# Run a small software factory

This application takes one or two preselected Bun-project issues and produces
separate tested patch packets for human review. It composes the repair and
independent evidence methods from `tested-patch`; it does not edit the originals,
merge patches, operate Git or CI, or decide that a change should ship.

## Run the supplied issue set

Complete the repository workspace setup, select and authenticate an Agent in
`bindings/agent.ts`, then inspect `batch.json`, `bindings/specialist.ts`, and
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

Keep the common paths selected by `bindings/specialist.ts`, then add each small
project below the source attachment. Add a named `*-cases.json` beside the
factory Flow and list its name, issue, directory, and existing `src/*.ts` or
`src/*.js` edit paths in `batch.json`. The batch accepts one or two jobs. Review
again after any issue, command, case, Agent, or grant changes.

Each repair permits at most two Agent proposals. `cancelAfterMs` may stop one
selected worker without stopping a healthy peer; root cancellation still stops
all owned work. Keep acceptance policy outside editable source and never relax
it after seeing a candidate. An incomplete or wholly empty source read fails
before any worker is dispatched.
