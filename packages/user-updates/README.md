# User updates

Install this package with its exact `@jigging/flow` peer. The publisher and caller
must share the public SDK's error class and writer implementation; a peer prevents
an independently resolved SDK copy from changing error identity.

Let a Flow report what it is doing while its application result remains the
authority for the outcome. This optional profile uses ordinary FLOW channels.
The provisional agreement is `https://jig.md/contracts/user-updates`, version
`0.1.0`. Its descriptor is exported as `@jigging/user-updates/user-updates.json`;
copy that file with the package's MPL-2.0 license when sharing it with another host.
The identifier is never fetched during execution.

Import the agreement once, declare an optional output, and use one scope:

```sh
mkdir -p contracts
jig import-contract builtin:user-updates contracts/user-updates
```

```json
{"channels":{"updates":{"direction":"send","required":false,"contract":"./contracts/user-updates/user-updates.json"}}}
```

```ts
import { handle } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'

handle(run => withUserUpdates(run, 'updates', async updates => {
  updates.activity('files', 'Checking files', { completed: 0, total: 3, unit: 'files' })
  // Perform the application's checks, updating the complete snapshot as needed.
  updates.notice('The file checks have ended.')
  updates.clear('files')
  return { outcome: 'done', output: { files: 3 } }
}))
```

Use `jig run <target> --receive updates` to expose ordinary selected-channel
records. Explicit reception retains existing stdout JSON/NDJSON and human
channel behavior. Automatic terminal observation is separately qualified by Jig;
it is not a power granted by this library.

`notice(text)` appends one complete message (multiline allowed). `activity(id,
label, progress?)` replaces a transient slot's entire state; omitted progress
removes the old count. `clear(id)` removes the slot, with unknown IDs harmless.
Progress counts may decrease or change units; 100%, clearing and EOF never mean
execution success. Consumers must retire all a source's activities on every end.
The exported `validateUserUpdate` returns an immutable snapshot for independent
consumers and enforces semantic rules beyond the descriptor's schema.

The scope owns its sender exclusively: do not send, close, transfer or wrap that
writer independently. Missing observation is allowed. Invalid offers throw even
when unwired; offers after body exit throw. Adjacent unsent activities with the
same ID may coalesce; notices and clears preserve order. Publication is bounded
to 16 retained items/256 KiB, 16 slots, 128 notices/512 KiB, 4096 attempts/4 MiB,
five sends per second, and 32 KiB per item. Local send and aggregate drain budgets
are 500 ms. Exceeding those budgets stops optional publication. Original sends
and close operations still settle before the scope returns, so cleanup can take
longer. Observer LAGGED/DISCONNECTED can degrade; unexpected publication errors
and root cancellation remain errors. A body error stays primary, with a bounded
secondary publisher diagnostic.

Children use separate channels. Parents validate and summarize deliberately,
own their receivers, map child occurrences to fresh IDs, and stop relay callbacks
before ordered clears. Shared publisher budgets can stop healthy siblings.
Do not reinterpret ACP fragments or plans as complete notices or measured counts.
Keep important domain warnings and evidence in the final result or artifacts too.
