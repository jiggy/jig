# Jig Agent Run capability

**Status:** experimental alpha candidate.

Agent Run is one exact FLOW Capability Contract consumed through Run/1
`effect/call`. It does not add an Agent API to `@jigging/flow`, a provider
configuration field to Bindings, or a semantic router to Jig.

The canonical descriptor is
[`agent-run.capability.json`](https://jig.md/contracts/agent-run.capability.json):

```text
id       https://jig.md/contracts/agent-run
version  1.0.0
digest   sha256:5a0f06495323419d275eeff92617d9287647ece137dacc9c5c6d50466d65c0f0
method   run
```

An Agent-using Flow includes an exact package-local copy of those descriptor
bytes and refers to it from `FLOW.md`:

```yaml
---
name: ticket-router
description: Select and run one exact ticket handler.
uses:
  agent:
    contract: ./contracts/agent-run.capability.json
---
```

The slot name `agent` is local to this package. The alpha accepts at most one
capability use per package, and it must be this exact descriptor. Jig resolves
and admits its identity offline; the contract URI is not fetched at runtime.

## Calling the Agent

The contract has one method, `run`. Its input is:

```ts
{
  instructions: string;
  skills?: readonly string[];
  responseSchema?: JsonObject;
}
```

Its result is:

```ts
{
  outcome: "completed" | "blocked" | "limit";
  text: string;
  structured?: JsonValue;
}
```

On the Run/1 wire, a successful effect response is
`{ "value": <Agent result> }`. `@jigging/flow` unwraps that envelope, so
`run.callEffect()` resolves directly to the Agent result. A completed call
which requested `responseSchema` includes `structured`, and Jig validates that
value against the supplied FLOW Schema/1 schema before returning it.

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

The complete schema is limited to eight schema levels including the root, 128
properties across all objects, and 256 enum members across all string enums.
Property names and enum strings together may contain at most 120,000 Unicode
characters; an enum with more than 250 members has a 15,000-character limit.
Descriptions may guide the provider but grant no authority. References,
definitions, applicators such as `anyOf`, free-form maps, optional properties,
booleans, non-integer numbers, and nullable objects or arrays are outside this
profile. Use an unstructured call for other result shapes. Unsupported schemas
fail before provider dispatch rather than being translated approximately.

`operationId` has the ordinary Run/1 meaning: use one stable identity for one
logical call. Reusing it with changed slot, method, or input conflicts. Work
which may have been dispatched is fenced and reported honestly; Jig does not
silently send it again. Cancellation fences Jig's local provider worker, but
cannot retract a request which the remote provider has already accepted.

## Package-local skills

Each selected skill is an immediate package-local directory:

```text
skills/<name>/SKILL.md
skills/<name>/...optional supporting files...
```

`skills` contains unique LocalNames in ascending byte order. Jig projects only
the selected subtrees as fresh read-only guidance for that one Agent call. All
projected files must be UTF-8 text. Selection is limited to 64 skills, 1,024
files, and 1 MiB of file content; the complete rendered provider input also
has a 1 MiB bound. Omitting `skills`, or passing `[]`, selects none. A skill
grants no Flow, filesystem, network, tool, or host authority, and unselected
package files are not projected.

`SKILL.md` and its supporting files are plain UTF-8 guidance. Jig does not
require frontmatter or define another skill metadata grammar.

## Exact ticket router

This Flow asks the Agent for one value from a closed enum, then calls the
matching exact Binding-local child slot:

```ts
import { handle, type JsonValue } from "@jigging/flow";

type AgentResult = {
  readonly outcome: "completed" | "blocked" | "limit";
  readonly text: string;
  readonly structured?: { readonly route: "billing" | "technical" };
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
  const agent = await run.callEffect({
    operationId: "choose-route",
    slot: "agent",
    method: "run",
    input: {
      instructions:
        `Choose billing or technical for this ticket: ${JSON.stringify(run.input)}`,
      skills: ["ticket-routing"],
      responseSchema: routeSchema,
    },
  }) as AgentResult;

  if (agent.outcome !== "completed" || agent.structured === undefined) {
    return {
      outcome: "done",
      output: { routed: false, agent } as JsonValue,
    };
  }

  const child = await run.callFlow({
    operationId: "dispatch-route",
    slot: agent.structured.route,
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
    billing: "./flows/billing",
    technical: "./flows/technical",
  },
});
```

The model returns data, not authority. The response schema limits its answer
to `billing` or `technical`, and Jig resolves that name only through the
Binding's exact same-generation slots. The two children must be ordinary
capability-free direct Flow targets in this one-level alpha.

Exactly one child is a property of this example's completed path, not a new
host rule. A blocked or limited Agent result reaches no child, and another
Flow may make additional sequential calls within its admitted slots.

## Alpha host implementations

Every implementation below serves the same Agent Run contract. A Flow cannot
select a client, endpoint, model, executable, or credential. Those are trusted
host configuration used by both `jig check` and `jig run`.

With `JIG_AGENT_CLIENT` unset, Jig uses the official OpenAI JavaScript SDK for
one direct API call. The operator supplies:

| Variable | Meaning |
| --- | --- |
| `OPENAI_API_KEY` | Required secret presented to the selected endpoint |
| `OPENAI_MODEL` | Required endpoint-specific model identifier |
| `OPENAI_BASE_URL` | Optional HTTPS API root; defaults to `https://api.openai.com/v1` |
| `OPENAI_API` | Optional wire API: `responses` (default) or `chat-completions` |

The base URL cannot contain credentials, a query, or a fragment. Jig supplies
no default model. The API, endpoint, and model are reviewed provider identity;
the key is not. `responses` uses the SDK's non-streaming Responses call.
`chat-completions` uses its non-streaming Chat Completions call. When the Agent
asks for structured data, the endpoint must accept the strict JSON Schema
request shape used by the selected API. Compatibility here means that the
endpoint implements this bounded request and response subset; it is not a
claim of complete OpenAI API compatibility. Jig disables SDK retries and
normalizes only one bounded final response.

An OpenRouter endpoint can be selected with the same variables when it
implements the selected subset. A direct Mistral endpoint uses those same
variables with `OPENAI_API=chat-completions`. Neither has a separate Jig
interface, credential name, provider object, or default model.

Native Agent clients use one private Agent Client Protocol (ACP) mechanism.
Each client contributes only the configuration needed to launch its own ACP
adapter:

| Client | Host selection | Subscription configuration | API configuration |
| --- | --- | --- | --- |
| Codex | `JIG_AGENT_CLIENT=codex`, `CODEX_PATH` | Existing `CODEX_HOME` (or `~/.codex`) authentication; optional `CODEX_MODEL`, with omission retaining the client default | `OPENAI_API_KEY` and `OPENAI_MODEL`; optional `OPENAI_BASE_URL`; `OPENAI_API` must be omitted or `responses` |
| Claude Code | `JIG_AGENT_CLIENT=claude`, `CLAUDE_PATH` | `CLAUDE_CODE_OAUTH_TOKEN`; optional `CLAUDE_MODEL` | Exactly one of `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, plus `ANTHROPIC_MODEL`; optional `ANTHROPIC_BASE_URL` |
| Pi | `JIG_AGENT_CLIENT=pi`, `PI_PATH` | `PI_PROVIDER` and `PI_MODEL`; authentication from `PI_CODING_AGENT_DIR/auth.json` or `~/.pi/agent/auth.json` | `PI_PROVIDER`, `PI_MODEL`, and `PI_API_KEY`, using a provider implemented by Pi |

The current Pi profile accepts the official self-contained Linux x64 Pi
0.84.4 release layout. It does not interpret the multi-file npm installation
or make Node part of Jig's runtime closure.

Native Codex's API-key path is Responses-compatible only; selecting
`chat-completions` fails closed. Claude Code uses its Anthropic-compatible API
path. `ANTHROPIC_API_KEY` selects API-key authentication;
`ANTHROPIC_AUTH_TOKEN` selects bearer-token authentication, with the API-key
channel explicitly blanked inside the client process. Supplying both nonempty
credentials is ambiguous and fails closed. Pi delegates an API-key selection
to the exact built-in provider named by `PI_PROVIDER`; Jig does not add an
endpoint or provider registry. Pi
subscription support is currently bounded to its `anthropic` and
`openai-codex` providers. No native profile hard-codes a production model.

Jig reads native credentials in trusted host code and gives the contained
client only the bounded credential projection needed for one provider
lifetime. Credential sources are not mounted. The selected non-secret client,
API, endpoint, model, and exact executable/support identities enter provider
identity and the reviewed Plan; secrets do not. Changing non-secret behavior
requires another `jig check` and approval, while rotating only the selected
credential does not.

The Flow remains in its ordinary network-isolated, keyless sandbox. Direct API
work and native ACP clients run in separate bounded scopes with inherited
network access. Each native client starts in an empty work directory. Jig's ACP
peer advertises no filesystem, terminal, or MCP client capability, supplies no
MCP servers, and rejects permission requests. The fixed client profiles also
disable their tool, extension, plugin, and native-skill surfaces. Selected
FLOW skills are rendered into the call instructions as bounded read-only text;
they are not exposed as a client filesystem or native skill installation.

These workers have ordinary inherited network access rather than
endpoint-filtered egress; their exact trusted bytes and configuration, not a
network-policy framework, limit what they do. A direct Responses call asks for
`store: false`; the Chat Completions path makes no equivalent retention claim,
and neither setting is a promise about an endpoint's retention or training
policy.

If the selected client, executable support, credential, or model is missing or
invalid, checking an Agent-bearing target reports it unavailable. A
capability-free target in an already admitted generation remains runnable
because its recipe does not depend on the Agent implementation.

`jig check` authenticates and admits the selected local configuration. It does
not send a remote health-check request, so `ready` does not assert that a model
endpoint is currently reachable or accepting requests.

Root `jig run --timeout DURATION` bounds the complete sequence, including the
Agent call and any selected child. The default is 30 seconds and the maximum
is 24 hours; neither an API worker, native client, nor child can extend the
root's absolute deadline. Cancellation fences Jig's complete local Agent
scope, though it cannot retract a remote request already accepted.

There is no public provider registry or SPI, package-selected provider profile,
model selector, semantic catalogue, `SemanticChoice`, Agent session,
Agent-authored Flow identity, or general routing framework.
