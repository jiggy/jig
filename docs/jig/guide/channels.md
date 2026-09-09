# See progress while work runs

A Flow can read selected Agent updates, filter them and choose their presentation.
No logging capability or hook configuration is required.

Choose `live-agent.tar.gz` from a
[matching Jig release](https://github.com/jiggy/jig/releases) and extract the
prepared application. Its [repository directory](https://github.com/jiggy/jig/tree/main/examples/live-agent)
is authoring source. With Jig and a configured [native client](agents.md),
run from the extracted application:

```sh
jig review
jig run flow:flows/chat --input '{"instructions":"Explain why the sky is blue."}'
```

Selected text appears live on stderr. The final JSON on stdout contains the
actual Agent result. This is observation, not permission to interrupt, continue
or replace the Agent session.

Inside the Flow, the connection is ordinary application code:

```ts
import { OperationError } from '@jigging/flow'

const input = run.input
if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !('instructions' in input) || typeof input.instructions !== 'string')
  throw new TypeError('Supply instructions')
const updates = await run.channel({
  contract: './contracts/acp-public-updates.json',
})
const answer = run.callCapability({
  operationId: 'answer', slot: 'agent', method: 'run',
  input: { instructions: input.instructions },
  channels: { events: updates.send },
}).catch(async (error) => {
  // Rejected admission can leave no producer to end the stream.
  await updates.receive.close().catch(() => undefined)
  throw error
})
const observation = (async () => {
  try {
    for await (const update of updates.receive) {
      if (!update || typeof update !== 'object' || Array.isArray(update) ||
          !('content' in update) || !('sessionUpdate' in update)) continue
      const content = update.content
      if (update.sessionUpdate === 'agent_message_chunk' &&
          content && typeof content === 'object' && !Array.isArray(content) &&
          'type' in content && content.type === 'text' &&
          'text' in content && typeof content.text === 'string')
        console.log(content.text)
    }
  } catch (error) {
    if (!(error instanceof OperationError) ||
        !['LAGGED', 'DISCONNECTED'].includes(error.code)) throw error
    console.error('Progress delivery was incomplete.')
  }
})()
const [execution, observed] = await Promise.allSettled([answer, observation])
if (execution.status === 'rejected') throw execution.reason
if (observed.status === 'rejected') throw observed.reason
const result = execution.value
```

The [complete application](https://github.com/jiggy/jig/blob/main/examples/live-agent/flows/chat/chat.ts)
adds bounded input validation, output selection and Agent-outcome interpretation.
Ordinary `catch` is sufficient. Closing the receiver joins disposal
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

## Give progress to another Flow

The [tested-patch application](tested-patch.md) separates repair from its
presentation. For a single issue, its parent creates two direct channels and
connects two exact child slots:

| Connection | Data | Responsibility |
| --- | --- | --- |
| Repair's `progress` → monitor's `phases` | Bounded phase and attempt records | Repair reports its work without choosing a display. |
| Monitor's `display` → parent | Selected text | Monitor filters and formats; parent prints or forwards it. |
| Repair's call result → parent | Patch and check evidence | Parent validates, checkpoints and delivers the actual result. |

The parent passes endpoints in `run.runChildFlow({ ..., channels: { ... } })`;
each child reads its declared endpoints from `run.channels`. No hook or Log
capability is involved. Replacing the exact `monitor` slot changes presentation
without editing the repair specialist. A monitor receives no source files,
Agent powers, commands or patch-approval authority.

The [complete parent](https://github.com/jiggy/jig/blob/main/examples/tested-patch/flows/project/monitoring.ts)
handles rejected connections, observation loss and cancellation. It always
settles the repair call independently: a finished stream is not a passing patch,
and a failed monitor need not discard successful work. Both channels stay owned
by the parent until its work settles. The existing two-child limit applies;
the example's batch mode uses both positions for repair workers instead.
