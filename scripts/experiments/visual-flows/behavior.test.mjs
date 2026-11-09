import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  valueChanges,
  nodeOccurrences,
  caseComparison,
  evidenceGaps,
  investigationContext,
} from './behavior.mjs'

test('value changes preserve absent, null, false, zero, arrays, and object key identity', () => {
  const result = valueChanges(
    { gone: null, flag: false, zero: 0, items: [1], 'a.b': 1 },
    { added: null, flag: true, zero: 0, items: [1, 2], 'a.b': 2 },
  )
  assert.equal(result.truncated, false)
  assert.deepEqual(result.changes, [
    { path: '$["a.b"]', before: 1, after: 2, beforePresent: true, afterPresent: true },
    { path: '$.added', before: undefined, after: null, beforePresent: false, afterPresent: true },
    { path: '$.flag', before: false, after: true, beforePresent: true, afterPresent: true },
    { path: '$.gone', before: null, after: undefined, beforePresent: true, afterPresent: false },
    { path: '$.items[1]', before: undefined, after: 2, beforePresent: false, afterPresent: true },
  ])
  assert.deepEqual(valueChanges({ a: 1, b: 2 }, { b: 2, a: 1 }), { changes: [], truncated: false })
  assert.deepEqual(valueChanges([], {}), {
    changes: [{ path: '$', before: [], after: {}, beforePresent: true, afterPresent: true }],
    truncated: false,
  })
})

test('large and deeply nested changes carry an explicit incomplete result', () => {
  const before = Object.fromEntries(
    Array.from({ length: 200 }, (_, index) => ['key' + index, index]),
  )
  const after = Object.fromEntries(Object.keys(before).map((key) => [key, -1]))
  assert.equal(valueChanges(before, after).changes.length, 128)
  assert.equal(valueChanges(before, after).truncated, true)
  let a = 1,
    b = 2
  for (let index = 0; index < 14; index++) {
    a = { nested: a }
    b = { nested: b }
  }
  assert.deepEqual(valueChanges(a, b), { changes: [], truncated: true })
})

test('node occurrences and comparisons use component identity, never the label', () => {
  const graph = { nodes: [{ id: 'binding:a' }, { id: 'binding:b' }], edges: [] }
  const left = {
    input: { n: 1 },
    observations: [
      { index: 17, nodeId: 'binding:a', label: 'Repair' },
      { index: 23, nodeId: 'binding:a', label: 'Repair' },
    ],
  }
  const right = {
    input: { n: 2 },
    observations: [
      { index: 91, nodeId: 'binding:a', label: 'Repair' },
      { index: 92, nodeId: 'binding:b', label: 'Repair' },
    ],
  }
  assert.deepEqual(nodeOccurrences(graph, left, 'binding:a'), left.observations)
  assert.deepEqual(nodeOccurrences(graph, left, 'binding:b'), [])
  const comparison = caseComparison(graph, left, right)
  assert.equal(comparison.commonPrefix, 1)
  assert.equal(comparison.firstDifference.position, 2)
  assert.equal(comparison.firstDifference.reason, 'different-node')
  assert.equal(comparison.leftVisits['binding:a'], 2)
  assert.equal(comparison.rightVisits['binding:b'], 1)
  const unknown = caseComparison(graph, { observations: ['Repair'] }, { observations: ['Repair'] })
  assert.equal(unknown.commonPrefix, 0)
  assert.equal(unknown.firstDifference.reason, 'unattributed-observation')
})

test('a different decision can precede the first different handler and an omitted condition is not false', () => {
  const graph = { nodes: [{ id: 'check' }, { id: 'publish' }, { id: 'review' }], edges: [] }
  const left = {
    observations: [
      {
        index: 8,
        nodeId: 'check',
        conditions: [{ id: 'accept', result: true }],
        action: 'accepted',
      },
      { index: 9, nodeId: 'publish' },
    ],
  }
  const right = {
    observations: [
      {
        index: 4,
        nodeId: 'check',
        conditions: [
          { id: 'accept', result: false },
          { id: 'limit', result: true },
        ],
        action: 'exhausted',
      },
      { index: 5, nodeId: 'review' },
    ],
  }
  const result = caseComparison(graph, left, right)
  assert.equal(result.decisionDifference.position, 1)
  assert.equal(result.firstDifference.position, 2)
  assert.equal(
    result.decisionDifference.changes.changes.some(
      (change) => change.path === '$.conditions[1]' && !change.beforePresent,
    ),
    true,
  )
  assert.equal(caseComparison(graph, left, left).firstDifference, null)
  assert.equal(caseComparison(graph, left, left).decisionDifference, null)
  assert.equal(
    caseComparison(graph, { observations: left.observations.slice(0, 1) }, left).firstDifference
      .reason,
    'left-ended',
  )
})

test('case output comparisons never substitute status or runtime bookkeeping for an uncaptured value', () => {
  const graph = { nodes: [], edges: [] }
  const missing = caseComparison(
    graph,
    { status: 'failed', result: { state: { count: 1 } } },
    { status: 'completed', outcome: 'done' },
  )
  assert.deepEqual(missing.outputChanges, { changes: [], truncated: false })
  const captured = caseComparison(graph, { output: false }, { output: null })
  assert.deepEqual(captured.outputChanges.changes, [
    { path: '$', before: false, after: null, beforePresent: true, afterPresent: true },
  ])
})

test('evidence gaps distinguish configured power, recorded entries, and unknown implementation', () => {
  const graph = {
    nodes: [
      { id: 'resource', kind: 'grant' },
      { id: 'unknown', kind: 'unknown' },
    ],
    edges: [],
  }
  assert.match(
    evidenceGaps(graph, { nodeId: 'resource' }).join('\n'),
    /does not prove that an external effect occurred/u,
  )
  assert.match(
    evidenceGaps(graph, { nodeId: 'unknown' }).join('\n'),
    /does not resolve the implementation/u,
  )
  const runtime = { ...graph, layer: 'runtime-topology' }
  const gaps = evidenceGaps(runtime, { nodeId: 'resource', run: { observations: [] } }).join('\n')
  assert.match(gaps, /does not establish that it is unreachable/u)
  assert.match(gaps, /omitted condition is not a recorded false result/u)
  assert.doesNotMatch(gaps, /skipped|impossible/u)
})

test('investigation context selects retained observation IDs and omits private graph fields', () => {
  const item = {
    title: 'Example',
    revision: 'a'.repeat(40),
    graph: {
      root: 'repair:a',
      nodes: [
        {
          id: 'repair:a',
          label: 'Repair',
          kind: 'binding',
          settings: { token: 'private-setting' },
          policy: 'private-policy',
          location: { path: 'repair/binding.ts', line: 3 },
        },
      ],
      edges: [
        {
          source: 'repair:a',
          target: 'repair:b',
          label: 'next',
          meaning: 'may-invoke',
          attachments: { input: { sourcePath: 'private-attachment' } },
          args: ['private-argument'],
        },
      ],
      runs: [
        {
          id: 'case',
          input: { attempts: 0 },
          output: { done: true },
          observations: [
            { index: 10, nodeId: 'repair:a', before: { n: 1 }, after: { n: 2 } },
            { index: 20, nodeId: 'repair:a', before: { n: 2 }, after: { n: 3 } },
          ],
        },
      ],
    },
  }
  const text = investigationContext(item, {
    nodeId: 'repair:a',
    runId: 'case',
    observationIndex: 20,
  })
  assert.match(text, /"index": 20/u)
  assert.doesNotMatch(
    text,
    /"index": 10|private-setting|private-policy|private-attachment|private-argument/u,
  )
  assert.match(text, /repair\/binding.ts/u)
  assert.match(text, /Component identity: repair:a/u)
  const missing = investigationContext(item, {
    nodeId: 'repair:a',
    runId: 'case',
    observationIndex: 99,
  })
  assert.match(missing, /requested observation identity is not present/u)
  assert.doesNotMatch(missing, /"index": (10|20)/u)
  const big = investigationContext({ ...item, title: 'x'.repeat(40000) })
  assert.ok(big.length <= 24000)
  assert.match(big, /context truncated/u)
})

test('context retains opaque Binding and projection qualifiers and handles unindexed legacy observations', () => {
  const item = {
    title: 'Source example',
    graph: {
      nodes: [
        {
          id: 'binding:agent',
          kind: 'binding',
          packagePath: 'npm:@jigging/agent-acp',
          reason: 'Package implementation is opaque',
        },
      ],
      edges: [],
      provenance: {
        source: 'authored source',
        approval: 'not-verified',
        controlFlow: 'not-analyzed',
      },
      warnings: [
        { code: 'OPAQUE_PACKAGE', node: 'binding:agent', message: 'Implementation unavailable' },
      ],
      runs: [
        {
          id: 'legacy',
          observations: [
            { nodeId: 'binding:agent', before: 1, after: 2 },
            { nodeId: 'binding:agent', before: 2, after: 3 },
          ],
        },
      ],
    },
  }
  const text = investigationContext(item, { nodeId: 'binding:agent', runId: 'legacy' })
  assert.match(text, /npm:@jigging\/agent-acp/u)
  assert.match(text, /Package implementation is opaque/u)
  assert.match(text, /not-verified/u)
  assert.match(text, /OPAQUE_PACKAGE/u)
  assert.match(text, /"after": 3/u)
  const compared = investigationContext(
    {
      title: 'Compare',
      graph: {
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [],
        runs: [
          {
            id: 'left',
            observations: [
              { index: 17, nodeId: 'a' },
              { index: 23, nodeId: 'a' },
            ],
          },
          {
            id: 'right',
            observations: [
              { index: 91, nodeId: 'a' },
              { index: 92, nodeId: 'b' },
            ],
          },
        ],
      },
    },
    { runId: 'left', compareRunId: 'right' },
  )
  assert.match(compared, /record position 2/u)
  assert.match(compared, /Retained indexes: 23 \/ 92/u)
  assert.doesNotMatch(compared, /observation 2/u)
})

test('recorded Sley evidence compares repeated handlers without inventing edge traversal', async () => {
  const graph = JSON.parse(await readFile(new URL('./sley-example.json', import.meta.url), 'utf8'))
  const left = graph.runs.find((run) => run.id === 'accepted-after-revision')
  const right = graph.runs.find((run) => run.id === 'exhausted')
  const comparison = caseComparison(graph, left, right)
  const check = graph.nodes.find((node) => node.label === 'Check')
  assert.equal(nodeOccurrences(graph, left, check.id).length, 2)
  assert.equal(comparison.commonPrefix, 5)
  assert.equal(comparison.firstDifference.position, 6)
  assert.equal(comparison.decisionDifference.position, 5)
  assert.equal(comparison.leftVisits[check.id], 2)
  assert.equal(comparison.rightVisits[check.id], 2)
  assert.equal(
    comparison.inputChanges.changes.some((change) => change.path === '$.acceptAfter'),
    true,
  )
  assert.deepEqual(
    comparison.outputChanges.changes.map((change) => change.path),
    ['$.outcome'],
  )
  assert.equal(Object.hasOwn(comparison, 'traversedEdges'), false)
  const boundary = caseComparison(
    graph,
    left,
    graph.runs.find((run) => run.id === 'accepted-at-limit'),
  )
  assert.deepEqual(
    boundary.inputChanges.changes.map((change) => change.path),
    ['$.limit'],
  )
  assert.equal(boundary.decisionDifference, null)
  assert.equal(boundary.firstDifference, null)
  assert.deepEqual(boundary.outputChanges, { changes: [], truncated: false })
})
