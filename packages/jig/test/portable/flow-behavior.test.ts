import { expect, test } from 'bun:test'
import { renderFlowBehavior } from '../../src/cli-flow-behavior.js'
import { analyzeFlowBehavior } from '../../src/internal/flow-behavior/compose.js'
import type {
  BehaviorInput,
  BehaviorPackage,
  BehaviorTarget,
} from '../../src/internal/flow-behavior/model.js'

const constructor = (body: string) =>
  `import { handle } from '@jigging/flow'; await handle(async (run) => { ${body} });`
const method = (text: string, extensions: Partial<BehaviorPackage> = {}): BehaviorPackage => ({
  entry: 'FLOW.ts',
  sources: new Map([['FLOW.ts', text]]),
  ...extensions,
})
function snapshot(
  callee: BehaviorPackage,
  importer = method(
    constructor(`
  const result = await run.call({ slot: 'converter', operationId: 'convert', input: {} })
  if (result.outcome === 'blocked') return { outcome: 'done', output: { status: 'refused' } }
  if (result.output.status === 'needs_mapping') return { outcome: 'done', output: { status: 'attention' } }
  const exporter = await run.call({ slot: 'exporter', operationId: 'export', input: result.output })
  return { outcome: 'done', output: { status: exporter.output.status } }
`),
  ),
): BehaviorInput {
  const targets: BehaviorTarget[] = [
    {
      id: 'binding:code',
      implementation: 'flows/import',
      settings: {},
      slots: new Map([
        ['converter', 'flow:flows/convert'],
        ['exporter', 'flow:flows/export'],
      ]),
      outcomes: ['done'],
    },
    {
      id: 'flow:flows/convert',
      implementation: 'flows/convert',
      settings: {},
      slots: new Map(),
      outcomes: ['done', 'blocked'],
    },
    {
      id: 'flow:flows/export',
      implementation: 'flows/export',
      settings: {},
      slots: new Map(),
      outcomes: ['done'],
    },
  ]
  return {
    revision: 'capture',
    focus: 'binding:code',
    targets,
    visible: targets.map((t) => t.id),
    packages: new Map([
      ['flows/import', importer],
      ['flows/convert', callee],
      [
        'flows/export',
        method(constructor(`return { outcome: 'done', output: { status: 'exported' } }`)),
      ],
    ]),
  }
}

test('a callee-only change alters the unchanged caller continuation', () => {
  const paths = (status: string) =>
    analyzeFlowBehavior(
      snapshot(method(constructor(`return { outcome: 'done', output: { status: '${status}' } }`))),
    ).scopes[0]!.routes
  const before = paths('ready').find(
    (p) => p.at(-1)?.kind === 'end' && p.at(-1)?.detail.includes('exported'),
  )!
  const after = paths('needs_mapping')
  expect(before.some((s) => s.kind === 'call' && s.slot === 'exporter')).toBe(true)
  expect(after.flat().some((s) => s.kind === 'call' && s.slot === 'exporter')).toBe(false)
  expect(after.flat()).toContainEqual(
    expect.objectContaining({ kind: 'end', detail: 'outcome "done", status = "attention"' }),
  )
})

test('opaque children retain hypothetical caller responses and concrete schema refusals suppress returns', () => {
  const opaque = analyzeFlowBehavior(
    snapshot(method('', { unavailable: 'Opaque implementation.' })),
  )
  expect(
    opaque.scopes[0]!.routes.some(
      (route) =>
        route.some(
          (s) =>
            s.kind === 'call' && s.completion === 'if-returned' && s.result.includes('"blocked"'),
        ) && route.some((s) => s.kind === 'end' && s.detail.includes('"refused"')),
    ),
  ).toBe(true)
  const rejected = analyzeFlowBehavior(
    snapshot(
      method(constructor(`return { outcome: 'done', output: { status: 'ready' } }`), {
        checkResult: () => false,
      }),
    ),
  )
  expect(rejected.scopes[0]!.routes.flat()).not.toContainEqual(
    expect.objectContaining({ completion: 'source-return' }),
  )
})

test('conditional publication follows closure state and the computed view payload', () => {
  const body = `
    import { handle } from '@jigging/flow'
    import { withReporting } from '@jigging/reporting'
    await handle(run => withReporting(run, 'progress', async reporter => {
      const view = reporter.view('progress')
      let state = { completed: 3, phase: 'checking' }
      const show = (phase: string) => {
        state = { ...state, phase }
        view.update({ sections: [{ blocks: [{ kind: 'progress', completed: Math.max(state.completed, state.phase === 'ready' ? 4 : 0), total: 4 }] }] })
      }
      const result = await run.call({ slot: 'converter', operationId: 'convert', input: {} })
      if (result.output.status === 'needs_mapping') {
        show('ready')
        return result
      }
      show('checking')
      return result
    }))
  `
  const child = method(
    constructor(`return { outcome: 'done', output: { status: 'needs_mapping' } }`),
  )
  const report = analyzeFlowBehavior(
    snapshot(child, method(body, { reportingFiles: new Set(['FLOW.ts']) })),
  )
  expect(report.scopes[0]!.routes.flat()).toContainEqual(
    expect.objectContaining({
      kind: 'effect',
      operation: 'view update',
      detail: 'progress 4/4',
    }),
  )
  const withoutProfile = analyzeFlowBehavior(snapshot(child, method(body)))
  expect(withoutProfile.scopes[0]!.gaps[0]?.reason).toContain('opaque')
  expect(renderFlowBehavior(withoutProfile)).not.toContain('progress 4/4')
})

test('unsupported mutation preserves the known prefix and stops before a stale return', () => {
  const root = method(
    constructor(`
    const result = await run.call({ slot: 'converter', operationId: 'convert', input: {} })
    opaque(result)
    return result
  `),
  )
  const report = analyzeFlowBehavior(
    snapshot(method(constructor(`return { outcome: 'done', output: { status: 'ready' } }`)), root),
  )
  const [scope] = report.scopes
  expect(scope!.routes.flat()).toContainEqual(
    expect.objectContaining({ kind: 'call', slot: 'converter', completion: 'source-return' }),
  )
  expect(scope!.routes.flat()).not.toContainEqual(
    expect.objectContaining({ kind: 'end', completion: 'return' }),
  )
  expect(scope!.gaps[0]?.reason).toBe('Opaque call may affect later behavior.')
})

test('a child write remains visible before a later child failure', () => {
  const child = method(`
    import { handle } from '@jigging/flow'
    import { writeFile } from 'node:fs/promises'
    await handle(async () => {
      await writeFile('preview.json', 'sample')
      throw new Error('Metadata rejected')
    })
  `)
  const report = analyzeFlowBehavior(snapshot(child))
  const route = report.scopes[0]!.routes.find((path) =>
    path.some((step) => step.kind === 'effect' && step.operation === 'writeFile'),
  )
  expect(route?.map((step) => step.kind)).toEqual(['effect', 'call', 'end'])
  expect(route?.[1]).toMatchObject({ kind: 'call', completion: 'if-failed' })
  expect(route?.[2]).toMatchObject({ kind: 'end', completion: 'throw' })
})

test('an overbound scope is explicit and another target still has its source results', () => {
  const many = Array.from({ length: 6 }, (_, i) => `if (run.input.field${i}) {}\n`).join('')
  const report = analyzeFlowBehavior(
    snapshot(
      method(constructor(`return { outcome: 'done', output: { status: 'ready' } }`)),
      method(constructor(many + `return { outcome: 'done', output: {} }`)),
    ),
  )
  expect(report.scopes[0]?.routes).toEqual([])
  expect(report.scopes[0]?.gaps[0]?.reason).toContain('limit on alternatives')
  expect(report.scopes.find((scope) => scope.target === 'flow:flows/convert')?.routes).toHaveLength(
    1,
  )
})
