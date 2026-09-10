# See progress while work runs

A repair can take time. Show its phases while it works, then handle the patch
and evidence as the final result. The [tested-patch application](tested-patch.md)
provides both through ordinary Flow channels.

After its setup and review, run from `examples/tested-patch`:

```sh
jig run binding:repair --input @issue.json --attach source=fixtures/log-report --out repair-result --timeout 5m
```

Baseline, proposal, and check phases appear on stderr. They describe activity;
they do not establish that the patch passed. Ctrl-C cancels owned work.

## Connect another application

Use a new output destination and select the optional `progress` output:

```sh
jig run binding:repair --input @issue.json --attach source=fixtures/log-report --out repair-stream-result --timeout 5m --receive progress --json
```

Read `begin`, ordered `data`, `end`, then `terminal` from stdout. Parse each
complete line as JSON and keep stderr separate. Only `terminal.result` reports
the Run outcome. Treat a disconnected stream or missing terminal as incomplete
delivery. The [output contract](../spec/channels.md#installed-subprocess-output)
defines exact fields and bounds.

Closing a progress reader stops observation, not the underlying work. Always
await the final result separately. A display failure can coexist with a passing
patch; cancellation and unresolved owned work still prevent success. Channels
have no retention or replay guarantee. Use explicit
[checkpoints](../spec/run-checkpoint.md) when completed artifacts must survive
later interruption.

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

The parent passes endpoints in `run.call({ ..., channels: { ... } })`;
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

## Observe an Agent directly

Application phases work with final-only API clients as well as native Agents.
When a supported native client supplies public updates, a Flow can instead
connect the Agent capability's optional `events` writer to a channel using the
[public update contract](../spec/agent-run.md). Filter those events inside the
Flow before displaying them; preserve spacing when joining text fragments.
Observation never authorizes a follow-up turn or changes the Agent's powers.
Always settle both the observer and the capability call.

## Exchange requests and replies

Two direct channels can connect running Flows in both directions, with each
participant owning one writer. Named contracts establish item meaning;
application code checks correlation and bounds. Await both child results
separately: reply EOF alone cannot establish completed work. See the
[channel contract](../spec/channels.md) for endpoint transfer and lifecycle rules.
