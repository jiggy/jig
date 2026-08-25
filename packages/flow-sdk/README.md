# @flowmd/sdk

Minimal, dependency-free TypeScript projection of FLOW Run/1 and Service/1.

This is a private `0.0.0` candidate, not a stable release. Its authoritative
source-checkout documents are `docs/spec/run-sdk.md`,
`docs/spec/service-sdk.md`, `docs/spec/run-protocol.md`, and
`docs/spec/service-protocol.md`. Stable external documentation URLs will be
added before publication. This installed README contains minimal quickstarts.

Finite work uses `serve()`:

```ts
import { serve, type RunContext, type RunResult } from "@flowmd/sdk";

await serve(async (run: RunContext): Promise<RunResult> => {
  const child = await run.callFlow({
    operationId: "research:1",
    slot: "research",
    intent: "Research this request.",
    input: run.input,
  });

  return { outcome: "done", output: child.output };
});
```

A long-lived provider with a fixed export set uses `serveService()`:

```ts
import { serveService, type ServiceDefinition } from "@flowmd/sdk";

const service: ServiceDefinition = {
  exports: {
    clock: async (invocation) => ({
      method: invocation.method,
      now: Date.now(),
    }),
  },
  async mount(context) {
    await context.ready();
    await context.cancelled;
  },
};

await serveService(service);
```

`serve()` owns the process's protocol stdin and stdout and serves exactly one
root Run. Root cancellation is exposed through `run.signal`. An already or
later aborted call-specific `AbortSignal` rejects that call with
`OperationError` code `CANCELLED` and sends the matching Run/1 cancellation
notification if the request reached the wire. A cancellation-only catch must
rethrow every other error. Cancellation does not claim that remote work was
undone.

`serveService()` owns the same protocol streams for exactly one Service Mount.
Its export map is fixed before protocol input. `ready()` publishes that exact
set, each invocation gets an independently cancellable context, and calls made
from a context remain owned by that Mount or invocation.

The SDK permits at most 64 live outbound requests; another call made while all
64 are live fails locally with `OperationError` code `RESOURCE_EXHAUSTED`. It
emits at most 65,536 outbound requests over the complete Run lifetime; a later
call fails with the same code rather than emitting another frame.
