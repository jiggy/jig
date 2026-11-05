import assert from 'node:assert/strict'
import test from 'node:test'
import {
  privateCompositionLayout,
  privateCompositionSelection,
  privateCompositionTextLines,
} from '../dist/composition.js'

const composition = () => ({
  state: 'available',
  provenance: 'admitted',
  rootId: 'root',
  nodes: [
    { id: 'root', label: 'Application', kind: 'binding' },
    { id: 'first', label: 'Same display name', kind: 'binding' },
    { id: 'second', label: 'Same display name', kind: 'binding' },
    { id: 'child', label: 'Check', kind: 'flow' },
    { id: 'checkpoint', label: 'Checkpoint', kind: 'resource', resourceKind: 'run-checkpoint' },
  ],
  edges: [
    { id: 'a', source: 'root', target: 'first', slot: 'first' },
    { id: 'b', source: 'root', target: 'second', slot: 'second' },
    { id: 'c', source: 'first', target: 'child', slot: 'check' },
    { id: 'd', source: 'second', target: 'child', slot: 'check' },
    { id: 'e', source: 'root', target: 'checkpoint', slot: 'checkpoint' },
  ],
})

test('map selection follows exact run, root and component identities across refresh', () => {
  const graph = composition()
  const selected = { rootSourceId: 'run', rootId: 'root', nodeId: 'second' }
  assert.deepEqual(privateCompositionSelection({ rootSourceId: 'run', composition: graph }, selected), selected)
  assert.deepEqual(privateCompositionSelection({
    rootSourceId: 'run', composition: { state: 'unavailable', reason: 'limit' },
  }, selected), selected)
  assert.deepEqual(privateCompositionSelection({ rootSourceId: 'other-run', composition: graph }, selected), {
    rootSourceId: 'other-run', rootId: 'root',
  })
  assert.deepEqual(privateCompositionSelection({
    rootSourceId: 'run', composition: { ...graph, rootId: 'first' },
  }, selected), { rootSourceId: 'run', rootId: 'first' })
  assert.deepEqual(privateCompositionSelection({
    rootSourceId: 'run', composition: { ...graph, nodes: graph.nodes.filter((node) => node.id !== 'second') },
  }, selected), { rootSourceId: 'run', rootId: 'root' })
})

test('complete labels wrap without substituting labels for graph identity', () => {
  const label = '<unsafe> ' + 'W'.repeat(160) + ' 日本語'
  assert.equal(privateCompositionTextLines(label).join(''), label)
  assert.ok(privateCompositionTextLines(label).length > 3)
  const graph = composition()
  const first = privateCompositionLayout(graph)
  const again = privateCompositionLayout(graph)
  assert.deepEqual(first, again)
  assert.equal(first.nodes.length, graph.nodes.length)
  assert.notEqual(first.nodes.find((node) => node.id === 'first').x, first.nodes.find((node) => node.id === 'second').x)
})

test('parallel configured slots retain every edge identity and full label', () => {
  const graph = composition()
  graph.edges = [...graph.edges, { id: 'parallel', source: 'root', target: 'first', slot: 'another-long-slot-name' }]
  const layout = privateCompositionLayout(graph)
  const grouped = layout.routes.find((route) => route.source === 'root' && route.target === 'first')
  assert.deepEqual(grouped.edgeIds, ['a', 'parallel'])
  assert.equal(grouped.lines.join(''), 'firstanother-long-slot-name')
  assert.equal(layout.routes.flatMap((route) => route.edgeIds).length, graph.edges.length)
})

test('layout keeps complete card labels and cross-level connectors inside finite bounds', () => {
  const graph = composition()
  graph.nodes = [...graph.nodes, { id: 'deep', label: 'A'.repeat(160), kind: 'flow' }]
  graph.edges = [
    ...graph.edges,
    { id: 'deep-call', source: 'child', target: 'deep', slot: 'complete' },
    { id: 'direct', source: 'root', target: 'deep', slot: 'also-available-directly' },
  ]
  const layout = privateCompositionLayout(graph)
  for (const box of layout.nodes) {
    assert.ok(box.x >= 0 && box.y >= 0)
    assert.ok(box.x + box.width <= layout.width)
    assert.ok(box.y + box.height <= layout.height)
    assert.ok(box.height >= box.labelLines.length * 20 + 80)
    for (const other of layout.nodes) {
      if (box.id === other.id) continue
      assert.ok(box.x + box.width <= other.x || other.x + other.width <= box.x ||
        box.y + box.height <= other.y || other.y + other.height <= box.y)
    }
  }
  for (const route of layout.routes) {
    assert.ok(Number.isFinite(route.labelX) && Number.isFinite(route.labelY))
    assert.ok(route.labelX >= 0 && route.labelX + 80 <= layout.width)
    assert.ok(route.labelY >= 0 && route.labelY + route.lines.length * 15 <= layout.height)
  }
})

test('the admitted node bound does not depend on recursive traversal', () => {
  const graph = {
    state: 'available', provenance: 'admitted', rootId: 'n0',
    nodes: Array.from({ length: 256 }, (_, index) => ({ id: 'n' + index, label: 'Component ' + index, kind: 'flow' })),
    edges: Array.from({ length: 255 }, (_, index) => ({
      id: 'e' + index, source: 'n' + index, target: 'n' + (index + 1), slot: 'child',
    })),
  }
  const layout = privateCompositionLayout(graph)
  assert.equal(layout.nodes.length, 256)
  assert.equal(layout.routes.length, 255)
  assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height))
})

test('a supplied self-loop has a visible return path rather than a collapsed line', () => {
  const graph = {
    state: 'available', provenance: 'admitted', rootId: 'root',
    nodes: [{ id: 'root', label: 'Repeated component', kind: 'flow' }],
    edges: [{ id: 'loop', source: 'root', target: 'root', slot: 'repeat' }],
  }
  const layout = privateCompositionLayout(graph), box = layout.nodes[0], route = layout.routes[0]
  assert.match(route.path, / V /u)
  assert.match(route.path, / H /u)
  assert.ok(route.path.includes(' V ' + (box.y - 25)))
  assert.ok(route.path.endsWith(' V ' + box.y))
  assert.ok(route.labelX > box.x + box.width)
})
