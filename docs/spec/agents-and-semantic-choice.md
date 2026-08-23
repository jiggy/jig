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
| Agent Run 1.0.0 | [`agent-run.capability.json`](contracts/jig/agent-run.capability.json) | `sha256:d455730ec798a2cfbba5a5a37e2f8a2167325071dffc7fedc02a22e192b72dd2` |
| Agent Session 1.0.0 | [`agent-session.capability.json`](contracts/jig/agent-session.capability.json) | `sha256:63b9e1d6753ba2691b72c75ef90a878390177246d163d942d18c8ab867fccfe8` |
| Agent Interactive 1.0.0 | [`agent-interactive.capability.json`](contracts/jig/agent-interactive.capability.json) | `sha256:abd7aad3b1813f5a8d5d7c45eb217386f0290f9a3187ca10803836915a095d19` |
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
  skills?,
  responseSchema?
}) -> {
  outcome: completed | blocked | limit,
  text,
  structured?
}
```

`skills` is a strictly increasing unsigned-UTF-8 list of package-local Skill
`LocalName`s and therefore has set semantics with one canonical spelling.
Omission means none. When `responseSchema` is present, `structured` is required
and validated with Schema/1. The supplied value must itself be a valid bounded Schema/1 root
schema, including the exact `$schema` declaration required of a schema file.
Provider crash, cancellation, denied authority, malformed output, and schema
failure are operation failures, not domain outcomes.

`AgentResult` below is the same `{ outcome, text, structured? }` value.

### Agent Session

```text
open({ skills? }) -> { sessionId }

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

Provider integrations must admit the concurrent operations required by the
contract, including `events` and `steer` while `prompt` remains pending. In Jig
v1 an Agent Binding is a trusted host-capability Binding, not a direct FLOW
Service export. The integration may internally supervise a local process or
remote daemon, but it owns that transport and the exact per-owner projection.

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

For remote providers Jig can guarantee only local session-admission closure,
projection revocation, and a recorded close attempt. It does not claim remote
data erasure or provider-side cleanup it cannot observe.

## 3. Workspace and authority

No Agent method accepts a host path, attachment token, tool grant, permission
override, provider option, model name, or shell command.

An Agent provider reference resolves to a host-capability Binding whose export
implements the exact Agent contract. It is not a separate Agent profile type.
The trusted integration must realize the exact per-owner resource and tool
projection below. A direct FLOW Service export cannot qualify in v1 because
Service/1 has only static Mount authority and no delegated per-invocation
resource view. A host integration may wrap such a process without exposing it
as the project Binding.

The resolved provider configuration fixes:

```text
provider and configuration
no/read/read-write attachment projection
tool/effect ceiling
approval provider
deadline and budget
```

These are resources of the exact Agent Binding, not attachments inherited from
the caller. Binding an Agent slot grants the caller only the mediated ability
to request work through that exact configured authority; the aggregate project
plan displays its transitive attachments and effect ceiling. The caller cannot
pass, remap, or widen them, and its own attachments, effects, private scratch,
project policy roots, `.jig`, credentials, and ambient tools never inherit into
the Agent operation.

For a host-native provider, Jig derives an Agent child lifetime with only the
Agent Binding's approved per-operation projection and leases. A caller and its
Agent Binding cannot independently map overlapping read-write roots: that
candidate is rejected unless a future explicit Backend serialization mechanism
defines and realizes one safe lease domain. Multiple Agent operations over one
write root likewise require mutually exclusive leases or isolated views. Graph
topology and the fact that a caller awaits the operation are not enforcement.

Instruction execution is different from an ordinary Agent effect call: the
conductor is the selected implementation of the Run, not a child of a live
component process. It therefore receives the instruction Run Binding's own
declared attachment and effect view, as an exact-code component would, under
the Agent provider ceiling and instruction-runtime sandbox. This is direct Run
authority, not caller inheritance. Any independent Agent-Binding resource is
still visible in the aggregate plan, and overlapping read-write roots reject.

A host-native Agent provider receives that derived operation projection.
Closing, cancelling, or losing the operation revokes its projection and
releases its write lease even when remote cleanup is uncertain.

### 3.1 Flow-local skills

The optional package-root `skills/` directory has one Jig meaning: each exact
immediate `skills/<LocalName>/SKILL.md` subtree is Flow-local Agent skill source
owned by that FLOW Package revision. Exact-code Agent Run calls select zero or
more of those LocalNames through `skills`; omission means no Flow-local skill
context. Session and Interactive calls select their immutable set at `open`,
and every turn in that session retains that set. A call cannot select a parent
Flow's skill, a sibling package's skill, or an undeclared project directory.

For each selected name Jig makes only that exact subtree available through a
read-only projection scoped to the Agent operation or session owner. A child
Flow sees its own package tree, not its parent's. An instruction conductor is
the package's single Agent operation and selects every valid immediate
Flow-local Skill by default, because the Markdown package has no inner call
site at which to make a narrower executable selection.

The `skills` field selects context; it does not carry files, paths, or
authority. Projection remains host lifecycle state rather than an ambient
project directory. An integration may realize it with an isolated
filesystem tree, a provider-native skill catalogue, or an equivalent
progressive-disclosure mechanism, but it must preserve the exact admitted tree
bytes and revoke the projection with the Agent owner. The provider integration,
not Jig, declares and implements the Skill format it understands. Jig does not
parse bundle identities, dependencies, or precedence. A provider which cannot
expose the tree without changing or colliding with existing provider state is
ineligible for that operation.

Service/1 cannot add this owner-scoped tree to an already mounted provider: its
resources and authority are fixed for the Mount generation. Static Mount
resources, even if they happen to contain similar files, never satisfy another
package's Flow-local projection. Agent Bindings therefore use a host
integration which can create and revoke the exact per-owner view. Instruction
conductors use the same boundary for their larger per-Run projection.

Projection proves availability, not use. Selecting a Skill does not prove that
an Agent followed it. When a Flow's procedure depends on one bundled Skill, the
same call both selects its LocalName and requests its use in the instructions,
or repeats the mandatory rule directly. Even both actions are behavioral
evidence rather than an authority or correctness guarantee; deterministic
validation and sandbox limits remain separate.

Jig never copies these bundles into or overwrites application- or
provider-native locations such as `.agents/skills/` or `.claude/skills/`.
V1 defines no implicit skill-name shadowing, global precedence, shared root
skill catalogue, inheritance/override tree, or skill dependency resolver.
Additional skills require an explicit admitted attachment/provider mechanism;
they do not appear through directory coincidence.

Flow-local skills remain directly editable package source and participate in
the package snapshot, provenance, update, and three-way-merge rules. They are
not a second installation or overlay system.

### 3.2 Instruction conductor mapping

Instruction execution is one pinned Jig implementation recipe over the
existing Run owner and Agent Run contract, not another FLOW wire protocol.
After ordinary input and settings validation, Jig acquires the recipe-pinned
Agent provider-generation lease and creates one instruction-conductor child
owner.

The conductor builds these host-owned immutable logical resources:

```text
package/                 exact read-only Package/1 tree, including FLOW.md
run/input.json           RFC 8785 encoding of immutable Run input
run/settings.json        RFC 8785 encoding of complete Binding settings
run/context.json         outcomes, logical attachments/modes, and slot descriptions
run/result.schema.json   package result schema or synthesized base-result schema
```

The names above are provider-facing logical resource names, never host paths.
The exact serialization and projection belong to the versioned instruction
runtime pinned by the recipe. It invokes Agent Run with one small fixed
instruction telling the Agent to read those resources, follow the FLOW body,
use only the exposed tools, and return the complete structured result. No
package, input, settings, descriptor, or candidate prose is interpolated into
that string, so it is validated against the Agent Run instruction ceiling
while the recipe is planned, independently of invocation data. A runtime whose
fixed request cannot satisfy that ceiling does not qualify; with no other exact
instruction recipe the Binding is admitted `UNAVAILABLE` with
`IMPLEMENTATION_UNAVAILABLE`, before any Run dispatch.

The conductor exposes declared attachments, every valid immediate Flow-local
Skill, and
already-admitted effect/Flow slots through owner-scoped provider tools. Those
tools realize the existing `effect/call` and `flow/call` semantics with stable
operation IDs derived from conductor turn/tool-call identity. They cannot add
a slot, remap an attachment, widen a mode or grant, or bypass the Run owner's
deadlines and budgets.

The conductor performs one Agent Run operation. Its `responseSchema` is the
package's complete `result.schema.json` when present. Otherwise the conductor
synthesizes a closed Schema/1 root requiring a normal object with `outcome`
equal to `done` or one declared custom outcome and a required `output` accepting
any FLOW JSON/1 value.

`AgentResult.outcome: completed` plus a present, valid `structured` value
becomes the provisional complete Flow result. Agent `text` is diagnostic
evidence only unless the structured result explicitly includes it. `blocked`
or `limit`, provider failure, and missing structured data fail the
implementation rather than becoming domain outcomes. A returned `blocked` or
`limit` is `IMPLEMENTATION_FAILED` with the exact Agent result retained as
diagnostic evidence; provider loss and cancellation keep their more specific
host failures. An Agent expresses a
declared domain `blocked` outcome only by completing and returning it inside
the structured Flow result. Schema or base-envelope rejection is
`INVALID_RESULT`.

The conductor then uses the same owner-close, child-quiescence, final result
validation, and commit rules as exact code. No result is inferred from prose,
workspace contents, or Agent text.

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
outside it remain impossible. A remote or multiplexed provider remains behind
the host integration; the integration must preserve exact owner attribution and
cannot treat a cooperative provider channel as a hard security boundary.
Persistent grants and policy editing are deferred.

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
edge. It may make a different decision on a later visit. In Spindle, Router is
a specialized Node; the choice provider is composed into it rather than
creating Codex/Claude-specific subclasses.

### Jig open-ended Resolver

For `flow/call`, the deterministic Resolver first freezes an ordered snapshot
of approved Binding revisions and filters exact compatibility, input, trust,
authority, runtime availability, budget, recursion, and liveness. Zero means
missing; one selects directly; several may call Semantic Choice or remain
ambiguous.

A project opts into the optional ranker by naming one exact Binding directly:

```ts
semanticChoice: "semantic-choice",
```

The field is omitted when semantic ranking is not desired. It is not a
`resolver` object: deterministic resolution remains kernel machinery and the
Binding supplies only the Semantic Choice capability used at the many-candidate
step. A runner-local Router receives a separately declared package capability
slot even when project policy binds both sites to the same provider revision.

If deterministic filtering leaves `reference-fast` and `reference-deep`, the
configured Binding may choose between those two IDs. Without the field that
same operation is `BINDING_AMBIGUOUS`; with one survivor it proceeds directly
and never calls Semantic Choice. The string is simply a Binding LocalName and
may name any compatible implementation, for example `offline-choice` or
`company-choice`.

A dangling or contract-incompatible `semanticChoice` reference invalidates the
project candidate. A valid Binding admitted `UNAVAILABLE` does not turn the
ranker into a required execution dependency: if deterministic filtering leaves
several candidates before a chooser can be dispatched, the call terminates
`BINDING_AMBIGUOUS` with ranker-unavailable evidence. Once a chooser is
dispatched, its normal effect ownership applies; loss without a provable result
is `UNCERTAIN`, not ambiguity and not a transparent rerank.

The semantic decision is a journaled child operation. Its committed result is
reused. Dispatch with an unprovable result makes the parent operation
`UNCERTAIN`; the same operation never reranks. Provider loss after selection
does not choose a replacement under the same operation ID.

A software factory can therefore route a new ticket among Gauntlet,
Majority-Vote, and future approved Bindings without keyword gates. The local
Router owns graph topology; Jig's Resolver owns open component discovery.

Missing repair is separate. A configured `create-missing-flow` maintenance
Flow may search, generate, test, and propose a candidate, but cannot insert it
into the terminal failed operation. Zero candidates commit terminal
`BINDING_MISSING`; later admission never resumes, mutates, or semantically
ranks that operation again. After the proposal passes ordinary plan, review,
and apply, a person or application starts a deliberate new root attempt with a
new submission key. Reusing the old key returns the old terminal Run.

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
7. Close/cancel revokes the per-owner projection and write lease. A remote
   session closes locally while provider-side erasure remains unclaimed.
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
16. Omitted `skills` selects none; an unsorted, unknown, duplicate, malformed,
    or out-of-package name rejects before provider work. Each selected Flow-local
    skill projection contains only its exact admitted subtree, is revoked with
    its Agent owner, and never overwrites provider-native skill directories.
    Session selection is fixed at `open`; instruction conductors select every
    immediate package skill.
17. Zero eligible `flow/call` candidates commit terminal `BINDING_MISSING`
    with the frozen candidate evidence and rejection reasons; repair cannot
    fill its resolution or rerank it.
18. A provider admitted by a later project generation can serve only a new
    attempt. Reusing the old root submission key returns the old terminal Run,
    and redelivering an old Hook/Event pair returns its old derived Run.
19. An Agent Binding's fixed attachment/effect authority is visible as
    transitive project authority but never inherited from or remapped by its
    caller. Independently configured overlapping caller/provider read-write
    roots reject before dispatch, and concurrent Agent writers require exact
    mutual exclusion or isolation.
20. An instruction conductor receives the instruction Run Binding's declared
    component view because it is that Run's selected implementation, while no
    component runner is live. This never permits undeclared roots, provider
    widening, or overlapping independent read-write projections.
21. Instruction mode supplies exact body/input/settings/outcome and logical
    authority context as bounded logical resources without host paths;
    provider tools cannot exceed the admitted Run view. The fixed instruction
    stays inside Agent Run limits regardless of package/input size. Only
    `completed` with a valid complete structured Flow result may become a
    domain result. Agent `blocked`/`limit`, absent structured data, and invalid
    results fail without fabricating an outcome.
22. A direct FLOW Service Binding cannot satisfy a Jig Agent slot in v1. A
    host integration may wrap a remote provider, but owns projection,
    revocation, transport, and conformance; static Mount files never
    impersonate per-owner package, attachment, skill, or tool context.
