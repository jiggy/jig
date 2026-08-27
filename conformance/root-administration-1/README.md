# Root Administration/1 consumer gate

This directory contains one deliberately small consumer of the closed
[`Root Administration/1`](../../docs/spec/root-administration.md) candidate.
It imports only `@jigging/jig/administration`, starts one Run, and polls its
status using application-owned wait policy.

The private Jig test host injects a real controller-backed object capability.
The consumer cannot import or name project roots, coordinator epochs,
admissions, runtime support, Sandbox Backends, process IDs, or cgroups. The Jig
package smoke test separately compiles this unchanged source against the packed
package.

This checked-in consumer is a public-surface cleanliness gate, not an
independent implementation, an IPC protocol, or a conformance certification.
An independent consumer subsequently packed and installed the package, compiled
this source unchanged, and exercised separately authored value, replay,
concurrency, and closure probes. That separate gate is recorded in
[`design-review/139-independent-root-administration-review.md`](../../docs/design-review/139-independent-root-administration-review.md).
