/** Closed explanations; evaluator/launcher exception text is never public guidance. */
export const EVALUATOR_HINTS = Object.freeze({
  PROJECT_EVALUATOR_MEMORY_LIMIT:
    'The configuration evaluator reached its enforced memory limit. Keep declarations small and inert; preserve this diagnostic if a small declaration fails. No Flow was started.',
  PROJECT_EVALUATOR_PROCESS_LIMIT:
    'The configuration evaluator reached its enforced process limit. Preserve this diagnostic and report it with the indicated declaration; changing a Flow deadline will not fix review. No Flow was started.',
  PROJECT_EVALUATOR_DEADLINE:
    'The configuration evaluator reached its enforced wall-clock deadline. This does not establish whether authored work or runtime startup consumed the budget. Preserve this diagnostic if a small, inert declaration fails. No Flow was started.',
  PROJECT_EVALUATOR_SUPPORT:
    'Jig could not verify its configuration evaluator files. Restore the complete Jig installation and retry review. No Flow was started.',
  PROJECT_EVALUATOR_LAUNCH:
    'Jig could not start the contained configuration evaluator. Check supported host prerequisites and host load before retrying review; the underlying cause is not established. No Flow was started.',
  PROJECT_EVALUATOR_ENVELOPE:
    'The configuration evaluator did not establish its required isolation. Check the supported host prerequisites; do not bypass containment. No Flow was started.',
  PROJECT_EVALUATOR_CLEANUP:
    'Configuration evaluation stopped without confirmed cleanup. Allow project recovery to settle owned work before retrying review. No Flow was started.',
  PROJECT_EVALUATOR_INTERRUPTED:
    'Configuration evaluation was interrupted before a result was accepted. No Flow was started. Retry review only after owned work has settled.',
  PROJECT_EVALUATOR_PROTOCOL:
    'The configuration evaluator returned an invalid response. Check the complete Jig installation; preserve this diagnostic if it recurs. No Flow was started.',
  PROJECT_EVALUATOR_UNAVAILABLE:
    'The configuration evaluator is unavailable; its underlying cause was not retained. Check the complete Jig installation and supported host prerequisites. No Flow was started.',
})
