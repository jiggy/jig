import { readPrivateNativeClock } from './native-clock.js'

export interface PrivateAttemptClock {
  readonly bootId: string
  readonly monotonicMs: number
  /** Presentation and retention hint only; never submission authority. */
  readonly unixMs: number
}

/** Both supported native sources include suspend and are shared across processes. */
export async function readPrivateAttemptClock(): Promise<PrivateAttemptClock> {
  return Object.freeze({ ...readPrivateNativeClock(), unixMs: Date.now() })
}
