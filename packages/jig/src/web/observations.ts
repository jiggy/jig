import type { PrivateWebSnapshot } from '../cli-web-snapshot.js'
import type { PrivateBrowserClient } from './client.js'

/** Routine revision replacement never becomes a transient warning banner. */
export function privateBrowserObservationStatus(
  client: Pick<PrivateBrowserClient, 'connection' | 'observationFresh' | 'bodyStale'>,
): { label: string; tone: 'quiet' | 'warning' } {
  if (client.connection === 'disconnected')
    return { label: 'Disconnected · retained observation is stale', tone: 'warning' }
  if (client.bodyStale) return { label: 'Incomplete observation', tone: 'warning' }
  if (client.connection === 'connecting') return { label: 'Connecting', tone: 'quiet' }
  if (client.connection === 'closed') return { label: 'Inspection ended', tone: 'quiet' }
  if (client.connection === 'unauthorized') return { label: 'Access unavailable', tone: 'warning' }
  return {
    label: client.observationFresh ? 'Connected' : 'Synchronizing',
    tone: 'quiet',
  }
}

/** Host observation intervals, never inferred test results or execution durations. */
export function privateBrowserCallSpans(calls: PrivateWebSnapshot['calls']): {
  milliseconds: number
  spans: Map<string, { x: number; width: number; milliseconds: number }>
} {
  const valid = calls.filter(
    (call) =>
      Number.isFinite(call.firstObservedAt) &&
      Number.isFinite(call.observedAt) &&
      call.firstObservedAt >= 0 &&
      call.observedAt >= call.firstObservedAt,
  )
  const first = Math.min(...valid.map((call) => call.firstObservedAt))
  const last = Math.max(...valid.map((call) => call.observedAt))
  const milliseconds = valid.length ? last - first : 0
  const scale = Math.max(1, milliseconds)
  return {
    milliseconds,
    spans: new Map(
      valid.map((call) => [
        call.id,
        {
          x: ((call.firstObservedAt - first) / scale) * 1000,
          width: ((call.observedAt - call.firstObservedAt) / scale) * 1000,
          milliseconds: call.observedAt - call.firstObservedAt,
        },
      ]),
    ),
  }
}

export function privateBrowserDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)}s`
  return `${Math.floor(milliseconds / 60000)}m ${Math.floor((milliseconds % 60000) / 1000)}s`
}
