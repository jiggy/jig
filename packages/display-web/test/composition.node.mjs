import assert from 'node:assert/strict'
import test from 'node:test'
import {
  privateCompositionLayout,
  privateCompositionFocusedRequests,
  privateCompositionRequestRows,
  privateCompositionRequestStateLabel,
  privateCompositionRequestSummary,
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

function pathPoints(path) {
  const tokens = path.split(' '),
    points = []
  let current
  while (tokens.length) {
    const command = tokens.shift()
    const point = { x: Number(tokens.shift()), y: Number(tokens.shift()) }
    if (command === 'M') {
      current = point
      points.push(point)
      continue
    }
    const end = command === 'Q' ? { x: Number(tokens.shift()), y: Number(tokens.shift()) } : point
    for (let step = 1; step <= 12; step++) {
      const t = step / 12,
        inverse = 1 - t
      points.push(
        command === 'Q'
          ? {
              x: inverse * inverse * current.x + 2 * inverse * t * point.x + t * t * end.x,
              y: inverse * inverse * current.y + 2 * inverse * t * point.y + t * t * end.y,
            }
          : { x: current.x + t * (end.x - current.x), y: current.y + t * (end.y - current.y) },
      )
    }
    current = end
  }
  return points
}

function pathsCross(first, second) {
  const a = pathPoints(first),
    b = pathPoints(second)
  const cross = (u, v) => u.x * v.y - u.y * v.x
  const difference = (u, v) => ({ x: u.x - v.x, y: u.y - v.y })
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const p = a[i - 1],
        q = b[j - 1]
      const r = difference(a[i], p),
        s = difference(b[j], q),
        between = difference(q, p)
      const determinant = cross(r, s)
      if (Math.abs(determinant) < 1e-8) {
        if (Math.abs(cross(between, r)) > 1e-8) continue
        if (
          Math.max(Math.min(p.x, a[i].x), Math.min(q.x, b[j].x)) <=
            Math.min(Math.max(p.x, a[i].x), Math.max(q.x, b[j].x)) &&
          Math.max(Math.min(p.y, a[i].y), Math.min(q.y, b[j].y)) <=
            Math.min(Math.max(p.y, a[i].y), Math.max(q.y, b[j].y))
        )
          return true
      } else {
        const t = cross(between, s) / determinant,
          u = cross(between, r) / determinant
        if (t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) return true
      }
    }
  }
  return false
}

function assertGeometry(layout, cardWidth = 224) {
  const intersects = (a, b) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  const rectangles = [...layout.nodes]
  for (const box of layout.nodes) {
    assert.ok(box.height >= box.labelLines.length * 20 + 88)
    assert.equal(box.width, cardWidth)
  }
  for (const route of layout.routes) {
    const source = layout.nodes.find((node) => node.id === route.source)
    const target = layout.nodes.find((node) => node.id === route.target)
    assert.equal(route.sourceX, source.x + source.width)
    assert.equal(route.targetX, target.x)
    assert.ok(route.sourceY >= source.y && route.sourceY <= source.y + source.height)
    assert.ok(route.targetY >= target.y && route.targetY <= target.y + target.height)
    assert.equal(route.lines.length, route.lineEdgeIds.length)
    assert.deepEqual(route.lineEdgeIds.filter(Boolean), route.edgeIds)
    assert.ok(route.labelY >= route.labelTop)
    assert.ok(route.labelY + (route.lines.length - 1) * 15 <= route.labelTop + route.labelHeight)
    rectangles.push({
      x: route.labelX - route.labelWidth / 2,
      y: route.labelTop,
      width: route.labelWidth,
      height: route.labelHeight,
    })
    const points = pathPoints(route.path)
    for (const [point, x, y] of [
      [points[0], route.sourceX, route.sourceY],
      [points.at(-1), route.targetX, route.targetY],
    ]) {
      assert.ok(Math.abs(point.x - x) <= 0.01 && Math.abs(point.y - y) <= 0.01)
    }
    for (const point of points) {
      assert.ok(point.x >= 0 && point.y >= 0 && point.x <= layout.width && point.y <= layout.height)
      assert.ok(
        !layout.nodes.some(
          (box) =>
            point.x > box.x + 0.01 &&
            point.x < box.x + box.width - 0.01 &&
            point.y > box.y + 0.01 &&
            point.y < box.y + box.height - 0.01,
        ),
        'a connector must not run through a card',
      )
    }
  }
  for (let index = 0; index < rectangles.length; index++) {
    const rectangle = rectangles[index]
    assert.ok(rectangle.x >= 0 && rectangle.y >= 0)
    assert.ok(rectangle.x + rectangle.width <= layout.width)
    assert.ok(rectangle.y + rectangle.height <= layout.height)
    for (const other of rectangles.slice(index + 1))
      assert.ok(!intersects(rectangle, other), 'cards and connection labels must not overlap')
  }
}

test('retained request summaries preserve mixed states and count repeated requests separately', () => {
  const summary = privateCompositionRequestSummary([
    { state: 'returned' },
    { state: 'active' },
    { state: 'failed' },
    { state: 'returned' },
    { state: 'requested' },
    { state: 'cancel-requested' },
    { state: 'uncertain' },
  ])
  assert.deepEqual(summary, {
    requested: 1,
    active: 1,
    'cancel-requested': 1,
    returned: 2,
    failed: 1,
    uncertain: 1,
  })
  assert.equal(privateCompositionFocusedRequests(summary, 'all'), 7)
  assert.equal(privateCompositionFocusedRequests(summary, 'active'), 1)
  assert.equal(privateCompositionFocusedRequests(summary, 'attention'), 2)
  const rows = privateCompositionRequestRows(summary)
  assert(rows.length <= 3 && rows.every((row) => row.length <= 2))
  assert.deepEqual(
    Object.fromEntries(rows.flat().map(({ state, count }) => [state, count])),
    summary,
  )
  assert.equal(rows.flat().length, 6, 'every supplied state remains visible exactly once')
  assert.equal(privateCompositionRequestStateLabel('cancel-requested'), 'cancel requested')
  assert.equal(privateCompositionRequestStateLabel('returned'), 'returned')
})

test('pending and cancellation-requested observations do not become active or attention failures', () => {
  const pending = privateCompositionRequestSummary([
    { state: 'requested' },
    { state: 'cancel-requested' },
    { state: 'returned' },
  ])
  assert.equal(privateCompositionFocusedRequests(pending, 'all'), 3)
  assert.equal(privateCompositionFocusedRequests(pending, 'active'), 0)
  assert.equal(privateCompositionFocusedRequests(pending, 'attention'), 0)
  const empty = privateCompositionRequestSummary([])
  assert.deepEqual(empty, {
    requested: 0,
    active: 0,
    'cancel-requested': 0,
    returned: 0,
    failed: 0,
    uncertain: 0,
  })
  assert.deepEqual(privateCompositionRequestRows(empty), [])
  for (const focus of ['all', 'active', 'attention'])
    assert.equal(privateCompositionFocusedRequests(empty, focus), 0)
})

test('Run maps reserve readable mixed-state rows for every shared configured slot', () => {
  const graph = composition()
  graph.edges.push({
    id: 'parallel',
    source: 'root',
    target: 'first',
    slot: 'another-long-slot-name',
  })
  const layout = privateCompositionLayout(graph, true)
  assertGeometry(layout, 240)
  assert.deepEqual(
    layout.routes.flatMap((route) => route.requestRows.map((row) => row.edgeId)).sort(),
    graph.edges.map((edge) => edge.id).sort(),
  )
  for (const node of layout.nodes)
    if (node.id !== graph.rootId) assert(node.height >= node.labelLines.length * 20 + 148)
  for (const route of layout.routes)
    for (const row of route.requestRows) {
      assert(row.line > route.lineEdgeIds.indexOf(row.edgeId))
      assert(route.labelY + row.line * 15 >= route.labelTop)
      assert(route.labelY + (row.line + 2) * 15 <= route.labelTop + route.labelHeight)
      for (const next of route.requestRows)
        if (next.line > row.line) assert(next.line > row.line + 2)
    }
  const shared = layout.routes.find((route) => route.source === 'root' && route.target === 'first')
  assert.deepEqual(
    shared.requestRows.map((row) => row.edgeId),
    ['a', 'parallel'],
  )
  assert(
    privateCompositionLayout(graph).nodes.every((node) => node.width === 224),
    'configuration maps retain their compact profile',
  )
})

test('map selection follows exact run, root and component identities across refresh', () => {
  const graph = composition()
  const selected = { rootSourceId: 'run', rootId: 'root', nodeId: 'second' }
  assert.deepEqual(
    privateCompositionSelection({ rootSourceId: 'run', composition: graph }, selected),
    selected,
  )
  assert.deepEqual(
    privateCompositionSelection(
      {
        rootSourceId: 'run',
        composition: { state: 'unavailable', reason: 'limit' },
      },
      selected,
    ),
    selected,
  )
  assert.deepEqual(
    privateCompositionSelection({ rootSourceId: 'other-run', composition: graph }, selected),
    {
      rootSourceId: 'other-run',
      rootId: 'root',
    },
  )
  assert.deepEqual(
    privateCompositionSelection(
      {
        rootSourceId: 'run',
        composition: { ...graph, rootId: 'first' },
      },
      selected,
    ),
    { rootSourceId: 'run', rootId: 'first' },
  )
  assert.deepEqual(
    privateCompositionSelection(
      {
        rootSourceId: 'run',
        composition: { ...graph, nodes: graph.nodes.filter((node) => node.id !== 'second') },
      },
      selected,
    ),
    { rootSourceId: 'run', rootId: 'root' },
  )
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
  assert.notEqual(
    first.nodes.find((node) => node.id === 'first').y,
    first.nodes.find((node) => node.id === 'second').y,
  )
  assert.equal(first.nodes.filter((node) => node.id === 'child').length, 1)
  assertGeometry(first)
})

test('one application and four dependencies form a compact readable composition', () => {
  const children = ['convert-contacts', 'export-preview', 'map-contacts', 'read-contacts']
  const graph = {
    state: 'available',
    provenance: 'admitted',
    rootId: 'root',
    nodes: [
      { id: 'root', label: 'Contact import', kind: 'binding' },
      ...children.map((id) => ({ id, label: id, kind: 'flow' })),
    ],
    edges: ['converter', 'exporter', 'mapper', 'reader'].map((slot, index) => ({
      id: slot,
      source: 'root',
      target: children[index],
      slot,
    })),
  }
  const layout = privateCompositionLayout(graph),
    root = layout.nodes[0],
    dependencies = layout.nodes.slice(1)
  assert.ok(layout.width <= 900 && layout.height <= 650)
  assert.ok(dependencies.every((node) => node.x > root.x + root.width))
  assert.equal(new Set(dependencies.map((node) => node.x)).size, 1)
  assert.equal(
    root.y + root.height / 2,
    dependencies.reduce((sum, node) => sum + node.y + node.height / 2, 0) / dependencies.length,
  )
  for (let index = 1; index < dependencies.length; index++)
    assert.ok(
      dependencies[index].y - dependencies[index - 1].y - dependencies[index - 1].height >= 24,
    )
  for (let index = 0; index < layout.routes.length; index++)
    for (const other of layout.routes.slice(index + 1))
      assert.ok(
        !pathsCross(layout.routes[index].path, other.path),
        'a simple fan must not cross its own branches',
      )
  assertGeometry(layout)
})

test('parallel configured slots retain every edge identity and full label', () => {
  const graph = composition()
  graph.edges = [
    ...graph.edges,
    { id: 'parallel', source: 'root', target: 'first', slot: 'another-long-slot-name' },
  ]
  const layout = privateCompositionLayout(graph)
  const grouped = layout.routes.find((route) => route.source === 'root' && route.target === 'first')
  assert.deepEqual(grouped.edgeIds, ['a', 'parallel'])
  assert.equal(grouped.lines.join(''), 'firstanother-long-slot-name')
  assert.deepEqual(grouped.lineEdgeIds.filter(Boolean), ['a', 'parallel'])
  assert.ok(
    grouped.lineEdgeIds.includes(''),
    'wrapped slot continuations must not repeat their count',
  )
  assert.equal(layout.routes.flatMap((route) => route.edgeIds).length, graph.edges.length)
  assertGeometry(layout)
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
  const root = layout.nodes.find((node) => node.id === 'root')
  const child = layout.nodes.find((node) => node.id === 'child')
  const deep = layout.nodes.find((node) => node.id === 'deep')
  assert.ok(
    root.x < child.x && child.x < deep.x,
    'a direct shortcut must not pull a shared dependency before its callers',
  )
  assert.equal(deep.labelLines.join(''), 'A'.repeat(160))
  assertGeometry(layout)
})

test('the admitted node bound does not depend on recursive traversal', () => {
  const graph = {
    state: 'available',
    provenance: 'admitted',
    rootId: 'n0',
    nodes: Array.from({ length: 256 }, (_, index) => ({
      id: 'n' + index,
      label: 'Component ' + index,
      kind: 'flow',
    })),
    edges: Array.from({ length: 255 }, (_, index) => ({
      id: 'e' + index,
      source: 'n' + index,
      target: 'n' + (index + 1),
      slot: 'child',
    })),
  }
  const layout = privateCompositionLayout(graph)
  assert.equal(layout.nodes.length, 256)
  assert.equal(layout.routes.length, 255)
  assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height))
})

test('supplied cycles keep every component visible and route outside the cards', () => {
  const graph = {
    state: 'available',
    provenance: 'admitted',
    rootId: 'root',
    nodes: ['root', 'a', 'b', 'leaf'].map((id) => ({ id, label: id, kind: 'flow' })),
    edges: [
      { id: 'entry', source: 'root', target: 'a', slot: 'entry' },
      { id: 'forward', source: 'a', target: 'b', slot: 'forward' },
      { id: 'return', source: 'b', target: 'a', slot: 'return' },
      { id: 'exit', source: 'b', target: 'leaf', slot: 'exit' },
    ],
  }
  const layout = privateCompositionLayout(graph),
    [root, a, b, leaf] = layout.nodes
  assert.ok(root.x < a.x && b.x < leaf.x)
  assert.equal(a.x, b.x)
  assert.notEqual(a.y, b.y)
  assert.equal(layout.routes.length, graph.edges.length)
  assert.deepEqual(layout, privateCompositionLayout(graph))
  assertGeometry(layout)
})

test('a supplied self-loop has distinct card ports and a visible outside return path', () => {
  const graph = {
    state: 'available',
    provenance: 'admitted',
    rootId: 'root',
    nodes: [{ id: 'root', label: 'Repeated component', kind: 'flow' }],
    edges: [{ id: 'loop', source: 'root', target: 'root', slot: 'repeat' }],
  }
  const layout = privateCompositionLayout(graph),
    box = layout.nodes[0],
    route = layout.routes[0]
  assert.notEqual(route.sourceX, route.targetX)
  assert.ok(pathPoints(route.path).some((point) => point.y < box.y))
  assert.ok(pathPoints(route.path).some((point) => point.x > box.x + box.width))
  assert.ok(route.labelX + route.labelWidth / 2 < box.x)
  assertGeometry(layout)
})

test('the admitted edge bound retains every port, slot label and route identity', () => {
  const graph = {
    state: 'available',
    provenance: 'admitted',
    rootId: 'n0',
    nodes: Array.from({ length: 256 }, (_, index) => ({
      id: 'n' + index,
      label: 'Component ' + index,
      kind: 'flow',
    })),
    edges: Array.from({ length: 1024 }, (_, index) => ({
      id: 'e' + index,
      source: 'n' + (index % 256),
      target: 'n' + (((index % 256) + Math.floor(index / 256) + 1) % 256),
      slot: 'slot' + Math.floor(index / 256),
    })),
  }
  const layout = privateCompositionLayout(graph)
  assert.equal(layout.nodes.length, 256)
  assert.deepEqual(
    new Set(layout.routes.flatMap((route) => route.edgeIds)),
    new Set(graph.edges.map((edge) => edge.id)),
  )
  assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height))
  for (const route of layout.routes) {
    assert.equal(route.lines.length, route.lineEdgeIds.length)
    assert.ok(
      [
        route.sourceX,
        route.sourceY,
        route.targetX,
        route.targetY,
        route.labelX,
        route.labelY,
        route.labelWidth,
        route.labelHeight,
      ].every(Number.isFinite),
    )
  }
})
