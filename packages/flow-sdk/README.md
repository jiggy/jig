# @jigging/flow

Minimal, dependency-free TypeScript projection of FLOW Run/1.

This is the prerelease `0.1.0-alpha.1` package. Its authoritative documents
are the [Run SDK/1](https://github.com/jigmd/jig/blob/main/docs/spec/run-sdk.md)
and [Run/1](https://github.com/jigmd/jig/blob/main/docs/spec/run-protocol.md)
specifications.

Declare the exact alpha in the FLOW package's `package.json`:

```json
{
  "private": true,
  "dependencies": {
    "@jigging/flow": "0.1.0-alpha.1"
  }
}
```

Generate only the text lock with Bun 1.3.3:

```console
bun install --lockfile-only
```

Keep `package.json` and `bun.lock` beside `flow.ts`; do not add `node_modules`
to the FLOW package. Jig's direct-run alpha prepares that locked dependency
during `jig check`; the admitted Run then reuses the prepared package without
installing or fetching.

Finite work uses `serve()`:

```ts
import { serve, type RunContext, type RunResult } from "@jigging/flow";

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
