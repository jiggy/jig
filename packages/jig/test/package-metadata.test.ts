import { describe, expect, test } from 'bun:test'

import { CheckError } from '../src/diagnostics.js'
import { parseFlowDocument, parseFlowMetadataSidecar } from '../src/package/metadata.js'

const encoder = new TextEncoder()
const flow = (frontmatter: string, body = ''): Uint8Array =>
  encoder.encode(`---\n${frontmatter}\n---\n${body}`)

describe('FLOW.md Metadata/0', () => {
  const featureParsers = [
    ['Markdown', (value: unknown) => parseFlowDocument(flow(JSON.stringify(value))).metadata],
    ['JSON', (value: unknown) => parseFlowMetadataSidecar(encoder.encode(JSON.stringify(value)))],
  ] as const

  for (const [owner, parse] of featureParsers) {
    test(`${owner} preserves optional feature declarations and their explicit presence`, () => {
      const metadata = parse({
        supports: ['sessions', 'conversation'],
        uses: {
          worker: { contract: './contracts/worker.json', requires: ['conversation'] },
          ordinary: { contract: './contracts/worker.json' },
          uncontracted: {},
        },
      })
      expect(metadata.supports).toEqual(['sessions', 'conversation'])
      expect(metadata.uses).toEqual({
        worker: { contract: './contracts/worker.json', requires: ['conversation'] },
        ordinary: { contract: './contracts/worker.json' },
        uncontracted: {},
      })
      expect(metadata.unknownFields).toEqual({})
      expect(Object.isFrozen(metadata.supports)).toBe(true)
      expect(Object.isFrozen(metadata.uses?.worker?.requires)).toBe(true)
      expect(parse({})).not.toHaveProperty('supports')
      expect(
        parse({ supports: [], uses: { worker: { contract: './worker.json', requires: [] } } }),
      ).toMatchObject({ supports: [], uses: { worker: { requires: [] } } })
      // Catalog membership belongs to aggregate inspection, not metadata parsing.
      expect(parse({ supports: ['not-in-a-catalog'] }).supports).toEqual(['not-in-a-catalog'])
    })

    test(`${owner} rejects malformed or duplicate feature names and misplaced requirements`, () => {
      for (const names of [
        null,
        true,
        'conversation',
        {},
        [true],
        [''],
        ['Conversation'],
        ['conversation\n'],
        ['a'.repeat(65)],
        ['events', 'events'],
      ]) {
        expectCheckError(() => parse({ supports: names }))
        expectCheckError(() =>
          parse({ uses: { worker: { contract: './worker.json', requires: names } } }),
        )
      }
      for (const declaration of [
        { requires: [] },
        { requires: ['events'] },
        { contract: './worker.json', supports: ['events'] },
        { contract: './worker.json', requires: [], unknown: true },
      ])
        expectCheckError(() => parse({ uses: { worker: declaration } }), 'METADATA_USES')
    })

    test(`${owner} uses inclusive feature list and LocalName bounds`, () => {
      const names = Array.from({ length: 256 }, (_, index) => `feature-${index}`)
      const metadata = parse({
        supports: names,
        uses: { worker: { contract: './worker.json', requires: names } },
      })
      expect(metadata.supports).toHaveLength(256)
      expect(metadata.uses?.worker?.requires).toHaveLength(256)
      expect(parse({ supports: ['a'.repeat(64)] }).supports).toEqual(['a'.repeat(64)])
      expectCheckError(() => parse({ supports: [...names, 'extra'] }), 'METADATA_LIMIT')
      expectCheckError(
        () =>
          parse({
            uses: {
              worker: {
                contract: './worker.json',
                requires: [...names, 'extra'],
              },
            },
          }),
        'METADATA_LIMIT',
      )
    })
  }

  test('accepts natural YAML feature lists and rejects duplicate members in either owner', () => {
    const metadata = parseFlowDocument(
      flow(`supports: [events, conversation]
uses:
  worker:
    contract: ./worker.json
    requires:
      - conversation`),
    ).metadata
    expect(metadata.supports).toEqual(['events', 'conversation'])
    expect(metadata.uses?.worker?.requires).toEqual(['conversation'])
    expectCheckError(() => parseFlowDocument(flow('supports: []\nsupports: []')))
    expectCheckError(() =>
      parseFlowMetadataSidecar(encoder.encode('{"supports":[],"supports":[]}')),
    )
    const duplicate = '{"uses":{"worker":{"contract":"./worker.json","requires":[],"requires":[]}}}'
    expectCheckError(() => parseFlowDocument(flow(duplicate)))
    expectCheckError(() => parseFlowMetadataSidecar(encoder.encode(duplicate)))
  })

  test('accepts the minimal Run form and preserves the Markdown body', () => {
    const parsed = parseFlowDocument(
      flow(
        'name: gauntlet-loop\ndescription: Build and review an artifact.',
        '# Procedure\n\r\nKeep these bytes.\n',
      ),
    )
    expect(parsed.metadata).toEqual({
      name: 'gauntlet-loop',
      description: 'Build and review an artifact.',
      extensions: {},
      unknownFields: {},
    })
    expect(parsed.markdown).toBe('# Procedure\n\r\nKeep these bytes.\n')
  })

  test('accepts Skill metadata, exact uses and inert JSON-shaped extensions', () => {
    const parsed = parseFlowDocument(
      flow(`name: document-index
description: >-
  Query a document index.
uses:
  agent:
    contract: ./contracts/agent.json
  scratch: {}
license: MIT
compatibility: Requires supplied text.
metadata:
  author: example
allowed-tools: Read
x-example:
  - null
  - true
  - 1.0
  - 2026-08-24`),
    )

    expect(parsed.metadata).toEqual({
      name: 'document-index',
      description: 'Query a document index.',
      uses: {
        agent: { contract: './contracts/agent.json' },
        scratch: {},
      },
      license: 'MIT',
      compatibility: 'Requires supplied text.',
      metadata: { author: 'example' },
      'allowed-tools': 'Read',
      extensions: { 'x-example': [null, true, 1, '2026-08-24'] },
      unknownFields: {},
    })
  })

  test('accepts mixed delimiter line endings and a closing delimiter at EOF', () => {
    const bytes = encoder.encode('---\r\nname: exact\ndescription: Exact.\r\n---')
    const parsed = parseFlowDocument(bytes)
    expect(parsed.metadata.name).toBe('exact')
    expect(parsed.markdown).toBe('')
  })

  for (const [name, bytes] of invalidDocuments()) {
    test(`rejects ${name}`, () => {
      expectCheckError(() => parseFlowDocument(bytes))
    })
  }

  test('counts description length in Unicode scalars', () => {
    expect(() =>
      parseFlowDocument(flow(`name: exact\ndescription: ${'😀'.repeat(16_384)}`)),
    ).not.toThrow()
    expectCheckError(() =>
      parseFlowDocument(flow(`name: exact\ndescription: ${'😀'.repeat(16_385)}`)),
    )
  })

  test('enforces the 256-entry container bound before field semantics', () => {
    const extensions = Array.from({ length: 254 }, (_, index) => `x-k${index}: null`).join('\n')
    expect(() =>
      parseFlowDocument(flow(`name: exact\ndescription: Exact.\n${extensions}`)),
    ).not.toThrow()
    expectCheckError(
      () =>
        parseFlowDocument(
          flow(
            `name: exact\ndescription: Exact.\n${extensions}\nx-overflow: null\nx-overflow-two: null`,
          ),
        ),
      'METADATA_LIMIT',
    )
  })

  test('bounds the LocalName suffix of extension keys', () => {
    const maximum = `x-${'a'.repeat(64)}`
    const parsed = parseFlowDocument(flow(`name: exact\ndescription: Exact.\n${maximum}: true`))
    expect(parsed.metadata.extensions[maximum]).toBe(true)

    const unknown = `x-${'a'.repeat(65)}`
    expect(parseFlowDocument(flow(`${unknown}: true`)).metadata.unknownFields[unknown]).toBe(true)
  })

  test('preserves unknown declarations for unsupported qualification without granting meaning', () => {
    const parsed = parseFlowDocument(flow('format: 2\nchannels: {forged: true}\nx-Bad: true'))
    expect(parsed.metadata.unknownFields).toEqual({
      format: 2,
      channels: { forged: true },
      'x-Bad': true,
    })
    expect(parsed.metadata.extensions).toEqual({})
    expect(Object.isFrozen(parsed.metadata.unknownFields)).toBe(true)
  })

  test('accepts absent or empty frontmatter and preserves inexact delimiters as prose', () => {
    for (const body of ['# Revise the input.\n', '--- \nname: exact\n---\n', '']) {
      const parsed = parseFlowDocument(encoder.encode(body))
      expect(parsed.metadata).toEqual({ extensions: {}, unknownFields: {} })
      expect(parsed.markdown).toBe(body)
    }
    for (const source of ['---\n---\n', '---\r---\r', '---\r\n---']) {
      expect(parseFlowDocument(encoder.encode(source))).toEqual({
        metadata: { extensions: {}, unknownFields: {} },
        markdown: '',
      })
    }
    expectCheckError(() => parseFlowDocument(encoder.encode('---')), 'METADATA_DELIMITER')
    expectCheckError(() => parseFlowDocument(flow('null')), 'METADATA_ROOT')
  })

  test('validates optional names/descriptions only when present', () => {
    expect(parseFlowDocument(flow('name: exact')).metadata.description).toBeUndefined()
    expect(parseFlowDocument(flow('description: Exact.')).metadata.name).toBeUndefined()
    expectCheckError(() => parseFlowDocument(flow('name: ""')))
    expectCheckError(() => parseFlowDocument(flow('description: ""')))
    expectCheckError(() => parseFlowDocument(flow('name: "exact\\n"')))
    expectCheckError(() => parseFlowDocument(flow('uses: {markdown-agent: {}}')), 'METADATA_USES')
  })

  test('code-side JSON metadata has the same fields and bounds without Markdown interpretation', () => {
    const parsed = parseFlowMetadataSidecar(
      encoder.encode(
        JSON.stringify({
          name: 'exact',
          'allowed-tools': '',
          metadata: { author: 'example' },
          uses: { 'markdown-agent': {} },
          unknown: true,
        }),
      ),
    )
    expect(parsed['allowed-tools']).toBe('')
    expect(parsed.unknownFields).toEqual({ unknown: true })
    expect(parsed.uses).toEqual({ 'markdown-agent': {} })
    for (const source of [
      'null',
      '{"name":"a","name":"b"}',
      '{"metadata":{"a":1}}',
      '{"allowed-tools":[]}',
    ]) {
      expectCheckError(() => parseFlowMetadataSidecar(encoder.encode(source)))
    }
    expectCheckError(
      () =>
        parseFlowMetadataSidecar(
          encoder.encode(JSON.stringify({ 'x-data': Array.from({ length: 257 }, () => null) })),
        ),
      'METADATA_LIMIT',
    )
    expectCheckError(() => parseFlowMetadataSidecar(new Uint8Array(262_145)), 'METADATA_LIMIT')
  })

  test('enforces frontmatter bytes, depth, and total nodes inclusively', () => {
    expect(() => parseFlowDocument(paddedDocument(262_144))).not.toThrow()
    expectCheckError(() => parseFlowDocument(paddedDocument(262_145)))

    expect(() =>
      parseFlowDocument(
        flow(`name: exact\ndescription: Exact.\nx-data: ${'['.repeat(14)}null${']'.repeat(14)}`),
      ),
    ).not.toThrow()
    expectCheckError(() =>
      parseFlowDocument(
        flow(`name: exact\ndescription: Exact.\nx-data: ${'['.repeat(15)}null${']'.repeat(15)}`),
      ),
    )

    expect(() => parseFlowDocument(flow(metadataWithNodeCount(4_096)))).not.toThrow()
    expectCheckError(() => parseFlowDocument(flow(metadataWithNodeCount(4_097))))
  })
})

function paddedDocument(bytesThroughClosingDelimiter: number): Uint8Array {
  const before = '---\nname: exact\ndescription: Exact.\nx-padding: "'
  const after = '"\n---\n'
  const padding =
    bytesThroughClosingDelimiter -
    encoder.encode(before).byteLength -
    encoder.encode(after).byteLength
  if (padding < 0) throw new Error('invalid test padding')
  return encoder.encode(`${before}${'a'.repeat(padding)}${after}`)
}

function metadataWithNodeCount(nodes: 4_096 | 4_097): string {
  // Root + three key/value pairs contribute seven nodes. The outer sequence
  // has 256 child sequences; the first 255 contribute sixteen nodes each.
  const finalItems = nodes - 4_088
  const full = `[${Array.from({ length: 15 }, () => 'null').join(',')}]`
  const last = `[${Array.from({ length: finalItems }, () => 'null').join(',')}]`
  return `name: exact\ndescription: Exact.\nx-data: [${[
    ...Array.from({ length: 255 }, () => full),
    last,
  ].join(',')}]`
}

function invalidDocuments(): Array<readonly [string, Uint8Array]> {
  const minimal = 'name: exact\ndescription: Exact.'
  return [
    ['UTF-8 BOM', Uint8Array.from([0xef, 0xbb, 0xbf, ...flow(minimal)])],
    ['invalid UTF-8 in the Markdown body', Uint8Array.from([...flow(minimal), 0xff])],
    ['a missing closing delimiter', encoder.encode(`---\n${minimal}\n`)],
    ['an inexact closing delimiter', encoder.encode(`---\n${minimal}\n--- \n`)],
    ['a duplicate key', flow('name: exact\nname: other\ndescription: Exact.')],
    ['an anchor', flow('name: &name exact\ndescription: Exact.')],
    ['an alias', flow('name: exact\ndescription: &text Exact.\nx-copy: *text')],
    ['an explicit tag', flow('name: exact\ndescription: !!str Exact.')],
    ['a non-string mapping key', flow('name: exact\ndescription: Exact.\n? [bad]\n: value')],
    ['non-string Skill metadata', flow(`${minimal}\nmetadata: {count: 1}`)],
    ['invalid tool declaration', flow(`${minimal}\nallowed-tools: [Read]`)],
    ['a non-object use declaration', flow(`${minimal}\nuses: {agent: true}`)],
    ['an unsafe JSON/0 number', flow(`${minimal}\nx-number: 9007199254740993`)],
    [
      'an escaping author reference',
      flow(`${minimal}\nuses:\n  agent:\n    contract: ../agent.json`),
    ],
    [
      'an unsupported invocation-use field',
      flow(`${minimal}\nuses:\n  agent:\n    contract: ./agent.json\n    local: true`),
    ],
  ]
}

function expectCheckError(action: () => unknown, code?: string): void {
  try {
    action()
    throw new Error('expected CheckError')
  } catch (error) {
    expect(error).toBeInstanceOf(CheckError)
    if (code !== undefined) expect((error as CheckError).code).toBe(code)
  }
}
