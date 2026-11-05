import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Script } from 'node:vm'
import { projectGraph } from './lock-graph.mjs'
import { displayNodeKind, edgeLabel, evidenceText, graphRoots, isRuntimeGraph, layoutGraph, nodeSource, renderExplorer, scopeExits } from './viewer.mjs'

const sley = JSON.parse(await readFile(new URL('./sley-example.json', import.meta.url), 'utf8'))
const digest = `sha256:${'a'.repeat(64)}`
const pkg = (extra = {}) => ({ digest, directRun: true, uses: {}, ...extra })
const example = graph => ({ title: 'Example', graph })
const small = () => ({ nodes: [{ id: 'a', kind: 'node', label: 'A' }], edges: [], warnings: [] })

function embeddedData(html) {
  const match = html.match(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/u)
  assert.ok(match, 'one inert graph-data block is present')
  return { encoded: match[1], decoded: JSON.parse(match[1]) }
}

test('hostile labels and titles remain inert JSON and escaped title text', () => {
  const hostile = '</script><script>globalThis.injection = true</script><img src=x onerror=alert(1)> & " \u2028 \u2029'
  const graph = small()
  graph.nodes[0].label = hostile
  const items = [{ title: hostile, summary: hostile, graph }]
  const html = renderExplorer({ title: hostile, graphs: items })
  const data = embeddedData(html)
  assert.deepEqual(data.decoded, items)
  assert.equal(/[<>&\u2028\u2029]/u.test(data.encoded), false)
  assert.equal(html.includes('<script>globalThis.injection'), false)
  assert.ok(html.includes('<title>&lt;/script&gt;&lt;script&gt;'))
  assert.equal([...html.matchAll(/<script(?:\s[^>]*)?>/gu)].length, 2)
})

test('generated executable script parses, including the exact shared helpers', () => {
  const html = renderExplorer({ graphs: [example(sley), example(small())] })
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gu)]
  const executable = scripts.filter(match => !match[1].includes('application/json'))
  assert.equal(executable.length, 1)
  assert.doesNotThrow(() => new Script(executable[0][2], { filename: 'generated-explorer.js' }))
  assert.ok(executable[0][2].includes(layoutGraph.toString()))
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
