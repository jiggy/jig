# Add progress to a Flow

A method can tell its caller what it is doing before its result arrives. Use
complete notices for messages and replaceable activities for current work. The
application still checks its result; a count or closed update stream never
establishes success.

## Import one agreement

Declare `@jigging/user-updates` alongside `@jigging/flow` in the Flow package's
dependencies. From that package, create a `contracts` directory and import:

```sh
mkdir -p contracts
jig import-contract jig:user-updates contracts/user-updates
```

The importer copies exact local descriptor bytes and its license, refuses an
existing destination, and runs no package code or network request. Other hosts
can copy the same agreement from the library or its
[download](https://jig.md/contracts/user-updates.json), with the accompanying
[MPL-2.0 license](https://jig.md/contracts/user-updates/LICENSE).

Add this optional port to `FLOW.meta.json` (or an existing invocation descriptor):

```json
{"channels":{"updates":{"direction":"send","required":false,"contract":"./contracts/user-updates/user-updates.json"}}}
```

The name `updates` is local. No named invocation contract for the whole Flow is
required. Direct delivery is the default; broadcast remains an ordinary choice.
Managed TypeSpec source borrows this exact descriptor; generation preserves its
bytes instead of rebuilding a similar model.

## Publish within the handler

Keep the method's work and checks inside one scope:

```ts
import { withUserUpdates } from '@jigging/user-updates'

return withUserUpdates(run, 'updates', async updates => {
  updates.activity('check', 'Checking the proposed result')
  const result = await checkProposal()
  updates.notice('The proposal checks have ended.')
  updates.clear('check')
  return result
})
```

Here `checkProposal()` is the application's existing procedure returning its
Run result. The scope validates offers, bounds queues, paces publication, and
settles its operations before returning. It owns that writer exclusively; do
not independently send, close, transfer, or wrap it again. Running without an
observer is allowed.
Invalid offers still throw when unwired, and offers after scope exit are errors.

Python uses its independently packaged `jiggy-user-updates` helper with the
same descriptor and meanings:

```python
from jiggy.user_updates import user_updates

async with user_updates(run, "updates") as updates:
    updates.activity("check", "Checking the proposed result")
    result = await check_proposal()
    updates.notice("The proposal checks have ended.")
    updates.clear("check")
    return result
```

`notice(text, severity?)` is one complete message; multiline content is allowed.
Use `info` (default), `warning` or `error` to report importance. For example,
`updates.notice("Could not start the AI session.", "error")` in TypeScript or
`updates.notice("Could not start the AI session.", severity="error")` in Python.
Jig prominently labels attributed Flow-reported errors. Severity does not change
ordering, quotas, optional delivery or execution authority. Offer blocking failures
promptly and retain their reasons in final results independently of observation.
`activity(id, label, progress?)` replaces the complete slot. Progress has required
`completed`, optional `total`, and optional `unit`, for example
`{completed: 3, total: 8, unit: 'files'}` in TypeScript. Counts may decrease or
change units; omitted progress removes the old count. `clear(id)` is idempotent.
Every source ending removes all its transient activities without decorating them
as successful. Keep essential warnings and outcome evidence in results/artifacts.

Local publication limits or 500 ms wait/drain expiry stop optional observation;
original send and close operations still settle, so cleanup can take longer.
Known observer loss may degrade. Unexpected publisher errors and root cancellation
remain failures. A body error stays primary with a bounded secondary diagnostic.
See [exact bounds and lifecycle](../spec/user-updates.md).

## Observe the work

After reviewing the changed source, ordinary `jig run` automatically displays
exactly one optional canonical output when stderr is a terminal. Activities share
one line with host progress; complete notices retain Flow attribution on every
line. Plain terminals show meaningful label changes without repeating every count.
Stdout remains the ordinary final result. `--updates off` disables automatic
observation; `--json` also disables it, while host diagnostics remain available.

Explicit `--receive updates` exposes the existing selected-channel stdout
presentation or JSON/NDJSON. It takes precedence even when supplied by the approved
project entrypoint; `--updates off` does not cancel that explicit choice. Multiple
canonical ports get one hint instead of a guess. Unsupported contracts remain
ordinary optional channels. NO_COLOR and TERM=dumb alter style, not selection.

For software consumers, use `--receive updates --json`, parse complete stdout
lines as JSON, and keep stderr separate. Read `begin`, ordered `data`, `end`, then
`terminal`. Only `terminal.result` reports the Run outcome. A disconnected stream
or missing terminal is incomplete delivery. There is no retention or replay.
[Run Checkpoint](../spec/run-checkpoint.md) separately retains settled artifacts.

A simpler string channel with explicit reception remains useful when messages
alone suffice. Raw authors must own validation, optional error handling and
cleanup themselves. The profile's shared replacement/count meaning is useful when
callers need current activity state across implementations; it is not required
for every log or output.

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

Here `eventSchema` is the application's FLOW Schema/0 item schema. This excerpt
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
