# Service/1 wire and TypeScript Provider milestone

**Status:** partial Service phase milestone, 2026-08-25.

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
  author projection. The TypeScript implementation now exists privately in
  `@flowmd/sdk`.

The Provider-facing TypeScript vocabulary is deliberately limited to:

```text
serveService
ServiceDefinition
ServiceMountContext
ServiceInvocationContext
ServiceError
```

The definition has one static export-handler map and one mount handler. The
mount calls `ready()` once and uses ordinary `try/finally` for cleanup. Both
mount and invocation contexts can call already-bound Flows and effects; the SDK
adds the correct wire owner privately.

## Evidence

- 20 Service/1 machine-schema fixtures pass.
- 10 focused TypeScript Provider lifecycle tests pass.
- The complete FLOW TypeScript SDK suite passes 53 tests.
- The installed-package smoke test passes after building only package files.
- The existing Jig suite passes 157 tests with the privileged hostile envelope
  cases skipped unless their explicit environment gate is enabled.

The focused Provider tests cover readiness, fixed exports, declared errors,
Mount- and invocation-owned calls, sibling-isolated cancellation, invocation
admission before readiness, invalid results, and definition capture before
protocol input.

## What this does not prove

The milestone does not yet contain:

- a Service/1 Host implementation;
- a Python Provider implementation;
- a shared process-level black-box lifecycle corpus;
- an independently implemented Host or Provider;
- provider generation, Binding, replacement, or durable Jig scheduling; or
- a stable Service/1 conformance label.

Those are the next gates. Consumer probes must not treat the TypeScript
Provider candidate alone as proof that Jig can host Services.
