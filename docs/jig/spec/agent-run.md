# Jig Agent Run invocation

**Status:** experimental alpha candidate.

Agent Run is one exact FLOW Invocation Contract consumed through Run/1
`flow/call`. A caller supplies explicit instructions, Skill contents and optional
guidance. The shared [Agent method](../guide/agent-method.md) prepares the prompt
and interprets the response in an ordinary Flow. Jig provides the granted
HTTP or finite native transport, not the Agent's method. This adds no special
Agent invocation API to `@jigging/flow`.

The canonical descriptor is
[`agent-run/contract.json`](https://jig.md/contracts/agent-run/contract.json):

```text
id       https://jig.md/contracts/agent-run
version  1.0.0
digest   sha256:d0c9ceb0c2b2940fa9d29daaea50e926a8060414d43c9a37f5a837641a55ef09
```

An Agent-using Flow includes an exact package-local copy of those descriptor
bytes and the referenced `contracts/acp-public-updates.json` descriptor. The
latter defines optional public updates. The bundle also includes direct
`agent-commands.json` and `agent-replies.json` channel contracts for conversational
use. Copy the complete
`agent-run/` bundle, preserving its descriptor-relative `contracts/` directory.
Declare the slot in a code Flow's optional `FLOW.meta.json`:

```json
{
  "name": "ticket-router",
  "description": "Select and run one exact ticket handler.",
  "uses": { "agent": { "contract": "./contracts/agent-run/contract.json" } }
}
```

The slot name `agent` is local to this package. Like any ordinary dependency,
it resolves through an exact Binding route or project default. Contract URIs
are not fetched at runtime. The selected method uses its own independently
reviewed resource grants; a matching descriptor grants no authority.

## Declare required Agent behavior

The descriptor's `features` catalog names optional mechanisms. Implementations
claim the mechanisms they implement through package metadata `supports`;
consumers require them through `uses.<slot>.requires`. These use the ordinary
[FLOW feature qualification](https://flow.jig.md/spec/invocation-contracts)
rules and the same exact contract identity as the call.

| Feature | Implementation obligation | Separate conditions |
| --- | --- | --- |
| `events` | Implement the optional public-update protocol and report observation loss honestly. | Updates may be incomplete; they never establish control or execution results. |
| `conversation` | Implement paired commands/replies, serial prompt and interruption control, turn results, and final settlement. | The resource's prompt allowance, current client support, and actual settlement remain separate. |
| `sessions` | Implement retain/restore requests and final receipts, including Run-scoped state and honest unavailability. | Current retention authority, valid references, native history and successful collection remain separate. |

The HTTP package declares `supports: []`. The ACP package declares
`supports: ["events", "conversation", "sessions"]`. These are unconditional
claims about the method across its accepted package settings. A setting cannot
deliberately remove an advertised mechanism while leaving its claim true.
Static matching checks those declarations, not implementation honesty. Separate
resource grants, native profiles and runtime failures may still refuse work.
Matching grants no authority and never converts package output into host evidence.

A caller whose method needs continuing control declares:

```json
{
  "uses": {
    "agent": {
      "contract": "./contracts/agent-run/contract.json",
      "requires": ["conversation"]
    }
  }
}
```

Jig checks required names after exact contract matching and makes a mismatching
target unavailable before its caller starts. An explicit selection never falls
back automatically. A caller with no extra requirements needs no `requires`
field; it retains ordinary input, channel and runtime refusal semantics.
Conditional features may remain runtime decisions with authored recovery;
review cannot infer those branches or arbitrary wrappers' resource use.

Requiring `conversation` does not promise permission for a follow-up: a grant
with `maxTurns: 1` permits only the initial prompt. Requiring `sessions` does not
grant `retainSessions` or promise a retained successor. Inspect final receipts
before restoring; unavailable retention and execution failure remain distinct.
Require `events` when the complete method supplies that optional port; after
accepted support, observer failure remains separate from essential execution.

Keep every participant's complete descriptor bundle synchronized. Catalog changes
change the exact invocation digest even for callers with no feature requirements;
refresh their bundle and use ordinary review/admission. Call syntax is unchanged.

## Calling the Agent

The optional `events` send channel carries the exact
[ACP public updates](../contracts/acp-public-updates.md) profile through supported
native clients, with direct or isolated-broadcast delivery. It adds no session
control and does not replace the final result. API clients remain one-shot;
requested unsupported channels reject before dispatch. See [channels](channels.md)
for ownership, buffering and installed output.

The contract has one invocation, with no method selector. Its input is:

```ts
{
  instructions: string;
  skills?: readonly { name: string; files: readonly { path: string; text: string }[] }[];
  guidance?: readonly { label: string; text: string }[];
  responseSchema?: JsonObject;
  session?: { retain: true; lifetime?: "run" } | { restore: string }; // opaque UUID reference
}
```

Its result is:

```ts
{
  outcome: "done" | "blocked" | "limit";
  output: {
    text: string;
    structured?: JsonValue;
    session?: { status: "retained"; reference: string }
      | { status: "unavailable"; reason: "not-cleanly-closed" | "missing-history" | "unsupported-history" | "capacity" };
  };
}
```

On the Run/1 wire and in the SDK, `run.call()` returns that complete result.
An Agent `blocked` or `limit` outcome is ordinary domain data, not an execution
error. A `done` call requesting `responseSchema` includes `output.structured`;
The consumer must check it against the requested schema before using it. The pure
`checkAgentResult(result, responseSchema)` helper supplies this check without
dispatch or authority. Jig validates the static invocation contract for every
implementation. The supplied ordinary methods also check the dynamic schema;
a consumer still checks independently when accepting a replacement.
An ordinary Flow offering the exact descriptor can replace the Agent through
a project default or explicit Binding route. Its own grants supply its powers; matching a
descriptor grants neither credentials nor network access. Supported optional
channels still require qualification by the selected implementation.
The optional `session` input requests native retention or restoration under a
separately reviewed grant. Its receipt appears only in the final invocation
output, after resource settlement; calls without a request omit it. The supplied
HTTP method rejects a session request before dispatch. See
[retaining a native conversation](#retaining-a-native-conversation).

## Continuing conversations

One-shot calls keep the input and result above. A conversational call adds
`conversation: true` and supplies both direct channels: `commands` (the Agent
receives) and `replies` (the Agent sends). Other pairings reject before native
dispatch. The supplied HTTP method does not support this mode and rejects it
before HTTP dispatch. A conversational native Binding grants `maxTurns` from
1 through 8; omission permits only one turn. One finite Agent invocation owns
the complete conversation, with unchanged root lifetime and aggregate limits.

Initial input starts turn 0. Later controls are ordinary channel values:

```json
{"type":"prompt","turn":1,"input":{"instructions":"Explain your recommendation."}}
{"type":"interrupt","turn":1}
{"type":"close","turn":1}
```

`prompt` requires the next sequential turn and no running turn. Its input is
the ordinary instructions, optional guidance and responseSchema; initial Skills
remain in the native conversation, not newly selected by a follow-up. `interrupt`
names the running turn. `close` requires the last settled turn. Controls are
not queued or replayed: busy, stale, duplicate interruption, exhausted allowance
and invalid prompt input receive a correlated `rejected` reply with a closed
code. A malformed channel value is an operation failure.
An invocation accepts at most 64 controls, including rejected controls; exceeding
that bound fails it. The prompt allowance is separately enforced by the host.

An `accepted` reply names `command` and `turn`; it acknowledges the control,
not native completion. Each turn separately produces one of:

- `{type:"result", turn, result}` with a complete ordinary Agent Run result;
- `{type:"cancelled", turn}` after native cancellation settlement; or
- `{type:"error", turn, code:"INVALID_RESULT", message}` when a settled answer
  cannot satisfy the requested structured result. A caller may issue another
  turn after that error; malformed ACP or uncertain native work is fatal instead.

Per-turn results contain the answer's `text` and optional `structured` value,
never a `session` receipt. Only the initial invocation input may request
retention or restoration; follow-up prompt inputs cannot change that request.

Replies are essential and fit the ordinary 64 KiB channel item bound. Oversized
results fail visibly rather than truncate. A reply blocked for five seconds
fails the conversation and settles its resource. Command EOF without an accepted
close fails; closing the command stream does not imply successful execution.
After sending `close`, the caller seals its command writer before awaiting the
invocation. The Agent waits at most five seconds for that clean EOF before
releasing its receiver; further controls after accepted close are invalid.
On accepted close, the invocation returns `{outcome:"done",output:{turns:N}}`
only after native cleanup. `N` counts all settled turns, including cancelled or
invalid answers; conversation completion does not imply every turn succeeded.
When the initial input requests a session, this final `output` also contains
the retention receipt defined below.

Optional public events add `turn` in conversational mode. They remain lossy
observation, never the source of turn-result or interruption acknowledgement.
Late native text/plan updates outside an active turn fail. Within a turn, native
ordering depends on the qualified client's ACP compliance; local turn labels
are not independent proof of native causality. All turn text and frame limits
remain cumulative across the invocation.

The live conversation stays within one invocation. Cross-Run restoration uses
the explicit session request below; neither path grants native workspace tools
or performs automatic handoff.

## Retaining a native conversation

The optional `session` field is exactly one of `{retain:true}`,
`{retain:true,lifetime:"run"}`, or
`{restore:reference}`, where `reference` is an opaque, canonical lowercase
36-character UUID returned by a previous
final invocation. The request applies to one-shot and conversational native
calls. Omission keeps the invocation ephemeral. Retention is a separately
reviewed native grant, `retainSessions:true`; a request or a reference never
grants this authority.

`retain` starts a new conversation and requests retention when it closes.
Omitting `lifetime` permits later authorized Runs to restore it. `lifetime:"run"`
restricts every reference in the chain to the current root Run, for temporary
work such as one evidence-driven repair correction. This lifetime spans child
and native-call settlement; it is not the lifetime of the individual Agent call.
`restore` consumes previously retained native state before starting the current
prompt, then requests a successor snapshot after this invocation settles.
It inherits the original lifetime; supplying a lifetime on restore is invalid.
Run-scoped state is inaccessible after the root ends and is deleted atomically
with its authoritative terminal, including cancellation and recovered termination.
Failed storage cleanup prevents terminal completion and must remain visible.
The current instructions, Skills and guidance supply the new prompt. The host
restores the native conversation; the Agent Flow relays metadata and does not
read native storage, replay a transcript or synthesize an earlier answer.

Only the final invocation output carries one of these closed receipts:

```ts
{ status: "retained", reference: "opaque-UUID" }
{ status: "unavailable", reason: "not-cleanly-closed" | "missing-history" | "unsupported-history" | "capacity" }
```

`retained` means that the final turn settled, the native client actually exited
cleanly, all owned execution was fenced, and bounded validated state was
collected, cleaned up and committed atomically. Accepted ACP close, a completed
answer, channel EOF or controlled termination alone cannot establish retention.
A successfully settled answer may therefore include an unavailable session receipt;
the answer remains valid under its ordinary result checks. An invocation error
does not return a usable successor reference.
The required reason distinguishes ineligible native exit, absent rollout,
unsupported collected history and exhausted retention capacity. It is not a
raw native error or information about another recipient's reference. Unexpected
collection, storage and cleanup failures remain errors; the exact host behavior
is defined in [Finite ACP](finite-acp.md#retained-native-state).

Restoration requires the current grant and the same protected project,
admitted recipient and ancestry, native slot, and exact provider/profile
identity. Changing the accepted package or configuration can invalidate access
to an earlier snapshot; a reference is identity, never permission. The host
claims a reference once before native startup. A used, expired, foreign or
unsupported reference fails visibly, with no fresh-conversation fallback or
automatic retry. Failure after a claim does not make the old reference reusable.

The initial host profile permits at most 16 available snapshots per project,
each at most 8 MiB. References expire logically after 24 hours; expired state is
pruned on the next store access, without promising automatic secure erasure.
Active execution ownership outlives snapshot expiry. Credentials, native tools
and arbitrary workspaces are outside retained state. Exact collection and
restore requirements belong to [Finite ACP](finite-acp.md#retained-native-state).

This is the synchronized source candidate contract. Installed-client
save-and-restore qualification and publication of matching artifacts are
separate requirements; the descriptor alone establishes neither.

## Structured-output profile

The alpha accepts one bounded recursive structured-output profile. Its root is
a nonempty closed object with the FLOW Schema/1 `$schema` identifier. Every
object:

- has `type: "object"`, 1–32 properties, and
  `additionalProperties: false`;
- lists every property exactly once in `required`, so optional fields are not
  part of this profile; and
- contains only values from this same recursive profile.

Values may be:

- another closed object;
- a homogeneous array with one `items` schema and a required integer
  `maxItems` from 0 through 256; `minItems` may additionally bound the lower
  end;
- a string, optionally restricted by a nonempty string `enum`;
- a JSON/1 safe integer; or
- a nullable string or safe integer, expressed by including `"null"` in its
  `type` array.

A nullable string enum includes `null` and at least one string in `enum`;
otherwise its `type` declaration and allowed values would disagree.

The canonical JSON/1 schema is limited to 256 KiB, eight schema levels including the root, 128
properties across all objects, and 256 enum members across all string enums.
Property names and enum strings together may contain at most 120,000 Unicode
characters; an enum with more than 250 members has a 15,000-character limit.
Descriptions may guide the provider but grant no authority. References,
definitions, applicators such as `anyOf`, free-form maps, optional properties,
booleans, non-integer numbers, and nullable objects or arrays are outside this
profile. Use an unstructured call for other result shapes. Unsupported schemas
fail before provider dispatch rather than being translated approximately.

`operationId` has the ordinary Run/1 meaning: use one stable identity for one
logical call. Reusing it with changed slot, input, intent, or channel mappings conflicts. Work
which may have been dispatched is fenced and reported honestly; Jig does not
silently send it again. Cancellation fences Jig's local provider worker, but
cannot retract a request which the remote provider has already accepted.

## Package-local skills

Each selected skill is an immediate package-local directory:

```text
skills/<name>/SKILL.md
skills/<name>/...optional supporting files...
```

The caller reads the selected files and passes their complete contents in
`skills`; names are not requests for the host to open files. The optional
`readPackageSkills(packageRoot, names)` library reader performs bounded reads
of explicit trees from the caller's package. Under Jig these are the caller's
captured source files. A caller may also supply constructed text: names and
paths describe that data, not independently host-attested provenance.

Skill names and file paths must be unique; every Skill contains `SKILL.md`.
The shared method sorts them by UTF-8 bytes. Skill files must be UTF-8 text.
Skills and guidance share 64 groups, 1,024 files/text items, and 1 MiB of
content including instructions. The rendered provider input has its own
1 MiB bound. Omission or `[]` supplies no Skills. Content grants no Flow,
filesystem, network, tool, or host authority.

`SKILL.md` and its supporting files are plain UTF-8 guidance. Jig does not
require frontmatter or define another skill metadata grammar.

## Exact ticket router

This Flow asks the Agent for one value from a closed enum, then calls the
matching exact Binding-local child slot:

```ts
import { handle, type JsonValue } from "@jigging/flow";
import { checkAgentResult } from "@jigging/agent-method";
import { readPackageSkills } from "@jigging/agent-method/skills";

type AgentResult = {
  readonly outcome: "done" | "blocked" | "limit";
  readonly output: { readonly text: string; readonly structured?: { readonly route: "billing" | "technical" } };
};

const routeSchema = {
  $schema: "https://flow.jig.md/schemas/schema-1.json",
  type: "object",
  properties: {
    route: { type: "string", enum: ["billing", "technical"] },
  },
  required: ["route"],
  additionalProperties: false,
} as const;

await handle(async (run) => {
  const agent = checkAgentResult(await run.call({
    operationId: "choose-route",
    slot: "agent",
    input: {
      instructions:
        `Choose billing or technical for this ticket: ${JSON.stringify(run.input)}`,
      skills: await readPackageSkills(new URL('./', import.meta.url), ['ticket-routing']),
      responseSchema: routeSchema,
    },
  }), routeSchema) as AgentResult;

  if (agent.outcome !== "done" || agent.output.structured === undefined) {
    return {
      outcome: "done",
      output: { routed: false, agent } as JsonValue,
    };
  }

  const child = await run.call({
    operationId: "dispatch-route",
    slot: agent.output.structured.route,
    input: run.input,
  });

  return {
    outcome: "done",
    output: { routed: true, agent, child } as JsonValue,
  };
});
```

The corresponding Binding fixes the only two children the Flow can call:

```ts
import { defineBinding } from "@jigging/jig";

export default defineBinding({
  package: "./flows/ticket-router",
  slots: {
    billing: "flow:flows/billing",
    technical: "flow:flows/technical",
  },
});
```

The model returns data, not authority. The response schema limits its answer
to `billing` or `technical`, and Jig resolves that name only through the
Binding's exact same-generation slots. Either child may use Agent Run itself.
A slot may instead name `binding:<id>` to invoke a specialist with that
Binding's own admitted settings and slots, within the bounded call tree below.
Parent settings, slots, and native authority are never inherited implicitly.

Each specialist selects Skills from its own admitted package for each Agent
call. A fresh call does not include the parent's or another specialist's
conversation unless the application explicitly passes that content as input.
Native restoration can access only the current recipient's authorized snapshot;
it does not inherit another specialist's conversation.
The operator selects the implementation and its grants. The caller does not
inherit the selected implementation's credentials or source files.

The root allows up to two sibling Flow calls or one exclusive effect; a child allows
one active Flow or effect, within the branch depth allowed by the
[aggregate reservation budget](project-policy.md). The root reserves each branch's resources before
dispatch, including its effect capacity. Parent cancellation
and the inherited deadline govern the child and its Agent worker; cleanup
must settle both before the parent result becomes terminal. As with root Agent
calls, cancelling local work cannot retract an already accepted remote request.

Exactly one child is a property of this example's completed path, not a new
host rule. A blocked or limited Agent result reaches no child, and another
Flow may make sequential calls or two parallel sibling calls within its admitted slots.

## Replaceable implementations

Two ordinary packages offer the same Agent Run contract:

- `@jigging/agent-method` prepares nonstreaming Chat Completions or Responses
  requests through an exact [HTTP grant](http-request.md).
- `@jigging/agent-acp` drives the finite ACP dialogue through an exact
  [native resource grant](finite-acp.md), including optional public updates.

A [default provider](project-sdk.md#default-providers-by-contract) or explicit Binding route
selects the package. Both execute as ordinary keyless, network-isolated Flows;
their granted resources hold credentials and enforce dispatch and lifetime.
Jig does not implement a hidden Agent method or fall back to another provider.

The HTTP package's settings choose its model, token cap, API format and strict
schema preference. The native package follows the resource's reviewed client
configuration. Settings guide method behavior; authority comes from the grant.
An operator requiring HTTP body restrictions against modified method code
uses the grant's `bodySchema`.

See [Choose an Agent](../guide/agents.md) for configuration and
[Finite ACP](finite-acp.md#native-client-profiles) for native installation,
authentication and containment limits. Review does not perform a remote
health check. A ready local plan does not assert model availability or quality.
