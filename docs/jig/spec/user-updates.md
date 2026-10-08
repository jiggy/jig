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
| `activity` | `id`: 1–64 single-line scalars; `label`: 1–256; optional `progress`, `detail`, own-call `operationId` | Fully replace transient state for this connected source instance and opaque ID. |
| `clear` | `id`: 1–64 single-line scalars | Remove the slot idempotently. Unknown IDs do nothing. |
| `view` | `id`, `title`, `summary`, `sections`; optional `landing: true`, own-call `operationId` | Replace one complete attributed workspace view; see dashboard semantics below. |
| `retire-view` | `id` | Remove a view and claim its ID against reuse. |

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

Only consecutive unsent tail replacements of the same activity or view may coalesce. Notices,
clears, view retirements and the immutable in-flight snapshot are barriers. Accepted transport order
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
| Local send wait / aggregate drain | 500 ms / 4000 ms |

The aggregate best-effort drain allowance starts at body exit. Already drained or
unwired scopes add no waiting period. Four seconds accommodates a full backlog
with prompt acknowledgements, without guaranteeing every legal sequence of
sub-500 ms sends. The Run deadline can expire during this final drain; it is
never extended. Send and close settlement may exceed either allowance.

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
cannot be retracted. Attention retains at most 128 reports /512 KiB. View retirement claims are bounded
by the lifetime ID limits; there is no unbounded history or tombstone map.

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
Otherwise observe the admitted optional port on stderr, using plain output when redirected.
NO_COLOR and TERM=dumb select nonanimated plain automatic output. Stdout TTY does not govern eligibility.

Exactly one optional send port must resolve from admitted captured bytes to the
supported identity/version/digest. Zero matches is silent; multiple matches emit
one bounded hint naming ports and explaining that `--receive` exposes existing
stdout records. Required ports keep normal connection requirements. There is no
guess, prompt, source reopening or URI fetch. Implicit reception has a separate
internal origin; it never modifies parsed receive names or stdout envelopes.
Stdout remains the ordinary human final result or single terminal JSON value.

One stderr presenter owns host progress, diagnostics, activities and notices.
It retains at most 16 slots in first-appearance order. Before application views or host calls, animated mode uses one
transient physical line for the host wait, refreshed at most 5/s. During execution
the bounded inline dashboard projects actual calls and the selected application view. Activity activation
and meaningful label/unit changes append complete attributed indented lines, with
reported counts. These are state projections, not exhaustive activity history;
obsolete queued projections may disappear, while printed phase lines remain.
Count-only changes retain state without flooding either terminal mode. No overall-run percentage, phase percentage or ETA is inferred. A progress block
with an explicit positive denominator may display a count bar. Retired activities never emit new projections. Escape controls/bidi before terminal-cell truncation
of transient text; preserve complete notice content as a contiguous block with
Flow attribution on its first line and indented continuations. Escape every
payload line. Application payload bypasses trusted heading/status recognition and
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
Prompts, approvals, executable links, plans, durable logs and replay are outside this
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

## Read-only run dashboard and domain views

Jig owns the run shell and the actual observed invocation tree. Applications own
workspace views through the same optional `jig:user-updates` agreement and
scoped publisher. There is no new channel, FLOW operation, domain task ontology,
executable widget, arbitrary layout language or execution-changing control.

`view` contains `id`, `title`, `summary`, `sections`, optional `landing: true`
and optional own-call `operationId`. `retire-view` contains `id`. A section has
optional title and blocks. Blocks are literal reports with optional references,
label/value facts, explicit completed/total progress, or typed collections with
stable row IDs, exact cells and optional non-collection row details. The canonical
descriptor owns the closed field schema; semantic validation additionally checks
column types, duplicate IDs, counts, aggregate bounds and safe references.

Full view replacement is atomic after validation and capacity reservation. A
rejected replacement preserves the last complete snapshot and marks the source
incomplete. Source, landing and call association stay fixed for a view lifetime;
title, summary and content may change. Omission removes optional old content.
Unknown raw retirement claims and retires its ID once. Retired IDs never revive.
Clean EOF removes activities but freezes views with ended context and last update;
loss, invalid data and quota freeze them incomplete. Host stopping permanently
fences callbacks. No observation ending or domain status establishes success.

Per publisher, at most 16 lifetime view IDs and 8 retained live/frozen views /128
KiB; per command, 64 lifetime IDs and 32 retained views /512 KiB. Each view has
8 sections, 32 total blocks including row details, 128 total rows, 8 columns per
collection, 1024 cells, 8 details per row, 32 facts per block, 8 references per
report. IDs/keys use 1–64 scalars; titles/labels 1–128; summary 1–1024;
report/text values 0–4096; units 1–32. IDs, keys, titles, labels and units are
single-line. Activity's existing 64/256/32 bounds remain; optional `detail` is
1–4096 multiline scalars and own-call `operationId` stays fixed until clear.

Actual accepted-send participant provenance is private sideband, including pending
sends and writer transfer. Creator or owner identity and public IDs never prove
the sender. View keys use actual publisher instance plus local ID. Call keys use
actual invoking instance plus original caller-local operation ID, independently
of flattened private execution IDs. Duplicate operations join; deliberate retries
need fresh IDs. Bounded dynamic reference lookup uses only current retained views,
actual own calls and verified delivered-file evidence, with no pending join map,
speculative node, URI lookup or implicit descendant subscription.

Record references name same-publisher view/collection/row. Call references name
the publisher's own operation ID, using the Run/0 ASCII identifier rule. Artifact
references name a declared output attachment and a safe relative file path (512
UTF-8 bytes, 16 segments, no absolute/dot/dot-dot/backslash/control/protected .jig
segments). A child-only file is unavailable unless its parent remaps and delivers
it. Pending delivery and missing targets remain explicit and may resolve later.
Previews use the exact immutable verified bytes retained by the delivery owner,
never reopen destination paths. One explicit inspector retains at most one output
snapshot /16 MiB /64 files and one active UTF-8 text/diff preview /64 KiB. Binary
or unavailable capture stays unavailable; clipping is explicit and character-safe.
Every command exit closes preview and presentation owners.

The host tree retains 256 nodes, depth 32 and 256 KiB metadata. It projects only
parent identity, reviewed slot, bounded caller intent, time, lifecycle state and
safe cause. It excludes inputs, prompts, native arguments, secrets and arbitrary
results. States distinguish requested/not-started, active, cancel-requested,
returned, failed/refused and uncertain. Returned does not mean domain success.
Overflow preserves represented nodes, saturated omission counts and explicit
incompleteness. Root result, cleanup and delivery are independent host facts.

Operator-only `--display auto|plain|dashboard` selects presentation; defaults
never come from a project entrypoint. Auto uses bounded noninteractive inline
output on suitable terminal stderr, without raw input or alternate screen.
Plain, redirected stderr, NO_COLOR and TERM=dumb use nonanimated automatic output.
Explicit dashboard requires terminal stdin/stderr and a suitable TERM; otherwise
it explains a plain fallback once. NO_COLOR permits explicit screen control but
disables SGR styling. `--json` and effective `--receive` retain their exact existing
stdout semantics and disable automatic observation/dashboard; dashboard cannot override.

### Workspace and navigation

After effective arguments and target selection, explicit dashboard waits for
trusted root execution admission before owning one alternate screen on stderr.
Initial review, input, files, output and runtime prerequisite failures remain
ordinary diagnostics. Entry is independent of application views or update ports;
early host stages, call observations and diagnostics stay in the retained model.
Immutable delivery inspection is selected before capture/publication, without
requiring the screen to be open. One fixed shell shows the actual target, host state,
elapsed execution limit, stable Activity/Overview/attributed application tabs,
attention and contextual help. Only the body scrolls. Activity is the fallback
landing; the first eligible root landing hint may select a view before human
navigation. Later updates never steal focus. Titles may change without reordering
tabs or changing their identity. No mouse capture or terminal author callbacks.

Collections have aligned headers and one clipped line per record; selection alone
never expands it. Numbers align right, boolean/null cells remain literal, and
application status-looking text never receives a host success verdict. Omitted
columns/counts are explicit. Enter opens complete escaped cells and supplied
details in a bounded body panel. Reports and long summaries start collapsed.
Details wrap graphemes while preserving authored line breaks; every safe value
remains reachable by scrolling. A count bar requires a positive supplied total.

Summary, reports, facts, progress and collection rows/empty states are selectable
in section/block order, including views with no collections. Updates preserve
surviving row identities; deletion chooses the nearest preceding surviving visible
row, else first, else a selectable empty/no-match state. Local disclosure and text
anchors reset when complete semantic report content (including references) or
summary text changes. An ordinal is not a durable report identity. Unselected
retirement preserves focus; selected retirement returns to Overview. Ended/frozen
views retain ended/incomplete context and last-update information.

Tab/Shift-Tab changes views and closes local panels. Arrows/j/k select body records;
Enter opens/closes detail. Left/Right collapses/expands actual calls in Overview;
hidden descendants/issues are counted without inventing a node. `c` moves to the
next supplied collection in block order, wrapping; from another block it chooses
the next collection after it. Zero collections explains absence; one already
selected collection is unchanged. `/` and `s` operate only on the selected row's
collection or its empty/no-match state, otherwise explain how to select one.
Filter/sort are local to collection identity and describe supplied records only.

Filter editing accepts every printable scalar literally, including shortcut
letters. Typing edits a draft; Enter commits, Escape discards, empty commit clears.
Backspace/Delete removes the last scalar; unsupported controls and Tab do nothing.
No navigation escape sequence is translated into filter letters. `r` explicitly
selects references from the selected record/detail; arrows/j/k chooses a reference
and Enter alone activates it. Missing targets explain absence without a focus jump.
Default Enter never opens an unrelated file. `!` opens the winning full attention
cause from every view; Left/Right chooses other retained causes. `?` opens contextual
help. Detail/preview/attention arrows and brackets/Page keys scroll without moving
the underlying record. Escape dismisses one local help/reference/attention/preview/
detail level before leaving; at most three overlay levels are retained. Home/End
select list ends. q leaves outside filter editing; Ctrl-C and input EOF/Ctrl-D are
always authoritative.

Normal workspace requires at least 40 columns/10 rows. Between 18x4 and that
threshold, a compact surface retains task/state, attributed cause beginning with
clipping, full-cause access, leave and stop controls. Below 18 columns or 4 rows,
release to plain output once with a size explanation and complete retained causes.
Never draw beyond the physical viewport, including zero dimensions. No automatic
re-entry follows fallback. Reduce workspace before cause and disclose clipping.

### Bounded Activity, attention and exit

Activity shows the current host stage and up to 16 current reported activities,
plus collapsed literal notices, host stage history and attributed diagnostics.
Newest reports appear first; informational setup history is one expandable entry.
Wide layouts project selected literal details beside the list without activating
references. Completed actual-call branches collapse unless the operator expanded
them; active and problematic branches remain visible. Host facts occupy the fixed
shell rather than a duplicated synthetic work row. Settled inspection freezes
elapsed execution time and does not claim current work.
Clear/EOF removes current activities without inventing completed history. Actual
publisher/call-path attribution is retained; prose punctuation never establishes
job ancestry. Do not duplicate every view snapshot or repaint into history.
History retains at most 128 Flow notices/512 KiB canonical payload, 64 host
entries/128 KiB escaped text and 32 diagnostic paths/64 KiB escaped projection:
224 entries/704 KiB plus bounded metadata. Diagnostic machine capture remains
separate. Routine history capacity freezes retained state with an omission cue;
it cannot cancel execution. New entries never move a reader's stable selection.
This is bounded session inspection, not a complete or durable transcript.

One stderr owner refreshes at most 5/s with 16 pending writes/256 KiB including
in-flight, one reserved 32 KiB critical write, and at most 32 KiB per encoded
projection including controls. Attention retains at most 128 reports/512 KiB of
their complete escaped exit representation, including attribution/importance;
32 KiB remains reserved for host/incomplete causes. Capacity is checked before
mutation. Sticky priority is host failure/unconfirmed cleanup, observation/output
incompleteness, Flow error, Flow warning; first accepted within priority wins with
additional count. View/source ending cannot erase admitted attention. Additional
unretained causes are disclosed, never claimed present.

Auto/plain commit complete essential notices outside redraw. Explicit dashboard
keeps them inside its workspace, then restores the original screen and commits
complete retained essential causes in awaited batches of at most 32 KiB before
final stdout. Admission is not successful output delivery. Closing fences callbacks,
discards undispatched replaceable frames, preserves complete required writes and
restores prior raw/flowing input. For finite enclosing command limits, a
45-second conservative presentation reserve covers at most 16 queued/in-flight writes,
16 cause batches, two controls and one final stdout write under the installed
one-second write timeout, plus release margin. Actual output loss or external
hard termination can prevent restoration/final output; cleanup ownership remains.
Inherited presentation constraints use an epoch reference with monotonic elapsed
time within each process. Host-clock changes between coordinator startups can
shift that reference; independent execution and command timers remain authoritative.

Live q/standalone Escape/input EOF restores input/screen and continues inline once
without cancelling or re-entering later. Do not replay routine history. Ctrl-C and
live shutdown use existing cancellation and join cleanup. After all execution,
channels, attempted cleanup and delivery settle, an open workspace becomes read-only
with separate literal execution/application/cleanup/delivery facts. It owns no live
Flow, channel or execution owner. Inspection has no built-in idle or absolute
expiry. Any explicit inherited presentation constraint remains the minimum across
enclosing owners and cannot be refreshed by input, repaint, resize, updates or
preview completion. Eligible interactive effective dashboard commands omit only
the default enclosing presentation lifetime; setup, Run execution, cancellation
and cleanup retain their bounds. An expiring explicit presentation constraint
continues live execution through its ordinary owner; no presentation path extends
or clears execution enforcement timers.
q/Escape/keyboard Ctrl-C then closes without changing admitted outcome. External
settled shutdown preserves frozen facts and the existing interrupted process status,
without claiming execution cancellation. Every exit releases input/preview/screen.

Auto/plain exit promptly and emit each retained latest attributed summary once
with ended/incomplete context, then host result/evidence. A session that actually
entered fullscreen omits that summary replay, retaining ordinary final result and
essential causes. Dashboard diagnostic retention does not prove its full text was
printed live; final bounded diagnostic evidence must remain visible. Applications
retain essential outcome evidence independently of every optional observation.
