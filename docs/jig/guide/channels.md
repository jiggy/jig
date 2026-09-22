# Add progress to a Flow

When a method takes time, its caller may need to show what stage it has reached.
A Flow can publish selected progress through an optional output channel while
its final result remains the source of the execution outcome.

Add this declaration to that Flow's `FLOW.contract.json`:

```json
{
  "$schema": "https://flow.jig.md/schemas/invocation-contract-1.schema.json",
  "channels": {
    "progress": {
      "direction": "send",
      "required": false,
      "delivery": "direct",
      "schema": { "type": "string", "maxLength": 256 }
    }
  }
}
```

Inside the existing handler, publish a short application-owned message at the
appropriate stage:

```ts
const progress = run.channels.progress
if (progress?.direction === 'send')
  await progress.send('Checking the proposed result')
```

The optional endpoint is absent when the caller has not connected it. This is
an integration excerpt, not a complete Flow: retain your method's work, result
checks, and failure handling. A message describes activity; it does not establish
that a result passed its checks.

## Connect a software caller

For a Flow declaring that output, add `--receive progress --json` to its ordinary
`jig run` command. Review the changed declaration and source before running.

Read `begin`, ordered `data`, `end`, then `terminal` records from stdout. Parse
each complete line as JSON and keep stderr separate. Only `terminal.result`
reports the Run outcome. A disconnected stream or missing terminal means the
caller lacks a complete result. The [subprocess output contract](../spec/channels.md#installed-subprocess-output)
defines exact fields and bounds.

Decide whether observation failure should fail your application. The simple
`await send()` above propagates delivery errors. An application that treats
progress as optional can handle known delivery failures and stop publishing,
while continuing to await its work. Cancellation and uncertain owned work must
still propagate; do not catch every error and report success.

Closing an observer stops observation, not the underlying work. Channels have
no retention or replay guarantee. [Run Checkpoint](../spec/run-checkpoint.md)
is a separate capability for retaining completed artifacts across interruption.

## Connect methods while they work

A parent can create a channel and pass its endpoints to exact child slots.
Each child reads its declared endpoints from `run.channels`. Endpoint transfer
and the child result remain separate operations; await the actual child outcome
rather than treating stream completion as success.

Use a direct channel when one consumer needs the data. Use broadcast only when
independent consumers genuinely need the same stream:

```ts
const events = await run.channel({ delivery: 'broadcast', schema: eventSchema })
const display = await events.subscribe()
const recorder = await events.subscribe()
```

Here `eventSchema` is the application's FLOW Schema/1 item schema. This excerpt
allocates endpoints only: the handler must connect the sender, consume or close
each subscription, and settle owned work. Subscribe before dispatch to receive
the beginning. A slow subscription can fail with `LAGGED` independently of other
consumers. Later subscriptions receive a suffix, without replay.

Two direct channels can support requests and replies. Named contracts establish
item meaning; application code checks correlation and bounds. Each participant
owns one writer. Reply EOF alone does not establish completed work.

See the [channel specification](../spec/channels.md) and
[SDK endpoint lifecycle](https://flow.jig.md/spec/run-sdk#9-channel-projection)
for exact transfer, disposal, and cancellation behavior.

## Observe an Agent directly

When a supported native client supplies public updates, a Flow can connect the
Agent capability's optional `events` writer to a channel using the
[public update contract](../spec/agent-run.md). Filter events inside the Flow
before displaying them; preserve spacing when joining text fragments.
Final-only API clients do not provide this stream.

Observation never authorizes a follow-up turn or changes the Agent's powers.
Settle both the observer and the capability call. Add this capability when live
Agent output is the lesson you need; application phases often suffice.
