# Jig Agent and Semantic Choice contracts/1

**Status:** reviewed Jig capability specifications. They use FLOW Capability
Contract/1; they do not add methods to FLOW Run/1 or create another contract
format.

FLOW is Agent-neutral. Jig is Agent-native: it publishes exact contracts which
Codex, Claude Code, ACP, command-line, API, deterministic-test, and future
providers may implement. Provider and model choice belongs to project
Bindings, not to the contracts.

The canonical descriptors and their Capability Contract/1 digests are:

| Contract | Descriptor | Digest |
|---|---|---|
| Agent Run 1.0.0 | [`agent-run.capability.json`](contracts/jig/agent-run.capability.json) | `sha256:124668db4b2b003532062d8da291d2e69696d782a38bd2cae9c0140057bd0f9b` |
| Agent Session 1.0.0 | [`agent-session.capability.json`](contracts/jig/agent-session.capability.json) | `sha256:f1fd50a5f50486e153214d3943cac349af42a0ebcd848a81d0551b3c6fc84e10` |
| Agent Interactive 1.0.0 | [`agent-interactive.capability.json`](contracts/jig/agent-interactive.capability.json) | `sha256:a7db3742696601c17ff61805b26cbd23165b936db8ef96dd3970a4af8c56d4e1` |
| Approval 1.0.0 | [`approval.capability.json`](contracts/jig/approval.capability.json) | `sha256:8153497564cb47d09cbc22671d1f6906f523d88f546815cc904ea2c10a50d38f` |
| Semantic Choice 1.0.0 | [`semantic-choice.capability.json`](contracts/jig/semantic-choice.capability.json) | `sha256:83767b89d02163d8a36c5e4f561d7c164135866a6bfdee1acd20f76370971e02` |

The JSON files are the wire authority. Method sketches below are explanatory
shorthand. Release automation must recompute this table with RFC 8785 and fail
on drift.

## 1. Three non-substitutable Agent contracts

Jig publishes three complete Capability Contract/1 descriptors:

```text
https://jig.dev/contracts/agent-run          1.0.0
https://jig.dev/contracts/agent-session      1.0.0
https://jig.dev/contracts/agent-interactive  1.0.0
```

They are separate because their compatibility claims differ:

- **Run** is finite and self-contained.
- **Session** retains provider state across sequential turns.
- **Interactive** repeats the complete Session surface and additionally
  guarantees concurrent steering of a live turn.

A provider may implement Run and Session without claiming steering. Optional
feature flags or `unsupported` results would make exact compatibility less
honest than the third small contract.

### Agent Run

```text
run({
  instructions,
  responseSchema?
}) -> {
  outcome: completed | blocked | limit,
  text,
  structured?
}
```

When `responseSchema` is present, `structured` is required and validated with
Schema/1. The supplied value must itself be a valid bounded Schema/1 root
schema, including the exact `$schema` declaration required of a schema file.
Provider crash, cancellation, denied authority, malformed output, and schema
failure are operation failures, not domain outcomes.

`AgentResult` below is the same `{ outcome, text, structured? }` value.

### Agent Session

```text
open({}) -> { sessionId }

prompt({
  sessionId,
  turnId,
  instructions,
  responseSchema?
}) -> AgentResult

events({
  sessionId,
  afterSequence,
  limit,
  waitMs
}) -> {
  events,
  nextSequence
}

close({ sessionId }) -> {}
```

`events` is a bounded long-poll over one session's portable observation log,
not a subscription. The session sequence starts at 1 and increments by one;
each event carries its exact `turnId`. A Provider may compact retained history,
but it tracks `retentionFloor`, the greatest sequence permanently discarded
(initially 0). `afterSequence < retentionFloor` returns `cursor-expired` with
that floor. At call admission, `afterSequence` greater than the current latest
sequence returns `cursor-ahead` with `latestSequence`; it never waits past or
silently skips a gap.

Returned events have sequence greater than `afterSequence`, are ordered, and
contain at most `limit` items. `nextSequence` is the final returned sequence or
the unchanged input cursor when the array is empty. The call returns when an
event is available or `waitMs` expires. Completed-turn events remain drainable
until ordinary retention compacts them. For every admitted turn, every
portable event—including exactly one terminal event—commits before its
`prompt` request terminates with a normal result or provider-produced turn
failure/cancellation. No event for that turn may be appended afterward.
Pre-admission named errors and provider/transport loss create no fictional
terminal event. The `prompt` result or error—not an event flag—is the
authoritative turn-terminal signal; this ordering rule only lets a caller
drain a completed turn without racing a late observation.

The closed named errors across Session and Interactive are:

```text
session-busy
turn-id-conflict
cursor-expired
cursor-ahead
turn-not-active
message-conflict
```

Provider loss is an operation/JSON-RPC failure, not a named application error.
It moves the local session record to `LOST`; no provider response is required
or implied.

The portable event vocabulary and data are intentionally small:

```text
turn.started       {}
message.completed  { text }
turn.completed     { outcome }
turn.failed        { code, message }
turn.cancelled     {}
```

The `prompt` result is authoritative. Events are observation. Provider-native
tool chatter, token deltas, and implementation messages remain namespaced
provider data rather than Jig lifecycle facts.

### Agent Interactive

Interactive repeats every Session method and adds:

```text
steer({
  sessionId,
  turnId,
  messageId,
  instructions
}) -> {
  accepted: true
}
```

Acceptance means the message entered the exact live Agent loop. It does not
guarantee that the final answer changes.

## 2. Session ownership and state

The exact session identity is:

```text
(consumer owner lifetime, Agent provider export generation, sessionId)
```

`sessionId` is provider-generated, opaque, nontransferable, and not a bearer
token or universal FLOW handle. Cross-owner or cross-generation use fails.

The state machine is:

```text
OPENING -> IDLE -> TURN_ACTIVE -> IDLE -> CLOSING -> CLOSED
                         `-----------------------> LOST
```

Exactly one prompt turn may be active. A second prompt returns
`session-busy`. The caller creates a unique `turnId` before dispatch so
concurrent operations can address the live turn. Reusing an admitted `turnId`
with the same parsed JSON/1 input (equivalently, the same RFC 8785 canonical
input digest) joins the pending call or returns its recorded result; changed input
returns `turn-id-conflict`.

Service/1 providers of these contracts must admit multiple outstanding,
out-of-order invocations on one Mount. This permits `events` and `steer` while
`prompt` remains pending. The contracts may also be implemented host-natively;
Service/1 is a provider option, not a requirement.

`steer` linearizes against turn completion. It either commits while that exact
turn is active, or returns
`turn-not-active`. Reusing `messageId` with identical content returns the
recorded result; equality uses the parsed JSON/1 input and its RFC 8785
canonical digest, not source byte spelling. Changed content conflicts. Lost
acknowledgement follows the ordinary operation-uncertainty rule and is never
resent to a replacement provider.

`close` is idempotent. It closes new prompt/steer admission, cancels or awaits
the active turn under a bounded deadline, and releases the session. Owner
cancellation performs the same cleanup. Provider loss makes every owned
session `LOST`; v1 has no transparent healing, rebinding, resume, migration, or
cross-Run sharing.

A successful `open` atomically registers a host-owned disposer on the consumer
owner and retains the exact provider-generation/Binding cleanup lease. An
explicit successful `close` consumes it. During owner quiescence Jig
compare-and-sets every remaining session to `CLOSING`, blocks prompt, events,
and steer, and invokes the idempotent close exactly once under a bounded
host-cleanup owner. That owner acts only through the disposer's unforgeable
cleanup lease on behalf of the original consumer owner; logical session
ownership never changes, and provider-side close is authorized only for that
exact owner/provider-generation/session tuple. The cleanup is not a caller
`effect/call`, cannot create child work, and cannot transfer or reparent the
session. Jig journals its
terminal or uncertain result before releasing or fencing the lease. Consistent
with Run/1 owner quiescence, cleanup which cannot become terminal or fenced by
the hard deadline prevents owner success and makes it `FAILED` or `LOST`.

For remote providers Jig can guarantee only local session-admission closure
and a recorded close attempt. A host-native per-owner projection is revoked as
described below; a Service-backed provider retains only its static Mount
authority until that Mount drains or is revoked. Jig does not claim remote data
erasure or provider-side cleanup it cannot observe.

## 3. Workspace and authority

No Agent method accepts a host path, attachment token, tool grant, permission
override, provider option, model name, or shell command.

An Agent provider reference resolves either to a host-capability Binding whose
export implements the exact Agent contract, or to an exact Agent export of a
Service package Binding. It is not a separate Agent profile type.

The resolved provider configuration fixes:

```text
provider and configuration
no/read/read-write attachment projection
tool/effect ceiling
approval provider
deadline and budget
```

Jig derives an Agent child lifetime and attenuates only the caller's already
approved named attachments and effects. Project policy roots, `.jig`,
credentials, ambient tools, unrelated attachments, and the caller's private
scratch never inherit implicitly. Concurrent writers require isolation or
mutually exclusive leases.

A host-native Agent provider receives a derived operation projection. Closing,
cancelling, or losing that operation revokes its projection and releases its
write lease even when remote cleanup is uncertain.

A Service/1 provider instead sees only the attachments statically approved for
its exact Service Binding. That authority and its write lease belong to the
Mount, not to an individual session; closing a session cannot revoke them. An
invocation never remaps the Mount workspace or injects paths or generic
handles. Projects needing several Service-backed workspaces or isolation
domains therefore declare several exact Bindings/Mounts, whose authority ends
only when each Mount drains or is revoked. Dynamic per-caller Service mounts
are deferred. A stateful provider cannot pool unrelated workspaces unless
those static Bindings and Sandbox instances already separate them.

## 4. Runtime Agent approvals

Project admission consent and an Agent's runtime tool approval are different
boundaries.

Jig may bind the separate exact
`https://jig.dev/contracts/approval` Capability Contract at `1.0.0` as a gate
for selected Agent-mediated effects:

```text
request({
  approvalId,
  kind,
  summary,
  details
}) -> {
  decision: allow-once | deny
}
```

The Agent provider does not call this method and cannot present an approval
token. Jig intercepts an effect which the Agent configuration marks as gated,
freezes its exact owner, provider generation, slot, operation ID, and canonical
call digest, and invokes the approval provider itself. `allow-once` is recorded
and consumed transactionally for that one exact effect before dispatch. It
cannot authorize a different call, retry, owner, or provider generation.

Approval can release only authority already inside the configured effect
ceiling; it cannot add a path, tool, effect, provider, or raw permission. Deny,
timeout, cancellation, unavailable approval, or an unprovable commit prevents
dispatch. Ungated effects inside the ceiling remain preapproved; effects
outside it remain impossible. A Service-backed Agent uses one Mount-scoped
ceiling and gate policy because sibling attribution on a multiplexed provider
channel is cooperative rather than a hard security boundary. Persistent grants
and policy editing are deferred.

## 5. Semantic Choice

Jig publishes one optional provider-neutral Capability Contract:

```text
https://jig.dev/contracts/semantic-choice  1.0.0
```

```text
choose({
  objective,
  context,
  candidates: [
    { id, description }
  ]
}) ->
  { status: selected, candidateId, rationale? }
  | { status: abstain, rationale? }
```

Candidate IDs are unique, decision-local opaque values. The deterministic
caller freezes their order and exact candidate revisions before dispatch, maps
IDs host-side, and rejects a duplicate input ID or unknown result.

The chooser cannot:

```text
add or make a candidate eligible
install, generate, repair, grant, bind, or mutate
return route arguments or executable plans
access project files or the network merely because it is a chooser
decide trust, compatibility, permissions, or completion
```

`confidence` is omitted because model self-confidence is not a compatibility
or safety signal. `abstain` lets deterministic caller policy choose clarify,
ambiguity, or failure.

An Agent-backed chooser uses an activation-pinned Agent Run provider reference,
normally with empty scratch, no project attachments, no mutation effects, and
one turn.
A rule-based or API-model provider may implement the same contract.

## 6. Two intentional routing sites

### Runner-local Router

A graph Router presents its actual finite outgoing edges as candidates. Each
node visit calls Semantic Choice once and maps the returned local ID to an
edge. It may make a different decision on a later visit. In Caskada, Router is
a specialized Node; the choice provider is composed into it rather than
creating Codex/Claude-specific subclasses.

### Jig open-ended Resolver

For `flow/call`, the deterministic Resolver first freezes an ordered snapshot
of approved Binding revisions and filters exact compatibility, input, trust,
authority, runtime availability, budget, recursion, and liveness. Zero means
missing; one selects directly; several may call Semantic Choice or remain
ambiguous.

The semantic decision is a journaled child operation. Its committed result is
reused. Dispatch with an unprovable result makes the parent operation
`UNCERTAIN`; the same operation never reranks. Provider loss after selection
does not choose a replacement under the same operation ID.

A software factory can therefore route a new ticket among Gauntlet,
Majority-Vote, and future approved Bindings without keyword gates. The local
Router owns graph topology; Jig's Resolver owns open component discovery.

Missing repair is separate. A configured `create-missing-flow` maintenance
Flow may search, generate, test, and propose a candidate, but cannot insert it
into the blocked operation without the ordinary admission process.

## 7. Required conformance cases

1. Agent Run cannot satisfy Session or Interactive; Session cannot satisfy
   Interactive.
2. A persistent sequential Session retains provider state without pretending
   to support steering.
3. One active prompt is enforced; concurrent session events/steer do not block
   behind it.
4. Accepted steering addresses the exact live turn and duplicate `messageId`
   behavior is stable.
5. Session events are consecutive, turn-addressed, and strictly typed; stale
   and future cursors return `cursor-expired` and `cursor-ahead` rather than
   guessing, waiting past a gap, or skipping.
6. Owner or provider loss invalidates the session without rebinding.
7. Close/cancel revokes a host-native per-owner projection and write lease. A
   Service-backed session closes locally while its static Mount authority ends
   only on Mount drain/revoke; remote erasure is never claimed.
8. Returning from an owner with an open session cannot commit success before
   the host-owned disposer closes or fences the exact session generation; its
   cleanup cannot create child work or silently reparent the session.
   An ordinary sibling-owner close fails, the disposer close succeeds at most
   once, and a stale provider-generation lease fails.
9. Request fields cannot widen workspace, tools, approvals, or provider
   configuration.
10. Response-schema violation fails the operation.
11. Semantic Choice never sees an incompatible or unapproved candidate and
    cannot return an unknown ID.
12. Duplicate candidate IDs reject before dispatch using exact string equality.
13. Prompt injection can influence only selection inside the frozen allowlist.
14. A committed semantic result is reused; uncertain dispatch never reranks.
15. A later graph visit is a distinct decision.
