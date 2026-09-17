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
[Agent Run contract bundle](../spec/agent-run.md). Keep its relative
`contracts/` directory, including `agent-commands.json`, `agent-replies.json`,
and `acp-public-updates.json`. For example, with the bundle under
`contracts/agent-run/`, its `flow.meta.json` contains:

```json
{
  "uses": {
    "agent": { "contract": "./contracts/agent-run/contract.json" }
  }
}
```

Use the optional Agent library helper to keep turn correlation and endpoint
cleanup out of application code:

```ts
import { withAgentConversation } from '@jigging/agent-method/conversation'

const completed = await withAgentConversation(run, {
  operationId: 'incident-brief', slot: 'agent',
  contractDirectory: './contracts/agent-run',
  input: { instructions: `Draft an incident brief from these facts: ${facts}` },
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
Its optional `events` writer leaves filtering and presentation in the caller.

## Connect the channels directly

The helper uses only the public contract; other languages and implementations
can compose it directly. Inside a Flow, allocate two named direct channels and pass opposite
ends to the Agent. `conversation: true` starts turn zero. The following excerpt
assumes validated `facts` and `correction` strings from the application's input:

```ts
const commands = await run.channel({
  contract: './contracts/agent-run/contracts/agent-commands.json',
})
const replies = await run.channel({
  contract: './contracts/agent-run/contracts/agent-replies.json',
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
summarizes and settles its predecessor before calling a successor. Earlier
context, current file text and later instructions remain separate from the
model's summary; the application carries its remaining turn budget and root
deadline forward. Another worker independently prepares review questions.

That is a new conversation with explicit context, not native session restoration.
Its input is a supplied snapshot, not an interactive instruction inbox; its
output is for human review, not permission to publish. It demonstrates the
lifecycle without introducing a host scheduler or changing one-shot calls.

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
`{status:'unavailable'}` means no reusable state was committed; an otherwise
valid answer remains usable. Receipt availability requires actual clean native
exit, validated collection and complete cleanup, so accepting a close command
or receiving the answer does not predict it. Forced closure cannot retain a
session.

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
