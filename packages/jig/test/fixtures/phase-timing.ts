export type FixtureTimingScope =
  | 'installed-factory'
  | 'installed-observation'
  | 'http-siblings'
  | 'http-deep'
  | 'repair-successful'
  | 'repair-unsuccessful'
  | 'repair-batch'
  | 'repair-mixed-batch'

export type FixtureTimingPhase =
  | 'archive-pack'
  | 'archive-extract'
  | 'tooling-install'
  | 'project-install'
  | 'project-construct'
  | 'installed-support'
  | 'project-open'
  | 'project-plan'
  | 'project-apply'
  | 'review'
  | 'review-blocked'
  | 'review-checked'
  | 'run'
  | 'run-blocked'
  | 'run-checked'
  | 'run-automatic'
  | 'run-automatic-clean'
  | 'run-automatic-lagged'
  | 'run-explicit-clean'
  | 'run-explicit-lagged'
  | 'run-interrupted'
  | 'delivery-close'

// Observes existing work without adding a timer, retry or cached result. Labels
// are closed fixture phases; arguments, private paths and result data stay out.
export async function timeFixturePhase<Value>(
  scope: FixtureTimingScope,
  phase: FixtureTimingPhase,
  work: () => Value | Promise<Value>,
): Promise<Value> {
  const started = performance.now()
  try {
    return await work()
  } finally {
    try {
      console.log(
        JSON.stringify({
          kind: 'fixture-phase',
          scope,
          phase,
          elapsedMs: Math.round(performance.now() - started),
        }),
      )
    } catch {
      // Optional timing cannot replace the result or failure of the owned work.
    }
  }
}
