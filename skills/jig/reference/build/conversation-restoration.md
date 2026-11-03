---
title: Retain and restore an Agent conversation
---

# Retain and restore an Agent conversation

Keep qualified native conversation state for a later authorized invocation. Use
the [two-turn tutorial](conversations.md) for follow-up within one live
conversation.

## Before you start

Use a supported native client with a separately reviewed retention grant.
Qualify retention and restoration for the installed client. Launcher discovery
and successful follow-up do not qualify either operation. The code excerpts run
inside a Flow handler with an exact `agent` slot and validated facts or
correction strings. They extend your caller and are not standalone Flows.

## 1. Grant and request retention

A later Run can request the earlier native conversation through an opaque
reference. The published Agent and Jig alphas include this interface. Qualify
the installed client's save-and-restore path before relying on it. The initial
retention profile is Codex 0.154.0. Successful live follow-up alone does not
qualify restoration.

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
`{status:'unavailable',reason}` means no reusable state was committed. An
otherwise valid answer remains usable. Receipt availability requires actual
clean native exit, validated collection and complete cleanup, so accepting a
close command or receiving the answer does not predict it. Forced closure cannot
retain a session.

Use a `retained` final receipt only after the invocation settles.
An unavailable receipt is not a reusable reference. Storage or cleanup errors
remain invocation failures, not optional retention loss.

For unavailable receipt reasons, see
[retention troubleshooting](../reference/troubleshooting.md#conversation-state-is-not-retained).

## 2. Restore in an authorized invocation

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

`retainedReference` is the UUID from the previous receipt. The host restores the
native conversation and reapplies current reviewed configuration before the new
prompt. It uses current credentials separately from conversation data. The
previous transcript is not submitted again as application input, and a failed
restoration does not silently start a fresh conversation.

Each reference can be claimed once. Use the new final receipt for any successor.
Do not retry the old reference after a failed claim. Restoration requires the
same authorized recipient and ancestry in the same protected project with the
matching native profile. Changed accepted code or configuration may invalidate
access. A reference identifies state and grants no permission by itself.

## 3. Choose the reference lifetime

For correction within one root Run, request
`session: {retain: true, lifetime: 'run'}`. The reference survives the Agent
call and can be restored after separate checks. Restoration inherits this
lifetime. References cannot cross root Runs, and root settlement removes their
stored state. Omit `lifetime` only when later Runs need the conversation. Both
modes require the same reviewed retention grant and bounds.

The project retains at most 16 available snapshots of at most 8 MiB each.
References expire after 24 hours. Physical pruning happens on the next store
access. The profile retains only bounded validated native conversation records,
never credentials, arbitrary workspaces or tool authority. Expiry is not a
secure-erasure guarantee.

## 4. Use retention with a continuing conversation

For a continuing conversation, put `session` beside `instructions` in its
initial input. The receipt is in the final invocation output—
`completed.settlement.output.session` when using the helper—and never in an
individual turn reply. Later prompt controls cannot request another retention
policy. The HTTP Agent package rejects session requests before dispatch.

If session handling is required by the complete method, also add `sessions` to
its Agent dependency's `requires` list. This checks implementation claims. It
does not replace the native retention grant or guarantee a successor receipt. A
settings-conditional session path can retain ordinary runtime refusal and
authored recovery without making every one-shot call require sessions.

The [Agent Run contract](../spec/agent-run.md#retaining-a-native-conversation)
defines the request and receipt.
[Finite ACP](../spec/finite-acp.md#retained-native-state) defines native
qualification, authorization and cleanup.

For a failed restoration, see
[restoration troubleshooting](../reference/troubleshooting.md#conversation-restoration-fails).
