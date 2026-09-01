# @flowmd/sdk

Minimal, dependency-free TypeScript projection of FLOW Run/1.

This is a prerelease `0.1.0-alpha.1` candidate. Its authoritative documents
are the [Run SDK/1](https://github.com/jigmd/jig/blob/main/docs/spec/run-sdk.md)
and [Run/1](https://github.com/jigmd/jig/blob/main/docs/spec/run-protocol.md)
specifications.

The technical candidate deliberately retains `private: true` and cannot be
published. The final release candidate removes that guard before its archive
is built and tested.

Once the package is published, add the exact alpha to a FLOW package with
Bun's ordinary dependency workflow:

```console
bun add --exact @flowmd/sdk@0.1.0-alpha.1
```

Keep the resulting `package.json` and text `bun.lock` beside `flow.ts`. Jig's
direct-run alpha prepares that locked dependency during `jig check`; the
admitted Run then reuses the prepared package without installing or fetching.

Finite work uses `serve()`:

```ts
import { serve, type RunContext, type RunResult } from "@flowmd/sdk";

await serve(async (run: RunContext): Promise<RunResult> => {
  return { outcome: "done", output: { received: run.input } };
});
```

`serve()` owns the process's protocol stdin and stdout and serves exactly one
root Run. Root cancellation is exposed through `run.signal`.

Run/1 also defines `run.callFlow()` and `run.callEffect()` as portable
operations. Jig's direct-run alpha does not provide child Flows or effects, so
it answers those calls with `OperationError` code `UNAVAILABLE`. A
call-specific `AbortSignal` rejects a cancelled call with code `CANCELLED` and
sends the matching Run/1 cancellation notification if the request reached the
wire. A cancellation-only catch must rethrow every other error. Cancellation
does not claim that remote work was undone.

The SDK permits at most 64 live outbound requests; another call made while all
64 are live fails locally with `OperationError` code `RESOURCE_EXHAUSTED`. It
emits at most 65,536 outbound requests over the complete Run lifetime; a later
call fails with the same code rather than emitting another frame.
