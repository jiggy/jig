# Service/1 wire, Provider, and private Host milestone

**Status:** partial Service implementation milestone, 2026-08-25.

This milestone closes the first implementable Service boundary without claiming
Service/1 conformance or stability.

## What is now fixed

- [`Service/1`](../spec/service-protocol.md) defines one pending Mount request,
  fixed readiness, concurrent invocations, owner-attributed dependency calls,
  cancellation, terminal arbitration, and failure behavior.
- [`service-1.schema.json`](../spec/machine/service-1.schema.json) and
  [`service-1-errors.json`](../spec/machine/service-1-errors.json) define the
  closed machine message and operational-error candidates.
- [`Service SDK/1`](../spec/service-sdk.md) defines the small TypeScript/Python
  author projection. Both implementations now exist privately in
  `@flowmd/sdk` and `flowmd-sdk`.

The Provider-facing vocabulary is deliberately limited to:

```text
serveService
ServiceDefinition
ServiceMountContext
ServiceInvocationContext
ServiceError
```

Python uses the corresponding `serve_service` and snake-case context methods.

The definition has one static export-handler map and one mount handler. The
mount calls `ready()` once and uses ordinary `try/finally` for cleanup. Both
mount and invocation contexts can call already-bound Flows and effects; the SDK
adds the correct wire owner privately.

## Evidence

- 20 Service/1 machine-schema fixtures pass.
- 10 focused TypeScript Provider lifecycle tests pass.
- The complete FLOW TypeScript SDK suite passes 53 tests.
- The complete Python SDK suite passes 40 tests.
- The installed-package smoke test passes after building only package files.
- The private Jig Host passes 13 focused state-machine tests and drives real
  TypeScript and Python Provider processes through the same three operations.
- An independent Bun protocol peer runs ten cross-language Provider matrix
  cases.
- A real Python Provider completes Mount, invocation, cancellation, fencing,
  and cgroup removal inside the private Linux security envelope.
- The existing Jig suite passes 172 tests with the 11 privileged hostile envelope
  cases skipped unless their explicit environment gate is enabled.

The focused Provider tests cover readiness, fixed exports, declared errors,
Mount- and invocation-owned calls, sibling-isolated cancellation, invocation
admission before readiness, invalid results, and definition capture before
protocol input.

## What this does not prove

The milestone does not yet contain:

- the complete shared Host/Provider black-box lifecycle corpus;
- a second non-test Host product implementation;
- provider generation, Binding, replacement, or durable Jig scheduling; or
- a stable Service/1 conformance label.

The private Jig Host and independent Bun peer exercise overlapping scenarios,
but they do not yet consume one complete Host-under-test corpus. Request
ceilings, full framing and process-loss injection, and deadline/terminal races
remain explicit gates. Detached invocation work, trailing output, pre-readiness
loss, and one complete containment cleanup path are now proven. Consumer probes
must not treat this milestone as a stable Service platform.
