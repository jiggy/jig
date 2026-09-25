---
title: Revise work in one Agent conversation
---

# Revise work in one Agent conversation

An application can ask an Agent to draft an incident brief, supply a correction,
and obtain a revised answer in the same native conversation. The application
chooses when to continue; the operator bounds how many turns may run.

Use the ordinary [native Agent package](agents.md#local-clients). In its existing
Binding, grant two turns:

```ts
slots: { native: { kind: 'acp', client: 'codex', maxTurns: 2 } }
```

Choose your installed client and model; this is not a product default. Review
the changed grant. One-shot calls remain unchanged. The HTTP Agent package does
not implement continuing conversations and rejects them before dispatch.

## Revise a draft

The caller declares an `agent` slot using the complete
[Agent Run contract bundle](../spec/agent-run.md). After installing the ordinary
`@jigging/agent-method` dependency, import its bundle into your Flow's existing
`contracts/` directory:

```sh
jig import-contract npm:@jigging/agent-method flows/worker/contracts/agent-run
```

Jig finds the nearest installation from the destination directory's parent,
including a member-local or project-root `node_modules`. You can also supply a
descriptor file path directly for a contract obtained without npm.

This validates and copies the descriptor and all referenced channel agreements,
without running the package or approving work. The new directory belongs to
your project. In the worker's `FLOW.meta.json`:

```json
{
  "uses": {
    "agent": {
      "contract": "./contracts/agent-run/FLOW.contract.json",
      "requires": ["conversation", "events"]
    }
  }
}
```

The example needs `conversation` and supplies the optional `events` port through
`onEvent`. Without observation, require only `conversation`. Review checks the
selected package's declarations before the caller starts; the two-turn grant
above independently permits the follow-up. Neither check guarantees an answer.

Use the optional Agent library helper to keep turn correlation and endpoint
cleanup out of application code:

```ts
import { withAgentConversation } from '@jigging/agent-method/conversation'

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
```

Declare `@jigging/agent-method` as an ordinary package dependency. `facts` and
`correction` above are validated application input. `completed.value` is the
callback result, `completed.turns` retains received answers and unsuccessful
turns, and `completed.settlement` is the final invocation result. The helper
closes the conversation and waits for that actual result before returning.
It does not grant authority or determine whether an answer is correct.

To interrupt an active turn, await `conversation.interrupt()`, then await that
turn's promise. An accepted interruption can race ordinary completion. Leaving
a live turn unfinished at callback return fails rather than detaching it.
`AgentConversationError` retains received `turns`, any known `settlement`, and
both primary and cleanup `errors`; ordinary `try/catch` remains sufficient.
Optional `onEvent` filters or displays public updates synchronously without
manual channel setup. Inspect `completed.observation.status`: `incomplete`
preserves observation errors without replacing the actual execution result.
Asynchronous routing can instead use a caller-created `events` writer; do not
combine it with `onEvent`. There is no privileged host echo of filtered text.

## Connect the channels directly

The helper uses only the public contract; other languages and implementations
can compose it directly. Inside a Flow, allocate two named direct channels and pass opposite
ends to the Agent. `conversation: true` starts turn zero. The following excerpt
assumes validated `facts` and `correction` strings from the application's input:

```ts
const commands = await run.channel({
  contract: { slot: 'agent', channel: 'commands' },
})
const replies = await run.channel({
  contract: { slot: 'agent', channel: 'replies' },
})
const work = run.call({
  operationId: 'incident-brief', slot: 'agent',
  input: { instructions: `Draft a short incident brief from these facts: ${facts}`, conversation: true },
  channels: { commands: commands.receive, replies: replies.send },
}).then(
  result => ({ result }),
  error => ({ error }),
)
```

Consume replies while the call runs. After the `result` for turn zero, inspect
its complete `result.outcome` and `result.output`. A completed draft permits an
explicit follow-up:

```ts
await commands.send.send({
  type: 'prompt', turn: 1,
  input: { instructions: `Revise the brief using this correction: ${correction}` },
})
```

An `accepted` control is not an answer. Wait for the correlated `result`,
`cancelled`, or `error` reply for turn one. Then close the settled conversation:

```ts
await commands.send.send({ type: 'close', turn: 1 })
await commands.send.close()
// Consume the correlated accepted-close reply, then await the actual invocation.
const completed = await work
if ('error' in completed) throw completed.error
// { outcome: 'done', output: { turns: 2 } } establishes conversation settlement,
// not that both answers were successful or factually correct.
```

Never wait only for a reply: race each pending read against `work` and the Run's
cancellation signal. A rejected call may have no connected reply producer.
Dispose the endpoints kept locally (`commands.send` and `replies.receive`).
Endpoints offered in the call's `channels` map belong to host-owned terminal
cleanup, even if the call fails before any reply arrives. Do not guess transfer
from received messages or close every endpoint after a failed call.

Using a call-specific abort signal cancels the local wait promptly; awaiting that cancelled promise
does not prove that the Agent has stopped. The SDK retains wire settlement and
the host accounts for owned cleanup before publishing the root result. Normal
conversation close followed by the actual, non-cancelled invocation result is
the path for confirmed settlement before starting subsequent work.
These are ordinary [call and channel lifecycle rules](channels.md), not a new
Agent-specific SDK. An application should retain every answer it actually
received and distinguish incomplete work from a finished revision.

## Interrupt without replacing the conversation

Send `{type: 'interrupt', turn: 1}` while turn one is running. Its accepted
reply means the method accepted that control. Only the later `cancelled` reply
establishes native turn settlement. A completion racing interruption can instead
return an ordinary result. Wait for either terminal turn reply before continuing.

Busy or stale controls are rejected, not queued. The host independently refuses
prompts beyond `maxTurns`. A native interruption that does not settle within
five seconds terminates the client; it does not enable another prompt.

Connect the optional `events` channel to show selected text or plans. Its values
carry the turn number, but progress can be incomplete and never substitutes for
the essential replies. A failed progress display need not stop the conversation.

## Hand work to a fresh conversation

The [incident brief example](https://github.com/jiggy/jig/tree/main/examples/incident-brief)
uses these controls for an application-owned summary handoff. One worker drafts,
while another publishes preliminary analysis through an ordinary FLOW channel
and continues preparing independent review questions. Ordinary commentary uses
a follow-up in the same conversation. A validated replacement of source files
or appended instructions triggers handoff: interrupt if still active, await the
actual turn, request a summary in the same conversation, then settle the
predecessor before starting one successor.

The parent connects the workers directly; no logging service or host scheduler
is involved:

```ts
const { replacement, ...context } = run.input
const revisions = await run.channel({ contract: './contracts/revisions.json' })
const results = await Promise.allSettled([
  run.call({ operationId: 'draft', slot: 'worker',
    input: { role: 'draft', context },
    channels: { revisions: revisions.receive } }),
  run.call({ operationId: 'review', slot: 'worker',
    input: { role: 'independent', context, ...(replacement ? { replacement } : {}) },
    channels: { updates: revisions.send } }),
])
```

Both start with the initial facts and instructions. The optional `replacement`
contains separately supplied files and ordered instructions for the reviewer
to publish; model output cannot create that authority. The successor receives the
latest validated context separately from the model's summary and review notes;
neither generated text can replace instructions or extend authority. The example
also retains each branch's result when the other fails. Its finite update batch
must finish before successor dispatch, so accepted updates cannot be silently
left behind. Drafting requests at most three model turns, review at most two,
all within the original root deadline and host grants.

That is a new conversation with explicit context, not native session restoration.
Its root input is a supplied snapshot, not an interactive instruction inbox;
file text is data, not live workspace access. The worker's optional revision
channel can carry updated files and appended instructions from another parent.
An unwired or cleanly empty channel needs no replacement. Its output is for
human review, not permission to publish; interruption can prevent the final
packet from arriving. This demonstrates lifecycle and context preservation,
not that summary handoff improves model answers.

## Restore after a clean close

A later Run can request the earlier native conversation through an opaque
reference. This is the synchronized source candidate: use matching Agent and
Jig artifacts, and qualify the installed client's save-and-restore path before
relying on it. The initial retention profile is Codex 0.154.0; successful live
follow-up alone does not qualify restoration.

In the Agent Binding, separately grant retention and review the changed
authority:

```ts
slots: { native: { kind: 'acp', client: 'codex', retainSessions: true } }
```

Request retention in the initial Agent input. A one-shot call needs no
conversation channels:

```ts
const first = await run.call({
  operationId: 'draft', slot: 'agent',
  input: {
    instructions: `Draft an incident brief from these facts: ${facts}`,
    session: { retain: true },
  },
})
```

Check the ordinary answer, then inspect the final `first.output.session`.
`{status:'retained',reference}` provides a UUID to keep as application data.
`{status:'unavailable',reason}` means no reusable state was committed; an otherwise
valid answer remains usable. Receipt availability requires actual clean native
exit, validated collection and complete cleanup, so accepting a close command
or receiving the answer does not predict it. Forced closure cannot retain a
session.

Use `reason` to explain what happened without rerunning completed work:

| Reason | Next step |
| --- | --- |
| `not-cleanly-closed` | Use the answer; investigate why native shutdown needed termination. |
| `missing-history` | Use the answer; check that the installed native client supports the qualified history profile. |
| `unsupported-history` | Use the answer; compare the native version and history features with the [collection profile](../spec/finite-acp.md#retained-native-state). |
| `capacity` | Keep the answer; available snapshots are bounded and expire after 24 hours. |

An unavailable receipt is not a reusable reference. Storage or cleanup errors
remain invocation failures, not optional retention loss.

In a later authorized Run, pass the retained reference with the next
instructions:

```ts
const revision = await run.call({
  operationId: 'revise', slot: 'agent',
  input: {
    instructions: `Revise the incident brief using this correction: ${correction}`,
    session: { restore: retainedReference },
  },
})
```

`retainedReference` is the UUID from the previous receipt. The host restores
the native conversation and reapplies current reviewed configuration before
the new prompt. It uses current credentials separately from conversation data.
The previous transcript is not submitted again as application input, and a
failed restoration does not silently start a fresh conversation.

Each reference can be claimed once. Use the new final receipt for any successor;
do not retry the old reference after a failed claim. Restoration requires the
same authorized recipient and ancestry in the same protected project with the
matching native profile. Changed accepted code or configuration may invalidate
access. A reference identifies state and grants no permission by itself.

For correction within one root Run, request `session: {retain: true, lifetime: 'run'}`.
The reference survives the Agent call and can be restored after separate checks.
Restoration inherits this lifetime. References cannot cross root Runs, and root
settlement removes their stored state. Omit `lifetime` only when later Runs need
the conversation. Both modes require the same reviewed retention grant and bounds.

The project retains at most 16 available snapshots of at most 8 MiB each.
References expire after 24 hours; physical pruning happens on the next store
access. The profile retains only bounded validated native conversation records,
never credentials, arbitrary workspaces or tool authority. Expiry is not a
secure-erasure guarantee.

For a continuing conversation, put `session` beside `instructions` in its
initial input. The receipt is in the final invocation output—
`completed.settlement.output.session` when using the helper—and never in an
individual turn reply. Later prompt controls cannot request another retention
policy. The HTTP Agent package rejects session requests before dispatch.

If session handling is required by the complete method, also add `sessions` to
its Agent dependency's `requires` list. This checks implementation claims; it
does not replace the native retention grant or guarantee a successor receipt.
A settings-conditional session path can retain ordinary runtime refusal and
authored recovery without making every one-shot call require sessions.

The [Agent Run contract](../spec/agent-run.md#retaining-a-native-conversation)
defines the request and receipt; [Finite ACP](../spec/finite-acp.md#retained-native-state)
defines native qualification, authorization and cleanup.

## Limits

Essential replies are bounded to 64 KiB each; ask for concise answers. Blocked
reply delivery fails after five seconds rather than silently losing a result.
All turns share the original deadline, byte budgets, and native owner. The
maximum grant is eight turns; no current conversation can extend its own grant.

Each live invocation remains finite. Explicit restoration does not grant durable
replay, automatic handoff or native workspace tools. The [exact contract](../spec/agent-run.md#continuing-conversations)
defines controls, failure cases, and the separate final result. Client startup,
live follow-up, interruption, and restoration need distinct qualification;
support for one does not establish the others.
