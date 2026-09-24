---
title: Run a small software factory
---

# Run a small software factory

Turn one or two small, authorized project issues into separately checked patch
packets. The [source application](https://github.com/jiggy/jig/tree/main/examples/software-factory)
combines an ordinary Agent with code that reproduces each defect, runs fixed
checks, and compares independent acceptance cases. It never applies or merges a
patch for you.

## Run the supplied batch

In a copy of the example, run `bun install`, inspect `batch.json`, the Agent
Binding, and the two named case files. Configure and authenticate an Agent, then:

```sh
jig review --allow-resolution-network
jig run binding:factory --input @batch.json --attach source=fixtures --out factory-result --timeout 8m
```

The supplied jobs choose `single-pass` for the log repair and
`checked-correction` for the timesheet repair. One allows a single checked
proposal; the other permits one correction after failed checks. Both use the
same acceptance policy. Jig captures source read-only and gives the factory
only a new result directory to write.

## Inspect the result

Open `factory-result/files/summary.txt`, each job directory, and the
host-owned `result.json`. A `review.patch` passed the repository test command
and every independent case after the baseline defect was reproduced.
`proposal-N.patch` retains an unsuccessful attempt without calling it ready.
The result and checkpoints record each job's selection source, chosen method,
and any automatic routing decision. A failed or cancelled peer does not erase
a healthy patch or acquire an invented verdict.

The patches were checked separately. Overlaps are reported and conflicting
replacements block a combined ready outcome; separately passing patches do
not prove the combined edit works. Apply selected patches to a disposable copy,
run combined checks, and make the merge decision yourself.

## Adapt the application

Put each small Bun project under the read-only `source` directory. The included
specialist uses a common `test/project.test.ts` and `src/cli.ts` command shape;
change its Binding only if your project needs a different reviewed command.
For each job, add a named `*-cases.json` beside `flows/factory/FLOW.ts`, then
record its relative directory, case-set name, issue, existing editable
`src/*.ts` or `src/*.js` paths, and method in `batch.json`. Reproduce the defect
and review the changed project before running it. Keep acceptance cases outside
the candidate's editable files.

Set `method` to `single-pass` or `checked-correction` when you know the work
budget. Omit it to use checked correction. Set it to `auto` only when the
application genuinely needs the [reusable Semantic Router](https://github.com/jiggy/jig/tree/main/examples/software-factory/flows/router)
to choose between these reviewed methods. Automatic selection may abstain or
fail; it never silently chooses a fallback. Unknown methods reject the whole
batch before dispatch. Optional `cancelAfterMs` bounds selection and repair for
one job; root cancellation stops all owned work.

This is an authored example, not independent adoption proof. Its earlier
two-issue comparisons tied or were unfavorable on their chosen measures; no
speed or quality advantage over a capable coding Agent is established. A
previous 24-file adapted project exposed a Jig projection defect, now corrected
in source; a fresh installed release and independent consumer completion remain
separate evidence gates. The example remains limited to small Bun projects and
one or two preselected issues with a human merge gate.
