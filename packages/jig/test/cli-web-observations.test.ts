import { expect, test } from 'bun:test'
import { PrivateRunModel } from '../src/cli-run-model.js'
import type { PrivateWebSnapshot } from '../src/cli-web-snapshot.js'
import { PrivateWebProjection } from '../src/cli-web-snapshot.js'
import {
  privateBrowserCallSpans,
  privateBrowserObservationStatus,
} from '../src/web/observations.js'

test('normal committed revision replacement stays quiet while genuine loss remains explicit', () => {
  expect(
    privateBrowserObservationStatus({
      connection: 'current',
      observationFresh: false,
      bodyStale: false,
    }),
  ).toEqual({ label: 'Synchronizing', tone: 'quiet' })
  expect(
    privateBrowserObservationStatus({
      connection: 'disconnected',
      observationFresh: false,
      bodyStale: false,
    }).tone,
  ).toBe('warning')
  expect(
    privateBrowserObservationStatus({
      connection: 'current',
      observationFresh: true,
      bodyStale: true,
    }).label,
  ).toBe('Incomplete observation')
})

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
  const snapshot = new PrivateWebProjection(model, new Uint8Array(32)).capture(1)
  expect(snapshot.calls[0]!.firstObservedAt).toBe(1000)
  expect(snapshot.calls[0]!.observedAt).toBe(2000)
  expect(snapshot.calls[0]!.state).toBe('returned')
  const timeline = privateBrowserCallSpans(snapshot.calls)
  expect(timeline.milliseconds).toBe(1500)
  expect(timeline.spans.get(snapshot.calls[0]!.id)).toEqual({
    x: 0,
    width: (1000 * 1000) / 1500,
    milliseconds: 1000,
  })
  expect(timeline.spans.get(snapshot.calls[1]!.id)?.width).toBe(0)
  expect(model.calls.size).toBe(2)
})

test('invalid or backwards observation clocks cannot fabricate durations or SVG coordinates', () => {
  const calls = [
    { id: 'reverse', firstObservedAt: 2, observedAt: 1 },
    { id: 'missing', firstObservedAt: Number.NaN, observedAt: 2 },
  ] as PrivateWebSnapshot['calls']
  expect(privateBrowserCallSpans(calls)).toEqual({ milliseconds: 0, spans: new Map() })
  expect(privateBrowserCallSpans([])).toEqual({ milliseconds: 0, spans: new Map() })
})
