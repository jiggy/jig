# Saturday kitchen roster

Cover a community kitchen's four Saturday shifts with six volunteers. You get
`schedule/roster.csv`: a cook and a server for every shift, with readable names
and times. An Agent considers preferences; code accepts only assignments that
satisfy every hard constraint.

The synthetic fixture covers 09:00–13:00. A valid result can look like this:

| Time | Cook | Serve |
| --- | --- | --- |
| 09:00–10:00 | Alex | Bea |
| 10:00–11:00 | Alex | Bea |
| 11:00–12:00 | Casey | Drew |
| 12:00–13:00 | Casey | Drew |

Other assignments can also be valid. This example checks feasibility, without
claiming to find the best roster or measuring scheduling quality.

## Run it

Complete the [ordinary workspace setup](../../docs/jig/guide/dependencies.md#local-workspace-packages)
and use a [supported host](../../docs/jig/guide/index.md#supported-host).
In this directory, review the project and run its default entrypoint:

```sh
jig review --allow-resolution-network
jig run
```

The editable Agent Binding is `bindings/model.ts`. It initially names Codex;
choose an installed, authenticated ACP client there, or use
`jig review --agent claude --allow-resolution-network` for a review-only choice.
No model is pinned. Review shows the selected authority and requires approval;
source edits take effect only after renewed review.

The final result identifies the roster and its eight checked rows. Jig reports
the temporary packet directory on stderr. Open
`files/schedule/roster.csv` there, or choose a new retained directory with
`jig run --out DIRECTORY`. Existing destinations are never overwritten, and the
operating system may eventually clear temporary packets.

Add `--display web` or `--display tui` to inspect the optional Saturday kitchen
page. It shows four shifts, each cook and server, the volunteer team's availability
and workload, the current scheduling stage, and any blocking reason. Assignments
appear only after the whole proposal passes checking. The CSV reference appears
after export; delivery remains a separate host fact. Execution, Activity, files
and individual child views are available under Inspector. CSV gets a table/raw preview in the web
viewer and coloured columns in the terminal. Reopen a retained packet with
`jig inspect --result DIRECTORY --display web`.

## Make one useful change

Edit a volunteer's `available` interval or `maxMinutes` in
`fixtures/feasible/scenario.json`, then run again. Times are integer minutes after
midnight: 540 is 09:00 and 780 is 13:00. A shift's end is exclusive, so adjacent
shifts can share a volunteer without overlapping.

Preferences are soft, such as “one late shift, preferably serving.” They cannot
extend availability, confer qualifications or increase a workload limit. The
Agent receives this scenario as supplied data; it has no file, calendar or
messaging access.

Try the impossible fixture:

```sh
jig run --attach source=fixtures/impossible
```

Its last shift runs after every volunteer's availability. The reading Flow
reports the uncovered cooking role before calling an Agent. The result is
`blocked`, with a reason and no roster CSV. The early check detects a role with
no eligible volunteer; it is not a general feasibility solver. More subtle
conflicts can require Agent abstention or cause the proposal checker to reject.

## Follow the five Flows

```text
roster
  ├─ read-roster       → validated scenario or an uncovered-role reason
  ├─ propose-roster    → one configured Agent → provisional assignments
  ├─ check-roster      → checked rows or a review reason
  └─ export-roster     → schedule/roster.csv
```

Each stage has its own package, invocation contract and optional reporting view.
The coordinator passes data across ordinary `run.call()` boundaries and handles
stopped outcomes before advancing. The root and reader receive only read-only
`source`. The reviewed Binding authorizes `attachments.files.create: true` for
the exporter call. The exporter receives its own writable `files` attachment.

The root requires its returned immutable grant and forwards it as
`artifactResults.schedule`. Jig delivers that artifact at `files/schedule/roster.csv`.
The middle stages receive JSON alone. Each Flow remains independently callable.

The checker validates the complete proposal: known IDs, both roles exactly once
per shift, qualifications, full availability, no overlapping assignments and
aggregate minutes. It derives names and times from the supplied scenario. The
exporter owns CSV formatting and exclusive file creation; scheduling policy
stays with the checker. It does not write anything until formatting passes.

`propose-roster/proposal.schema.json` constrains the Agent's answer shape. The
Flow contracts bound invocation data; `check-roster/policy.ts` enforces scheduling
rules. The private reply schema is deliberately separate from those rules.

`flows/roster/view.ts` projects typed application state through public reporting types.
Its fixed target identifies the captured scenario independently of a Run.
The completed page offers the captured CSV through a semantic content block.
All views use `withReporting` from `@jigging/reporting` and the copied
`jig:reporting` agreement. Views are observations. The final application and
host result establish acceptance and delivery.

## Checks and limits

```sh
bun test examples/kitchen-roster/test
```

Run the checks from the repository root after workspace setup. Tests exercise
the public Agent preparation validator, real reader and exporter, scheduling
policy, pure response interpretation and root view projections.
They cover absence, qualifications, coverage, workload, overlaps, uncovered
input, bounded stopped reasons, safe CSV fields and exclusive creation.

The installed kitchen regression uses a deterministic public proposal Flow
through a reviewed Binding. It checks CSV delivery and unchanged source, then
uncovered input without an export. It requires a qualified native runner.
It does not qualify model judgment.

The old injected coordinator and channel tests did not prove native execution.
Cancellation after proposal, clipped coordinator stops, export failure after
writes and observations from all five publishers remain unqualified.

This is a small cookbook task: six volunteers, four shifts, cook/serve roles,
one Agent proposal and one CSV. It performs no retries, calendar changes,
messages, negotiation or optimization. An invalid proposal returns `blocked` with the violated rule before export;
an explicit review or limit outcome remains visible. A failed root publishes
no partial final roster files. Use the CSV for human inspection before putting
an actual schedule into operation.
