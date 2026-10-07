# Run a small software factory

This application takes one or two preselected Bun-project issues and produces
separate tested patch packets for human review. Each supplied issue selects one
checked proposal or up to two proposals with corrective feedback explicitly.
An optional Semantic Router can judge the choice when it is not already known.
The project owns its repair
method and evidence checks. Original projects stay read-only; a person decides
whether to apply, merge, or release any patch.

## Run the supplied issue set

Run `bun install` in this project, select and authenticate an Agent in
`bindings/agent.ts`, then inspect `batch.json`, `bindings/single-pass.ts`, `bindings/checked-correction.ts`, and
the two named case files under `flows/factory/`. The supplied Binding uses
native ACP Codex. For an HTTP Agent route instead, follow the package and
Binding setup in the [Agent method guide](../../docs/jig/guide/agent-method.md).
From this directory:

```sh
jig review --allow-resolution-network
jig run
```

The reviewed `entrypoint` in `jig.ts` selects the factory, `batch.json`, the
`fixtures` source tree, an eight-minute deadline, and `factory-result` for output.
For another batch or a repeat Run, override the input and choose a new output:

```sh
jig run --input @batch.json --out factory-result-2
```

Existing results are never overwritten. Explicitly naming a target bypasses
entrypoint defaults; supply that invocation's arguments in full.

Open `factory-result/files/summary.txt`, then inspect each job directory and
`result.json`. A job receives `review.patch` only after its original reproduced
the issue and its candidate passed both the fixed repository command and every
independent case. An unsuccessful peer remains explicit and does not erase a
healthy packet. Checkpoint evidence retains settled work if the root Run is
interrupted after a worker finishes.
For a failed job, the summary names the observed routing, repair, or evidence
validation stage, quotes the public cause, and points to retained details in
`result.json`. A native ACP cause may name the failed protocol request; that
identifies the phase, not an authentication, model, or service diagnosis. Check
the selected Agent's ordinary setup when investigating it. No verified patch is
claimed for that job and no work is retried automatically. Confirm settlement
before choosing another Run, and review any changed configuration first.
For a settled unsuccessful proposal, inspect its command evidence and proposal
patches; these are not accepted patches to apply. A healthy job's `review.patch`
remains available even when the batch outcome is `blocked`.
The factory first introduces each job by its optional `label` (or its `id`),
requested goal, editable source files, reviewed repair approach and named checks.
During work it identifies the command slot or case being run, then reports the
observed repository-command status and passing or mismatched acceptance cases.
Collected command invocations and a procedural next step explain why it requests
a fix, asks for a correction or returns evidence. Proposal numbers include the
reviewed limit, such as “1 of 2”. Worker reports remain provisional until the
factory independently checks the returned evidence.
The final brief repeats requested goals and, for accepted patches, names changed
files and verified check counts. Failed proposals retain their rejection or check
cause even with updates disabled. Passing these fixed checks does not prove every
sentence of an issue correct. Full evidence remains
in `result.json`; `files/summary.txt` starts with the same plain-language report.
Long goals and paths may shorten in the terminal; each job's complete `issue`,
editable paths and verified acceptance-case IDs remain in `result.json`.
The standard [user-updates contract](../../docs/jig/contracts/user-updates.md)
shows current job activity on terminal stderr.
Use `--receive progress --json` for explicit machine records, or `--updates off`
to turn automatic observation off. The scoped publisher bounds observation work;
rapid phases can replace one another, and slow or lost observation can end early.
A saved-results notice follows durable storage; its count measures saved jobs,
including failed jobs, rather than successful repairs. If live observation ends
early, use the final report and saved evidence to determine the work's outcome.
Progress is activity, not evidence that a patch passed;
the separate `checkpoint` slot retains settled evidence across interruption.

Patches are checked separately. Overlap is reported, conflicting overlap blocks
the batch, and no combined test is implied. Review, combine, test, and merge the
selected patches yourself.

## Adapt a bounded batch

Keep the common paths selected by `bindings/single-pass.ts`, `bindings/checked-correction.ts`, then add each small
project below the source attachment. Add a named `*-cases.json` beside the
factory Flow and list its name, issue, directory, and existing `src/*.ts` or
`src/*.js` edit paths in `batch.json`. The batch accepts one or two jobs.
Use an optional single-line `label` of up to 80 characters to give each job a
readable name while preserving its `id` in paths and evidence.
Review again after Flow, entrypoint, command, case, Agent, or grant changes. New job input
and source files are captured for each Run without another review.

The reviewed configurations permit one or two Agent proposals and share the same
acceptance checks. The supplied batch selects `"method": "p1"` for logs (one
proposal) and `"method": "p2"` for timesheet (one proposal plus a possible
correction). These exact reviewed choices skip the router. Remove a job's
`method` to ask the Semantic Router to choose from its issue and work preferences;
that optional step adds an Agent call and may abstain or choose incorrectly.
`cancelAfterMs`
covers the complete per-job routing-and-repair
interval and may stop one selected job without stopping a healthy peer; root cancellation still stops
all owned work. Keep acceptance policy outside editable source and never relax
it after seeing a candidate. An incomplete or wholly empty source read fails
before any worker is dispatched.

Both repair Bindings select the local `flows/repair` package by project path.
`npm:` is for a Flow selected from a declared project dependency.

## Adapt the method choice

`flows/factory/methods.ts` owns readable candidates and their exact slots. The
router sees only opaque IDs and descriptions, then returns an ID and reason or
abstains. The factory validates a replacement router's complete result too.
Descriptions can guide choices but never grant paths, commands, tests or providers.
An abstention or routing failure produces no patch and does not stop a healthy peer.
Final and checkpoint job evidence retains `routing.input`, validated `routing.result`
and the selected slot; summaries include the routing outcome.

To add a genuinely different eligible method, add candidate data and its slot in
the factory metadata and Binding. Keep deterministic input/result adaptation in
application code and preserve independent evidence inspection. Do not change the
router prompt. For use with unrelated methods, follow the self-contained
[Semantic Router package](flows/router/README.md). This is bounded semantic dispatch,
not open discovery. An explicit method choice is cheaper when the caller already
knows which configuration it wants; semantic judgment can still choose incorrectly.
