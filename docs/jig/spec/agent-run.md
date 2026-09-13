# Jig Agent Run capability

**Status:** experimental alpha candidate.

Agent Run is one exact FLOW Capability Contract consumed through Run/1
`capability/call`. It does not add an Agent API to `@jigging/flow`, a provider
configuration field to Bindings, or a semantic router to Jig.

The canonical descriptor is
[`agent-run.capability.json`](https://jig.md/contracts/agent-run.capability.json):

```text
id       https://jig.md/contracts/agent-run
version  1.0.0
digest   sha256:5e7df4408fd1f6aebf7e1269573a10ff87c7374248a51dacb63cd1c9c97e2b56
method   run
```

An Agent-using Flow includes an exact package-local copy of those descriptor
bytes and the referenced `contracts/acp-public-updates.json` descriptor. The
latter defines the method's optional named output channel. Refer to Agent Run
from `FLOW.md`:

```yaml
---
name: ticket-router
description: Select and run one exact ticket handler.
uses:
  agent:
    contract: ./contracts/agent-run.capability.json
---
```

The slot name `agent` is local to this package. A package may declare one slot
for each supported capability: Agent Run, [Project Command](project-command.md),
and [Run Checkpoint](run-checkpoint.md). Each requires its exact descriptor and
its own eligibility conditions: Project Command needs reviewed Binding command
policy, and Run Checkpoint requires a root writable attachment and output owner.
Jig resolves and admits these identities offline; contract URIs are not fetched
at runtime. Declarations do not grant additional concurrent worker capacity.

## Calling the Agent

The optional `events` send channel carries the exact
[ACP public updates](../contracts/acp-public-updates.md) profile through supported
native clients, with direct or isolated-broadcast delivery. It adds no session
control and does not replace the final result. API clients remain one-shot;
requested unsupported channels reject before dispatch. See [channels](channels.md)
for ownership, buffering and installed output.

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
`run.callCapability()` resolves directly to the Agent result. A completed call
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
  const agent = await run.callCapability({
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

  const child = await run.runChildFlow({
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
    billing: "flow:flows/billing",
    technical: "flow:flows/technical",
  },
});
```

The model returns data, not authority. The response schema limits its answer
to `billing` or `technical`, and Jig resolves that name only through the
Binding's exact same-generation slots. Either child may use Agent Run itself.
A slot may instead name `binding:<id>` to invoke a specialist with that
Binding's own admitted settings. Selected child Bindings must have no child
slots; parent settings, slots, and capabilities are never inherited implicitly.

Each specialist selects Skills from its own admitted package for each Agent
call. A fresh call does not include the parent's or another specialist's
conversation unless the application explicitly passes that content as input.
Provider selection and credentials remain host-owned; no new Skill or provider
configuration field is added to Bindings.

The root allows two sibling Flow calls or one exclusive effect; a leaf allows
one Agent or command effect. The root reserves each branch's resources before
dispatch, including its effect capacity. Parent cancellation
and the inherited deadline govern the child and its Agent worker; cleanup
must settle both before the parent result becomes terminal. As with root Agent
calls, cancelling local work cannot retract an already accepted remote request.

Exactly one child is a property of this example's completed path, not a new
host rule. A blocked or limited Agent result reaches no child, and another
Flow may make sequential calls or two parallel sibling calls within its admitted slots.

## Alpha host implementations

Every implementation below serves the same Agent Run contract. A Flow cannot
select a client, endpoint, model, executable, or credential. Those are trusted
host configuration used by both `jig review` and `jig run`.

The installed CLI selects the Agent in this order: an explicit
`JIG_AGENT_CLIENT` (`codex`, `claude`, `pi`, or `api`), then the operator's
remembered choice for the canonical project directory. Credentials alone
never select a client. With neither selection, interactive `jig review`
prompts only when a captured target uses Agent Run, before dependency
preparation. Unavailable clients are explained but cannot be selected.
An empty answer, end of input, or interruption does not select a default.
Noninteractive review requires an explicit or remembered choice; `--yes`
authorizes approval, not client selection. Run and recovery never prompt.

The chooser checks local configuration and runtime support without issuing
model requests. It distinguishes native live updates from API final results;
it does not claim remote readiness. Existing Agent Run declarations make
updates optional and do not establish whether Flow code will request them.
Do not infer that requirement from code text or an application output channel.
No additional Flow metadata or authoring interface is required for selection.

A prompted choice is remembered immediately as operator preference, separately
from approval. The installed CLI stores only the client name under
`$XDG_STATE_HOME/jig/agent-choices` (default `~/.local/state/jig/agent-choices`),
keyed by canonical project directory. State must be operator-owned and outside
the project; credentials, model configuration and consent are not stored there.
A failed or declined review can leave this preference, but cannot grant Run
authority. Explicit selection overrides the preference without rewriting it.
A missing or invalid selected client never silently falls back to another.
Changing provider identity still requires ordinary review.

Selecting `api` uses the official OpenAI JavaScript SDK for one direct API
call. For any compatible endpoint, the operator may supply:

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
variables with `OPENAI_API=chat-completions`. Compatible endpoints do not create
a separate provider object or default model.

As a convenience for OpenRouter's fixed endpoint, Jig also accepts the natural
`OPENROUTER_API_KEY` and `OPENROUTER_MODEL` pair after selecting `api`. It selects
`https://openrouter.ai/api/v1` using Chat Completions. Combining that pair with
`OPENAI_*` is ambiguous and unavailable. The natural names and the equivalent
generic endpoint configuration produce the same reviewed provider identity.

Native Agent clients use one private Agent Client Protocol (ACP) mechanism.
Each client contributes only the configuration needed to launch its own ACP
adapter:

| Client | Host selection | Subscription configuration | API configuration |
| --- | --- | --- | --- |
| Codex | `JIG_AGENT_CLIENT=codex`; optional absolute `CODEX_PATH` | Operator-owned, file-backed `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`), created by `codex login`; optional `CODEX_MODEL`, with omission retaining the client default | `OPENAI_API_KEY` and `OPENAI_MODEL`; optional `OPENAI_BASE_URL`; `OPENAI_API` must be omitted or `responses` |
| Claude Code | `JIG_AGENT_CLIENT=claude`; optional absolute `CLAUDE_PATH` | `CLAUDE_CODE_OAUTH_TOKEN`; optional `CLAUDE_MODEL` | Exactly one of `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, plus `ANTHROPIC_MODEL`; optional `ANTHROPIC_BASE_URL` |
| Pi | `JIG_AGENT_CLIENT=pi`; optional absolute `PI_PATH` | `PI_PROVIDER` and `PI_MODEL`; authentication from `PI_CODING_AGENT_DIR/auth.json` or `~/.pi/agent/auth.json` | `PI_PROVIDER`, `PI_MODEL`, and `PI_API_KEY`, using a provider implemented by Pi |

The current Pi profile accepts the official self-contained Linux x64 Pi
0.84.4 release layout. It does not interpret the multi-file npm installation
or make Node part of Jig's runtime closure.

Jig snapshots the operator environment before loading project code. An explicit
`CODEX_PATH`, `CLAUDE_PATH`, or `PI_PATH` selects that client's executable and
must be an absolute path; an invalid override fails without fallback. Otherwise,
Jig searches the operator's `PATH` in order for `codex`, `claude`, or `pi`.
Empty and relative entries are ignored. Implicit discovery excludes the project
tree and ancestor `node_modules` directories, including symlink routes through
those locations. Operator-managed symlinks are supported. Shell aliases are not
executables, and discovery does not make shell wrappers or JavaScript launchers
supported native clients.

The selected regular executable and client-specific support files receive the
same validation and identity checks with either selection method. Invalid client
support fails without trying another installation. Review shows
the native client and its resolved operator executable path. Launch uses the
resolved executable checked against admitted provider identity, without repeating
host PATH discovery. A changed selection cannot silently replace reviewed
executable or support bytes.

All three native adapters inspect Linux x86-64 ELF executables. Codex and
Claude Code also accept the declarative `makeBinaryWrapper` form which preserves
arguments and prefixes PATH; Pi requires its unwrapped standalone executable.
Arbitrary shell/JavaScript wrappers, wrapper flags or environment changes, and nested
wrappers are unsupported. Jig reads installation metadata without executing the
client during review. It retains the wrapped executable, ELF interpreter, and
transitive shared libraries as individual regular files at their installation
paths. Library resolution uses ELF RUNPATH/RPATH, `$ORIGIN`, the selected
interpreter’s directory (including its canonical location), and supported Linux
loader locations; it does not import ambient loader variables or whole runtime
directories. Missing, malformed, project-selected, or unsupported dependencies
fail closed. Each executable's runtime dependency walk is bounded to 128 file
destinations. Pi's matching manifest and themes remain beside its native
executable and cannot be selected through the project tree. Bun's private loader
settings are removed before each native client starts, so its libraries use
the reviewed installation's ABI.

For Codex's nested sandbox, Jig selects the first eligible unprivileged `bwrap`
from the wrapper's declared PATH prefix followed by operator PATH, with the
same project and dependency-directory exclusions as client discovery. With no
eligible helper, it selects the installation's matching `codex-resources/bwrap`
beside the executable directory or its parent. A PATH-selected helper is never
substituted at the vendor bundle path. `JIG_BWRAP_PATH` selects only Jig's outer
containment tool. Executable, wrapper, helper, shared-library bytes, and their
contained paths enter provider identity and are revalidated before launch.
A bundled fallback stays off PATH so Codex applies its vendor integrity check.
For a PATH-selected helper, only its directory enters the initial contained
PATH; other operator PATH entries do not become filesystem authority.

Subscription mode requires Codex's `cli_auth_credentials_store = "file"`
setting. Jig reads the current operator's file during review and Run, validates
it, discards its refresh token, and gives the contained client only a
short-lived non-refreshable bearer. It never embeds a development credential
or mounts the operator's `CODEX_HOME`. A keyring-backed login is unavailable
because the Agent process receives no host credential-store authority.

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
requires another `jig review` and approval, while rotating only the selected
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
invalid, reviewing an Agent-bearing target reports it unavailable. A
capability-free target in an already admitted generation remains runnable
because its recipe does not depend on the Agent implementation.

`jig review` authenticates and admits the selected local configuration. It does
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
