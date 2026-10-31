import { performance } from 'node:perf_hooks'

const suites = new Set(['checkpoint', 'workspace', 'foundation'])
const phases = new Set([
  'setup',
  'review-command',
  'run-command',
  'application-command',
  'inspect-command',
  'fixture-command',
  'interruption-wait',
  'recovery-command',
  'verification',
])
const counts = new Map()

export function hostTestTimingEnabled() {
  return process.env.JIG_HOST_TEST_TIMING === '1'
}

/** Closed diagnostic labels only. Elapsed wall time establishes no native outcome. */
export function startHostTestTiming(suite, phase) {
  if (!hostTestTimingEnabled() || !suites.has(suite) || !phases.has(phase)) return () => {}
  const started = performance.now()
  let finished = false
  return (outcome = 'returned') => {
    if (finished) return
    finished = true
    try {
      const count = counts.get(suite) ?? 0
      if (count > 96) return
      counts.set(suite, count + 1)
      const elapsedMs = Math.round(performance.now() - started)
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > 86_400_000) return
      console.error(
        `host-test-timing ${JSON.stringify(
          count === 96
            ? { suite, status: 'truncated' }
            : {
                suite,
                phase,
                elapsedMs,
                outcome: outcome === 'returned' ? 'returned' : 'failed',
              },
        )}`,
      )
    } catch {
      // Optional timing output cannot change the command or its cleanup result.
    }
  }
}
