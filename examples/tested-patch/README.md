# Get a project patch you can inspect

Give this application a small Bun project and a bug. Its repair specialist
proposes changes across selected source files; Jig runs reviewed commands in
separate containment. Independent assertions check captured behavior.
You receive a patch and evidence, while the originals remain unchanged.

## Try it

Use the paired `@jigging/jig@0.1.0-alpha.14` and
`@jigging/flow@0.1.0-alpha.9` releases, after publication, on a
[supported host](https://jig.md/guide/). These sources use their new Run method
names; an older SDK is not interchangeable.
Copy this directory, configure your
[Agent](https://jig.md/spec/agent-run#alpha-host-implementations), and inspect
`issue.json`, `bindings/specialist.ts`, and `flows/project/cases.json`.

```sh
for flow in flows/project flows/repair; do
  (cd "$flow" && bun install --lockfile-only --ignore-scripts)
done
jig review
jig run binding:repair --input @issue.json --attach source=fixtures/log-report --out ../repair-result --timeout 5m
```

Open `../repair-result/files/summary.txt`. A successful repair produces
`review.patch`; unsuccessful proposals remain `proposal-N.patch`.
`result.json` records candidate identities, actual command output and
termination, and independent acceptance results. Review before applying.

Use Bun 1.3.3 to generate the locks above and retain them with your copy.

The fixture is an HTTP log-report CLI with defects in parsing and aggregation.
The root Flow captures files and delivers patches. A JSON-input leaf uses
Agent and Project Command effects; it has no attachments or child Flows.
The two Bindings configure that exact relationship and approved Bun commands.

This deliberately narrow application allows 16 UTF-8 files, 64 KiB of text,
eight editable source paths, and two Agent proposals. It provides no network,
installation, shell service, writable host repository, or automatic merge.
Repository tests can be interfered with by candidate code; independent cases
compare captured CLI behavior outside its execution scope.

The output destination must be new. Ctrl-C requests cancellation; operational
failure exports no partial Flow files. Selected source reaches your configured
provider, and even unsuccessful calls may incur charges.

## Repair two projects together

`batch.json` pairs the log reporter with a timesheet CLI that mishandles
overnight shifts and invalid minutes. The same unchanged specialist works on
both projects, with separate source and acceptance cases:

```sh
jig run binding:repair --input @batch.json --attach source=fixtures --out ../batch-result --timeout 5m
```

Each job gets its own folder under `files/`, with a patch and checks. A failed
worker does not discard its successful sibling. Optional `cancelAfterMs` on a
job stops that worker; Ctrl-C cancels the whole Run. At most two workers run,
each with two Agent proposals. Overlapping edits are reported, never merged.
The patches were tested separately, not as a combined change.

The [public guide](https://jig.md/guide/tested-patch) covers evidence, failures,
and adaptation. This is an authored example, not a promoted Starter or a
claim of general coding reliability.
