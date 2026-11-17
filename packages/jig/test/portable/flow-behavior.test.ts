import { expect, test } from 'bun:test'
import { renderFlowBehavior } from '../../src/cli-flow-behavior.js'
import { analyzeFlowBehavior } from '../../src/internal/flow-behavior/compose.js'
import type {
  BehaviorInput,
  BehaviorPackage,
  BehaviorTarget,
} from '../../src/internal/flow-behavior/model.js'

const handlerSource = (body: string) =>
  `import { handle } from '@jigging/flow'; await handle(async (run) => { ${body} });`
const method = (text: string, extensions: Partial<BehaviorPackage> = {}): BehaviorPackage => ({
  entry: 'FLOW.ts',
  sources: new Map([['FLOW.ts', text]]),
  ...extensions,
})
function snapshot(
  callee: BehaviorPackage,
  importer = method(
    handlerSource(`
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
        method(handlerSource(`return { outcome: 'done', output: { status: 'exported' } }`)),
      ],
    ]),
  }
}

test('a callee-only change alters the unchanged caller continuation', () => {
  const paths = (status: string) =>
    analyzeFlowBehavior(
      snapshot(
        method(handlerSource(`return { outcome: 'done', output: { status: '${status}' } }`)),
      ),
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
    opaque.scopes[0]!.alternatives.some(
      (route) =>
        route.some(
          (s) =>
            s.kind === 'call' && s.completion === 'if-returned' && s.result.includes('"blocked"'),
        ) && route.some((s) => s.kind === 'end' && s.detail.includes('"refused"')),
    ),
  ).toBe(true)
  const rejected = analyzeFlowBehavior(
    snapshot(
      method(handlerSource(`return { outcome: 'done', output: { status: 'ready' } }`), {
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
    handlerSource(`return { outcome: 'done', output: { status: 'needs_mapping' } }`),
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
    handlerSource(`
    const result = await run.call({ slot: 'converter', operationId: 'convert', input: {} })
    opaque(result)
    return result
  `),
  )
  const report = analyzeFlowBehavior(
    snapshot(
      method(handlerSource(`return { outcome: 'done', output: { status: 'ready' } }`)),
      root,
    ),
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

test('an unknown reporting payload leaves a later handoff visible', () => {
  const body = `
    import { handle } from '@jigging/flow'
    import { withReporting } from '@jigging/reporting'
    function describe(data: { title: string }) {
      return { summary: \`Preview: \${data.title?.trim() ?? 'Unknown'}\`, sections: [] }
    }
    await handle(run => withReporting(run, 'progress', async reporter => {
      reporter.view('progress').update(describe(run.input))
      return await run.call({ slot: 'converter', operationId: 'convert', input: {} })
    }))
  `
  const child = method(handlerSource(`return { outcome: 'done', output: { status: 'ready' } }`))
  const steps = analyzeFlowBehavior(
    snapshot(
      child,
      method(body, {
        reportingFiles: new Set(['FLOW.ts']),
      }),
    ),
  ).scopes[0]!.routes[0]!
  expect(steps).toEqual([
    expect.objectContaining({
      kind: 'effect',
      operation: 'view update',
      detail: 'display effect unknown',
    }),
    expect.objectContaining({ kind: 'call', slot: 'converter', completion: 'source-return' }),
    expect.objectContaining({ kind: 'end', detail: 'outcome "done", status = "ready"' }),
  ])
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

test('a grandchild contract alternative remains conditional in its callers', () => {
  const input = snapshot(
    method(
      handlerSource(`
      const answer = await run.call({ slot: 'review', operationId: 'review', input: {} })
      return { outcome: 'done', output: { status: answer.outcome === 'blocked' ? 'review' : 'ready' } }
    `),
    ),
    method(
      handlerSource(
        `return await run.call({ slot: 'converter', operationId: 'convert', input: {} })`,
      ),
    ),
  )
  const [root, middle, leaf] = input.targets
  const [scope] = analyzeFlowBehavior({
    ...input,
    targets: [
      root!,
      { ...middle!, slots: new Map([['review', leaf!.id]]) },
      { ...leaf!, outcomes: ['done', 'blocked'] },
    ],
  }).scopes
  expect(
    scope!.routes.flat().some((step) => step.kind === 'call' && step.result.includes('"review"')),
  ).toBe(false)
  expect(scope!.alternatives.flat()).toContainEqual(
    expect.objectContaining({
      kind: 'call',
      slot: 'converter',
      completion: 'if-returned',
      result: 'outcome "done", status = "review"',
      assumptions: [expect.objectContaining({ kind: 'contract-return', slot: 'review' })],
    }),
  )
})

test('opaque completion carries an earlier write without assigning it to every failure', () => {
  const input = snapshot(
    method(`
    import { handle } from '@jigging/flow'
    import { writeFile } from 'node:fs/promises'
    await handle(async () => {
      await writeFile('preview.json', 'sample')
      opaque()
    })
  `),
  )
  const [scope] = analyzeFlowBehavior(input).scopes
  const wrote = (route: (typeof scope.routes)[number]) =>
    route.some((step) => step.kind === 'effect' && step.operation === 'writeFile')
  expect(
    scope!.routes.some(
      (route) =>
        wrote(route) &&
        route.some(
          (step) =>
            step.kind === 'call' &&
            step.slot === 'converter' &&
            step.assumptions?.some((fact) => fact.kind === 'opaque-return'),
        ),
    ),
  ).toBe(true)
  expect(
    scope!.alternatives.some(
      (route) =>
        wrote(route) &&
        route.some(
          (step) => step.kind === 'call' && step.result === 'call fails after the known prefix',
        ),
    ),
  ).toBe(true)
  expect(
    scope!.alternatives.some(
      (route) =>
        !wrote(route) &&
        route.some(
          (step) =>
            step.kind === 'call' &&
            step.slot === 'converter' &&
            step.result === 'call or result admission fails',
        ),
    ),
  ).toBe(true)
})

test('additional contract outcomes leave the main diagram and source routes intact', () => {
  const slots = ['first', 'second', 'third', 'fourth']
  const initial = snapshot(
    method(handlerSource(`return { outcome: 'done', output: { status: 'ready' } }`)),
    method(
      handlerSource(
        slots
          .map((slot) => `await run.call({ slot: '${slot}', operationId: '${slot}', input: {} });`)
          .join('\n') + `return { outcome: 'done', output: {} }`,
      ),
    ),
  )
  const [root, worker] = initial.targets
  const build = (outcomes: string[]) =>
    analyzeFlowBehavior({
      ...initial,
      targets: [
        { ...root!, slots: new Map(slots.map((slot) => [slot, worker!.id])) },
        { ...worker!, outcomes },
      ],
    })
  const narrow = build(['done'])
  const wide = build(['done', 'blocked', 'limit'])
  const chart = (report: typeof wide) =>
    renderFlowBehavior(report).match(/```mermaid[\s\S]+?```/)?.[0]
  expect(chart(narrow)).toContain('fourth')
  expect(chart(wide)).toBe(chart(narrow))
  expect(wide.scopes[0]!.routes).toEqual(narrow.scopes[0]!.routes)
  expect(wide.scopes[0]!.alternatives.length).toBeGreaterThan(8)
})

test('an overbound scope is explicit and another target still has its source results', () => {
  const many = Array.from({ length: 6 }, (_, i) => `if (run.input.field${i}) {}\n`).join('')
  const report = analyzeFlowBehavior(
    snapshot(
      method(handlerSource(`return { outcome: 'done', output: { status: 'ready' } }`)),
      method(handlerSource(many + `return { outcome: 'done', output: {} }`)),
    ),
  )
  expect(report.scopes[0]?.routes).toEqual([])
  expect(report.scopes[0]?.gaps[0]?.reason).toContain('limit on alternatives')
  expect(report.scopes.find((scope) => scope.target === 'flow:flows/convert')?.routes).toHaveLength(
    1,
  )
})
