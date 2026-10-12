import { expect, test } from 'bun:test'
import type { DisplaySnapshot } from '@jigging/display-model'
import { privateBrowserCallSpans, privateBrowserObservationStatus } from '../src/observations.js'

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

test('invalid or backwards observation clocks cannot fabricate durations or SVG coordinates', () => {
  const calls = [
    { id: 'reverse', firstObservedAt: 2, observedAt: 1 },
    { id: 'missing', firstObservedAt: Number.NaN, observedAt: 2 },
  ] as DisplaySnapshot['calls']
  expect(privateBrowserCallSpans(calls)).toEqual({ milliseconds: 0, spans: new Map() })
  expect(privateBrowserCallSpans([])).toEqual({ milliseconds: 0, spans: new Map() })
})
