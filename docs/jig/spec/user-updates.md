# User updates

*Status: experimental user-updates profile, provisional 0.1.0.*

The portable agreement belongs to `@jigging/user-updates`; its canonical
self-contained descriptor is `packages/user-updates/src/user-updates.json` in
the source distribution and [user-updates.json](https://jig.md/contracts/user-updates.json)
in documentation builds. Jig owns its CLI consumer and resource policy.
This profile adds no FLOW wire operation or execution authority. Exact identity,
version and digest use existing [Channel Contract/0](https://flow.jig.md/spec/channel-contracts)
rules. Identifier URLs are never runtime resolution.

## Message semantics

All messages are closed JSON/0 objects. No canonical encoded item exceeds
32 KiB. Strings contain Unicode scalars; lengths below count scalars, not bytes
or UTF-16 units. Publishers and consumers enforce semantic rules beyond schema.

| Kind | Fields | Meaning |
| --- | --- | --- |
| `notice` | `text`: 1–4096 scalars, multiline allowed; optional `severity`: `info`, `warning`, `error` | Append one complete attributed message; never a fragment. |
| `activity` | `id`: 1–64 scalars; `label`: 1–256; optional `progress` | Fully replace transient state for this connected source instance and opaque ID. |
| `clear` | `id`: 1–64 scalars | Remove the slot idempotently. Unknown IDs do nothing. |

Notice severity defaults to info. It classifies author-reported importance, never
host-attested blocking state, execution failure, retry or cancellation authority.
Severity changes emphasis, not ordering, quotas, pacing or optional delivery.
Authors report known blocking failures promptly and retain their reasons in final
results or artifacts even when live observation is unavailable.

Labels and units contain no CR, LF, U+2028 or U+2029. Progress is a closed object
with required `completed` and optional `total`, both safe nonnegative integers
through 9007199254740991, and optional `unit` (1–32 scalars). Completed cannot
exceed a present total. Zero total requires zero completed and displays counts
without a percentage; absent total also displays a count. Later complete snapshots
may decrease counts, change total/unit or omit progress. Omission removes previous
progress. Replacement retains first-appearance order; clearing and reusing an ID
creates a new appearance. IDs are presentation slots, not durable tasks, native
paths or host-attested provenance.

Only consecutive unsent tail activities with the same ID may coalesce. Notices,
clears and the immutable in-flight snapshot are barriers. Accepted transport order
is not an application revision counter or exhaustive history. No count, exact
100%, clear, or EOF establishes execution success. No rate, ETA or overall-run
percentage is promised; incomplete counts must never round to 100%.

## Scoped publishers

`withUserUpdates(run, name, body)` and Python's `async with user_updates(run,
name)` own an optional sender until body exit and cleanup settlement. They verify
the exact supported contract. The scope requires exclusive use: authors must not
independently send, close, transfer, or wrap its writer again. Process-local claims
reject double wrapping; language aliases are an ownership precondition, not a
security boundary. Every offer validates and snapshots before checking whether
observation is absent or disabled. Invalid offers throw even when unwired; offers
after draining begins are lifecycle errors. Disabled valid offers are no-ops.

| Publisher resource | Bound per scope |
| --- | --- |
| Serialized sends | 1 |
| Retained items including in-flight | 16 / 256 KiB |
| Send attempts / canonical traffic | 4096 / 4 MiB |
| Notices / canonical notice payload | 128 / 512 KiB |
| Active keys | 16 |
| Dispatch rate | At most 5/s |
| Local send wait / aggregate drain | 500 ms / 500 ms |

Lifecycle is accepting → draining → finished, with observation disabling and
publisher failure retained separately. Charge attempts/bytes before dispatch,
without refund for uncertainty. Quota or local wait expiry stops offers, releases
the unsent suffix and initiates one abnormal LAGGED close concurrently with the
original send. The helper never cancels or replaces that original promise/task.
It joins and inspects both send and close, including unexpected send rejection
after acknowledged close. Cleanup may exceed the optional publication budget.
No detached operation, automatic replay or fabricated successful seal is allowed.
Helper queues, keys, timers, callbacks and tasks retain their cleanup owner;
SDK-retained wire settlement keeps its existing owner through public cancellation.

Genuine observer LAGGED/DISCONNECTED may degrade under exclusive ownership.
Unexpected RESOURCE_EXHAUSTED, invalid contract/item/ownership/permission,
OWNER_CLOSED and fatal protocol failures remain publisher errors. Root
cancellation/deadline is authoritative. Successful bodies expose publisher failure;
failed bodies preserve their primary error with one bounded secondary diagnostic.
Cleanup is internally idempotent and issues no duplicate close.

## Composition and retirement

Roots retain their publisher; children use separate channels. Parents explicitly
validate/summarize/relay and own receiver disposal. Map each bounded child
occurrence to fresh outgoing IDs; stop its producer and callbacks before offering
ordered clears, and settle pending relay work before reuse. A used writer cannot
be transferred. Upstream loss clears that child's slots and may offer a complete
unavailable notice while the outgoing publisher remains healthy. Essential child
results follow normal call handling. ACP fragments/plans retain their separate
agreement; there is no generic conversion or implicit descendant subscription.

Retiring a direct source on EOF, loss, invalid input, quota or disposal fences
future callbacks and removes only its slots. Preserve surviving labels, progress,
relative order and current host status; reproject current state rather than restore
old screen snapshots. Complete notices already admitted to the bounded presenter
keep its ownership and order through ordinary retirement. Obsolete transient
projections may be superseded; accepted notice jobs may not. Printing a notice
cannot restore retired activity. Already dispatched output is irreversible and
cannot be retracted. No notice history or unbounded tombstone map is retained.

Shared queues, traffic, rate and slot budgets can stop healthy contributors.
This does not establish fairness, commutativity, independent transcripts or
independent outcomes. Clearing frees active occupancy only, never lifetime counters
or allocation rights. Observation availability never retries, activates or rebinds
domain work. Host stopping/cancellation/cleanup/terminal display permanently
fences Flow updates; transport and explicit machine records still settle normally.

## Jig selection and output

Resolve admitted target, entrypoint defaults and operator arguments first. An
effective `--receive` group, including an entrypoint default, disables automatic
selection and retains existing human channel stdout or exact begin/data/end/terminal
NDJSON. `--json` disables automatic Flow observation independently of host diagnostics.
Operator-only `--updates off` disables automatic selection and ambiguity hints;
it does not override explicit reception and is forbidden in entrypoint defaults.
Otherwise require terminal stderr; stdin/stdout TTY do not govern eligibility.
NO_COLOR and TERM=dumb change rendering only.

Exactly one optional send port must resolve from admitted captured bytes to the
supported identity/version/digest. Zero matches is silent; multiple matches emit
one bounded hint naming ports and explaining that `--receive` exposes existing
stdout records. Required ports keep normal connection requirements. There is no
guess, prompt, source reopening or URI fetch. Implicit reception has a separate
internal origin; it never modifies parsed receive names or stdout envelopes.
Stdout remains the ordinary human final result or single terminal JSON value.

One stderr presenter owns host progress, diagnostics, activities and notices.
It retains at most 16 slots in first-appearance order. Animated mode uses one
transient physical line for the host wait, refreshed at most 5/s. Activity activation
and meaningful label/unit changes append complete attributed indented lines, with
reported counts. These are state projections, not exhaustive activity history;
obsolete queued projections may disappear, while printed phase lines remain.
Count-only changes retain state without flooding either terminal mode. No phase
percentage or bar is inferred. Retired activities never emit new projections. Escape controls/bidi before terminal-cell truncation
of transient text; preserve complete notice content with Flow attribution on every
logical line. Application payload bypasses trusted heading/status recognition and
success colors. Explicit warning/error notices have a prominent attributed
Flow-reported warning/error label; payload text is still escaped data. IDs are map
keys. Plain mode emits activation and meaningful label/unit changes; count-only
updates change retained state without flooding. In both modes, clears silently
remove live slots and suppress obsolete queued appearances. Printed phase lines
remain history; application notices and final results own job outcomes. Clean
source EOF with remaining slots still reports that live activity observation ended.
The unique automatic source uses concise `Flow:` attribution rather than its
technical port name. Observation loss explains incomplete delivery and points
to the final result; a machine code cannot replace that explanation.
Resize, notice completion, update and retirement redraw current retained state.
Obsolete queued transient projections are superseded before dispatch; output already
dispatched follows normal settlement and is followed by current state when usable.

Consumer bounds are 4096 records/4 MiB input, 128 notices/512 KiB notice payload,
16 slots, and 16 pending presentation writes/256 KiB encoded output, including
in-flight output. Observation quota or semantic failure retires/disposes the
observer and emits one bounded unavailable explanation when output is usable.
Malformed data is a contract violation, not lag. Clean EOF returns to host waiting;
abnormal EOF reports incomplete observation without success decoration.

## Separate presentation pool

The uniquely selected optional port receives one command-owned source/receiver
outside the unchanged 16/16 application lifetime allocation allowance. At most one
presentation allocation is made per Run; disposal never replenishes it. There is
no late reallocation, replay or Flow creator-subscription right. Generic channel
creation and explicit reception retain normal limits and their closed wire schemas.

Presentation allows a 32 KiB item, 4 MiB source traffic, receiver buffer of
16 items/256 KiB and one pending send/32 KiB, isolated from ordinary pending-send
capacity. Both pools and limits participate in reviewed logical launch identity.
Descriptor cache and connection wire ceilings remain unchanged. Publication still
uses finite request capacity, CPU and deadline; this preserves application channel
allocation capacity without promising zero overhead or outcome invariance.

Installed stdout/stderr blockage or disconnection continues to request root
cancellation. Stderr flush failure can prevent final stdout. No notices or final
records are guaranteed after output loss. Independent host fencing owns cleanup.
Prompts, approvals, links, plans, durable logs and replay are outside this
profile. Markdown's sequential interpreter can reference the agreement but lacks
the code helpers' safe optional concurrent publishing; no parity is claimed.

## Qualification and promotion

This remains an experimental candidate. Qualify TypeScript and Python publishers
separately from installed public distributions, including a send failure arriving
after acknowledged abnormal close. Automatic display additionally requires the
separate-pool, exact stdout, effective-entrypoint, retirement, bounded-output,
Unicode-width and terminal failure checks on the supported host. Source tests and
design approval do not establish installed-host qualification or publication readiness.

Freeze public candidate bytes for an independent noncoding consumer and compare
against bounded string notices with the same optional lifecycle. Record setup
steps, required concepts, lifecycle code and comprehension limits; software-factory
composition is separate evidence. Promote only if shared replacement and counts
justify their additional ceremony. Passing protocol checks does not establish
better human supervision, fairness, optimal limits or Markdown parity. Change a
provisional limit or descriptor deliberately and re-review it before promotion.
