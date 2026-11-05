# Recover an interrupted draft

This application completes two drafts after their original worker becomes unsuccessful.
One worker saves text and binary material before throwing. The other returns a draft that fails independent acceptance.
A nested recovery Flow preserves each original result and uses the saved work to produce a checked replacement.
The deliberate failures are synthetic examples, not claims about real user workloads.

## Run

Copy this directory into an ordinary project. Install dependencies and configure an [Agent](https://jig.md/build/agents).
The supplied Agent Binding selects Codex through the ordinary ACP package. You can replace that Binding.

```sh
bun install
bunx --no-install jig review
bunx --no-install jig run --out ./recovered-drafts
```

Inspect source and proposed authority before approving review. The workers receive only local file powers.
The selector sends its bounded task and candidate description to the configured Agent.
The operator supplies that Agent's permissions, model, and resource limits.
This source example requires packages from the corresponding release candidate or a published release containing them.

Expect independently checked reports under `files/first/` and `files/second/` in the result packet.
Each report includes its original three-byte binary file and an empty file.
The result retains the original worker outcome, checkpoint evidence, selection, replacement result, and acceptance verdict.
If selection abstains or reaches a limit, the affected draft retains an honest stopped outcome.

## How recovery works

| Flow | Responsibility |
| --- | --- |
| `outer` | Call recovery as a child and explicitly forward accepted final artifacts. |
| `draft` | Retain partial work, then fail or return an unacceptable report. |
| `material` | Produce the original text, binary file, and empty file. |
| `recovery` | Permit at most two worker attempts and preserve the full recovery trace. |
| `repair` | Validate the saved draft format and produce replacement input. |
| Published semantic selector | Propose an eligible fallback or abstain. |
| `finish` | Complete the draft using the immutable saved artifact. |
| `evaluate` | Check the actual report bytes and retained binary material. |

The coordinator awaits the original child call before retrieving its checkpoint.
Retrieval names `draft`, the original direct child operation ID. Each recovery invocation can reuse that local ID independently.

The adapter validates the saved JSON and associated files before selection. The fallback receives the immutable checkpoint artifact.
The application invokes only its fixed `finish` slot, then checks the actual replacement files.
A valid candidate ID or available checkpoint does not establish acceptable work.

Absent checkpoints and unavailable checkpoints remain distinct stopped reasons.
A one-attempt limit stops before selection. Failed validation, Agent refusal, abstention, and replacement rejection never trigger another attempt.
Cancellation, deadlines, and uncertain effects propagate without replay. This example grants no external worker effects to repeat.
Applications with external effects must decide whether another execution is permitted after uncertain work.

Change the candidate descriptions or the Agent Binding to explore selection.
Change `evaluate/FLOW.ts` to adapt acceptance criteria. Keep its checks independent of the selector and worker claims.
The installed host regression uses a deterministic ordinary Agent peer to test mechanics. Live semantic quality requires separate measurement.

## Measure live selection separately

After reviewing this project with your chosen Agent, run the optional fixed evaluation:

```sh
JIG_EVAL_CONFIGURATION='Describe your Agent, model, and configured limits here' node evaluate-selector.mjs
```

This command permits eighteen invocations across six tasks, with original, reordered, and renamed candidate IDs.
Each invocation has a sixty-second work limit. The operator must configure any monetary or token allowance separately.
The cases cover task fit, mandatory language, suitable defaults, abstention, and misleading descriptions.
The runner records configuration, sample size, complete decisions, operational failures, and unsuccessful judgments without retries.
These eighteen trials cannot establish broad reliability or prompt-injection resistance.
