# Get a project patch you can inspect

Give this application a small Bun project and a bug. It reproduces the failure,
asks an Agent for a bounded change, runs reviewed commands, and independently
checks their output. You receive a patch with evidence; your original source
stays unchanged.

## Try it

Install Jig on a [supported host](https://jig.md/guide/).

The application declares pinned ordinary FLOW and ACP Agent packages. Download
this directory, install its dependencies with lifecycle scripts disabled, and
keep the resulting lock so review uses the same resolved packages:

```sh
bun install --ignore-scripts
```

Select your native client in `bindings/agent.ts`; it shows Pi as an example,
with Codex and Claude supported by the same interface. Follow
[Choose an Agent](https://jig.md/guide/agents) for authentication and configuration.
Then inspect `issue.json`,
`bindings/specialist.ts`, and `flows/project/logs-cases.json`.
From this directory:

```sh
jig review --allow-resolution-network
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

For your own project, add `flows/project/<name>-cases.json` with independent CLI
expectations and set `"checks": "<name>"` in the issue. The default is `logs`.
Select your test files and CLI in `bindings/specialist.ts`, then review the
application. The [walkthrough](https://jig.md/guide/tested-patch) explains the
evidence and adaptation steps. Keep one issue and one specialist so the
acceptance boundary remains easy to follow.

The walkthrough also describes optional [conversation-based correction](https://jig.md/guide/tested-patch#keep-conversation-context-for-a-correction):
settle the first Agent, execute checks, then restore its retained native state
for one revision. It requires explicit retention authority; default one-shot
repair needs none.

Run `bun test examples/tested-patch/test` from the repository root after workspace
setup. These are authored application checks, not a claim of general coding reliability.
