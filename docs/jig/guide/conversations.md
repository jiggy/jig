---
title: Revise work in one Agent conversation
---

# Revise work in one Agent conversation

An application can ask an Agent to draft an incident brief, supply a correction,
and obtain a revised answer in the same native conversation. The application
chooses when to continue. The operator bounds how many turns may run.

## Before you start

You need Jig on a [supported host](index.md#supported-host), Bun, and an
authenticated supported native client. Follow
[native Agent setup](agents.md#local-clients) to create the project. The HTTP
Agent package does not implement continuing conversations.

In the native Agent Binding, allow two turns with an inline policy:

```ts
slots: { native: { kind: 'acp', client: 'codex', maxTurns: 2 } },
```

Choose your installed client and model. This is not a product default. Review
the changed grant. One-shot calls remain unchanged.

## 1. Create the caller

Start with a project configured through
[native client setup](agents.md#local-clients). Create the caller from that
project's root.

The published Jig alpha supplies `new --use`. It copies the selected Agent
contract and writes an ordinary editable slot declaration. You supply the
caller's code and the operator chooses its powers.

```sh
bun install
jig new worker --use agent=npm:@jigging/agent-acp
bun add --cwd flows/worker @jigging/agent-method@alpha
```

The Bun command installs an authoring dependency and records it in the worker's
manifest. The project installation supplies the already-declared ACP package
whose Agent Run contract is selected by `--use`. It grants no additional powers.
Jig separately prepares reviewed execution dependencies.

In `bindings/agent.ts`, set the native slot to
`{ kind: 'acp', client: 'codex', maxTurns: 2 }`. Add `requires` as shown below
to the generated `agent` slot in `flows/worker/FLOW.meta.json`. Replace
`flows/worker/FLOW.ts` with the complete caller below.

## 2. Declare and implement the caller

The caller declares an `agent` slot using the complete
[Agent Run contract bundle](../spec/agent-run.md), imported in the step above.

`new --use` finds the nearest project or ancestor installation. You can also
supply a descriptor path directly. For an existing Flow, use
[`jig import-contract`](../spec/cli-experience.md#required-experience) and
declare the corresponding slot in its metadata.

This validates and copies the descriptor and all referenced channel agreements,
without running the package or approving work. The new directory belongs to your
project. In the worker's `FLOW.meta.json`:

```json
{
  "uses": {
    "agent": {
      "contract": "./contracts/agent/FLOW.contract.json",
      "requires": ["conversation", "events"]
    }
  }
}
```

The example needs `conversation` and supplies the optional `events` port through
`onEvent`. Without observation, require only `conversation`. Review checks the
selected package's declarations before the caller starts. The two-turn grant
above independently permits the follow-up. Neither check guarantees an answer.

Use the optional Agent library helper to keep turn correlation and endpoint
cleanup out of application code:

```ts
import { withAgentConversation } from '@jigging/agent-method/conversation'
import { handle } from '@jigging/flow'

await handle(async run => {
  if (run.input === null || typeof run.input !== 'object' || Array.isArray(run.input)
      || !('facts' in run.input) || !('correction' in run.input))
    throw new TypeError('Supply facts and correction strings.')
  const { facts, correction } = run.input
  if (typeof facts !== 'string' || typeof correction !== 'string'
      || facts.length > 4096 || correction.length > 4096)
    throw new TypeError('Supply facts and correction strings of at most 4096 characters.')

  const completed = await withAgentConversation(run, {
    operationId: 'incident-brief', slot: 'agent',
    input: { instructions: `Draft an incident brief from these facts: ${facts}` },
    onEvent(event) {
      if (event.sessionUpdate === 'agent_message_chunk') console.log(event.content.text)
    },
  }, async conversation => {
    const draft = await conversation.initial
    if (draft.type !== 'result' || draft.result.outcome !== 'done') return draft
    return await conversation.prompt({
      instructions: `Revise using this correction: ${correction}`,
    })
  })
  return {
    outcome: 'done',
    output: {
      turn: completed.value,
      settlement: completed.settlement,
      observation: completed.observation?.status ?? 'complete',
    },
  }
})
```

## 3. Review and run

```sh
jig review --allow-resolution-network
jig run flow:flows/worker --input '{"facts":"Recovery at 09:48; cause unknown.","correction":"Reconciled recovery time: 09:47. Keep the cause uncertain."}'
```

Review shows the code, dependencies and two-turn authority before approval.
Resolution permission can contact dependency-selected destinations before that
approval. See [dependency preparation](dependencies.md). For later edits, review
again. Inspect the returned turn's `type` and `result.outcome`: a clean
conversation close alone does not establish a successful revision.

## 4. Check the result

The caller's `done` means it returned a settled conversation packet. Inspect
`output.turn` to distinguish an answer from an unsuccessful or cancelled turn.
Operational errors still fail the Run. `completed.value` is the callback result,
`completed.turns` retains received answers and unsuccessful turns, and
`completed.settlement` is the final invocation result. The helper closes the
conversation and waits for that actual result before returning. It does not
grant authority or determine whether an answer is correct.

After two successful turns, expect `output.turn.type: 'result'`,
`output.turn.turn: 1`, and `output.turn.result.outcome: 'done'`. The answer is
in `output.turn.result.output.text`. Its wording depends on the selected Agent.
`output.settlement` separately reports
`{ outcome: 'done', output: { turns: 2 } }`. Observation is `complete` only when
the public update stream closed cleanly.

Try changing the correction while keeping the cause uncertain. Review the source
again if you change the caller. If the initial turn is `blocked` or `limit`,
this caller returns that turn without requesting a revision. A clean settlement
does not turn that outcome into an answer.

## If the tutorial does not complete

| Observation | Next action |
| --- | --- |
| Review stops at a selected client prerequisite | Follow [client-check recovery](agents.md#repair-a-client-check). No new approval exists. |
| The initial turn is `blocked` or `limit` | Read that turn's output. This caller does not request a revision. |
| A turn returns `cancelled` or `error` | Preserve the turn and settlement evidence. Follow [conversation control](conversation-control.md#handle-errors-and-observation-loss). |
| Execution, delivery, or cleanup is uncertain | Use [Results and recovery](results.md). Do not automatically replay work. |
| The revised text is incorrect | Check the supplied facts and correction. Application code owns factual validation. |

## Continue with a different task

| Task | Guide |
| --- | --- |
| Interrupt a turn or connect channels without the helper | [Control a conversation](conversation-control.md) |
| Move validated context to a fresh conversation | [Hand work to a fresh conversation](conversation-handoff.md) |
| Retain and restore native conversation state | [Retain and restore a conversation](conversation-restoration.md) |

## Limits

Essential replies are bounded to 64 KiB each. Ask for concise answers. Blocked
reply delivery fails after five seconds rather than silently losing a result.
All turns share the original deadline, byte budgets, and native owner. The
maximum grant is eight turns. No current conversation can extend its own grant.

Each live invocation remains finite.
[Native restoration](conversation-restoration.md) does not grant durable replay,
automatic handoff or native workspace tools. The
[exact contract](../spec/agent-run.md#continuing-conversations) defines
controls, failure cases, and the separate final result. Client startup, live
follow-up, interruption, and restoration need distinct qualification. Support
for one does not establish the others.
