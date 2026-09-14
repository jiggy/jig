# Get a project patch you can inspect

Give this application a small Bun project and a bug. It reproduces the failure,
asks an Agent for a bounded change, runs reviewed commands, and independently
checks their output. You receive a patch with evidence; your original source
stays unchanged.

## Try it

Complete [workspace setup](https://jig.md/guide/dependencies#local-workspace-packages)
and [configure an Agent](https://jig.md/guide/agents) on a
[supported host](https://jig.md/guide/). Inspect `issue.json`,
`bindings/specialist.ts`, and `flows/project/cases.json`, then run here:

```sh
jig review
jig run binding:repair --input @issue.json --attach source=fixtures/log-report --out repair-result --timeout 5m
```

The synthetic fixture is an HTTP log reporter with defects in parsing and
aggregation. Open `repair-result/files/summary.txt`. A passing repair produces
`review.patch`; valid unsuccessful proposals remain `proposal-N.patch`.
`result.json` records candidate identities, command output and termination,
and independent acceptance results. Review the patch before applying it.

## Follow the evidence

1. The root captures the selected files and fixed acceptance cases.
2. The repair specialist reproduces an independent failure before asking an Agent.
3. The Agent proposes complete replacements for permitted source paths.
4. Reviewed Bun commands execute against the candidate in separate containment.
5. Independent assertions check collected CLI behavior. The root validates the
   evidence and constructs a patch from passing replacements.

There are at most two Agent proposals. The acceptance expectations stay fixed.
Repository tests can be interfered with by candidate code; the independent
checks do not import that code or trust its pass flag. A finite case set proves
only the tested behavior.

The method accepts 16 UTF-8 files totaling 64 KiB and eight editable source paths.
Its leaf receives JSON and uses Agent and Project Command capabilities, with no
attachments or child Flows. Source selection and delivery belong to the root.

The output destination must be new. Ctrl-C cancels owned work. This example
publishes final results only; an interrupted Run does not preserve partial patches.
Selected source reaches the configured provider.

## Make it your own

Change the issue, permitted source paths, and independent acceptance cases for
another small Bun project. Review the changed application before running it.
The [walkthrough](https://jig.md/guide/tested-patch) explains the evidence and
adaptation steps. Keep one issue and one specialist so the acceptance boundary
remains easy to follow.

Run `bun test examples/tested-patch/test` from the repository root after workspace
setup. These are authored application checks, not a claim of general coding reliability.
