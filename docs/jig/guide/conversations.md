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

## Connect controls and replies

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

Inside a TypeScript Flow, allocate two named direct channels and pass opposite
ends to the Agent. `conversation: true` starts turn zero. The following excerpt
assumes validated `facts` and `correction` strings from the application's input:

```ts
const commands = await run.channel({
  contract: './contracts/agent-run/contracts/agent-commands.json',
})
const replies = await run.channel({
  contract: './contracts/agent-run/contracts/agent-replies.json',
})
const stop = new AbortController()
const work = run.call({
  operationId: 'incident-brief', slot: 'agent',
  input: { instructions: `Draft a short incident brief from these facts: ${facts}`, conversation: true },
  channels: { commands: commands.receive, replies: replies.send },
}, { signal: stop.signal }).then(
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
In `finally`, abort `stop`, await `work`, and dispose local endpoints, including
untransferred endpoints if dispatch failed. Disposal errors remain visible.
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

## Limits

Essential replies are bounded to 64 KiB each; ask for concise answers. Blocked
reply delivery fails after five seconds rather than silently losing a result.
All turns share the original deadline, byte budgets, and native owner. The
maximum grant is eight turns; no current conversation can extend its own grant.

This is one finite live session, not cross-Run restoration, durable replay, or
permission to use native workspace tools. The [exact contract](../spec/agent-run.md#continuing-conversations)
defines controls, failure cases, and the separate final result. Client startup,
live follow-up, interruption, and restoration need distinct qualification;
support for one does not establish the others.
