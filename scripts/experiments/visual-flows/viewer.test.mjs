import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Script } from 'node:vm'
import { projectGraph } from './lock-graph.mjs'
import { componentSelection, defaultGraphIndex, displayNodeKind, edgeLabel, evidenceText, graphRoots, isRuntimeGraph, layoutGraph, nodeSource, preserveCaseSelection, renderExplorer, scopeExits, selectedCaseObservation, selectedInvestigationContext } from './viewer.mjs'

const sley = JSON.parse(await readFile(new URL('./sley-example.json', import.meta.url), 'utf8'))
const digest = `sha256:${'a'.repeat(64)}`
const pkg = (extra = {}) => ({ digest, directRun: true, uses: {}, ...extra })
const example = graph => ({ title: 'Example', graph })
const small = () => ({ nodes: [{ id: 'a', kind: 'node', label: 'A' }], edges: [], warnings: [] })

function embeddedData(html) {
  const match = html.match(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script\b[^>]*>/iu)
  assert.ok(match, 'one inert graph-data block is present')
  return { encoded: match[1], decoded: JSON.parse(match[1]) }
}

test('hostile labels and titles remain inert JSON and escaped title text', () => {
  const payloads = [
    '</script><script>globalThis.injection = true</script><img src=x onerror=alert(1)> & " \u2028 \u2029',
    '</ScRiPt><SCRIPT>globalThis.injection = true</SCRIPT><IMG src=x onerror=alert(1)> & " \u2028 \u2029',
    '</script ><script>globalThis.injection = true</script ><img src=x onerror=alert(1)> & " \u2028 \u2029',
    '</script\t\n bar><script>globalThis.injection = true</script foo="bar"><img src=x onerror=alert(1)> & " \u2028 \u2029',
  ]
  for (const hostile of payloads) {
    const graph = small()
    graph.nodes[0].label = hostile
    const items = [{ title: hostile, summary: hostile, graph }]
    const html = renderExplorer({ title: hostile, graphs: items })
    const data = embeddedData(html)
    assert.deepEqual(data.decoded, items)
    assert.equal(/[<>&\u2028\u2029]/u.test(data.encoded), false)
    assert.equal(html.toLowerCase().includes('<script>globalthis.injection'), false)
    assert.ok(html.toLowerCase().includes('<title>&lt;/script'))
    assert.equal(html.toLowerCase().includes('<img'), false)
    assert.ok(html.includes('onerror=alert(1)&gt;'))
    assert.ok(html.includes(' &amp; &quot; '))
    assert.equal([...html.matchAll(/<script\b[^>]*>/giu)].length, 2)
  }
})

test('generated executable script parses, including the exact shared helpers', () => {
  const html = renderExplorer({ graphs: [example(sley), example(small())] })
  // Inspect this renderer's bounded output. These helpers do not sanitize HTML.
  const endings = ['</script>', '</ScRiPt \t>', '</script\t\n bar>', '</script foo="bar">']
  for (const ending of endings) {
    const page = html.replaceAll('</script>', ending)
    assert.deepEqual(embeddedData(page).decoded, [example(sley), example(small())])
    const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/giu)]
    const executable = scripts.filter(match => !match[1].includes('application/json'))
    assert.equal(executable.length, 1)
    assert.doesNotThrow(() => new Script(executable[0][2], { filename: 'generated-explorer.js' }))
    assert.ok(executable[0][2].includes(layoutGraph.toString()))
    assert.ok(executable[0][2].includes(componentSelection.toString()))
    assert.ok(executable[0][2].includes(selectedCaseObservation.toString()))
    assert.ok(executable[0][2].includes(selectedInvestigationContext.toString()))
  }
  // Syntax and pure geometry checks are not browser execution or visual QA.
})

test('lock inventories retain structural hierarchy even though every runnable target is a possible root', () => {
  const graph = projectGraph({
    packages: {
      'flows/parent': pkg({ uses: { child: {} }, slots: { child: { kind: 'flow', path: 'flows/child' } } }),
      'flows/child': pkg(),
    },
    bindings: {},
  })
  assert.deepEqual(graph.provenance.roots, ['flow:flows/child', 'flow:flows/parent'])
  assert.deepEqual(graphRoots(graph), ['flow:flows/parent'])
  const { positions } = layoutGraph(graph)
  assert.equal(positions.get('flow:flows/parent').rank, 0)
  assert.equal(positions.get('flow:flows/child').rank, 1)
})

test('actual Sley entry and scope exits survive without invented callback edges', () => {
  assert.deepEqual(graphRoots(sley), ['sley:element:1'])
  const nested = sley.nodes.find(node => node.label === 'Draft / check loop')
  assert.deepEqual(scopeExits(sley, nested), ['accepted', 'exhausted'])
  const { declaredExits, ...scopeOnly } = nested
  assert.deepEqual(scopeExits(sley, scopeOnly), ['accepted', 'exhausted'])
  const check = sley.nodes.find(node => node.label === 'Check')
  assert.deepEqual(sley.edges.filter(edge => edge.source === check.id).map(edgeLabel), ['revise'])
  assert.equal(layoutGraph(sley).edgePaths.size, sley.edges.length)
})

test('ordinary unlabelled runtime links are not described as scope entries', () => {
  assert.equal(edgeLabel({ label: 'unlabelled', action: null, meaning: 'declared-link' }), 'unlabelled')
  assert.equal(edgeLabel({ action: null, meaning: 'declared-link' }), 'unlabelled')
  assert.equal(edgeLabel({ action: null, meaning: 'scope-entry' }), 'entry')
  assert.equal(edgeLabel({ slot: 'child', meaning: 'may-invoke' }), 'child')
})

test('runtime classification follows the topology contract rather than the presence of run records', () => {
  assert.equal(isRuntimeGraph({ ...sley, runs: [] }), true)
  assert.equal(isRuntimeGraph({ ...small(), runs: sley.runs, provenance: { source: 'jig.lock' } }), false)
  assert.equal(displayNodeKind({ kind: 'flow', runnable: false }, small()), 'Flow · not direct')
  assert.equal(displayNodeKind(sley.nodes[0], sley), 'Scope')
})

test('source locations and conditional evidence wording reflect the supplied data', () => {
  const location = { path: 'bindings/review.ts', line: 12, column: 7 }
  assert.deepEqual(nodeSource({ location }), location)
  assert.match(evidenceText(sley).text, /reports zero handler entries/u)
  assert.doesNotMatch(evidenceText({ ...sley, provenance: {} }).text, /reports zero handler entries/u)
  assert.match(evidenceText({ ...sley, provenance: {} }).text, /does not verify/u)
  assert.match(evidenceText({ ...small(), provenance: { source: 'jig.lock' } }).heading, /supplied lock/u)
})

test('parallel slots have separate paths and labels', () => {
  const graph = {
    nodes: [{ id: 'a', kind: 'flow' }, { id: 'b', kind: 'flow' }],
    edges: ['first', 'second'].map(slot => ({ id: slot, source: 'a', target: 'b', slot, meaning: 'may-invoke' })),
  }
  const paths = [...layoutGraph(graph).edgePaths.values()]
  assert.notEqual(paths[0].path, paths[1].path)
  assert.notDeepEqual([paths[0].labelX, paths[0].labelY], [paths[1].labelX, paths[1].labelY])
})

test('the Sley exhausted edge stays in the sibling gutter, away from incoming labels', () => {
  const { positions, edgePaths } = layoutGraph(sley)
  const edge = sley.edges.find(edge => edge.action === 'exhausted')
  const source = positions.get(edge.source), target = positions.get(edge.target)
  const geometry = edgePaths.get(edge.id)
  assert.equal(source.y, target.y)
  const left = source.x + source.width, right = target.x
  assert.ok(geometry.labelY > source.y && geometry.labelY < source.y + source.height)
  assert.ok(geometry.labelX - geometry.labelWidth / 2 > left)
  assert.ok(geometry.labelX + geometry.labelWidth / 2 < right)
  const coordinates = geometry.path.match(/-?\d+(?:\.\d+)?/gu).map(Number)
  for (let index = 0; index < coordinates.length; index += 2) {
    assert.ok(coordinates[index] >= left && coordinates[index] <= right)
    assert.ok(coordinates[index + 1] > source.y && coordinates[index + 1] < source.y + source.height)
  }
})

test('fit bounds include feedback curves, self-loops, and label extents', () => {
  const cyclic = {
    nodes: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, kind: 'node' })),
    edges: [
      { id: 'de', source: 'd', target: 'e', meaning: 'declared-link' },
      { id: 'ed', source: 'e', target: 'd', meaning: 'declared-link' },
      { id: 'aa', source: 'a', target: 'a', meaning: 'declared-link' },
    ],
  }
  for (const graph of [sley, cyclic]) {
    const { dimensions: view, positions, edgePaths } = layoutGraph(graph)
    for (const box of positions.values()) {
      assert.ok(box.x >= view.x && box.x + box.width <= view.x + view.width)
      assert.ok(box.y >= view.y && box.y + box.height <= view.y + view.height)
    }
    for (const { bounds } of edgePaths.values()) {
      assert.ok(bounds.left >= view.x && bounds.right <= view.x + view.width)
      assert.ok(bounds.top >= view.y && bounds.bottom <= view.y + view.height)
    }
  }
  const view = layoutGraph(cyclic).dimensions
  assert.ok(view.y < 0, 'the fitted view includes arcs above the first node row')
  assert.ok(view.width > 1074, 'the fitted view includes feedback labels beyond the rightmost node')
})

test('the lock projection remains redacted inside the HTML and its embedded export data', () => {
  const secret = 'SECRET-do-not-embed'
  const graph = projectGraph({
    entrypoint: `binding:request --input ${secret}`,
    packages: { 'flows/request': pkg({ directRun: false }) },
    bindings: {
      request: {
        packagePath: 'flows/request', settings: { token: secret },
        slots: { service: { kind: 'grant', policy: { kind: 'http', url: `https://${secret}.invalid` } } },
        attachments: { source: { source: secret, files: [{ path: secret }], digest } },
      },
    },
  })
  const html = renderExplorer({ graphs: [example(graph)] })
  assert.equal(html.includes(secret), false)
  assert.deepEqual(embeddedData(html).decoded[0].graph, graph)
  assert.equal(embeddedData(html).decoded[0].graph.provenance.approval, 'not-verified')
})

test('raw locks, missing endpoints, duplicate IDs, and malformed observations fail before producing HTML', () => {
  const invalid = [
    { packages: {}, bindings: {} },
    { ...small(), nodes: [{ id: 'a', kind: 'node' }, { id: 'a', kind: 'node' }] },
    { ...small(), edges: [{ id: 'missing', source: 'a', target: 'missing', meaning: 'may-invoke' }] },
    { ...small(), warnings: [null] },
    { ...small(), runs: [{ observations: [null] }] },
    { ...small(), runs: [{ nodeCounts: { a: -1 } }] },
    { ...small(), runs: [{ nodeCounts: { missing: 1 } }] },
    { ...small(), nodes: [{ id: 'a', kind: 'scope', declaredExits: 'accepted' }] },
    { ...small(), root: 'missing' },
  ]
  for (const graph of invalid) assert.throws(() => renderExplorer({ graphs: [example(graph)] }), TypeError)
})

test('empty inventories render an empty bounded graph rather than crashing layout', () => {
  const graph = projectGraph({ packages: {}, bindings: {} })
  assert.equal(layoutGraph(graph).positions.size, 0)
  assert.ok(layoutGraph(graph).dimensions.width > 0)
  assert.doesNotThrow(() => renderExplorer({ graphs: [example(graph)] }))
})

test('the initial application is selected by retained runtime cases, independently of labels', () => {
  const source = { title: 'Sley', graph: small() }
  assert.equal(defaultGraphIndex([source, { title: 'A captured application', graph: sley }]), 1)
  assert.equal(defaultGraphIndex([source, example(small())]), 0)
  assert.equal(defaultGraphIndex([source, example({ ...small(), runs: sley.runs })]), 1)
})

test('case changes preserve the selected component and repeated visit through a missing-case gap', () => {
  const check = sley.nodes.find(node => node.label === 'Check')
  const accepted = sley.runs.find(run => run.id === 'accepted-after-revision')
  const rejected = sley.runs.find(run => run.id === 'rejected-before-drafting')
  const exhausted = sley.runs.find(run => run.id === 'exhausted')
  const original = { nodeId: check.id, runId: accepted.id, observationIndex: 5, visitOrdinal: 2 }
  const gap = preserveCaseSelection(sley, original, rejected.id)
  assert.deepEqual(gap, { nodeId: check.id, runId: rejected.id, observationIndex: null, visitOrdinal: 2 })
  assert.equal(selectedCaseObservation(sley, rejected, gap), undefined)
  const restored = preserveCaseSelection(sley, gap, accepted.id)
  assert.deepEqual(restored, original)
  const changedCase = preserveCaseSelection(sley, original, exhausted.id)
  assert.equal(changedCase.observationIndex, 5)
  assert.equal(selectedCaseObservation(sley, exhausted, changedCase).action, 'exhausted')
  assert.equal(selectedCaseObservation(sley, accepted, original).action, 'accepted')
})

test('changing the component in Overview cannot show the prior component observation in Recorded cases', () => {
  const run = sley.runs.find(value => value.id === 'accepted-after-revision')
  const check = sley.nodes.find(node => node.label === 'Check')
  const draft = sley.nodes.find(node => node.label === 'Draft')
  const selectedCheck = { nodeId: check.id, runId: run.id, observationIndex: 5, visitOrdinal: 2 }
  // The browser calls this same transition in both modes. Overview does not erase the remembered case.
  const selectedDraft = componentSelection(sley, selectedCheck, draft.id)
  assert.deepEqual(selectedDraft, { nodeId: draft.id, runId: run.id, observationIndex: 2, visitOrdinal: 1 })
  assert.equal(selectedCaseObservation(sley, run, selectedDraft).nodeId, draft.id)
  assert.equal(selectedCaseObservation(sley, run, { ...selectedDraft, observationIndex: 5 }), undefined)
  assert.deepEqual(componentSelection(sley, selectedCheck, check.id), selectedCheck)
  assert.deepEqual(componentSelection(sley, selectedCheck, 'missing'), { nodeId: null, runId: run.id, observationIndex: null, visitOrdinal: null })
})

test('retained observation indexes remain identities instead of array positions', () => {
  const graph = structuredClone(sley)
  const run = graph.runs.find(value => value.id === 'accepted-after-revision')
  run.observations.forEach((entry, index) => { entry.index = 100 + index * 10 })
  const check = graph.nodes.find(node => node.label === 'Check')
  const selection = { nodeId: check.id, runId: run.id, observationIndex: 140, visitOrdinal: 2 }
  assert.equal(selectedCaseObservation(graph, run, selection).action, 'accepted')
  assert.deepEqual(componentSelection(graph, selection, check.id), selection)
  assert.equal(selectedCaseObservation(graph, run, { ...selection, observationIndex: 5 }), undefined)
})

test('copied investigation context states when the selected repeated visit is absent', () => {
  const check = sley.nodes.find(node => node.label === 'Check')
  const accepted = sley.runs.find(run => run.id === 'accepted-after-revision')
  const once = sley.runs.find(run => run.id === 'accepted-first-attempt')
  const selection = preserveCaseSelection(sley, {
    nodeId: check.id, runId: accepted.id, observationIndex: 5, visitOrdinal: 2,
  }, once.id)
  const text = selectedInvestigationContext(example(sley), selection)
  assert.match(text, /^Selection gap: requested visit 2/u)
  assert.match(text, /not retained in this case/u)
  assert.match(text, /Any included observations are other available visits/u)
  assert.match(text, /Case identity: accepted-first-attempt/u)
  const restored = preserveCaseSelection(sley, selection, accepted.id)
  const captured = selectedInvestigationContext(example(sley), restored)
  assert.doesNotMatch(captured, /^Selection gap:/u)
  assert.match(captured, /"index": 5/u)
})

test('recorded conditions and nested hostile input values survive only inside inert snapshot JSON', () => {
  const graph = structuredClone(sley), run = graph.runs[0]
  const hostile = '</sCrIpT x><ScRiPt>globalThis.injection=true</ScRiPt><img src=x onerror=alert(1)>'
  graph.nodes[0].description = hostile
  run.input.note = hostile
  const observed = run.observations.find(entry => entry.conditions.some(condition => condition.result === false))
  observed.source = { path: hostile, symbol: hostile }
  observed.conditions[0].label = hostile
  observed.conditions[0].expression = hostile
  observed.conditions[0].values.hostile = hostile
  observed.before.note = hostile
  const html = renderExplorer({ graphs: [example(graph)] }), data = embeddedData(html)
  assert.deepEqual(data.decoded[0].graph, graph)
  assert.equal(/[<>&\u2028\u2029]/u.test(data.encoded), false)
  assert.equal(html.toLowerCase().includes('<script>globalthis.injection'), false)
  assert.equal(data.decoded[0].graph.runs[0].observations.find(entry => entry.index === observed.index).conditions[0].result, observed.conditions[0].result)
})

test('ambiguous case identities, unknown components, and malformed condition evidence are refused', () => {
  const mutations = [
    graph => { graph.runs[1].id = graph.runs[0].id },
    graph => { graph.runs[0].id = '' },
    graph => { graph.runs[0].observations[1].index = graph.runs[0].observations[0].index },
    graph => { delete graph.runs[0].observations[0].index },
    graph => { graph.runs[0].observations[0].index = Number.MAX_SAFE_INTEGER + 1 },
    graph => { graph.runs[0].observations[0].nodeId = 'uncaptured-component' },
    graph => { graph.runs[0].observations[1].occurrenceId = graph.runs[0].observations[0].occurrenceId },
    graph => { graph.runs[0].observations[0].conditions[0].result = 'false' },
    graph => { graph.runs[0].observations[0].conditions[0].result = null },
    graph => { graph.runs[0].observations[0].conditions = {} },
  ]
  for (const mutate of mutations) {
    const graph = structuredClone(sley)
    mutate(graph)
    assert.throws(() => renderExplorer({ graphs: [example(graph)] }), TypeError)
  }
  const missing = structuredClone(sley)
  delete missing.runs[0].observations[0].conditions
  delete missing.runs[0].observations[0].before
  assert.doesNotThrow(() => renderExplorer({ graphs: [example(missing)] }))
  const unattributed = { ...small(), runs: [{ id: 'capture', observations: ['Handler reported a note'] }] }
  assert.doesNotThrow(() => renderExplorer({ graphs: [example(unattributed)] }))
  assert.equal(selectedCaseObservation(unattributed, unattributed.runs[0], { nodeId: 'a', observationIndex: 1 }), undefined)
})

test('snapshot bounds reject oversized, cyclic, and executable data before HTML serialization', () => {
  const tooManyRuns = { ...small(), runs: Array.from({ length: 65 }, (_, index) => ({ id: 'run-' + index })) }
  const tooManyObservations = { ...small(), runs: [{ id: 'run', observations: Array.from({ length: 4097 }, (_, index) => ({ index: index + 1, nodeId: 'a' })) }] }
  assert.throws(() => renderExplorer({ graphs: [example(tooManyRuns)] }), /64 recorded cases/u)
  assert.throws(() => renderExplorer({ graphs: [example(tooManyObservations)] }), /4096 observations/u)
  const deep = small()
  let parent = deep
  for (let depth = 0; depth < 70; depth++) { parent.next = {}; parent = parent.next }
  assert.throws(() => renderExplorer({ graphs: [example(deep)] }), /data limits/u)
  const cyclic = small(); cyclic.self = cyclic
  assert.throws(() => renderExplorer({ graphs: [example(cyclic)] }), /cycles/u)
  const executable = small()
  Object.defineProperty(executable, 'data', { enumerable: true, get() { throw new Error('Data accessors must never execute.') } })
  assert.throws(() => renderExplorer({ graphs: [example(executable)] }), /accessors/u)
  const oversized = small(); oversized.nodes[0].description = 'x'.repeat(16 * 1024 * 1024 + 1)
  assert.throws(() => renderExplorer({ graphs: [example(oversized)] }), /text limit/u)
})
