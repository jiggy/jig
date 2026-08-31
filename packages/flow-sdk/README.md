# @flowmd/sdk

Minimal, dependency-free TypeScript projection of FLOW Run/1.

This is a private `0.0.0` candidate, not a stable release. Its authoritative
source-checkout documents are `docs/spec/run-sdk.md` and
`docs/spec/run-protocol.md`. Stable external documentation URLs will be added
before publication. This installed README contains a minimal quickstart.

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

`serve()` owns the process's protocol stdin and stdout and serves exactly one
root Run. Root cancellation is exposed through `run.signal`. An already or
later aborted call-specific `AbortSignal` rejects that call with
`OperationError` code `CANCELLED` and sends the matching Run/1 cancellation
notification if the request reached the wire. A cancellation-only catch must
rethrow every other error. Cancellation does not claim that remote work was
undone.

The SDK permits at most 64 live outbound requests; another call made while all
64 are live fails locally with `OperationError` code `RESOURCE_EXHAUSTED`. It
emits at most 65,536 outbound requests over the complete Run lifetime; a later
call fails with the same code rather than emitting another frame.
