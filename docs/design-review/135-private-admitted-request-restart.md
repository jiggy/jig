# Private admitted-request restart boundary

**Status:** implemented prerequisite for durable root Runs. A fresh coordinator
can now reconstruct the exact activation request from protected admission
state, without retaining the authoring graph or trusting a digest-only test
variable.

## Change

Activation candidate version 2 stores one closed immutable activation-request
snapshot beside its READY or unavailable disposition. The snapshot covers the
target, mode, package path and Package/1 reference, entrypoint, settings,
attachments, and slots. Its embedded digest is recomputed from canonical
content, and candidate normalization cross-checks the request against the
portable lock's exact target, package, digest, and mode.

Because this changes persisted private candidate semantics, the owner database
uses a new filename, application ID, and schema version 4. It never interprets
version-3 bytes under the new model.

`loadPrivateActiveActivation` reopens the current linear admission, rechecks
its complete admission-plan-candidate closure, reacquires every referenced
Package/1 object, rejects a head change during observation, and returns only a
storage-authenticated candidate. Reconstructed request values are deeply
immutable and retain their exact request identity.

## Proof

The focused candidate/store suite passes 15 tests with 123 expectations, and
the complete ordinary suite passes 306 tests with 66,564 expectations. The
hostile retained-project integration now discards the original planning
request, reopens the active candidate, re-plans from its stored request plus a
fresh runtime-support observation, and completes the contained Run/1 path with
68 expectations.

## Boundary

This does not allocate a Run, accept a submission key, record spawn intent, or
publish a terminal. It removes the last invocation-memory dependency before
that state machine is introduced.
