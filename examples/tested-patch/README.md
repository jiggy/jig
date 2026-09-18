# Get a project patch you can inspect

Give this application a small Bun project and a bug. It reproduces the failure,
asks an Agent for a bounded change, runs reviewed commands, and independently
checks their output. You receive a patch with evidence; your original source
stays unchanged.

## Try it

Install Jig on a [supported host](https://jig.md/guide/).

The application declares the ordinary ACP Agent package as a workspace dependency.
Select your native client in `bindings/agent.ts`; it shows Pi as an example,
with Codex and Claude supported by the same interface. Follow
[Choose an Agent](https://jig.md/guide/agents) for authentication and configuration.
Then inspect `issue.json`,
`bindings/specialist.ts`, and `flows/project/logs-cases.json`.
From this directory:

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

The output destination must be new. Ctrl-C cancels owned work; accepted
checkpoints can retain completed evidence after cleanup without turning an
interrupted Run into success. Selected source reaches the configured provider.

## Build on the method

For your own project, add `flows/project/<name>-cases.json` with independent CLI
expectations and set `"checks": "<name>"` in the issue. The default is `logs`.
The same name works in batch jobs; adding check sets requires no orchestration
code changes. Select your test files and CLI in `bindings/specialist.ts`, then
review the application. These checks stay outside the source being repaired.

The same repair specialist handles the included timesheet CLI as well as the
log reporter. `batch.json` requests both, preserving separate results:

```sh
jig run binding:repair --input @batch.json --attach source=fixtures --out batch-result --timeout 5m
```

The [walkthrough](https://jig.md/guide/tested-patch) explains adaptation, batch
failure, and checkpoints. [Progress integration](https://jig.md/guide/channels)
shows the single-job monitor, independent recorder, and `--receive progress`.
These observations never establish that a patch passed.

The walkthrough also describes optional [conversation-based correction](https://jig.md/guide/tested-patch#keep-conversation-context-for-a-correction):
settle the first Agent, execute checks, then restore its retained native state
for one revision. It requires explicit retention authority; default one-shot
repair needs none.

Run `bun test examples/tested-patch/test` from the repository root after workspace
setup. These are authored application checks, not a claim of general coding reliability.
