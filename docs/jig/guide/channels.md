# See progress while work runs

A Flow can read selected Agent updates, filter them and choose their presentation.
No logging capability or hook configuration is required.

The [live-agent example](https://github.com/jiggy/jig/tree/main/examples/live-agent)
targets the channel-enabled development candidate. Prepare its current FLOW
SDK as package-local source or a bundled Flow through the
[local authoring route](dependencies.md#local-or-unreleased-code); installing
its declared registry dependency alone does not supply the candidate APIs.
With the matching Jig candidate and a configured [native client](agents.md),
review the prepared application and run it:

```sh
jig review
jig run flow:flows/chat --input '{"instructions":"Explain why the sky is blue."}'
```

Selected text appears live on stderr. The final JSON on stdout contains the
actual Agent result. This is observation, not permission to interrupt, continue
or replace the Agent session.

Inside the Flow, the connection is ordinary application code:

```ts
const updates = await run.channel({
  contract: './contracts/acp-public-updates.json',
})
const answer = run.callCapability({
  operationId: 'answer', slot: 'agent', method: 'run',
  input: { instructions: run.input.instructions },
  channels: { events: updates.send },
})
try {
  for await (const update of updates.receive) {
    if (update.sessionUpdate === 'agent_message_chunk')
      console.log(update.content.text)
  }
} finally {
  await updates.receive.close()
}
const result = await answer
```

The example includes bounded input validation and recovery for incomplete
progress. Ordinary `catch` is sufficient. Closing the receiver joins disposal
and may reveal a racing failure not previously exposed. It stops observation,
not the Agent; await the Agent result separately. A caught display failure can
coexist with successful work, while root cancellation and unresolved owned work
still prevent success.

## Connect another application

The example declares an optional `progress` output. Select it to receive the
Flow's chosen text as structured live records instead of console diagnostics:

```sh
jig run flow:flows/chat --input '{"instructions":"Explain tides."}' --receive progress
```

Read `begin`, ordered `data`, `end`, then `terminal` from stdout. Parse each
complete line as JSON; keep stderr separate. Only `terminal.result` reports the
Run outcome. Treat a disconnected stream or missing terminal as incomplete
delivery. The [output contract](../spec/channels.md#installed-subprocess-output)
defines exact fields and bounds.

Setting `"suppress": true` in this example's input suppresses progress only;
it does not redact the actual final Agent answer. No host-side echo bypasses the
Flow's filtering. Channels have no retention or replay guarantee; use explicit
[checkpoints](../spec/run-checkpoint.md) when a completed artifact must survive
later execution interruption.
