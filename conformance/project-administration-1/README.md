# Project Administration/1 consumer gate

This directory contains one deliberately finite consumer of the candidate
[`Project Administration/1`](../../docs/spec/project-administration.md)
surface. A trusted host injects a `ProjectSession`; the consumer can plan,
display the complete review, explicitly approve one subject containing the
operation, retained Plan digest, and review evidence, apply that same digest,
and close the session. If the operation and close both fail, the consumer
preserves both errors in order rather than letting cleanup mask the operation.

The consumer cannot open arbitrary state stores, select an evaluator, runtime,
Sandbox Backend, coordinator, launcher, or executor. It never treats review
text as authority and has no access to private Plan, Candidate, lock, recipe,
or host evidence records.

The packed-package smoke compiles this unchanged source against the installed
artifact. This is a public-surface cleanliness gate, not an operational host,
wire protocol, or conformance certification.
