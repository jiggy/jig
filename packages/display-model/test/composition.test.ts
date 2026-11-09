import { expect, test } from 'bun:test'
import {
  DISPLAY_COMPOSITION_BYTE_LIMIT,
  DISPLAY_COMPOSITION_EDGE_LIMIT,
  DISPLAY_COMPOSITION_NODE_LIMIT,
  compositionObservations,
  validateDisplaySnapshot,
  type DisplayComposition,
  type DisplayCompositionResourceKind,
  type DisplaySnapshot,
} from '@jigging/display-model'
import { fixture } from './fixture.js'

type Call = DisplaySnapshot['calls'][number]

/** Consumer-owned configuration and observations, without a Jig admission or execution claim. */
function graph(): Extract<DisplayComposition, { state: 'available' }> {
  return {
    state: 'available',
    provenance: 'admitted',
    rootId: 'application',
    nodes: [
      { id: 'application', label: 'Review', kind: 'binding' },
      { id: 'fast', label: 'Check', kind: 'binding' },
      { id: 'full', label: 'Check', kind: 'binding' },
      { id: 'direct', label: 'Check', kind: 'flow' },
      { id: 'fast-reference', label: 'Reference', kind: 'resource', resourceKind: 'http-request' },
      { id: 'full-reference', label: 'Reference', kind: 'resource', resourceKind: 'http-request' },
    ],
    edges: [
      { id: 'route-fast', source: 'application', target: 'fast', slot: 'fast' },
      { id: 'route-full', source: 'application', target: 'full', slot: 'full' },
      { id: 'route-direct', source: 'application', target: 'direct', slot: 'direct' },
      { id: 'fast-http', source: 'fast', target: 'fast-reference', slot: 'reference' },
      { id: 'full-http', source: 'full', target: 'full-reference', slot: 'reference' },
    ],
  }
}

function call(id: string, sourceId: string, slot: string, extra: Partial<Call> = {}): Call {
  return {
    id,
    sourceId,
    sourceLabel: 'Check',
    operationId: id,
    slot,
    state: 'requested',
    firstObservedAt: 10,
    observedAt: 10,
    ...extra,
  }
}

function supplied(
  calls: readonly Call[] = [],
  composition: DisplayComposition = graph(),
): DisplaySnapshot {
  const value = validateDisplaySnapshot({ ...fixture(), calls, composition })
  if (value.kind !== 'snapshot') throw new Error('Expected complete consumer fixture')
  return value
}

function star(size: number) {
  return {
    state: 'available' as const,
    provenance: 'admitted' as const,
    rootId: 'node-0',
    nodes: Array.from({ length: size }, (_, index) => ({
      id: `node-${index}`,
      label: `Component ${index}`,
      kind: 'flow' as const,
    })),
    edges: Array.from({ length: Math.max(0, size - 1) }, (_, index) => ({
      id: `edge-${index}`,
      source: 'node-0',
      target: `node-${index + 1}`,
      slot: `slot-${index}`,
    })),
  }
}

test('complete composition is an owned immutable value with separate Binding, Flow and resource identities', () => {
  const input = graph()
  const value = supplied([], input)
  expect(value.composition).toEqual(input)
  expect(value.composition).not.toBe(input)
  expect(Object.isFrozen(value.composition)).toBeTrue()
  if (value.composition?.state !== 'available') throw new Error('Expected composition')
  expect(Object.isFrozen(value.composition.nodes)).toBeTrue()
  expect(Object.isFrozen(value.composition.edges[0])).toBeTrue()
  expect(
    value.composition.nodes.filter((node) => node.label === 'Check').map((node) => node.id),
  ).toEqual(['fast', 'full', 'direct'])
  expect(
    value.composition.nodes.filter((node) => node.label === 'Reference').map((node) => node.id),
  ).toEqual(['fast-reference', 'full-reference'])
  expect(compositionObservations(value)).toEqual({ matches: [], unmatched: [] })
})

test('exact source and slot joins retain repeated requests, independent of labels, state and arrival order', () => {
  const calls = [
    call('fast-effect', 'fast-source', 'reference', {
      parentId: 'fast-request',
      state: 'uncertain',
    }),
    call('full-effect', 'full-source', 'reference', { parentId: 'full-request', state: 'failed' }),
    call('direct-effect', 'direct-source', 'reference', { parentId: 'direct-request' }),
    call('orphan', 'unobserved-source', 'reference'),
    call('fast-request', 'source-root', 'fast', {
      childSourceId: 'fast-source',
      state: 'returned',
    }),
    call('full-request', 'source-root', 'full', { childSourceId: 'full-source', state: 'active' }),
    call('direct-request', 'source-root', 'direct', { childSourceId: 'direct-source' }),
    call('fast-again', 'source-root', 'fast'),
  ]
  const value = supplied(calls)
  const before = JSON.stringify(value)
  const observations = compositionObservations(value)
  expect(observations.matches).toEqual([
    {
      callId: 'fast-effect',
      edgeId: 'fast-http',
      sourceNodeId: 'fast',
      targetNodeId: 'fast-reference',
    },
    {
      callId: 'full-effect',
      edgeId: 'full-http',
      sourceNodeId: 'full',
      targetNodeId: 'full-reference',
    },
    {
      callId: 'fast-request',
      edgeId: 'route-fast',
      sourceNodeId: 'application',
      targetNodeId: 'fast',
    },
    {
      callId: 'full-request',
      edgeId: 'route-full',
      sourceNodeId: 'application',
      targetNodeId: 'full',
    },
    {
      callId: 'direct-request',
      edgeId: 'route-direct',
      sourceNodeId: 'application',
      targetNodeId: 'direct',
    },
    {
      callId: 'fast-again',
      edgeId: 'route-fast',
      sourceNodeId: 'application',
      targetNodeId: 'fast',
    },
  ])
  expect(observations.unmatched).toEqual([
    { callId: 'direct-effect', reason: 'slot-unavailable' },
    { callId: 'orphan', reason: 'caller-unobserved' },
  ])
  expect(observations.matches.some((match) => match.targetNodeId === 'application')).toBeFalse()
  expect(JSON.stringify(value)).toBe(before)
  const reversed = compositionObservations(supplied([...calls].reverse()))
  const sorted = <T extends { callId: string }>(values: readonly T[]) =>
    [...values].sort((left, right) => left.callId.localeCompare(right.callId))
  expect(sorted(reversed.matches)).toEqual(sorted(observations.matches))
  expect(sorted(reversed.unmatched)).toEqual(sorted(observations.unmatched))
})

test('missing child attribution stays unavailable while an exact retained relationship needs no inferred parent', () => {
  const observations = compositionObservations(
    supplied([
      call('parent-without-child', 'source-root', 'fast'),
      call('missing-child', 'not-attributed', 'reference', { parentId: 'parent-without-child' }),
      call('missing-parent', 'absent', 'reference', { parentId: 'not-retained' }),
      call('retained-parent', 'source-root', 'full', { childSourceId: 'retained-child' }),
      call('exact-child', 'retained-child', 'reference'),
    ]),
  )
  expect(observations.matches.map((match) => match.callId)).toEqual([
    'parent-without-child',
    'retained-parent',
    'exact-child',
  ])
  expect(observations.unmatched).toEqual([
    { callId: 'missing-child', reason: 'caller-unobserved' },
    { callId: 'missing-parent', reason: 'caller-unobserved' },
  ])
})

test('conflicting publisher ownership and supplied ancestry cannot choose a configured target', () => {
  const observations = compositionObservations(
    supplied([
      call('first-owner', 'source-root', 'fast', { childSourceId: 'shared-child' }),
      call('second-owner', 'source-root', 'full', { childSourceId: 'shared-child' }),
      call('ambiguous-child', 'shared-child', 'reference'),
      call('good-owner', 'source-root', 'fast', { childSourceId: 'good-child' }),
      call('wrong-parent', 'good-child', 'reference', { parentId: 'second-owner' }),
      call('missing-wrong-parent', 'good-child', 'reference', {
        parentId: 'different-unretained-parent',
      }),
      call('root-as-child', 'source-root', 'full', { childSourceId: 'source-root' }),
      call('root-with-parent', 'source-root', 'fast', { parentId: 'good-owner' }),
      call('healthy', 'source-root', 'direct'),
    ]),
  )
  expect(observations.matches.map((match) => match.callId)).toEqual(['good-owner', 'healthy'])
  expect(observations.unmatched).toEqual(
    [
      'first-owner',
      'second-owner',
      'ambiguous-child',
      'wrong-parent',
      'missing-wrong-parent',
      'root-as-child',
      'root-with-parent',
    ].map((callId) => ({ callId, reason: 'identity-conflict' })),
  )
})

test('cyclic publisher claims terminate without a guessed root relationship', () => {
  const observations = compositionObservations(
    supplied([
      call('cycle-a', 'publisher-a', 'reference', { childSourceId: 'publisher-b' }),
      call('cycle-b', 'publisher-b', 'reference', { childSourceId: 'publisher-a' }),
      call('self', 'publisher-self', 'reference', { childSourceId: 'publisher-self' }),
      call('root-request', 'source-root', 'fast'),
    ]),
  )
  expect(observations.matches.map((match) => match.callId)).toEqual(['root-request'])
  expect(observations.unmatched).toEqual(
    ['cycle-a', 'cycle-b', 'self'].map((callId) => ({
      callId,
      reason: 'identity-conflict',
    })),
  )
})

test('composition is optional producer evidence and unavailable projections never invent matches', () => {
  const value = fixture()
  expect(compositionObservations(value)).toEqual({
    matches: [],
    unmatched: [{ callId: 'call-root', reason: 'composition-unavailable' }],
  })
  for (const reason of ['limit', 'unavailable'] as const) {
    const unavailable = supplied(value.calls, { state: 'unavailable', reason })
    expect(unavailable.composition).toEqual({ state: 'unavailable', reason })
    expect(compositionObservations(unavailable)).toEqual(compositionObservations(value))
  }
  for (const mode of ['recorded-packet', 'retained-views'] as const)
    expect(() =>
      validateDisplaySnapshot({ ...value, mode, calls: [], composition: graph() }),
    ).toThrow(TypeError)
  expect(() =>
    validateDisplaySnapshot({
      kind: 'incomplete',
      revision: 2,
      mode: value.mode,
      rootSourceId: value.rootSourceId,
      workspace: value.workspace,
      context: value.context,
      omissions: value.omissions,
      attention: value.attention,
      diagnostics: [],
      reason: 'Observation unavailable',
      composition: graph(),
    }),
  ).toThrow(TypeError)
})

test('all six supplied native kinds remain distinct while private or malformed graph fields fail closed', () => {
  const kinds: DisplayCompositionResourceKind[] = [
    'http-request',
    'project-command',
    'project-evaluation',
    'finite-acp',
    'run-checkpoint',
    'child-checkpoint',
  ]
  const resources = {
    state: 'available',
    provenance: 'admitted',
    rootId: 'root',
    nodes: [
      { id: 'root', label: 'Application', kind: 'flow' },
      ...kinds.map((kind) => ({ id: kind, label: kind, kind: 'resource', resourceKind: kind })),
    ],
    edges: kinds.map((kind) => ({ id: `edge-${kind}`, source: 'root', target: kind, slot: kind })),
  }
  expect(validateDisplaySnapshot({ ...fixture(), composition: resources }).kind).toBe('snapshot')
  const original = graph()
  const bad: unknown[] = [
    { ...original, rootId: 'missing' },
    { ...original, rootId: 'fast-reference' },
    { ...original, nodes: [...original.nodes, original.nodes[0]] },
    { ...original, edges: [...original.edges, original.edges[0]] },
    {
      ...original,
      edges: [
        ...original.edges,
        { id: 'duplicate-slot', source: 'application', target: 'full', slot: 'fast' },
      ],
    },
    {
      ...original,
      edges: [
        ...original.edges,
        { id: 'missing-node', source: 'application', target: 'missing', slot: 'missing' },
      ],
    },
    {
      ...original,
      nodes: [
        ...original.nodes,
        { id: 'unrelated', label: 'Not in this application', kind: 'flow' },
      ],
    },
    {
      ...original,
      edges: [
        ...original.edges,
        { id: 'resource-child', source: 'fast-reference', target: 'full', slot: 'child' },
      ],
    },
    { ...original, edges: [{ ...original.edges[0], slot: '' }, ...original.edges.slice(1)] },
    { ...original, nodes: [{ ...original.nodes[0], label: '' }, ...original.nodes.slice(1)] },
    {
      ...original,
      nodes: [{ ...original.nodes[0], resourceKind: 'http-request' }, ...original.nodes.slice(1)],
    },
    {
      ...original,
      nodes: [...original.nodes.slice(0, -1), { ...original.nodes.at(-1), resourceKind: 'http' }],
    },
    {
      ...original,
      nodes: [
        { ...original.nodes[0], settings: { secret: 'private' } },
        ...original.nodes.slice(1),
      ],
    },
    {
      ...original,
      nodes: [{ ...original.nodes[0], path: '/private/project' }, ...original.nodes.slice(1)],
    },
    {
      ...original,
      edges: [
        { ...original.edges[0], policy: { bearerEnv: 'PRIVATE' } },
        ...original.edges.slice(1),
      ],
    },
    { ...original, generation: 'private-generation' },
    { state: 'unavailable', reason: 'limit', nodes: [] },
    { state: 'unavailable', reason: 'custom reason' },
  ]
  const prior = supplied()
  for (const composition of bad)
    expect(() => validateDisplaySnapshot({ ...fixture(), composition })).toThrow(TypeError)
  expect(prior.composition).toEqual(original)
})

test('node and edge capacities accept their fixed boundaries and reject otherwise valid larger graphs', () => {
  expect(supplied([], star(DISPLAY_COMPOSITION_NODE_LIMIT)).composition?.state).toBe('available')
  expect(() => supplied([], star(DISPLAY_COMPOSITION_NODE_LIMIT + 1))).toThrow(TypeError)
  const edges = star(2)
  edges.edges = Array.from({ length: DISPLAY_COMPOSITION_EDGE_LIMIT }, (_, index) => ({
    id: `edge-${index}`,
    source: 'node-0',
    target: 'node-1',
    slot: `slot-${index}`,
  }))
  expect(supplied([], edges).composition?.state).toBe('available')
  edges.edges.push({ id: 'one-too-many', source: 'node-0', target: 'node-1', slot: 'one-too-many' })
  expect(() => supplied([], edges)).toThrow(TypeError)
})

test('composition byte capacity measures encoded UTF-8 data without weakening the immutable prior snapshot', () => {
  const input = star(DISPLAY_COMPOSITION_NODE_LIMIT)
  for (const node of input.nodes) node.label = '😀'.repeat(256)
  const bytes = () => Buffer.byteLength(JSON.stringify(input), 'utf8')
  let excess = bytes() - DISPLAY_COMPOSITION_BYTE_LIMIT
  expect(excess).toBeGreaterThan(0)
  for (const node of input.nodes) {
    if (excess <= 0) break
    const removed = Math.min(255, Math.ceil(excess / 4))
    node.label = '😀'.repeat(256 - removed)
    excess -= removed * 4
  }
  const room = input.nodes.find((node) => [...node.label].length < 252)!
  room.label += 'a'.repeat(DISPLAY_COMPOSITION_BYTE_LIMIT - bytes())
  expect(bytes()).toBe(DISPLAY_COMPOSITION_BYTE_LIMIT)
  const prior = supplied([], input)
  room.label += 'x'
  expect(bytes()).toBe(DISPLAY_COMPOSITION_BYTE_LIMIT + 1)
  expect(() => supplied([], input)).toThrow(TypeError)
  expect(Buffer.byteLength(JSON.stringify(prior.composition), 'utf8')).toBe(
    DISPLAY_COMPOSITION_BYTE_LIMIT,
  )
})
