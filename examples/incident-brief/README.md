# Prepare an incident brief as new context arrives

Get a draft incorporating preliminary review, plus independent questions for a
person to investigate. Two workers start with all supplied facts. The reviewer
sends its initial analysis through a FLOW channel, then keeps preparing questions.
Commentary refines the draft in its existing conversation. A separately supplied
replacement of files or instructions triggers one handoff to a fresh conversation.

Download this directory as an ordinary project. With Jig installed, configure
the included Agent Binding and your native client as described in the
[conversation guide](https://jig.md/guide/conversations). From this directory:

```sh
jig review --allow-resolution-network
jig run
```

Review prepares the declared package dependencies; no repository-private tools
or separate Flow installations are needed. Resolution can make dependency-selected
network requests before approval. An authored lock avoids fresh resolution;
see [dependencies](https://jig.md/guide/dependencies).
In a Jig source checkout, the ordinary workspace setup supplies matching local
packages instead of requiring publication.

The included worker already carries its complete Agent contract; no contract
copy is needed to run this project. To reuse that boundary in your own existing
Flow, install its declared `@jigging/agent-acp` dependency with `bun install` and
import from the package, without specifying an installation directory:

```sh
mkdir -p flows/worker/contracts
jig import-contract npm:@jigging/agent-acp flows/worker/contracts/agent-run
```

This copies the complete offline bundle for the caller's
`uses.agent.contract: './contracts/agent-run/FLOW.contract.json'`. Require
`conversation` for the handoff method; the native Binding separately grants two
turns per invocation. The importer resolves project-root or worker-local installs,
executes no package code, and refuses an existing destination. Installed dependency
updates do not silently replace this project-owned contract. The compact importer
requires the matching Jig source candidate until its alpha is published.

The synthetic fixture corrects 600 affected requests to 48, then supplies a
reconciled 47-minute duration in `replacement`, keeping the cause uncertain.
The reviewed entrypoint in `jig.ts` selects the brief, input and three-minute
deadline. Override an argument when needed, for example `jig run --input @my-incident.json`.
Successful output contains a proposed brief, independent questions, actual
conversation settlement and, when replaced, the exact handoff snapshot. Progress
diagnostics identify each worker's requested turn, received answer, handoff
preparation and actual predecessor settlement. A requested turn is not evidence
of remote dispatch or completion; a deadline can still prevent the final packet.
Inspect each branch's `outcome`: `blocked` retains available unsuccessful work
and the other worker's result. Model text is not independently verified evidence
or permission to publish.
An unsuccessful worker includes `failureDetails` with bounded public operation
explanations; a root-level worker-call failure includes `message`. These distinguish
lost connections, execution failures and incomplete application work without
requiring private traces. A received answer still does not establish clean final
settlement, and a deadline can prevent the packet from arriving at all.

## What triggers the handoff?

The root [connects the two workers](flows/project/brief.ts) with one direct
channel. The reviewer publishes a numbered context revision containing supplied
files and instructions plus its separately labelled analysis. Model commentary
alone does not trigger replacement: the drafter waits for its initial turn and
uses one ordinary follow-up with the notes labelled as unverified model text.

If the revision changes files or appends instructions, the drafting worker
requests interruption if still active, waits for the actual turn to settle,
then asks that same conversation for a concise summary. The reviewer carries
the root's optional `replacement`; it cannot generate authoritative replacements.

Only after the finite revision batch ends and the old invocation settles does
one successor start. It receives the latest validated files and instructions,
unchanged earlier context, the summary, review notes and remaining bounds.
Generated summaries and notes cannot replace instructions or grant authority.

Drafting requests at most three model turns; independent analysis and questions
request at most two. All calls keep the root deadline and operator grants.
Failure to deliver preliminary analysis need not stop independent questions;
a broken revision feed prevents drafting replacement.

## Adapt the context

Edit `replacement.files` or append to `replacement.laterInstructions` in
`input.json` to exercise a source-context change. Removing `replacement` exercises
ordinary commentary and continuation instead. Instruction revisions must increase. Lowering
`turnBudget` from three to two prevents drafting from starting but still allows
the reviewer to finish its two-turn method.

The worker also accepts revisions from another application through its optional
`revisions` receiver. The matching `updates` sender is used by its independent
mode. Their named agreement is
`https://github.com/jiggy/jig/tree/main/examples/incident-brief`, version `0.1.0`;
both packages include the same [offline descriptor](flows/worker/contracts/revisions.json).
The identifier names this agreement; it is not a server to contact.

A revision replaces the current file snapshot, appends instructions and carries
review notes (an empty string is allowed):

```json
{
  "revision": 2,
  "files": [{"path": "facts.txt", "text": "48 requests affected; cause unknown."}],
  "laterInstructions": [
    {"revision": 1, "text": "Use the corrected count of 48."},
    {"revision": 2, "text": "Keep the brief internal pending verification."}
  ],
  "reviewNotes": "An analyst suggests checking the missing monitoring interval."
}
```

Keep every previously accepted instruction unchanged at the start of the new
list. At most eight distinct increasing revisions and sixteen deliveries are
accepted; each message is bounded to 64 KiB. Exact duplicates are inert.
Conflicting duplicates, unknown stale revisions and lost instructions fail.
Close the sender to finish the batch: all accepted revisions through clean EOF
enter the single successor. EOF is not evidence that its producer succeeded.

An unwired or cleanly empty feed needs only the original draft turn, without a
summary or successor. An independent worker without its sender uses one ordinary
call for review questions. See the [method](flows/worker/work.ts) and
[deterministic tests](test/handoff.test.ts) for races, disposal and cancellation.

This is application-owned automatic summary handoff, not native session
restoration or a general scheduler. The root accepts a supplied snapshot, not
interactive CLI updates; file text is data, not live workspace access. A summary
can lose information or mislead the successor. Model obedience and the benefit
of this extra coordination need separate evaluation. Root interruption can
prevent the final packet from arriving; this example adds no durable store.
