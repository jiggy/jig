# Run/1 external-author gate

This directory defines the repeatable instruction-restricted author and
evaluator exercise used by the Run/1 prerelease gate. It contains no solution,
evaluator implementation, packed artifact, or historical probe workspace.

For each run, the release owner must seal and record:

- the current [`AUTHOR-BRIEF.md`](AUTHOR-BRIEF.md) and
  [`EVALUATOR-BRIEF.md`](EVALUATOR-BRIEF.md) bytes;
- the exact public Package/1, JSON/1, Schema/1, Run/1, Run SDK/1, and Runtime
  Adapter documents supplied to the participants;
- the exact packed SDK and inert Jig package-checker artifacts and their
  digests;
- the supported author-language and host-runtime facts; and
- the submitted source, reports, evaluator result, commands, and explicit
  nonclaims.

The author and evaluator start fresh and do not inspect Jig/FLOW source,
private tests, design reviews, historical probe output, or one another's work
before the chronology in the evaluator brief permits it. They cannot edit the
platform or complete a missing interface. A missing documented operation is a
blocked result.

Execution occurs in an ephemeral directory outside the repository. Installed
dependencies, caches, copied specifications, built artifacts, and evaluator
scratch are disposable and are never promoted from the exercise. The release
record may retain the small submitted source and reports as evidence, but they
are not product code, a Starter, or a conformance implementation.

This gate supplements the executable Run/1 corpus. It tests independent
learnability and public-surface sufficiency; it does not create a general
third-party certification label.
