// Private finite-review policy, shared by the collector and trusted evaluator.
// These are not Flow runtime options or a persistent evaluation service.
export const PRIVATE_AUTHOR_EVALUATOR_PROTOCOL = 'jig-author-evaluator/1'
export const PRIVATE_AUTHOR_EVALUATOR_MAX_ENTRIES = 256
export const PRIVATE_AUTHOR_EVALUATOR_ENTRY_MS = 3_000
export const PRIVATE_AUTHOR_EVALUATOR_DIRECTORY = '/jig-input/evaluator'
export const PRIVATE_AUTHOR_EVALUATOR_WORKER = `${PRIVATE_AUTHOR_EVALUATOR_DIRECTORY}/project-evaluator-worker.js`
export const PRIVATE_AUTHOR_EVALUATOR_LIMITS = Object.freeze({
  memoryBytes: 256 * 1024 * 1024,
  pids: 64,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  wallClockCeilingMs: PRIVATE_AUTHOR_EVALUATOR_ENTRY_MS as number,
  cancellationGraceMs: 1_000,
  cleanupTimeoutMs: 5_000,
})
