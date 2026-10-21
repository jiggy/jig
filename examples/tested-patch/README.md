# Get a project patch you can inspect

Give this application a small Bun project and a bug. It reproduces the failure,
asks an Agent for a bounded change, runs reviewed commands, and independently
checks their output. You receive a patch with evidence; your original source
stays unchanged.

## Try it

Install Jig on a [supported host](https://jig.md/guide/).

The application declares pinned ordinary FLOW and ACP Agent packages; review
prepares their execution dependencies. Download this directory and follow
[Choose an Agent](https://jig.md/guide/agents) for authentication and configuration.
The inline native policy in `bindings/agent.ts` selects Pi as an example.
Edit that Binding and review again for a lasting client preference. Inspect `issue.json`,
`bindings/specialist.ts`, and `flows/read-project/logs-cases.json`.
From this directory:

```sh
jig review --allow-resolution-network
jig run
```

To propose a different installed client for this review, use
`jig review --agent CLIENT --allow-resolution-network`, where `CLIENT` is
`codex`, `claude`, or `pi`. Review shows the effective client before approval;
it leaves the Binding unchanged. Repeat `--agent CLIENT` on later reviews, or
edit the Binding for a lasting choice. Without the argument, later review
proposes the source client again. Normal `jig run` uses the approved client and
code; failed review keeps the previous approval.

The reviewed entrypoint supplies the issue, read-only fixture and five-minute deadline.
Jig chooses a fresh packet directory in operating-system temporary storage for
its forwarded deliverables and reports it on stderr. Repeating `jig run` leaves
earlier packets intact, but the operating system may clear temporary storage.
Use `jig run --out ./repair-result` to choose a retained location that does not
already exist; Jig never overwrites a packet. Explicit targets bypass the
entrypoint defaults.

Add `--receive progress` to see the repair specialist's phase and attempt
while the Run is active. Redirected stdout then uses NDJSON records; only the
terminal record establishes the outcome. Phase records do not include Agent
text or guarantee that a candidate passed its checks.

The `updates` channel carries the optional semantic dashboards; `progress` retains the
specialist’s separate closed phase records for explicit channel consumers. Neither
establishes acceptance.

The synthetic fixture is an HTTP log reporter with defects in parsing and
aggregation. Open `files/deliverables/review/summary.txt` inside the reported destination. A passing repair produces
`review.patch`; valid unsuccessful proposals remain `proposal-N.patch`.
`result.json` records candidate identities, command output and termination,
and independent acceptance results. Review the patch before applying it.

## Follow the work

**Patch review** keeps the requested issue, permitted edits, current stage,
original → candidate check comparison, and complete review files together.
The coordinator captures source, calls the repair specialist, delegates independent
evidence acceptance, then exports patches. It shows checked verdicts only after
`check-repair` validates command identities and recomputes every result.
Worker views remain provisional in Inspector. Only accepted evidence earns
`review/review.patch`; unsuccessful proposals remain inspectable.

Add `--display tui` for a terminal workspace or `--display web` for the same
views in a browser. Open the private link printed after execution starts. The completed inspector
stays open until you explicitly close it; leaving a live display does not cancel work.
Blocking causes remain reachable from every view. Plain output and `--json` remain
available.

## Follow the composition

| Flow | Responsibility |
| --- | --- |
| `project` | Coordinate the task and publish the application page. |
| `read-project` | Capture bounded source and reviewed acceptance cases. |
| `repair` | Reproduce the defect, request bounded proposals and execute fixed checks. |
| `check-repair` | Validate source/candidate/command identities and recompute acceptance. |
| `export-patch` | Format supplied review data and write patches without applying them. |

Among the child methods, only `read-project` receives source access.
Only `export-patch` receives a fresh writable attachment.
The coordinator forwards its immutable artifact as `deliverables`, retaining the exporter's `review/` subdirectory. The checker and
repair specialist receive JSON data. The exporter formats supplied review data;
when called independently its files are caller claims, not proof of acceptance.
The application's checker establishes acceptance before export.

## Follow the evidence

1. `read-project` captures the selected files and fixed acceptance cases.
2. The repair specialist reproduces an independent failure before asking an Agent.
3. The Agent proposes complete replacements for permitted source paths.
4. Reviewed Bun commands execute against the candidate in separate containment.
5. `check-repair` validates complete evidence and recomputes verdicts.
6. `export-patch` constructs patches from that accepted review data.

There are at most two Agent proposals. The acceptance expectations stay fixed.
Repository tests can be interfered with by candidate code; the independent
checks do not import that code or trust its pass flag. A finite case set proves
only the tested behavior.

The method accepts 16 UTF-8 files totaling 64 KiB and eight editable source paths.
Its leaf receives JSON and uses Agent and Project Command capabilities, with no
attachments or child Flows. Source selection and delivery belong to the root.

An explicit `--out` destination must be new. Ctrl-C cancels owned work. This example
publishes patches only at completion; an interrupted Run does not preserve
partial patches. Optional progress is transient.
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
