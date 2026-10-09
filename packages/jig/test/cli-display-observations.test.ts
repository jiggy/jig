import { expect, test } from 'bun:test'
import { callObservationSpans } from '@jigging/display-model'
import { PrivateRunModel } from '../src/cli-run-model.js'
import { PrivateDisplayProjection } from '../src/cli-display-projection.js'

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
