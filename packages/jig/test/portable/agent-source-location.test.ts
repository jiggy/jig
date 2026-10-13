import { describe, expect, test } from 'bun:test'
import {
  type PrivateAgentSourceLocation,
  privateAgentGrantSourceLocation,
  privateAgentSourceLocations,
} from '../../src/project/agent-source-location.js'

const encoder = new TextEncoder()
const path = 'bindings/model.ts'
const ordinaryImport = "import { defineBinding } from '@jigging/jig'\n"

function binding(properties: string): string {
  return `${ordinaryImport}export default defineBinding({ package: 'npm:@jigging/agent-acp', ${properties} })`
}

function locate(source: string, client = 'pi') {
  return privateAgentSourceLocations(path, encoder.encode(source), { native: client }).native!
}

function textAt(source: string, location: PrivateAgentSourceLocation, length: number): string {
  const line = source.split(/\r\n|[\r\n\u2028\u2029]/)[location.line! - 1]!
  return [...line].slice(location.column! - 1, location.column! - 1 + length).join('')
}

describe('captured Agent source locations', () => {
  test('proves each direct client in a complete inert Binding and preserves source coordinates', () => {
    const source = [
      "import { defineBinding } from '@jigging/jig'",
      "/* π 😀 decoy client: 'claude' */",
      'export default defineBinding({',
      "  package: 'npm:@jigging/agent-acp',",
      '  slots: {',
      "    native: { kind: 'acp', client: 'pi', maxTurns: 2 },",
      "    'alternate': { kind: 'acp', client: 'claude' },",
      '  },',
      '})',
    ].join('\r\n')
    const facts = privateAgentSourceLocations(path, encoder.encode(source), {
      native: 'pi',
      alternate: 'claude',
      absent: 'codex',
    })
    expect(facts.native).toEqual({ path, line: 6, column: 36, kind: 'client-literal' })
    expect(textAt(source, facts.alternate!, 8)).toBe("'claude'")
    expect(facts.alternate!.kind).toBe('client-literal')
    expect(facts.absent).toEqual({ path, kind: 'unlocated' })
    expect(Object.isFrozen(facts)).toBe(true)
    expect(Object.isFrozen(facts.native)).toBe(true)
  })

  test('counts Unicode scalar columns and all source line terminators', () => {
    const source =
      ordinaryImport +
      "// decoy client: 'claude'\u2028" +
      "export default defineBinding({ package: '😀', slots: { native: { kind: 'acp', client: 'pi' } } })"
    const fact = locate(source)
    expect(fact.kind).toBe('client-literal')
    expect(fact.line).toBe(3)
    expect(textAt(source, fact, 4)).toBe("'pi'")
  })

  test('never treats comments, strings, another property or a mismatched client as the selected literal', () => {
    for (const source of [
      "/* export default defineBinding({ slots: { native: { kind: 'acp', client: 'pi' } } }) */\n" +
        binding('slots: {}'),
      binding('settings: { note: "slots: { native: { client: \'pi\' } }" }, slots: {}'),
      binding("settings: { client: 'pi' }, slots: { other: { kind: 'acp', client: 'pi' } }"),
    ])
      expect(locate(source)).toEqual({ path, kind: 'unlocated' })
    const source = binding("slots: { native: { kind: 'acp', client: 'codex' } }")
    const fact = locate(source, 'pi')
    expect(fact.kind).toBe('selection-context')
    expect(textAt(source, fact, 1)).toBe('{')
    expect(JSON.stringify(fact)).not.toContain('codex')
  })

  test('retains honest slot expression context only through the ordinary trusted import', () => {
    const sources = [
      binding("slots: { native: { ...shared, kind: 'acp', client: 'pi' } }"),
      binding("slots: { native: { kind: 'acp', client: 'codex', client: 'pi' } }"),
      binding("slots: { native: { kind: 'acp', ['client']: 'pi' } }"),
      binding("slots: { native: { kind: 'acp', client: selected } }"),
      binding("slots: { native: { kind: 'acp', client: 'pi' as const } }"),
      binding("slots: { native: { kind: 'acp', client: 'pi' } as Policy }"),
      binding('slots: { native: makePolicy() }'),
      binding("settings: readSettings(), slots: { native: { kind: 'acp', client: 'pi' } }"),
      binding("slots: { native: { kind: 'acp', client: '\\u0070i' } }"),
    ]
    for (const source of sources) {
      const fact = locate(source)
      expect(fact.kind).toBe('selection-context')
      expect(fact.line).toBeGreaterThan(0)
      expect(fact.column).toBeGreaterThan(0)
    }
  })

  test('uses file-only fallback when the originating slot expression is ambiguous', () => {
    const sources = [
      binding("slots: { native: { kind: 'acp', client: 'pi' } }").replace(
        "'@jigging/jig'\n",
        "'@jigging/jig' ",
      ),
      "import { shared } from './shared.ts'\n" + binding('slots: { native: shared }'),
      "const selected = 'pi'\n" + binding("slots: { native: { kind: 'acp', client: 'pi' } }"),
      binding("slots: { native: { kind: 'acp', client: 'pi' } }") + ' as const',
      binding("slots: { native: { kind: 'acp', client: 'pi' } }") + '; mutate() ',
      binding("slots: { native: { kind: 'acp', client: 'pi' } }").replace(' })', ' }, other)'),
      binding("slots: { native: { kind: 'acp', client: 'pi' } }, ...override"),
      binding("...base, slots: { native: { kind: 'acp', client: 'pi' } }"),
      binding("slots: {}, slots: { native: { kind: 'acp', client: 'pi' } }"),
      binding("slots: { native: { kind: 'acp', client: 'pi' }, ...override }"),
      binding("slots: { native: {}, native: { kind: 'acp', client: 'pi' } }"),
      binding("slots: { ['native']: { kind: 'acp', client: 'pi' } }"),
      binding('slots: sharedSlots'),
      "import { defineBinding as bind } from '@jigging/jig'\n" +
        "export default bind({ slots: { native: { kind: 'acp', client: 'pi' } } })",
      "const value = defineBinding({ slots: { native: { kind: 'acp', client: 'pi' } } })\n" +
        "value.slots.native.client = 'codex'\nexport default value",
      "export { default } from './another.ts'",
      "export default { slots: { native: { kind: 'acp', client: 'pi' } } }",
      binding("slots: { native: { kind: 'acp', client: 'pi' } }") + '\nexport default another',
    ]
    for (const source of sources) expect(locate(source)).toEqual({ path, kind: 'unlocated' })
  })

  test('never locates an ignored argument of a local defineBinding lookalike', () => {
    const decoy =
      "export default defineBinding({ slots: { native: { kind: 'acp', client: 'pi' } } })"
    const sources = [
      "const defineBinding = (ignored) => ({ slots: { native: { kind: 'acp', client: 'codex' } } })\n" +
        decoy,
      "function defineBinding(ignored) { return { slots: { native: { kind: 'acp', client: 'codex' } } } }\n" +
        decoy,
      "import { defineBinding } from './lookalike.ts'\n" + decoy,
    ]
    for (const source of sources)
      for (const client of ['codex', 'pi'])
        expect(locate(source, client)).toEqual({ path, kind: 'unlocated' })
  })

  test('never locates a trusted call used only as the condition of the exported selection', () => {
    const source =
      binding("slots: { native: { kind: 'acp', client: 'codex' } }") +
      " ? { kind: 'package', package: 'npm:@jigging/agent-acp', settings: {}, " +
      "slots: { native: { kind: 'acp', client: 'pi' } } } : null"
    for (const client of ['codex', 'pi'])
      expect(locate(source, client)).toEqual({ path, kind: 'unlocated' })
  })

  test('the supplied captured bytes determine coordinates despite later source edits', () => {
    let visibleSource = binding("slots: { native: { kind: 'acp', client: 'pi' } }")
    const captured = encoder.encode(visibleSource)
    visibleSource = '\n\n' + binding("slots: { native: { kind: 'acp', client: 'codex' } }")
    const fact = privateAgentSourceLocations(path, captured, { native: 'pi' }).native!
    expect(fact.kind).toBe('client-literal')
    expect(fact.line).toBe(2)
    expect(textAt(new TextDecoder().decode(captured), fact, 4)).toBe("'pi'")
    expect(locate(visibleSource, 'pi').kind).toBe('selection-context')
  })

  test('malformed, unsupported and bounded-out input degrades without inventing coordinates', () => {
    const malformed = [
      new Uint8Array([0xc3, 0x28]),
      encoder.encode(binding("slots: { native: { kind: 'acp', client: 'pi' } }").slice(0, -1)),
      encoder.encode(binding("slots: { native: /client: 'pi'/ }")),
      encoder.encode(binding('slots: { native: `client: pi` }')),
      encoder.encode("'unterminated"),
      encoder.encode('/* unterminated'),
      encoder.encode(' '.repeat(1024 * 1024 + 1)),
      encoder.encode(';'.repeat(32769)),
      encoder.encode('('.repeat(65) + ')'.repeat(65)),
    ]
    for (const bytes of malformed)
      expect(privateAgentSourceLocations(path, bytes, { native: 'pi' }).native).toEqual({
        path,
        kind: 'unlocated',
      })
  })
})

describe('captured named ACP policy locations', () => {
  const grantPath = 'grants/shared.json'

  test('locates the root client and ignores nested or string decoys', () => {
    const source =
      '{\r\n  "kind": "acp",\r\n  "client": "codex",\r\n' + '  "model": "client: pi 😀"\r\n}'
    const fact = privateAgentGrantSourceLocation(grantPath, encoder.encode(source), 'codex')
    expect(fact).toEqual({ path: grantPath, line: 3, column: 13, kind: 'client-literal' })
    expect(textAt(source, fact, 7)).toBe('"codex"')
    expect(Object.keys(fact).sort()).toEqual(['column', 'kind', 'line', 'path'])
  })

  test('supports valid JSON escaping while pointing to the actual captured token', () => {
    const source = '{"kind":"acp","\\u0063lient":"\\u0070i"}'
    const fact = privateAgentGrantSourceLocation(grantPath, encoder.encode(source), 'pi')
    expect(fact.kind).toBe('client-literal')
    expect(textAt(source, fact, 9)).toBe('"\\u0070i"')
  })

  test('refuses duplicate, malformed, wrong-client and non-ACP objects', () => {
    const sources = [
      '{"kind":"acp","client":"pi","client":"codex"}',
      '{"kind":"acp","kind":"acp","client":"codex"}',
      '{"kind":"acp","client":"codex","extra":{"a":1,"a":2}}',
      '{"kind":"acp","client":"pi"}',
      '{"kind":"http","client":"codex"}',
      '{"kind":"acp","note":"client codex"}',
      '{"kind":"acp","client":"codex",}',
      '{/* client */"kind":"acp","client":"codex"}',
      '[{"kind":"acp","client":"codex"}]',
      'null',
      '{"client":"codex"',
      ' '.repeat(32769),
    ]
    for (const source of sources)
      expect(privateAgentGrantSourceLocation(grantPath, encoder.encode(source), 'codex')).toEqual({
        path: grantPath,
        kind: 'unlocated',
      })
    expect(privateAgentGrantSourceLocation(grantPath, new Uint8Array([0xff]), 'codex')).toEqual({
      path: grantPath,
      kind: 'unlocated',
    })
  })
})
