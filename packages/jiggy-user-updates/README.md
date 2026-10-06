# Python user updates

Report complete notices and replace transient activity while a Flow works:

```python
from jiggy.flow import handle, RunResult
from jiggy.user_updates import user_updates

async def run(context):
    async with user_updates(context, "updates") as updates:
        updates.activity("files", "Checking files", {"completed": 0, "total": 3, "unit": "files"})
        # Perform the application's checks here.
        updates.notice("The file checks have ended.")
        updates.clear("files")
        return RunResult(outcome="done", output={"files": 3})

handle(run)
```

Create the `contracts` parent directory, import the agreement with `jig import-contract jig:user-updates
contracts/user-updates`, then declare an optional send channel in `FLOW.meta.json`:
`{"channels":{"updates":{"direction":"send","required":false,"contract":"./contracts/user-updates/user-updates.json"}}}`.
Use `--receive updates` for explicit observation. The exact same provisional
`0.1.0` agreement is also bundled as `jiggy.user_updates/user-updates.json`;
share its MPL-2.0 license when copying it to other hosts. Identity is derived
from the descriptor, with no runtime network fetch.

Offers validate and snapshot even without an observer. The scope exclusively
owns its writer; do not send, close, transfer or wrap it independently. Adjacent
unsent activities may coalesce; notices and clears preserve order. Activity fully
replaces the label and optional count, which may decrease or change units. Clear
and source ending remove transient state. Notices, counts and even 100% never
establish execution success. Keep essential evidence in results or artifacts.

The publisher bounds retained messages (16/256 KiB), active IDs (16), notices
(128/512 KiB), attempts/traffic (4096/4 MiB), item size (32 KiB) and rate (5/s).
Local send and aggregate drain budgets are 500 ms. Local overflow or timeout
stops observation; original sends and close still settle before scope exit,
which may therefore take longer. Observer LAGGED/DISCONNECTED may degrade.
Unexpected publication errors remain errors; application exceptions remain
primary with a bounded secondary diagnostic. Cancellation stops publication and
joins owned operations while the SDK keeps ownership of retained wire requests.

Parents explicitly validate/summarize child observations and own their receivers.
Give each child occurrence fresh IDs and fence relays before ordered clears.
Shared budgets can stop healthy siblings. ACP fragments and plans have a
separate contract; this helper does not convert them.
