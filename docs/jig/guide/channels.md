# See progress while work runs

A Flow can read selected Agent updates, filter them and choose their presentation.
No logging capability or hook configuration is required.

Use the [live-agent source example](https://github.com/jiggy/jig/tree/main/examples/live-agent).
After [workspace setup](dependencies.md#local-workspace-packages), with Jig and
a configured [native client](agents.md), run from that directory:

```sh
jig review
jig run flow:flows/chat --input '{"instructions":"Explain why the sky is blue."}'
```

Selected text appears live on stderr. The final JSON on stdout contains the
actual Agent result. This is observation, not permission to interrupt, continue
or replace the Agent session.

The chat Flow creates the channel and passes its writer to the Agent
capability. The capability supplies public Agent updates; the chat Flow keeps
the receiver and chooses what to display. Both the call and the reading loop
below belong to that one Flow. This is a handler excerpt: `run` is the
`RunContext` supplied by `handle()`.

```ts
import { OperationError } from '@jigging/flow'

const input = run.input
if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !('instructions' in input) || typeof input.instructions !== 'string')
  throw new TypeError('Supply instructions')
const updates = await run.channel({
  contract: './contracts/acp-public-updates.json',
})
// Give the Agent capability the writer; it produces the updates.
const answer = run.callCapability({
  operationId: 'answer', slot: 'agent', method: 'run',
  input: { instructions: input.instructions },
  channels: { events: updates.send },
}).catch(async (error) => {
  // Rejected admission can leave no producer to end the stream.
  await updates.receive.close().catch(() => undefined)
  throw error
})
// The chat Flow consumes those updates while the Agent call is pending.
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
presentation. For a single issue, its parent creates a broadcast phase source
and a direct display channel, then connects two exact child slots:

| Connection | Data | Responsibility |
| --- | --- | --- |
| Repair's `progress` → monitor's `phases` | Bounded phase and attempt records | Repair reports its work without choosing a display. |
| Repair's `progress` → root recorder | The same phase records, independently received | Root saves a bounded trace without another child. |
| Monitor's `display` → parent | Selected text | Monitor filters and formats; parent prints or forwards it. |
| Repair's call result → parent | Patch and check evidence | Parent validates, checkpoints and delivers the actual result. |

The parent passes endpoints in `run.runChildFlow({ ..., channels: { ... } })`;
each child reads its declared endpoints from `run.channels`. No hook or Log
capability is involved. Replacing the exact `monitor` slot changes presentation
without editing the repair specialist. A monitor receives no source files,
Agent powers, commands or patch-approval authority.

These excerpts run in separate child Flows, each with its own `run` context.
They show endpoint use; the linked handlers also validate values and settings,
handle optional delivery failures, and settle their channel ownership.

The [repair Flow](https://github.com/jiggy/jig/blob/main/examples/tested-patch/flows/repair/repair.ts)
gets its writer from `run.channels.progress`. Inside its `publish(phase, attempt)`
helper, it sends a record when progress is connected and still available:

```ts
run.signal.throwIfAborted()
if (!progress || !progressAvailable) return
await progress.send({ phase, attempt })
```

The [monitor Flow](https://github.com/jiggy/jig/blob/main/examples/tested-patch/flows/monitor/monitor.ts)
gets `source` from `run.channels.phases` and `destination` from
`run.channels.display`. Its reading loop uses its own validated presentation
settings and `formatProgress` helper:

```ts
for await (const value of source) {
  run.signal.throwIfAborted()
  const record = formatProgress(value, style)
  if (!selected.includes(record.phase)) continue
  await destination.send(record.text)
  displayed++
}
```

The [complete parent](https://github.com/jiggy/jig/blob/main/examples/tested-patch/flows/project/monitoring.ts)
handles rejected connections, observation loss and cancellation. It always
settles the repair call independently: a finished stream is not a passing patch,
and a failed monitor need not discard successful work. Both sources stay owned
by the parent until its work settles. The existing two-child limit applies;
the example's batch mode uses both positions for repair workers instead.

## Give each consumer its own subscription

Broadcast adds one choice at creation and one allocation per consumer:

```ts
const phases = await run.channel({ delivery: 'broadcast', schema: phaseSchema })
const monitorFeed = await phases.subscribe()
const recorderFeed = await phases.subscribe()
```

The parent passes `phases.send` to repair, `monitorFeed` to the monitor, and
reads `recorderFeed` itself. Subscribe before starting repair to receive its
beginning. Each feed has independent capacity: a slow subscriber gets `LAGGED`
instead of slowing the others. Catch its failure, dispose it, and still await
the worker's actual result. A source error or root cancellation remains different
from a single subscriber failure.

Only the source creator can subscribe. A later subscription starts at the next
accepted sequence, with no replay; a receiving port must accept `start: suffix`
when that sequence is greater than one. Every allocated feed must be exhausted
or closed, even if never read. The [SDK contract](https://flow.jig.md/spec/run-sdk#9-channel-projection)
defines disposal and language-specific early-exit behavior.

The example saves its at-most-six-record trace as `files/progress.json`, with
its own completeness flag. Filtering the monitor does not filter this independent
trace. Neither is acceptance evidence, and a checkpoint retained before the
observers settle may contain the patch without the trace.

## Exchange structured requests and replies

Channels also connect two running Flows in both directions. The
[dataset analysis application](dataset-analysis.md) uses a request channel and
a Celsius-reading channel to choose samples adaptively. Each side owns one
writer; named contracts establish meaning, while application code checks
correlation and an eight-request bound. The parent still awaits and validates
both execution results separately.
