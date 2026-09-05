# @jigging/flow

Minimal, dependency-free TypeScript projection of FLOW Run/1.

This is the prerelease `0.1.0-alpha.6` package. Its authoritative documents
are the [Run SDK/1](https://flow.jig.md/spec/run-sdk) and
[Run/1](https://flow.jig.md/spec/run-protocol) specifications.

Declare the exact alpha in the FLOW package's `package.json`:

```json
{
  "private": true,
  "dependencies": {
    "@jigging/flow": "0.1.0-alpha.6"
  }
}
```

Generate only the text lock with Bun 1.3.3:

```console
bun install --lockfile-only
```

Keep `package.json` and `bun.lock` beside `flow.ts`; do not add `node_modules`
to the FLOW package. Jig's direct-run alpha prepares that locked dependency
during `jig review`; the admitted Run then reuses the prepared package without
installing or fetching.

Finite work uses `handle()`:

```ts
import { handle, type RunContext, type RunResult } from "@jigging/flow";

await handle(async (run: RunContext): Promise<RunResult> => {
  return { outcome: "done", output: { received: run.input } };
});
```

`handle()` owns the process's protocol stdin and stdout and handles exactly one
root Run. It captures the transport first, then replaces the global console
with one backed by diagnostic stderr, including after `handle()` returns. An
imported library that reads the current global `console` while the handler runs
is therefore safe. Logging from modules evaluated before `handle()`, a console
method cached before `handle()`, raw writes to stdout or file descriptor 1, and
child processes that inherit stdout remain invalid protocol output. Root
cancellation is exposed through `run.signal`.

If an application library logs through `console` while its module is first
evaluated, import the application graph dynamically after `handle()` owns the
channel:

```ts
import { handle } from "@jigging/flow";

await handle(async (run) => {
  const { runFlow } = await import("./application.js");
  return runFlow(run);
});
```

This also protects console methods cached by that later module graph. It does
not make raw stdout or inherited child stdout valid protocol output.

Run/1 also defines `run.callFlow()` and `run.callEffect()` as portable
operations. Jig supplies `callFlow()` only when the invoked Binding maps that
slot to one exact admitted direct Flow; a direct `flow:` Run has no child
slots. Jig supplies `callEffect()` only for its exact experimental
[Agent Run capability](https://jig.md/spec/agent-run); other effect slots are
unavailable. An unavailable operation rejects with `OperationError` code
`UNAVAILABLE`. A call-specific `AbortSignal` rejects a cancelled call with
code `CANCELLED` and sends the matching Run/1 cancellation notification if
the request reached the wire. A cancellation-only catch must rethrow every
other error. Cancellation does not claim that remote work was undone.

The SDK permits at most 64 live outbound requests; another call made while all
64 are live fails locally with `OperationError` code `RESOURCE_EXHAUSTED`. It
emits at most 65,536 outbound requests over the complete Run lifetime; a later
call fails with the same code rather than emitting another frame.
