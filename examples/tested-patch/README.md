# Get a project patch you can inspect

Give this application a small Bun project and a bug. Its repair specialist
proposes changes across selected source files; Jig runs reviewed commands in
separate containment. Independent assertions check captured behavior.
You receive a patch and evidence, while the originals remain unchanged.

## Try it

Install Jig on a [supported host](https://jig.md/guide/). Choose
`tested-patch.tar.gz` from a [matching Jig release](https://github.com/jiggy/jig/releases)
and extract it. Release archives contain prepared applications; the
[repository directory](https://github.com/jiggy/jig/tree/main/examples/tested-patch)
contains their original authoring modules.

Configure your [Agent](https://jig.md/guide/agents), then inspect
`issue.json`, `bindings/specialist.ts`, and `flows/project/cases.json`.
From the extracted application:

```sh
jig review
jig run binding:repair --input @issue.json --attach source=fixtures/log-report --out repair-result --timeout 5m
```

Open `repair-result/files/summary.txt`. A successful repair produces
`review.patch`; unsuccessful proposals remain `proposal-N.patch`.
`result.json` records candidate identities, actual command output and
termination, and independent acceptance results. Review before applying.

The fixture is an HTTP log-report CLI with defects in parsing and aggregation.
The root Flow captures files and delivers patches. A JSON-input leaf uses
Agent and Project Command effects; it has no attachments or child Flows.
For one issue, a separate monitor formats the leaf's selected phase records
as live diagnostics. The two Bindings configure these exact child slots and
approved Bun commands.

## Choose the progress presentation

The repair specialist publishes only bounded phases: reproducing the defect,
requesting a proposal, checking a candidate, and finishing. It works with
ordinary one-shot Agent clients; no Agent message or source text goes to the
monitor. The monitor receives data, not execution or acceptance authority.

`bindings/repair.ts` selects the monitor through its exact `monitor` slot.
Replace that target with another Flow that receives `phases` and sends
`display`, as declared in `flows/monitor/FLOW.md`. The included monitor also
accepts Binding settings `style: 'compact'` and `phases: ['proposal', 'check']`
for shorter, filtered output. The repair method stays unchanged.

Add `--receive progress` to a single-issue run for structured subprocess
records instead of duplicate console diagnostics. A completed single-issue
run's `result.json` contains the repair result and a separate `output.monitoring`
completeness record.
A failed monitor may leave a review-ready patch; its messages never establish
that a patch passed. The root validates and checkpoints repair evidence as
soon as the specialist settles, independently of the monitor's final result.

This deliberately narrow application allows 16 UTF-8 files, 64 KiB of text,
eight editable source paths, and two Agent proposals. It provides no network,
installation, shell service, writable host repository, or automatic merge.
Repository tests can be interfered with by candidate code; independent cases
compare captured CLI behavior outside its execution scope.

The output destination must be new. Ctrl-C requests cancellation. Settled jobs
are checkpointed: interruption preserves only the latest accepted aggregate,
after cleanup, and never becomes a successful Run. Selected source reaches your configured
provider, and even unsuccessful calls may incur charges.

## Repair two projects together

`batch.json` pairs the log reporter with a timesheet CLI that mishandles
overnight shifts and invalid minutes. The same unchanged specialist works on
both projects, with separate source and acceptance cases:

```sh
jig run binding:repair --input @batch.json --attach source=fixtures --out batch-result --timeout 5m
```

Each job gets its own folder under `files/`, with a patch and checks. A failed
worker does not discard its successful sibling. Optional `cancelAfterMs` on a
job stops that worker; Ctrl-C cancels the whole Run. At most two workers run,
each with two Agent proposals. Overlapping edits are reported, never merged.
The patches were tested separately, not as a combined change.
Both child positions belong to repair workers in batch mode; no monitor is
started, and no live phase output is promised for that mode.

The [public guide](https://jig.md/guide/tested-patch) covers evidence, failures,
and adaptation. This is an authored example, not a promoted Starter or a
claim of general coding reliability.
