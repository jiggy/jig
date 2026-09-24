# Run a small software factory

This application takes one or two preselected Bun-project issues and produces
separate tested patch packets for human review. Each job chooses one checked
proposal or up to two proposals with corrective feedback; an optional reusable
Semantic Router can make that choice and can abstain. The project owns its repair
method and evidence checks. Original projects stay read-only; a person decides
whether to apply, merge, or release any patch.

## Run the supplied issue set

Run `bun install` in this project, select and authenticate an Agent in
`bindings/agent.ts`, then inspect `batch.json`, `bindings/single-pass.ts`, `bindings/checked-correction.ts`, and
the two named case files under `flows/factory/`. From this directory:

```sh
jig review --allow-resolution-network
jig run binding:factory --input @batch.json --attach source=fixtures --out factory-result --timeout 8m
```

Open `factory-result/files/summary.txt`, then inspect each job directory and
`result.json`. A job receives `review.patch` only after its original reproduced
the issue and its candidate passed both the fixed repository command and every
independent case. An unsuccessful peer remains explicit and does not erase a
healthy packet. Checkpoint evidence retains settled work if the root Run is
interrupted after a worker finishes.

Patches are checked separately. Overlap is reported, conflicting overlap blocks
the batch, and no combined test is implied. Review, combine, test, and merge the
selected patches yourself.

## Adapt a bounded batch

Keep the common paths selected by `bindings/single-pass.ts`, `bindings/checked-correction.ts`, then add each small
project below the source attachment. Add a named `*-cases.json` beside the
factory Flow and list its name, issue, directory, existing `src/*.ts` or
`src/*.js` edit paths, and method in `batch.json`. The batch accepts one or two jobs. Review
again after any issue, command, case, Agent, or grant changes.

The reviewed configurations permit one or two Agent proposals and share the same
acceptance checks. `cancelAfterMs` covers the complete per-job selection-and-repair
interval and may stop one selected job without stopping a healthy peer; root cancellation still stops
all owned work. Keep acceptance policy outside editable source and never relax
it after seeing a candidate. An incomplete or wholly empty source read fails
before any worker is dispatched.

Both repair Bindings select the local `flows/repair` package by project path.
`npm:` is for a Flow selected from a declared project dependency.

## Adapt the method choice

Set `method` to `single-pass` or `checked-correction` to use a reviewed slot
without a routing call. Omission defaults to checked correction. Set `method`
to `auto` when task language should choose between them; an unknown choice
rejects the whole batch before dispatch.

`flows/factory/methods.ts` owns readable candidates and their exact slots. In
automatic mode the router sees only opaque IDs and descriptions, then returns
an ID and reason or abstains. The factory validates a replacement router's
complete result too.
Descriptions can guide choices but never grant paths, commands, tests or providers.
An abstention or routing failure produces no patch and does not stop a healthy peer.
Final and checkpoint job evidence retains the selection source and chosen
method. Automatic choices also retain routing input and validated result;
summaries identify the selected method or routing outcome.

To add a genuinely different eligible method, add candidate data and its slot in
the factory metadata and Binding. Keep deterministic input/result adaptation in
application code and preserve independent evidence inspection. Do not change the
router prompt. For use with unrelated methods, follow the self-contained
[Semantic Router package](flows/router/README.md). This is bounded semantic dispatch,
not open discovery. Semantic judgment can still choose incorrectly.
