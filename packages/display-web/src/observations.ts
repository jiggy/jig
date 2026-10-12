import { callObservationSpans, displayDuration } from '@jigging/display-model'
import type { DisplaySnapshot } from '@jigging/display-model'
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
export function privateBrowserCallSpans(calls: DisplaySnapshot['calls']): {
  milliseconds: number
  spans: Map<string, { x: number; width: number; milliseconds: number }>
} {
  return callObservationSpans(calls)
}

export function privateBrowserDuration(milliseconds: number): string {
  return displayDuration(milliseconds)
}
