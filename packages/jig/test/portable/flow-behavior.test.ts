import { expect, test } from 'bun:test'
import { renderFlowBehavior, renderFlowBehaviorComparison } from '../../src/cli-flow-behavior.js'
import {
  compareFlowBehavior,
  decodeFlowBehaviorSnapshot,
  encodeFlowBehaviorSnapshot,
  flowBehaviorSnapshot,
} from '../../src/internal/flow-behavior/comparison.js'
import { analyzeFlowBehavior } from '../../src/internal/flow-behavior/compose.js'
import type {
  BehaviorInput,
  BehaviorPackage,
  BehaviorTarget,
} from '../../src/internal/flow-behavior/model.js'
import { compileEmbeddedSchema, SchemaDiagnostic } from '../../src/schema/index.js'

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

test('Boolean guards keep both continuations visible and respect local shadowing', () => {
  const callee = method(handlerSource('return { outcome: "done", output: {} }'))
  const analyze = (body: string) =>
    analyzeFlowBehavior(snapshot(callee, method(handlerSource(body)))).scopes[0]!
  const guard = analyze(`
    if (Boolean(run.input.commission) === Boolean(run.input.continuation))
      return { outcome: 'done', output: { status: 'select one' } }
    await run.call({ slot: 'converter', operationId: 'convert', input: {} })
    return { outcome: 'done', output: { status: 'handled' } }
  `)
  expect(guard.routes.some((route) => route.some((step) => step.kind === 'call'))).toBe(true)
  expect(guard.routes.flat()).toContainEqual(
    expect.objectContaining({ kind: 'end', detail: 'outcome "done", status = "select one"' }),
  )
  const shadowed = analyze(`
    const Boolean = (_value: unknown) => false
    if (Boolean('yes')) throw new Error('wrong branch')
    return { outcome: 'done', output: {} }
  `)
  expect(shadowed.routes).toHaveLength(1)
  expect(shadowed.routes[0]!.at(-1)).toMatchObject({ kind: 'end', detail: 'outcome "done"' })
})

test('directly returned helper promises settle at the returning function boundary', () => {
  const callee = method(handlerSource('return { outcome: "done", output: {} }'))
  const check = (expression: string, finalizer = '') => {
    const source = handlerSource(`
      async function readingPlan(run, fail) {
        await run.call({ slot: 'converter', operationId: 'convert', input: {} })
        if (fail) throw new Error('rejected')
        return { outcome: 'done', output: { status: 'planned' } }
      }
      function argument() { throw new Error('argument') }
      try { ${expression} } catch {
        return { outcome: 'done', output: { status: 'caught' } }
      } ${finalizer}
    `)
    return analyzeFlowBehavior(snapshot(callee, method(source))).scopes[0]!
  }
  const direct = check('return readingPlan(run, run.input.fail)')
  expect(direct.routes.flat()).toContainEqual(
    expect.objectContaining({ kind: 'end', detail: 'outcome "done", status = "planned"' }),
  )
  expect(direct.routes.flat()).toContainEqual(
    expect.objectContaining({ kind: 'end', completion: 'throw' }),
  )
  expect(
    direct.routes.flat().some((step) => step.kind === 'end' && step.detail.includes('caught')),
  ).toBe(false)
  const awaited = check('return await readingPlan(run, true)')
  const argument = check('return readingPlan(run, argument())')
  for (const scope of [awaited, argument])
    expect(scope.routes.flat()).toContainEqual(
      expect.objectContaining({ kind: 'end', detail: 'outcome "done", status = "caught"' }),
    )
  expect(argument.routes.flat().some((step) => step.kind === 'call')).toBe(false)
  expect(check('readingPlan(run, true)').gaps[0]?.reason).toContain('unawaited helper')
  expect(check('return readingPlan(run, true)', 'finally {}').gaps[0]?.reason).toContain(
    'finalizer',
  )
})

test('focused orientation shows distinct slots and variant callers before analysis', () => {
  const focus = 'binding:chapter-reading'
  const baseline = 'binding:chapter-reading-baseline'
  const producer = 'binding:produce-book'
  const compare = 'binding:compare-writing'
  const target = (
    id: string,
    implementation: string,
    slots: [string, string][] = [],
    settings = {},
  ) => ({
    id,
    implementation,
    slots: new Map(slots),
    settings,
    outcomes: ['done'],
  })
  const targets = [
    target(compare, 'flows/compare', [
      ['current', focus],
      ['baseline', baseline],
    ]),
    target(focus, 'flows/draft-chapter', [], { prompt: 'reading' }),
    target(baseline, 'flows/draft-chapter', [], { prompt: 'baseline' }),
    target(producer, 'flows/produce', [
      ['chapter', focus],
      ['polish', focus],
    ]),
  ]
  const report = analyzeFlowBehavior({
    revision: 'capture',
    targets,
    focus,
    entrypoint: producer,
    visible: targets.map(({ id }) => id),
    packages: new Map(),
  })
  const orientation = renderFlowBehavior(report).split('## Configured targets')[0]!
  expect(orientation).toContain('binding:chapter-reading uses flows/draft-chapter.')
  expect(orientation).toContain('binding:produce-book · chapter')
  expect(orientation).toContain('binding:produce-book · polish')
  expect(orientation).toContain('binding:compare-writing · current')
  expect(orientation).toContain(
    'binding:chapter-reading-baseline · called by binding:compare-writing · baseline · settings differ: prompt = "baseline"',
  )
  const application = renderFlowBehavior({ ...report, focus: undefined })
  const opening = application.split('| Configured target')[0]!
  expect(opening).toContain('[binding:produce-book]')
  expect(opening).toContain('chapter → [binding:chapter-reading]')
  expect(opening).toContain('polish → [binding:chapter-reading]')
  expect(application.split('| --- | --- | --- | --- |\n')[1]).toStartWith(
    '| [binding:produce-book]',
  )
})

test('package inspection joins source sites to exact configured caller slots', () => {
  const input = snapshot(
    method(handlerSource(`return { outcome: 'done', output: { status: 'ready' } }`)),
  )
  const report = analyzeFlowBehavior({
    ...input,
    focus: undefined,
    packagePath: 'flows/convert',
    visible: ['binding:code', 'flow:flows/convert'],
  })
  const output = renderFlowBehavior(report)
  expect(output).toStartWith('# Flow package uses')
  expect(output).toContain('### flow:flows/convert')
  expect(output).toContain('- binding:code · converter · flows/import/FLOW.ts:2')
  expect(output).not.toContain('flow:flows/export')
  expect(output).not.toContain('mermaid')
  const opaque = renderFlowBehavior({ ...report, scopes: [] })
  expect(opaque).toContain('- binding:code · converter\n')
})

test('comparison round-trips a baseline and localizes changed effects to the configured use', () => {
  const caller = handlerSource(`
    const result = await run.call({slot:'converter',operationId:'convert',input:{}})
    if (run.settings.preview !== false)
      await run.call({slot:'exporter',operationId:'export',input:result.output})
    return {outcome:'done',output:result.output}
  `)
  const project = snapshot(method(handlerSource(`return {outcome:'done',output:{status:'ready'}}`)))
  const [code, ...direct] = project.targets
  const capture = (preview: boolean, shift: string) => {
    const targets = [
      code!,
      { ...code!, id: 'binding:validation', settings: { preview } },
      ...direct,
    ]
    return flowBehaviorSnapshot(
      analyzeFlowBehavior({
        ...project,
        revision: 'sha256:' + (preview ? 'a' : 'b').repeat(64),
        focus: undefined,
        visible: targets.map((item) => item.id),
        targets,
        packages: new Map([...project.packages, ['flows/import', method(shift + caller)]]),
      }),
    )
  }
  const bytes = Buffer.from(encodeFlowBehaviorSnapshot(capture(true, '')))
  const before = decodeFlowBehaviorSnapshot(bytes)
  const unchanged = compareFlowBehavior(before, capture(true, '\n// Shift source locations.\n'))
  expect(unchanged.changes).toHaveLength(0)

  const diff = compareFlowBehavior(before, capture(false, '\n'))
  expect(diff.changes.map((change) => change.id)).toEqual(['binding:validation'])
  expect(diff.changes[0]?.settingsChanged).toBe(true)
  expect(
    diff.changes[0]?.removedPaths.some(([, facts]) =>
      facts.some(([kind, detail]) => kind === 'call' && detail.includes('exporter')),
    ),
  ).toBe(true)
  expect(
    diff.changes[0]?.addedPaths.every(([, facts]) =>
      facts.every(([kind, detail]) => kind !== 'call' || !detail.includes('exporter')),
    ),
  ).toBe(true)
  const summary = renderFlowBehaviorComparison(diff)
  expect(summary).toContain('## binding:validation')
  expect(summary).toContain('Removed · exporter → flow:flows/export')
  expect(summary).not.toContain('converter → flow:flows/convert')
  expect(renderFlowBehaviorComparison(diff, true)).toContain('converter → flow:flows/convert')
  expect(() => decodeFlowBehaviorSnapshot(Buffer.from('{"format":"jig.flow-behavior/1"}'))).toThrow(
    'Jig behavior snapshot',
  )
})

test('comparison keeps paths with the same checks unpaired when correspondence is ambiguous', () => {
  const captured = flowBehaviorSnapshot(
    analyzeFlowBehavior(
      snapshot(method(handlerSource(`return {outcome:'done',output:{status:'ready'}}`))),
    ),
  )
  const make = (results: readonly string[]): typeof captured => ({
    ...captured,
    targets: [
      {
        ...captured.targets[0]!,
        paths: results.map((result) => ({
          kind: 'source',
          facts: [['exit', result, ['flows/import/FLOW.ts', 23]]],
        })),
      },
    ],
  })
  const diff = compareFlowBehavior(make(['first', 'second']), make(['third', 'fourth']))
  const summary = renderFlowBehaviorComparison(diff)
  expect(summary).toContain('Unmatched paths · 2 before, 2 after')
  expect(summary).not.toContain('first')
  const detail = renderFlowBehaviorComparison(diff, true)
  expect(detail).toContain('first · flows/import/FLOW.ts:23')
  expect(detail).toContain('[flows/import/FLOW.ts:23](./flows/import/FLOW.ts#L23)')
  expect(() =>
    decodeFlowBehaviorSnapshot(
      Buffer.from(
        encodeFlowBehaviorSnapshot(make(['first'])).replace(
          'flows/import/FLOW.ts',
          '../outside.ts',
        ),
      ),
    ),
  ).toThrow('Jig behavior snapshot')
})

test('unmatched source paths disclose writes without pairing changed checks', () => {
  const report = flowBehaviorSnapshot(
    analyzeFlowBehavior(
      snapshot(method(handlerSource(`return {outcome:'done',output:{status:'ready'}}`))),
    ),
  )
  const site = ['flows/import/FLOW.ts', 25] as const
  const withGuard = (guard: string, write: boolean): typeof report => ({
    ...report,
    targets: [
      {
        ...report.targets[0]!,
        paths: [
          {
            kind: 'source',
            facts: [
              ['check', guard, site],
              ...(write
                ? [['effect', 'writeFile · preview.json (binding:code)', site] as const]
                : []),
              ['exit', 'return · done', site],
            ],
          },
        ],
      },
    ],
  })
  const diff = compareFlowBehavior(withGuard('Previous', true), withGuard('Current', false))
  const summary = renderFlowBehaviorComparison(diff)
  expect(summary).toContain('Baseline source paths only · writeFile · preview.json')
  expect(summary).toContain('Unmatched paths · 1 before, 1 after')
  expect(summary).not.toContain('Removed · writeFile')
})

test('unmatched paths retain newly captured call order without inventing baseline order', () => {
  const report = flowBehaviorSnapshot(
    analyzeFlowBehavior(
      snapshot(method(handlerSource(`return {outcome:'done',output:{status:'ready'}}`))),
    ),
  )
  type CapturedPath = (typeof report.targets)[number]['paths'][number]
  const path = (kind: CapturedPath['kind'], guard: string, ...slots: string[]): CapturedPath => ({
    kind,
    facts: [
      ['check', guard, ['flows/import/FLOW.ts', 12]],
      ...slots.map(
        (slot, offset) =>
          ['call', slot + ' → flow:flows/' + slot, ['flows/import/FLOW.ts', 15 + offset]] as const,
      ),
    ],
  })
  const capture = (...paths: CapturedPath[]): typeof report => ({
    ...report,
    targets: [{ ...report.targets[0]!, paths }],
  })
  const baseline = capture(path('source', 'Before', 'release'), path('authored', 'Later', 'export'))
  const next = capture(path('source', 'After', 'export', 'release'))
  const render = (old: typeof report, current: typeof report) =>
    renderFlowBehaviorComparison(compareFlowBehavior(old, current))
  const result = render(baseline, next)
  expect(result).toContain(
    'Captured call order · export before release · 1 source path · baseline order unresolved',
  )
  expect(result).toContain('[flows/import/FLOW.ts:15](./flows/import/FLOW.ts#L15)')
  expect(render(capture(path('source', 'Before', 'release', 'export')), next)).toContain(
    'opposite order in baseline source paths',
  )
  expect(
    render(capture(path('source', 'Before', 'export', 'review', 'release')), next),
  ).not.toContain('Captured call order')
  expect(
    render(baseline, capture(path('conditional', 'After', 'export', 'release'))),
  ).not.toContain('Captured call order')
  expect(
    render(baseline, capture(path('source', 'After', 'export', 'release', 'export'))),
  ).not.toContain('Captured call order')
  expect(
    render(
      baseline,
      capture(
        path('source', 'First', 'export', 'release'),
        path('source', 'Second', 'release', 'export'),
      ),
    ),
  ).not.toContain('Captured call order')
})

test('a new callee return keeps the existing call case link attached to its result', () => {
  const caller = method(
    handlerSource(`
    const converted = await run.call({slot:'converter',operationId:'convert',input:run.input})
    return {outcome:'done',output:converted.output}
  `),
  )
  const render = (early: string) =>
    renderFlowBehavior(
      analyzeFlowBehavior(
        snapshot(
          method(
            handlerSource(`
      ${early}
      if (run.input.special) return {outcome:'done', output:{status:'special'}}
      return {outcome:'done', output:{status:'other'}}
    `),
          ),
          caller,
        ),
      ),
    )
  const before = render('')
  const after = render(`if (run.input.added) return {outcome:'done', output:{status:'new'}}`)
  const link = /<a id="(call-converter-[a-f0-9]+-path-[a-f0-9]+)"><\/a>\*\*[^\n]+status = "special"/
  const id = before.match(link)?.[1]
  expect(id).toBeDefined()
  expect(after.match(link)?.[1]).toBe(id)
  expect(after).toContain('status = "new"')
})

test('short-circuited values keep their truth without becoming Booleans', () => {
  for (const operation of ['||', '&&']) {
    const expected = operation === '||'
    const input = snapshot(
      method(
        handlerSource(`
      let usedFallback = false
      const selected = run.input.name ${operation} (usedFallback = true)
      if (selected) return {outcome:'done', output:{selected, usedFallback, truth:'true'}}
      return {outcome:'done', output:{selected, usedFallback, truth:'false'}}
    `),
      ),
    )
    const routes = analyzeFlowBehavior({ ...input, focus: 'flow:flows/convert' }).scopes[0]!.routes
    const short = routes.filter((route) => route.at(-1)?.detail.includes('usedFallback = false'))
    expect(short).toHaveLength(1)
    expect(short[0]?.at(-1)?.detail).toContain('truth = "' + expected + '"')
    expect(short[0]?.at(-1)?.detail).not.toContain('selected = ')
    expect(routes.some((route) => route.at(-1)?.detail.includes('selected = true'))).toBe(true)
  }
})

test('authored handoffs retain caller exit checks beyond an opaque operation', () => {
  const caller = method(
    handlerSource(`
    opaque()
    if (run.input.confirmed) {
      const result = await run.call({ slot: 'converter', intent: 'Check records' })
      if (result.outcome === 'blocked') return { outcome: 'done', output: {} }
      await run.call({ slot: 'exporter', intent: 'Write checked records' })
    }
    if (run.input.preview) {
      const run = { call() {} }
      run.call({ slot: 'converter', intent: 'Unrelated receiver' })
    }
    await run.call({ slot: 'converter', ...other })
  `),
  )
  const input = snapshot(method(handlerSource(`return { outcome: 'done', output: {} }`)), caller)
  const report = analyzeFlowBehavior({ ...input, focus: undefined })
  const scope = report.scopes.find((item) => item.target === 'binding:code')!
  expect(scope.routes.flat().some((step) => step.kind === 'call')).toBe(false)
  expect(scope.authoredHandoffs).toMatchObject([
    {
      slot: 'converter',
      target: 'flow:flows/convert',
      intent: 'Check records',
      guards: [{ code: 'run.input.confirmed', taken: true }],
      exitChecks: [{ code: "result.outcome === 'blocked'", taken: true, exit: 'return' }],
    },
    { slot: 'exporter', target: 'flow:flows/export', intent: 'Write checked records' },
  ])
  const rendered = renderFlowBehavior(report)
  expect(rendered).toContain('Reachability, order, and results remain unresolved.')
  expect(rendered).toMatch(/converter → \[flow:flows\/convert\]\(#target-/)
  expect(rendered).toContain('true branch ends with return')
  expect(rendered).not.toContain('Unrelated receiver')
})

test('a known configured early return leaves no speculative exporter handoff', () => {
  const caller = method(
    handlerSource(`
    const labels = run.input.labels.map(label => {
      if (!label) throw new TypeError('Supply a label')
      return label
    })
    if (run.settings.validateOnly) return { outcome: 'done', output: { labels } }
    return await run.call({ slot: 'exporter', operationId: 'export', input: { labels } })
  `),
  )
  const input = snapshot(method(handlerSource(`return { outcome: 'done', output: {} }`)), caller)
  const report = analyzeFlowBehavior({
    ...input,
    targets: input.targets.map((target) =>
      target.id === 'binding:code' ? { ...target, settings: { validateOnly: true } } : target,
    ),
  })
  const scope = report.scopes[0]!
  expect(scope.gaps[0]?.reason).toContain('assumes mapping completes')
  expect(scope.authoredHandoffs).toBeUndefined()
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

test('a known undeclared outcome is refused both directly and through its caller', () => {
  const path = 'flows/convert/FLOW.contract.json'
  const input = snapshot(
    method(
      `
    import {handle} from '@jigging/flow'
    import {writeFile} from 'node:fs/promises'
    await handle(async run => {
      await writeFile('draft.json', '{}')
      return {outcome:'review', output:{status:'draft'}}
    })
  `,
      { contractPath: path },
    ),
  )
  const report = analyzeFlowBehavior({ ...input, focus: 'flow:flows/convert' })
  const [scope] = report.scopes
  const route = scope?.routes[0]
  expect(route?.map((step) => step.kind)).toEqual(['effect', 'end'])
  expect(route?.at(-1)).toMatchObject({
    completion: 'rejected',
    detail: 'The target does not declare outcome "review".',
    contractPath: path,
    site: { path: 'flows/convert/FLOW.ts', line: 6 },
  })
  const lines = renderFlowBehavior(report)
  expect(lines).toContain('### Result contract checks')
  expect(lines).toContain(path)
  const caller = report.scopes.find((item) => item.target === 'binding:code')
  expect(caller?.routes[0]?.map((step) => step.kind)).toEqual(['effect', 'call', 'end'])
  expect(caller?.routes[0]?.[1]).toMatchObject({
    completion: 'if-failed',
    result: 'The target does not declare outcome "review".',
  })
})

test('standalone schema checks reject concrete results and leave unknown values unresolved', () => {
  const schema = compileEmbeddedSchema(
    {
      type: 'object',
      properties: { output: { type: 'number' } },
      required: ['output'],
    },
    { path: 'flows/convert/FLOW.contract.json' },
  )
  const inspect = (output: string) => {
    const input = snapshot(
      method(handlerSource(`return {outcome:'done', output:${output}}`), {
        checkResult(value) {
          try {
            schema.validate(value, 'INVALID_RESULT')
            return true
          } catch (error) {
            if (error instanceof SchemaDiagnostic) return false
            throw error
          }
        },
      }),
    )
    return analyzeFlowBehavior({ ...input, focus: 'flow:flows/convert' }).scopes[0]?.routes[0]?.at(
      -1,
    )
  }
  expect(inspect('"unacceptable"')).toMatchObject({
    completion: 'rejected',
    detail: 'The known result fails its declared schema.',
  })
  expect(inspect('run.input.value')).toMatchObject({ completion: 'return' })
})

test('negative numeric literals preserve the source branch after a lookup sentinel', () => {
  const child = method(
    handlerSource(`
    if (run.input.index === -1) return {outcome:'done', output:{status:'missing'}}
    return {outcome:'done', output:{status:'found'}}
  `),
  )
  const importer = method(
    handlerSource(`
    return await run.call({slot:'converter', operationId:'convert', input:{index:-1}})
  `),
  )
  const routes = analyzeFlowBehavior(snapshot(child, importer)).scopes[0]?.routes
  expect(routes).toHaveLength(1)
  expect(routes?.[0]?.at(-1)).toMatchObject({ detail: 'outcome "done", status = "missing"' })
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
  const repaired = analyzeFlowBehavior(
    snapshot(
      child,
      method(body.replace("show('ready')", "show('checking')"), {
        reportingFiles: new Set(['FLOW.ts']),
      }),
    ),
  )
  const comparison = compareFlowBehavior(
    flowBehaviorSnapshot(report),
    flowBehaviorSnapshot(repaired),
  )
  const reportingLine = body.split('\n').findIndex((line) => line.includes("show('ready')")) + 1
  const rendered = renderFlowBehaviorComparison(comparison)
  expect(rendered).toContain('Requested progress 4/4 → 3/4')
  expect(rendered).toContain(
    `[flows/import/FLOW.ts:${reportingLine}](./flows/import/FLOW.ts#L${reportingLine})`,
  )
  expect(rendered).not.toContain('converter → flow:flows/convert')
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

test('finite Set spreads and formatting preserve progress before an opaque import', () => {
  const importer = method(
    `
    import { handle } from '@jigging/flow'
    import { withReporting } from '@jigging/reporting'
    import { access } from 'node:fs/promises'
    const total = 2 * 3
    function panel() {
      const marks = [...new Set(['check', 'check', -0, 0])]
      const sections = [{ blocks: [{ kind: 'progress', completed: marks.length, total: 1 / marks[1] > 0 ? total : 1 }] }]
      if (marks.length > total) sections.push(...sections.splice(0, 1))
      return { sections }
    }
    await handle(run => withReporting(run, 'progress', async reporter => {
      reporter.view('progress').update(panel())
      await access('unknown.txt')
      return { outcome: 'done', output: {} }
    }))
  `,
    { reportingFiles: new Set(['FLOW.ts']) },
  )
  const input = snapshot(method(handlerSource(`return { outcome: 'done', output: {} }`)), importer)
  const scope = analyzeFlowBehavior(input).scopes[0]!
  expect(scope.routes[0]).toMatchObject([
    { kind: 'effect', operation: 'view update', detail: 'progress 2/6' },
    { kind: 'end', completion: 'unknown', detail: 'Opaque imported call: node:fs/promises.' },
  ])
})

test('read-only file validation branches retain cleanup and file effect order', () => {
  const caller = method(`
    import { handle } from '@jigging/flow'
    import { constants as flags } from 'node:fs'
    import { open } from 'node:fs/promises'
    async function inspectCatalogue(maximumBytes: number) {
      const file = await open('catalogue.json', flags.O_RDONLY | flags.O_NOFOLLOW)
      try {
        const metadata = await file.stat()
        if (!metadata.isFile() || metadata.size > maximumBytes) throw new TypeError('Supply a bounded regular file')
        await file.readFile()
        return { outcome: 'done', output: { status: 'checked' } }
      } finally {
        await file.close()
      }
    }
    await handle(async () => inspectCatalogue(1024))
  `)
  const report = analyzeFlowBehavior(snapshot(method(''), caller))
  const routes = report.scopes[0]!.routes
  const operations = (route: (typeof routes)[number]) =>
    route.flatMap((step) => (step.kind === 'effect' ? [step.operation] : []))
  const accepted = routes.find((route) => {
    const stop = route.at(-1)
    return stop?.kind === 'end' && stop.completion === 'return' && stop.detail.includes('checked')
  })!
  const refused = routes.find((route) => {
    const stop = route.at(-1)
    return (
      stop?.kind === 'end' &&
      stop.completion === 'throw' &&
      stop.detail.includes('Supply a bounded regular file')
    )
  })!
  expect(operations(accepted)).toEqual(['open', 'stat', 'readFile', 'close'])
  expect(operations(refused)).toEqual(['open', 'stat', 'close'])
  expect(
    routes.some(
      (route) =>
        operations(route).includes('readFile') &&
        route.some(
          (step) => step.kind === 'condition' && step.code === '!metadata.isFile()' && step.taken,
        ),
    ),
  ).toBe(false)
  expect(routes.some((route) => operations(route).join(',') === 'open')).toBe(true)
  expect(renderFlowBehavior(report)).toContain('File operations attempted')
  const markdown = renderFlowBehavior(report)
  expect(markdown).toContain('Attempts readFile')
  expect(markdown).toMatch(/assume true \(!metadata\.isFile/)
  expect(markdown).toMatch(/assume false \(!metadata\.isFile/)
  expect(markdown).toContain('before check: maximumBytes = 1024')
})

test('a child read sequence stays in its expansion while the write reaches the caller', () => {
  const child = method(`
    import { handle } from '@jigging/flow'
    import { open, writeFile } from 'node:fs/promises'
    await handle(async () => {
      const file = await open('catalogue.json')
      const bytes = await file.readFile()
      await file.close()
      await writeFile('preview.json', bytes)
      return {outcome:'done', output:{status:'ready'}}
    })
  `)
  const report = analyzeFlowBehavior(
    snapshot(
      child,
      method(
        handlerSource(`
    const result = await run.call({slot:'converter',operationId:'check',input:{}})
    if (result.outcome === 'blocked') return {outcome:'done',output:{status:'refused'}}
    return {outcome:'done',output:{status:'ready'}}
  `),
      ),
    ),
  )
  const scope = report.scopes[0]!
  expect(
    scope.routes
      .flat()
      .filter((step) => step.kind === 'effect')
      .map((step) => step.operation),
  ).toEqual(['writeFile'])
  expect(
    scope.routes.flat().filter((step) => step.kind === 'call' && step.result === 'Throws'),
  ).toMatchObject([{ representativeChild: true }])
  expect(
    scope.alternatives
      .flat()
      .some((step) => step.kind === 'end' && step.detail.includes('refused')),
  ).toBe(true)
  const markdown = renderFlowBehavior(report)
  expect(markdown).toContain('Read-only file attempts')
  expect(markdown).toMatch(
    /Read-only file attempts[^\n]+Attempts open[^\n]+Attempts readFile[^\n]+Attempts close/,
  )
  const diagram = markdown.match(/\x60\x60\x60mermaid([\s\S]+?)\x60\x60\x60/)?.[1]
  expect(diagram).toContain('Attempts writeFile')
  expect(diagram).not.toContain('Attempts open')
})

test('strict decoding and parsing preserve distinct failures before effects', () => {
  const inspect = (decoder: string) =>
    analyzeFlowBehavior(
      snapshot(
        method(''),
        method(`
          import { handle } from '@jigging/flow'
          import { open, writeFile } from 'node:fs/promises'
          await handle(async () => {
            const file = await open('catalogue.json', 'r')
            const bytes = await file.readFile()
            await file.close()
            try {
              const text = ${decoder}.decode(bytes)
              const input = JSON.parse(text)
              if (!Array.isArray(input)) throw new TypeError('Expected an array')
              await writeFile('approved.json', text)
              return { outcome: 'done', output: {} }
            } catch (error) {
              throw error
            }
          })
        `),
      ),
    )
  const report = inspect("new TextDecoder('utf-8', { fatal: true })")
  const routes = report.scopes[0]!.routes
  const end = (route: (typeof routes)[number], detail: string) =>
    route.some((step) => step.kind === 'end' && step.detail === detail)
  const writes = (route: (typeof routes)[number]) =>
    route.some((step) => step.kind === 'effect' && step.operation === 'writeFile')
  for (const failure of ['Throws TypeError', 'Throws SyntaxError', 'Throws: Expected an array']) {
    const route = routes.find((candidate) => end(candidate, failure))
    expect(route).toBeDefined()
    expect(writes(route!)).toBe(false)
  }
  expect(routes.some(writes)).toBe(true)
  const markdown = renderFlowBehavior(report)
  expect(markdown).toContain('UTF-8 decoding succeeds')
  expect(markdown).toContain('JSON syntax is valid')
  expect(markdown).toContain('Throws SyntaxError')
  const syntaxFailure = routes.find((route) => end(route, 'Throws SyntaxError'))!
  const syntaxCheck = syntaxFailure.find(
    (step) => step.kind === 'condition' && step.code === 'JSON syntax is valid',
  )!
  expect(syntaxFailure.at(-1)?.site).toEqual(syntaxCheck.site)
  expect(markdown).toContain('Throws: Expected an array')
  const opaque = inspect("new TextDecoder('utf-8', { fatal: false })")
  expect(opaque.scopes[0]!.routes.some(writes)).toBe(false)
  expect(renderFlowBehavior(opaque)).not.toContain('UTF-8 decoding succeeds')
})

test('writable opens and reads through a closed alias stay unresolved', () => {
  const inspect = (flags: string) =>
    analyzeFlowBehavior(
      snapshot(
        method(''),
        method(`
    import { handle } from '@jigging/flow'
    import { open } from 'node:fs/promises'
    import { constants } from 'node:fs'
    await handle(async () => {
      const file = await open('catalogue.json', ${flags})
      const alias = file
      try {} finally { await file.close() }
      await alias.readFile()
      return { outcome: 'done', output: {} }
    })
  `),
      ),
    ).scopes[0]!
  const writable = inspect('constants.O_RDONLY | constants.O_CREAT')
  expect(writable.routes[0]?.[0]).toMatchObject({ kind: 'end', completion: 'unknown' })
  const closed = inspect("'r'")
  expect(closed.routes.flat()).not.toContainEqual(
    expect.objectContaining({ operation: 'readFile' }),
  )
  expect(closed.gaps).toContainEqual(
    expect.objectContaining({ reason: 'File handle use after a close attempt is unresolved.' }),
  )
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

test('large data-only view formatting leaves its caller route and progress uncertainty visible', () => {
  const branches = Array.from(
    { length: 7 },
    (_, index) => `if (input.field${index}) { label = 'option ${index}' }`,
  ).join('\n')
  const caller = method(
    `
    import {handle} from '@jigging/flow'
    import {withReporting} from '@jigging/reporting'
    function render(input) {
      let label = 'default'
      ${branches}
      return {summary: label, sections: []}
    }
    await handle(run => withReporting(run, 'progress', async reporter => {
      reporter.view('progress').update(render(run.input))
      return await run.call({slot: 'converter', operationId: 'convert', input: {}})
    }))
  `,
    { reportingFiles: new Set(['FLOW.ts']) },
  )
  const child = method(handlerSource(`return {outcome:'done', output:{status:'ready'}}`))
  const report = analyzeFlowBehavior(snapshot(child, caller))
  const [scope] = report.scopes
  expect(scope?.gaps).toEqual([
    expect.objectContaining({ reason: 'Reporting payload exceeded its data analysis allowance.' }),
  ])
  expect(scope?.routes.flat()).toContainEqual(
    expect.objectContaining({ kind: 'call', slot: 'converter' }),
  )
  expect(renderFlowBehavior(report)).toContain('display effect unknown')
})

test('the diagram attaches an unresolved callee condition to each affected completion', () => {
  const child = method(
    handlerSource(`
    if (run.settings.refuse || run.input.review) return {outcome:'blocked', output:{reason:'Review'}}
    return {outcome:'done', output:{status:'ready'}}
  `),
  )
  const input = snapshot(
    child,
    method(
      handlerSource(`
    const child = await run.call({slot:'converter', operationId:'convert', input:run.input})
    return {outcome:'done', output:{status: child.outcome === 'blocked' ? 'review' : 'ready'}}
  `),
    ),
  )
  const rendered = renderFlowBehavior(analyzeFlowBehavior(input))
  const chart = rendered.match(/```mermaid[\s\S]+?```/)?.[0]
  expect(chart).toMatch(
    /Unresolved check at flows\/convert\/FLOW\.ts:2 · assume true.+converter returns/,
  )
  expect(chart).toMatch(
    /Unresolved check at flows\/convert\/FLOW\.ts:2 · assume false.+converter returns/,
  )
  expect(rendered).toContain('### Consequences')
})

test('a shared child keeps the inputs and continuations of its configured callers', () => {
  const child = method(
    handlerSource(`
    if (run.input.mode === 'audit') return {outcome:'blocked', output:{reason:'Review'}}
    return {outcome:'done', output:{status:'ready'}}
  `),
  )
  const input = snapshot(
    child,
    method(
      handlerSource(`
    const child = await run.call({slot:'converter', operationId:'convert', input:run.settings})
    if (child.outcome === 'blocked') return {outcome:'done', output:{status:'refused'}}
    return await run.call({slot:'exporter', operationId:'export', input:child.output})
  `),
    ),
  )
  const root = input.targets[0]!
  const code = { ...root, settings: { mode: 'code' } }
  const audit = { ...root, id: 'binding:audit', settings: { mode: 'audit' } }
  const inspect = (focus: string) =>
    renderFlowBehavior(
      analyzeFlowBehavior({
        ...input,
        focus,
        targets: [code, audit, ...input.targets.slice(1)],
        visible: [...input.visible, audit.id],
      }),
    )
  const section = (output: string, caller: string) =>
    output.split('### converter in ' + caller + '\n')[1]?.split('\n### ')[0] ?? ''
  const codeMap = inspect(code.id)
  const auditMap = inspect(audit.id)
  expect(section(codeMap, code.id)).toContain('mode = "code"')
  expect(section(codeMap, code.id)).toMatch(/Back in binding:code[^\n]+Call exporter/)
  expect(section(auditMap, audit.id)).toContain('mode = "audit"')
  expect(section(auditMap, audit.id)).toMatch(/Back in binding:audit[^\n]+status = "refused"/)
  const link = codeMap.match(/\[converter\]\(#(call-converter-[^)]+)\)/)?.[1]
  expect(link).toBeDefined()
  expect(codeMap).toContain('<a id="' + link + '"></a>')
  expect(auditMap).not.toContain('<a id="' + link + '"></a>')
})

test('two uses of a slot on one source line have distinct expansion anchors', () => {
  const worker = method(handlerSource(`return {outcome:'done', output:{status:run.input.mode}}`))
  const input = snapshot(
    worker,
    method(
      handlerSource(`
    const first = await run.call({slot:'converter', operationId:'first', input:{mode:'first'}}); const second = await run.call({slot:'converter', operationId:'second', input:{mode:'second'}});
    return second
  `),
    ),
  )
  const rendered = renderFlowBehavior(analyzeFlowBehavior(input))
  const anchors = [...rendered.matchAll(/\[converter\]\(#(call-converter-[^)]+)\)/g)].map(
    (match) => match[1],
  )
  expect(new Set(anchors).size).toBe(2)
  for (const anchor of anchors) expect(rendered).toContain('<a id="' + anchor + '"></a>')
  expect(rendered).toContain('mode = "first"')
  expect(rendered).toContain('mode = "second"')
})

test('a guard before a child write labels the incoming edge and later guards stay after the write', () => {
  const child = method(`
    import { handle } from '@jigging/flow'
    import { writeFile } from 'node:fs/promises'
    await handle(async run => {
      if (!run.input.allow) throw new Error('No write allowed')
      await writeFile('preview.json', 'sample')
      if (!run.input.valid) throw new Error('Metadata rejected')
      return {outcome:'done', output:{status:'ready'}}
    })
  `)
  const root = method(
    handlerSource(
      `return await run.call({slot:'converter', operationId:'convert', input:run.input})`,
    ),
  )
  const rendered = renderFlowBehavior(analyzeFlowBehavior(snapshot(child, root)))
  const chart = rendered.match(/```mermaid[\s\S]+?```/)?.[0] ?? ''
  const writeLine = chart.split('\n').find((line) => line.includes('Attempts writeFile'))
  expect(writeLine).toContain('!run.input.allow')
  expect(writeLine).not.toContain('!run.input.valid')
  expect(chart).toMatch(/!run\.input\.valid[^\n]+converter (returns|failed)/)
  const expansion = rendered.split('### converter in binding:code')[1] ?? ''
  expect(expansion).toMatch(
    /Child path[^\n]+run\.input\.allow[^\n]+writeFile[^\n]+run\.input\.valid/,
  )
  expect(expansion).toContain('Metadata rejected')
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

test('a route limit preserves the established handoff and keeps omissions visible', () => {
  const many = Array.from({ length: 6 }, (_, i) => `if (run.input.field${i}) {}\n`).join('')
  const report = analyzeFlowBehavior(
    snapshot(
      method(handlerSource(`return { outcome: 'done', output: { status: 'ready' } }`)),
      method(
        handlerSource(
          `await run.call({slot:'converter', operationId:'check', input:{}});\n` +
            many +
            `return { outcome: 'done', output: {} }`,
        ),
      ),
    ),
  )
  const routes = report.scopes[0]?.routes ?? []
  expect(routes.length).toBeGreaterThan(1)
  expect(routes.length).toBeLessThanOrEqual(32)
  expect(
    routes.some(
      (route) =>
        route.at(-1)?.kind === 'end' &&
        route.at(-1)?.detail.includes('limit on alternatives') &&
        route.some((step) => step.kind === 'call' && step.slot === 'converter'),
    ),
  ).toBe(true)
  expect(
    routes.some((route) =>
      route.some((step) => step.kind === 'end' && step.completion === 'return'),
    ),
  ).toBe(true)
  expect(report.scopes[0]?.gaps[0]?.reason).toContain('limit on alternatives')
  expect(report.scopes.find((scope) => scope.target === 'flow:flows/convert')?.routes).toHaveLength(
    1,
  )
})

test('repeated failures do not hide a distinct return at the alternatives limit', () => {
  const split = Array.from({ length: 5 }, (_, i) => `if (run.input.field${i}) {}`).join('\n')
  const result = snapshot(
    method(
      handlerSource(`
        if (run.input.unavailable) {
          ${split}
          throw new Error('Unavailable')
        } else {
          return {outcome:'done', output:{status:'ready'}}
        }
      `),
    ),
  )
  const scope = analyzeFlowBehavior({ ...result, focus: 'flow:flows/convert' }).scopes[0]!
  expect(scope.routes.flat()).toContainEqual(
    expect.objectContaining({
      kind: 'end',
      completion: 'return',
      detail: 'outcome "done", status = "ready"',
    }),
  )
  expect(scope.routes.flat()).toContainEqual(
    expect.objectContaining({ kind: 'end', completion: 'throw', detail: 'Throws: Unavailable' }),
  )
  expect(scope.gaps.some((gap) => gap.reason.includes('limit on alternatives'))).toBe(true)
})

test('the chart and overview reserve space for distinct outcomes', () => {
  const refusals = Array.from(
    { length: 5 },
    (_, index) => `
    if (run.input.case === ${index}) return {outcome:'blocked', output:{reason:'reason-${index}'}}
  `,
  ).join('\n')
  const input = snapshot(
    method(
      handlerSource(`
    ${refusals}
    return {outcome:'done', output:{status:'ready'}}
  `),
    ),
  )
  const report = analyzeFlowBehavior({ ...input, focus: undefined })
  const rendered = renderFlowBehavior(report)
  const overview = rendered.split('## Flow ')[0] ?? ''
  const row = overview.split('\n').find((line) => line.startsWith('| [flow:flows/convert]'))
  expect(row).toContain('Returns "blocked"')
  expect(row).toContain('Returns "done"')
  const scope = rendered.split('## Flow flows/convert\n')[1] ?? ''
  const chart = scope.match(/\x60\x60\x60mermaid([\s\S]+?)\x60\x60\x60/)?.[1]
  expect(chart).toContain('Returns &#34;blocked&#34;')
  expect(chart).toContain('Returns &#34;done&#34;')
})

test('a finite array repeats the same call site and an early return skips later iterations', () => {
  const child = method(
    handlerSource(`
    if (run.input.stage === 'review' && run.input.refuse)
      return {outcome:'blocked', output:{reason:'Needs review'}}
    return {outcome:'done', output:{status:run.input.stage}}
  `),
  )
  const caller = method(
    handlerSource(`
    for (const stage of ['check', 'review', 'publish']) {
      const result = await run.call({slot:'converter', operationId:stage, input:{stage, refuse:run.input.refuse}})
      if (result.outcome === 'blocked') return {outcome:'done', output:{status:'blocked early'}}
    }
    return {outcome:'done', output:{status:'published'}}
  `),
  )
  const report = analyzeFlowBehavior(snapshot(child, caller))
  const routes = report.scopes[0]?.routes ?? []
  const calls = (status: string) =>
    routes
      .find((route) => route.some((step) => step.kind === 'end' && step.detail.includes(status)))
      ?.filter((step) => step.kind === 'call')
  expect(calls('blocked early')?.map((step) => step.returned?.outcome)).toEqual([
    '"done"',
    '"blocked"',
  ])
  expect(calls('published')?.map((step) => step.returned?.fields[0]?.[1])).toEqual([
    '"check"',
    '"review"',
    '"publish"',
  ])
  expect(new Set(calls('published')?.map((step) => step.site.identity)).size).toBe(1)
  expect(renderFlowBehavior(report)).toContain('up to 3 times')
})

test('a bounded data map preserves validation failures before a write', () => {
  const inspect = (items: string) =>
    analyzeFlowBehavior({
      ...snapshot(
        method(`
          import { handle } from '@jigging/flow'
          import { writeFile } from 'node:fs/promises'
          function check(item: string, index: number) {
            if (item === '') throw new TypeError('Name is empty')
            return item + index * 2
          }
          await handle(async () => {
            const names = ['one', ...${items}].map(check)
            await writeFile(names[1], 'prepared')
            return { outcome: 'done', output: { status: names[1] } }
          })
        `),
      ),
      focus: 'flow:flows/convert',
    }).scopes[0]!.routes[0]!

  expect(inspect("['two']")).toMatchObject([
    { kind: 'condition', taken: false },
    { kind: 'condition', taken: false },
    { kind: 'effect', operation: 'writeFile', detail: '"two2"' },
    { kind: 'end', completion: 'return', detail: 'outcome "done", status = "two2"' },
  ])
  expect(inspect("['']")).toMatchObject([
    { kind: 'condition', taken: false },
    { kind: 'condition', taken: true },
    { kind: 'end', completion: 'throw', detail: 'Throws: Name is empty' },
  ])
})

test('an unresolved data map shows its conditional continuation without hiding opaque callbacks', () => {
  const inspect = (check: string) =>
    analyzeFlowBehavior(
      snapshot(
        method(handlerSource(`return { outcome: 'done', output: {} }`)),
        method(
          handlerSource(`
            const labels = run.input.items.map((label) => {
              ${check}
              return label
            })
            await run.call({slot:'converter', operationId:'prepare', input:{labels}})
            return { outcome: 'done', output: {} }
          `),
        ),
      ),
    ).scopes[0]!

  const data = inspect(`if (label === '') throw new TypeError('Empty label')`)
  expect(data.routes[0]).toMatchObject([
    { kind: 'gap', detail: expect.stringContaining('assumes mapping completes') },
    { kind: 'call', slot: 'converter' },
    { kind: 'end', completion: 'return' },
  ])
  const opaque = inspect(`external(label)`)
  expect(opaque.routes[0]).toMatchObject([{ kind: 'end', completion: 'unknown' }])
})

test('an empty error subclass can be caught without folding ordinary TypeError into the refusal', () => {
  const caller = method(`
    import {handle} from '@jigging/flow'
    import {validate, Refusal} from './policy.ts'
    await handle(async (run) => {
      try {
        validate(run.input)
      } catch (error) {
        if (!(error instanceof Refusal)) throw error
        return {outcome:'done', output:{reason:error.message}}
      }
      return {outcome:'done', output:{status:'valid'}}
    })
  `)
  const pkg: BehaviorPackage = {
    ...caller,
    sources: new Map([
      ...caller.sources,
      [
        'policy.ts',
        `
    export class Refusal extends TypeError {}
    export function validate(input) {
      if (input.refuse) throw new Refusal('Needs review')
      if (input.fail) throw new TypeError('Invalid value')
    }
  `,
      ],
    ]),
  }
  const child = method(handlerSource(`return {outcome:'done', output:{}}`))
  const report = analyzeFlowBehavior(snapshot(child, pkg))
  const rendered = renderFlowBehavior(report)
  expect(rendered).toContain('reason = "Needs review"')
  expect(rendered).toContain('status = "valid"')
  expect(rendered).toContain('Throws: Invalid value')
})

test('equivalent suffixes converge while different return values keep separate continuations', () => {
  const project = snapshot(
    method(handlerSource(`return {outcome:'done', output:{status:'ready'}}`)),
  )
  const chart = (tail: string) => {
    const parent = method(
      handlerSource(`
      let status
      if (run.input.forward) {
        const converted = await run.call({slot:'converter', operationId:'convert', input:{}})
        status = converted.output.status
      } else {
        const exported = await run.call({slot:'exporter', operationId:'export', input:{}})
        status = exported.output.status
      }
      return {outcome:'done', output:{status:${tail}}}
    `),
    )
    const packages = new Map(project.packages)
    packages.set('flows/import', parent)
    const rendered = renderFlowBehavior(analyzeFlowBehavior({ ...project, packages }))
    return rendered.match(/```mermaid[\s\S]+?```/)?.[0] ?? ''
  }
  const joined = [...chart("'complete'").matchAll(/--> (\w+)\["Returns[^\n]+complete/g)]
  expect(joined).toHaveLength(2)
  expect(joined[0]?.[1]).toBe(joined[1]?.[1])
  const distinct = [...chart('status').matchAll(/--> (\w+)\["Returns[^\n]+status/g)]
  expect(distinct).toHaveLength(2)
  expect(distinct[0]?.[1]).not.toBe(distinct[1]?.[1])
})

test('an application map keeps configured continuations separate under one chart per Flow', () => {
  const project = snapshot(
    method(handlerSource(`return {outcome:'done', output:{status:'ready'}}`)),
    method(
      handlerSource(`
      if (run.settings.audit) return {outcome:'done', output:{status:'audit'}}
      return await run.call({slot:'converter', operationId:'convert', input:{}})
    `),
    ),
  )
  const [main, ...direct] = project.targets
  if (!main) throw Error('Expected a configured entrypoint')
  const audit = { ...main, id: 'binding:audit', settings: { audit: true } }
  const targets = [main, audit, ...direct]
  const captured = (shift: string) =>
    renderFlowBehavior(
      analyzeFlowBehavior({
        ...project,
        focus: undefined,
        entrypoint: main.id,
        visible: targets.map((target) => target.id),
        targets,
        packages: new Map([
          ...project.packages,
          [
            main.implementation,
            method(shift + project.packages.get(main.implementation)?.sources.get('FLOW.ts')),
          ],
        ]),
      }),
    )
  const before = captured('')
  const after = captured('// A change before the handler\n')
  const mainChart = before.split('## Flow flows/import\n')[1]?.split('\n## Flow ')[0] ?? ''
  const auditSection = mainChart.split('### binding:audit\n')[1] ?? ''
  expect(before.match(/^## Flow flows\/import$/gm)).toHaveLength(1)
  expect(before).toContain('Project entrypoint')
  expect(before).toMatch(/flow:flows\/export[^\n]+Direct Flow[^\n]+exported/)
  expect(mainChart.match(/```mermaid/g)).toHaveLength(1)
  expect(mainChart).toContain('["binding:audit"]')
  expect(auditSection).toContain('status = "audit"')
  expect(auditSection).not.toContain('### converter in')
  expect(before).toContain('[Configured child](#target-')
  const anchors = [...before.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1])
  const links = [...before.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((m) => m[1])
  expect(new Set(anchors).size).toBe(anchors.length)
  for (const link of links) expect(anchors).toContain(link)
  const call = before.match(/<a id="(call-converter-[a-f0-9]+)"><\/a>/)?.[1]
  expect(call).toBeDefined()
  expect(after).toContain('<a id="' + call + '"></a>')
})
