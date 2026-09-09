# @jigging/flow

Minimal, dependency-free TypeScript projection of FLOW Run/1.

This is the prerelease `0.1.0-alpha.10` package. Its authoritative documents
are the [Run SDK/1](https://flow.jig.md/spec/run-sdk) and
[Run/1](https://flow.jig.md/spec/run-protocol) specifications.

Declare the exact alpha in the FLOW package's `package.json`:

```json
{
  "private": true,
  "dependencies": {
    "@jigging/flow": "0.1.0-alpha.10"
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

Run/1 also defines `run.runChildFlow()` and `run.callCapability()` as portable
operations. The host determines which slots are available. For Jig's admitted
child targets and Agent capability, see its
[project policy](https://jig.md/spec/project-policy) and
[Agent Run documentation](https://jig.md/spec/agent-run).
An unavailable operation rejects with `OperationError` code
`UNAVAILABLE`. A call-specific `AbortSignal` rejects a cancelled call with
code `CANCELLED` and sends the matching Run/1 cancellation notification if
the request reached the wire. A cancellation-only catch must rethrow every
other error. Cancellation does not claim that remote work was undone.

The SDK permits at most 64 live wire requests and 65,536 request frames over
one Run. When channels are present, it reserves capacity inside those limits
for endpoint disposal. Saturated ordinary admission fails with
`OperationError` code `RESOURCE_EXHAUSTED`.

## Direct channels

Channels exchange bounded JSON values while ordinary calls execute. A direct
pair has one sender and one receiver. The host checks declared channel
requirements when an unused endpoint is passed through a call's `channels` map.
Incoming endpoints are available by local name in `run.channels`.

For a capability whose `run` method declares an `events` sender matching the
package-local channel contract:

```ts
import { OperationError } from "@jigging/flow";

const events = await run.channel({ contract: "./contracts/updates.json" });
const work = run.callCapability({
  operationId: "worker", slot: "worker", method: "run", input: run.input,
  channels: { events: events.send },
}).catch(async (error) => {
  // Rejected admission may leave the source without a connected producer.
  await events.receive.close().catch(() => undefined);
  throw error;
});

const observation = (async () => {
  try {
    for await (const value of events.receive) {
      console.log(value); // Application-owned filtering and presentation.
    }
  } catch (error) {
    if (!(error instanceof OperationError) ||
        !["LAGGED", "DISCONNECTED"].includes(error.code)) throw error;
    console.error("Progress delivery was incomplete.");
  }
})();

const [execution, observed] = await Promise.allSettled([work, observation]);
if (execution.status === "rejected") throw execution.reason;
if (observed.status === "rejected") throw observed.reason;
const result = execution.value; // Channel completion is not execution success.
```

`run.channel()` accepts generic JSON values; `schema` optionally constrains
their shape, or `contract` selects exact named meaning. The sender's
`send(value, options?)` acknowledges host
acceptance, and `close(options?)` seals the source. Neither promises processing
by the consumer. Closing with unaccepted sends rejects.

A receiver supports one async iterator and one outstanding `next(options?)`.
Breaking a TypeScript `for await` loop disposes it; explicit
`await receiver.close(options?)` also stops observation without cancelling the
producer. Cancelling a started read disposes its receiver and retains the late
wire response. A later uncancelled `close()` waits for that settlement and
exposes any terminal failure not previously exposed. Repeated close does not
repeat the same terminal error.

Ordinary `try/catch` remains sufficient for recoverable failures. An ignored,
already-settled rejection is not a completion guarantee. Returning with live
work or an unfinished connected receiver refuses success; root cancellation
and loss of the current control transport cannot be recovered into success.

## Broadcast channels

`run.channel({ delivery: "broadcast" })` returns a `ChannelBroadcast` with
`send` and `subscribe(options?)`. Only its creating Run can allocate subscriptions;
the subscription authority is not an endpoint and cannot be passed through a
call. The creator may transfer the unused writer and still subscribe afterward.

```ts
const source = await run.channel({ delivery: "broadcast" });
const first = await source.subscribe();
await source.send.send("first");
const later = await source.subscribe(); // startSequence is now 2.
await source.send.send("second");
await source.send.close();

await Promise.all([first, later].map(async (receiver) => {
  for await (const value of receiver) console.log(receiver.startSequence, value);
}));
```

Each subscription receives only its own interval, beginning at its immutable
`startSequence`. There is no replay: publishing without subscribers retains no
values. A slow receiver fails with `LAGGED` independently of healthy receivers
and the writer. Closing one receiver does not close the source; sealing the
writer allows existing receivers to drain but rejects new subscriptions.
Each unused receiver may be passed through an ordinary call's `channels` map.

Subscription allocation itself creates an active receiver. Consume it to an
end or terminal failure, or explicitly close it. Cancellation of allocation
retains the wire response and disposes any late allocated right before Run
completion; failed allocation cleanup prevents success. Broadcast carries
JSON values, not native sockets, binary streams, replay storage, or execution
control.
