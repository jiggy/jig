/** Closed explanations; evaluator/launcher exception text is never public guidance. */
export const EVALUATOR_HINTS = Object.freeze({
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
