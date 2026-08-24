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
root Run. Root cancellation is exposed through `run.signal`. A call-specific
`AbortSignal` cancels the local wait and sends the matching Run/1 cancellation
notification without claiming that remote work was undone.
