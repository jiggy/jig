# @flowmd/sdk

Minimal, dependency-free TypeScript projection of FLOW Run/1.

The candidate public surface is specified in
[`docs/spec/run-sdk.md`](../../docs/spec/run-sdk.md); wire behavior is specified
in [`docs/spec/run-protocol.md`](../../docs/spec/run-protocol.md).

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

Build and verify a clean tarball install with:

```console
bun run test:package
```
