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
  author projection. Both implementations now exist privately in the
  separately gated `@flowmd/sdk/service` and `flowmd_sdk.service` modules.
  The Run SDK package roots do not export this candidate.

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
- The private Jig Host passes 24 focused state-machine tests and eight real
  process cases across conforming and hostile Providers.
- An independent Bun protocol peer runs 24 cross-language Provider matrix
  cases, including exact lifetime and frame boundaries.
- A real Python Provider completes Mount, invocation, cancellation, fencing,
  and cgroup removal inside the private Linux security envelope.
- The existing Jig suite passes 189 tests with the 11 privileged hostile
  envelope harness entries skipped unless their explicit environment gate is
  enabled.

The focused Provider tests cover readiness, fixed exports, declared errors,
Mount- and invocation-owned calls, sibling-isolated cancellation, invocation
admission before readiness, invalid results, and definition capture before
protocol input.

## What this does not prove

The milestone does not yet contain:

- a portable shared Host-under-test lifecycle corpus;
- a second non-test Host product implementation;
- provider generation, Binding, replacement, or durable Jig scheduling; or
- a stable Service/1 conformance label.

The required-case matrix now has executable evidence for every session-local
wire rule. Provider crash is proven, but fresh durable provider generations,
lease pinning, drain/replacement behavior, and the guarantee against silent
rebinding belong to the still-missing Jig controller. The cases are not yet
packaged as one portable Host-under-test corpus, and no second independent Host
has passed them. Consumer probes must not treat this milestone as a stable
Service platform.
