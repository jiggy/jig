---
title: Hand work to a fresh Agent conversation
---

# Hand work to a fresh Agent conversation

Transfer validated context and a summary when the application needs a new
conversation. Use a [same-session follow-up](conversations.md) when a new
conversation is unnecessary.

## Before you start

You need an approved worker that implements the handoff sequence and a parent
with exact worker slots. The source and instruction replacements must come from
separately authorized application input. The excerpt below shows parent
composition. It does not implement the worker or define its revision channel
contract. Use [Flow channels](channels.md) to declare that application-owned
agreement.

## Settle the predecessor before dispatch

An application can use these controls for an application-owned summary handoff.
One worker drafts, while another publishes preliminary analysis through an
ordinary FLOW channel and continues preparing independent review questions.
Ordinary commentary uses a follow-up in the same conversation. A validated
replacement of source files or appended instructions triggers handoff:

1. Interrupt the predecessor if it is still active.
2. Await the actual turn.
3. Request a summary in the same conversation.
4. Settle the predecessor.
5. Start one successor.

The parent connects the workers directly. No logging service or host scheduler
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
contains separately supplied files and ordered instructions for the reviewer to
publish. Model output cannot create that authority. The successor receives the
latest validated context separately from the model's summary and review notes.
Neither generated text can replace instructions or extend authority. The example
also retains each branch's result when the other fails.

Its finite update batch must finish before successor dispatch, so accepted
updates cannot be silently left behind. Drafting requests at most three model
turns, review at most two, all within the original root deadline and host
grants.

That is a new conversation with explicit context, not native session
restoration. Its root input is a supplied snapshot, not an interactive
instruction inbox. File text is data, not live workspace access. The worker's
optional revision channel can carry updated files and appended instructions from
another parent. An unwired or cleanly empty channel needs no replacement. Its
output is for human review, not permission to publish.

Interruption can prevent the final packet from arriving. This demonstrates
lifecycle and context preservation, not that summary handoff improves model
answers.

## Check the result

Inspect both results retained by `Promise.allSettled`. Check the successor's
answer against the latest validated context. A summary is model output and does
not establish factual correctness or authorize publication. This pattern
demonstrates lifecycle and context preservation. It does not establish better
answers.

## If handoff does not complete

Preserve received answers and each branch's result. Do not dispatch a successor
while the predecessor's turn or invocation remains unsettled. If interruption or
cleanup is uncertain, follow [Results and recovery](results.md).
[Conversation control](conversation-control.md) explains interruption and
retained helper errors.
