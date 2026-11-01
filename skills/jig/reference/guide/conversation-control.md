---
title: Control an Agent conversation
---

<!-- Generated from docs/jig/guide/conversation-control.md. Edit the source, then run just sync-skills. -->


# Control an Agent conversation

Use this guide to interrupt an active turn or connect the public conversation
channels directly. Start with the [two-turn tutorial](conversations.md) for a
complete caller.

## Before you start

Use an approved native Agent route with the `conversation` feature and a
sufficient `maxTurns` grant. The helper examples run inside the callback
supplied to `withAgentConversation`. Direct-channel examples run inside a Flow
handler with validated `facts` and `correction` strings. These excerpts extend
your caller. They are not standalone Flows.

## Interrupt a turn

Keep the follow-up promise, request interruption, then await that same promise:

```ts
const turn = conversation.prompt({ instructions: 'Continue the draft.' })
const control = await conversation.interrupt()
const settled = await turn
```

The control reply (`accepted` or `not-running`) is not the turn result. The
settled turn is either `cancelled` or an ordinary `result` if completion won the
race. Do not start subsequent work until the turn promise settles.

At the channel level, send `{type: 'interrupt', turn: 1}` while turn one is
running. Its accepted reply means the method accepted that control. Only the
later `cancelled` reply establishes native turn settlement. A completion racing
interruption can instead return an ordinary result. Wait for either terminal
turn reply before continuing.

Busy or stale controls are rejected, not queued. The host independently refuses
prompts beyond `maxTurns`. A native interruption that does not settle within
five seconds terminates the client. It does not enable another prompt.

Connect the optional `events` channel to show selected text or plans. Its values
carry the turn number, but progress can be incomplete and never substitutes for
the essential replies. A failed progress display need not stop the conversation.

It is safe to request interruption immediately: the helper waits for the prompt
acknowledgement before sending the interrupt. `accepted` means the request was
accepted, not that the turn was cancelled. Natural completion can win, in which
case the control may be `not-running` and the prompt still returns its result.
Leaving a live turn unfinished at callback return fails rather than detaching
it.

## Check interruption and recover

Check the same turn promise before starting subsequent work. An accepted control
does not prove cancellation. Natural completion may win the race. If native
interruption exceeds its five-second limit, the client terminates and cannot
accept another prompt. Use [Results and recovery](results.md) for uncertain
execution or cleanup.

## Handle errors and observation loss

`AgentConversationError` retains received `turns`, any known `settlement`, and
both primary and cleanup `errors`.

Ordinary `try/catch` remains sufficient. Its failure summary includes the first
exposed error's bounded message. Inspect the retained `errors` when deliberately
recovering. Optional `onEvent` filters or displays public updates synchronously
without manual channel setup. Inspect `completed.observation?.status`:
`incomplete` preserves observation errors without replacing the actual execution
result. Asynchronous routing can instead use a caller-created `events` writer.

Do not combine it with `onEvent`. There is no privileged host echo of filtered
text.

## Connect the channels directly

The helper uses only the public contract. Other languages and implementations
can compose it directly. Inside a Flow, allocate two named direct channels and
pass opposite ends to the Agent. `conversation: true` starts turn zero. The
following excerpt assumes validated `facts` and `correction` strings from the
application's input:

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

Using a call-specific abort signal cancels the local wait promptly. Awaiting
that cancelled promise does not prove that the Agent has stopped. The SDK
retains wire settlement and the host accounts for owned cleanup before
publishing the root result. Normal conversation close followed by the actual,
non-cancelled invocation result is the path for confirmed settlement before
starting subsequent work. These are ordinary
[call and channel lifecycle rules](channels.md), not a new Agent-specific SDK.
An application should retain every answer it actually received and distinguish
incomplete work from a finished revision.

## Related tasks

- [Hand work to a fresh conversation](conversation-handoff.md).
- [Retain and restore a conversation](conversation-restoration.md).
- [Exact conversation contract](../spec/agent-run.md#continuing-conversations).
