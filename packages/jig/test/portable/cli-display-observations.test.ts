import { expect, test } from 'bun:test'
import {
  callObservationSpans,
  compositionObservations,
  DISPLAY_COMPOSITION_BYTE_LIMIT,
  DISPLAY_COMPOSITION_EDGE_LIMIT,
  DISPLAY_COMPOSITION_NODE_LIMIT,
  validateDisplaySnapshot,
} from '@jigging/display-model'
import { projectPrivateRunComposition } from '../../src/cli-composition.js'
import { PrivateDisplayProjection } from '../../src/cli-display-projection.js'
import { PrivateRunModel } from '../../src/cli-run-model.js'

test('call spans preserve the first actual observation and terminal fencing across publishers', () => {
  const model = new PrivateRunModel()
  model.observeCall({
    publisher: 'root',
    operationId: 'a',
    slot: 'worker',
    state: 'requested',
    time: 1000,
  })
  model.observeCall({
    publisher: 'root',
    operationId: 'a',
    slot: 'worker',
    state: 'active',
    time: 1100,
  })
  model.observeCall({
    publisher: 'root',
    operationId: 'a',
    slot: 'worker',
    state: 'returned',
    time: 2000,
  })
  model.observeCall({
    publisher: 'root',
    operationId: 'a',
    slot: 'worker',
    state: 'failed',
    time: 4000,
  })
  model.observeCall({
    publisher: 'different',
    operationId: 'a',
    slot: 'worker',
    state: 'active',
    time: 2500,
  })
  const snapshot = new PrivateDisplayProjection(model, new Uint8Array(32)).capture(1)
  expect(snapshot.calls[0]!.firstObservedAt).toBe(1000)
  expect(snapshot.calls[0]!.observedAt).toBe(2000)
  expect(snapshot.calls[0]!.state).toBe('returned')
  const timeline = callObservationSpans(snapshot.calls)
  expect(timeline.milliseconds).toBe(1500)
  expect(timeline.spans.get(snapshot.calls[0]!.id)).toEqual({
    x: 0,
    width: (1000 * 1000) / 1500,
    milliseconds: 1000,
  })
  expect(timeline.spans.get(snapshot.calls[1]!.id)?.width).toBe(0)
  expect(model.calls.size).toBe(2)
})

test('admitted composition publishes opaque target IDs and joins only observed caller slots', () => {
  const root = { kind: 'flow', path: 'private/project/root' } as const
  const child = { kind: 'binding', id: 'worker' } as const
  const composition = projectPrivateRunComposition(
    {
      root,
      targets: [
        { request: { target: root, slots: { worker: { kind: 'flow', target: child } } } },
        { request: { target: child, slots: {} } },
      ],
    },
    {
      nodes: DISPLAY_COMPOSITION_NODE_LIMIT,
      edges: DISPLAY_COMPOSITION_EDGE_LIMIT,
      bytes: DISPLAY_COMPOSITION_BYTE_LIMIT,
    },
  )
  const model = new PrivateRunModel()
  model.observeComposition(composition)
  model.observeComposition({ state: 'unavailable', reason: 'limit' })
  model.observeCall({
    publisher: 'root',
    operationId: 'one',
    slot: 'worker',
    state: 'active',
    time: 1,
    childPublisher: 'private-child-publisher',
  })
  const projection = new PrivateDisplayProjection(model, new Uint8Array(32))
  const snapshot = projection.capture(1)
  expect(validateDisplaySnapshot(snapshot)).toEqual(snapshot)
  expect(snapshot.composition?.state).toBe('available')
  if (snapshot.composition?.state !== 'available') throw new Error('expected admitted map')
  expect(snapshot.composition.nodes.map((node) => node.label).sort()).toEqual(['root', 'worker'])
  expect(JSON.stringify(snapshot.composition)).not.toContain('private/project')
  expect(JSON.stringify(snapshot.composition)).not.toContain('private-child-publisher')
  expect(snapshot.composition.nodes.every((node) => /^[0-9a-f]{64}$/.test(node.id))).toBe(true)
  expect(projection.capture(2).composition).toEqual(snapshot.composition)
  const distinct = new PrivateDisplayProjection(model, new Uint8Array(32).fill(1)).capture(1)
  expect(distinct.composition).not.toEqual(snapshot.composition)
  const observed = compositionObservations(snapshot)
  expect(observed.matches).toHaveLength(1)
  expect(observed.matches[0]!.edgeId).toBe(snapshot.composition.edges[0]!.id)
  model.configureWorkspace({ target: 'Recorded packet', recorded: true })
  expect(projection.capture(3).composition).toBeUndefined()
})

test('a live model without admitted composition keeps an explicit unavailable map', () => {
  const snapshot = new PrivateDisplayProjection(new PrivateRunModel(), new Uint8Array(32)).capture(
    1,
  )
  expect(snapshot.composition).toEqual({ state: 'unavailable', reason: 'unavailable' })
})

test('display ID expansion retains other observations when the complete map exceeds its byte allowance', () => {
  const targets = Array.from(
    { length: 5 },
    (_, index) => ({ kind: 'binding', id: `b${index}` }) as const,
  )
  const source = {
    root: targets[0]!,
    targets: targets.map((target, index) => ({
      request: {
        target,
        slots:
          index === 4
            ? {}
            : Object.fromEntries(
                Array.from({ length: 256 }, (_, slot) => [
                  `s${slot.toString().padStart(31, '0')}`,
                  { kind: 'flow' as const, target: targets[index + 1]! },
                ]),
              ),
      },
    })),
  }
  const composition = projectPrivateRunComposition(source, {
    nodes: DISPLAY_COMPOSITION_NODE_LIMIT,
    edges: DISPLAY_COMPOSITION_EDGE_LIMIT,
    bytes: DISPLAY_COMPOSITION_BYTE_LIMIT,
  })
  expect(composition.state).toBe('available')
  const model = new PrivateRunModel()
  model.observeComposition(composition)
  model.setContext('Other retained observations remain available')
  const snapshot = new PrivateDisplayProjection(model, new Uint8Array(32)).capture(1)
  expect(snapshot.composition).toEqual({ state: 'unavailable', reason: 'limit' })
  expect(snapshot.context).toBe('Other retained observations remain available')
  expect(validateDisplaySnapshot(snapshot)).toEqual(snapshot)
})
