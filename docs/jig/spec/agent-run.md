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
digest   sha256:6372b2fce7854fccafe9fd079a79a27e504fc26a9d4e62027ee0b3d79b3df5f5
```

An Agent-using Flow includes an exact package-local copy of those descriptor
bytes and the referenced `contracts/acp-public-updates.json` descriptor. The
latter defines optional public updates. The bundle also includes direct
`agent-commands.json` and `agent-replies.json` channel contracts for conversational
use. Copy the complete
`agent-run/` bundle, preserving its descriptor-relative `contracts/` directory.
Declare the slot in a code Flow's optional `flow.meta.json`:

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
}
```

Its result is:

```ts
{
  outcome: "done" | "blocked" | "limit";
  output: { text: string; structured?: JsonValue };
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

Optional public events add `turn` in conversational mode. They remain lossy
observation, never the source of turn-result or interruption acknowledgement.
Late native text/plan updates outside an active turn fail. Within a turn, native
ordering depends on the qualified client's ACP compliance; local turn labels
are not independent proof of native causality. All turn text and frame limits
remain cumulative across the invocation.

This mode does not retain sessions across Runs, restore native history, expose
workspace tools or perform automatic handoff. Those require separate contracts.

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
The operator selects the implementation and its grants. The caller does not
inherit the selected implementation's credentials or source files.

The root allows up to two sibling Flow calls or one exclusive effect; a child allows
one active Flow or effect, within two child Flow levels and the
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
