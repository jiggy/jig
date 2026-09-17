# Reusable Agent method

`@jigging/agent-method` prepares one bounded Agent request and interprets its
result. The same implementation is available as a pure library and as an
ordinary FLOW package. The complete archive contains runnable output, source,
types, contracts, selected method guidance and licenses, with no runtime npm
dependencies or installation hooks.

This is a source candidate. Build an archive from the revision you reviewed;
this README does not assert registry publication.

## Choose how to use it

| Entry | Guidance source | Invocation |
| --- | --- | --- |
| Pure library | Explicit input and Skill text supplied by its caller | In the caller's existing process |
| Ordinary `FLOW.ts` | Explicit caller Skill contents and guidance | One Run/1 invocation and one granted HTTP request |
| Ordinary ACP Agent package | The same explicit Skill contents and guidance | Separate Flow using this library and a finite native resource |

The ordinary Flow offers the exact Agent Run contract. Its result does not
attest caller context. A root can call the Agent Flow directly or through a specialist's
ordinary slot. Each uses its own Binding and grants. The specialist → Agent
branch reserves both child levels. Two such branches fit Jig's fixed aggregate
resource budget; a third is rejected rather than queued.

## Pure library

```ts
import { prepareAgent, finishAgent } from '@jigging/agent-method'

const prepared = prepareAgent({
  instructions: 'Summarize this observation.',
  guidance: [{ label: 'observation', text: 'The second measurement was lower.' }],
})

// Your implementation supplies bounded transport facts.
const response = await yourTransport(prepared.request)
const result = finishAgent(prepared, response)
```

`yourTransport` is application code, not an implicit Jig service. This package's
HTTP implementation and `@jigging/agent-acp` show concrete granted transports.
Your host supplies authorized execution. Neither library function calls a
provider, reads files, chooses credentials or grants authority.

Public exports are:

```ts
prepareAgent(input: AgentInput, selectedSkills?: readonly SkillText[]): PreparedAgent
finishAgent(prepared: PreparedAgent, result: unknown): AgentResult
checkAgentResult(result: unknown, responseSchema?: JsonObject): AgentResult
assertResponseSchema(schema: JsonObject): void
projectResponseSchema(schema: JsonObject): JsonObject
```

The package also exports `AgentMethodError`, `AgentMethodErrorCode`, and the
`AgentInput`, `AgentCallInput`, `AgentSessionRequest`, `AgentSessionReceipt`,
`SkillText`, `PreparedAgent`, `AgentResult`, `AgentTransportInput`,
`AgentTransportResult`, `JsonObject`, and `JsonValue` types.

`AgentInput` is
`{ instructions, guidance?: [{ label, text }], responseSchema?, session? }`.
`AgentSessionRequest` is `{ retain: true } | { restore: string }`, with an opaque
UUID reference for restoration. It requests native state handling from a
compatible implementation under its current grant; it confers no authority.
Selected `SkillText` values are `{ name, files: [{ path, text }] }`; every Skill
requires `SKILL.md`. Names use lowercase letters, digits and separating hyphens,
up to 64 characters. Paths are relative to the selected Skill, with no empty,
`.` or `..` components, backslashes or NULs.

Preparation snapshots the input and returns frozen ordinary data:
`{ request: { prompt, responseSchema? }, session? }`. Session metadata remains
outside `request` and is never rendered into the prompt. The data can be
inspected, serialized, cloned and adapted; finishing validates it again. It is
not an authorization token. `projectResponseSchema` returns a fresh copy with only
the root FLOW `$schema` removed for a provider's structured-output API.

The transport supplies `{ outcome: 'done', output: { text, stop } }`, where `stop`
is `end-turn`, `refusal` or `limit`. Finishing returns
`{ outcome: 'done' | 'blocked' | 'limit', output: { text, structured? } }`.
With a response schema, a completed answer must contain valid matching JSON.
One complete `json` Markdown fence is accepted, as is raw JSON; surrounding
prose, duplicate members and malformed JSON reject. For blocked or limited
answers, non-JSON text is retained without `structured`. If such an answer
does contain JSON, that value must still match the requested schema.

`finishAgent` returns only the interpreted answer; it never manufactures a
session receipt. A selected native Agent Flow can add `output.session` after
its resource settles. `AgentSessionReceipt` is
`{ status: 'retained', reference: string } | { status: 'unavailable', reason }`.
The closed reasons are `not-cleanly-closed`, `missing-history`, `unsupported-history`
and `capacity`; they describe retention, not answer quality.
`checkAgentResult` validates that optional receipt's closed shape and UUID
alongside the answer, but does not access storage or establish host authority.

Invalid inputs and prepared values throw `AgentMethodError('INVALID_INPUT')`;
explicit method bounds use `RESOURCE_EXHAUSTED`; invalid transport facts or
structured answers use `INVALID_RESULT`. Operational transport failures remain
failures and are never converted to a domain outcome or retried.

## Conversation caller

The optional `@jigging/agent-method/conversation` export manages a continuing
Agent call using the public FLOW SDK and Agent Run contract. It works with a
compatible selected Agent; the HTTP implementation in this package remains
one-shot. It introduces no host service or additional authority.

```ts
import { withAgentConversation } from '@jigging/agent-method/conversation'

const completed = await withAgentConversation(run, {
  operationId: 'incident-brief', slot: 'agent',
  contractDirectory: './contracts/agent-run',
  input: { instructions: 'Draft a brief from the supplied incident facts.' },
}, async conversation => {
  const draft = await conversation.initial
  if (draft.type !== 'result' || draft.result.outcome !== 'done') return draft
  return await conversation.prompt({ instructions: 'Revise: the outage lasted 48 minutes.' })
})
```

The caller declares the ordinary Agent slot and includes its unchanged contract
bundle at `contractDirectory`. The result contains the callback's `value`, all
received `turns`, and the actual invocation `settlement`. The helper closes the
settled conversation and awaits owned invocation completion before returning.
It does not judge answer quality. `initial` and `prompt()` resolve to a
`result`, `cancelled`, or `error` turn; domain outcomes remain explicit data.

To request native retention or restoration, supply `session` in the initial
`input`. Its receipt appears only in `completed.settlement.output.session`,
after resource settlement, never in `turns`. Follow-up
`prompt(input: Omit<AgentInput, 'session'>)` supplies new instructions, optional
guidance and a response schema; it cannot change the invocation's session
request. The selected implementation and reviewed native grant must support it.

`interrupt()` resolves to `accepted` or `not-running`; await the active turn to
learn whether native cancellation or ordinary completion won. Concurrent prompts
are rejected, never queued. A callback that leaves a live turn unfinished fails
and closes its command channel; the helper still waits for the invocation's
actual settlement. It never cancels that local waiter to manufacture cleanup.
Root cancellation remains fatal to the Run.

`AgentConversationError` retains `turns`, any known `settlement`, and primary
and cleanup `errors`. Catch it normally to retain partial work, not to infer
successful cleanup from a missing settlement. Optional `events` accepts a
caller-created update writer; filtering and presentation remain caller-owned.
See the [conversation guide](https://jig.md/guide/conversations) for grants,
control semantics, and the raw channel interface.

## Ordinary Flow and explicit Skills

The root `FLOW.ts` runs the bundled method through Run/1. Its input adds
`skills?: SkillText[]` to the shared input. This HTTP implementation rejects any
`session` field, conversational mode and requested channels before HTTP
dispatch. Omitted Skills supply none. For example:

```json
{
  "instructions": "Explain a way to check an assumption.",
  "skills": [{ "name": "answer-check", "files": [{ "path": "SKILL.md", "text": "Check the answer against supplied evidence." }] }]
}
```

Names and paths describe explicit data; they do not cause host file reads or
attest provenance. The optional reader below loads selected package-local
trees. The included `answer-check` Skill is a small editable example. Model
choice belongs in reviewed Binding settings.

An ordinary caller should pass the requested schema to `checkAgentResult`
before relying on a replacement's structured result. This pure check validates
the result envelope and dynamic data; it cannot establish semantic correctness.

For a package extracted at `flows/agent`, configure one Binding:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/agent',
  settings: { model: 'your-model', maxCompletionTokens: 4096 },
  slots: {
    http: {
      kind: 'http',
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      bearerEnv: 'OPENAI_API_KEY',
    },
  },
})
```

Name it `bindings/agent.ts`, include that Binding and Flow in `jig.ts`, then
`jig review` and `jig run binding:agent --input @task.json`. The operator supplies
the named credential through their environment. The Flow receives neither its
value nor network access. This path needs no native Agent configuration.
`settings.schema.json` requires a nonempty model; `maxCompletionTokens` defaults
to 4096 and accepts 1–65536. A grant's optional `bodySchema` can enforce model and
token restrictions outside the method; settings alone do not constrain malicious
code. Review the exact endpoint and its data policy before granting access.

Extract the complete archive into a real project directory, then add that
directory using ordinary Flow membership. An explicit installed real directory
can also be used where the host accepts it; package-manager symlinks still
receive that host's ordinary symlink rules. Running the packed `FLOW.ts` needs
no consumer build or registry dependency resolution.

This Flow makes one non-streaming text-only request using the configured API.
The exact endpoint remains in the HTTP grant; `api` changes only the request
and response format, never the destination or permissions.

| Setting | Values and default | Meaning |
| --- | --- | --- |
| `api` | `chat-completions` (default), `responses` | Select the wire API matching the granted endpoint. |
| `structuredOutput` | `prompt` (default), `json-schema` | Request a supplied `responseSchema` through prompt guidance alone or through the provider's strict schema format as well. |
| `maxCompletionTokens` | 1–65536; default 4096 | Bound generated tokens using the selected API's token field. |

[Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
uses `max_completion_tokens`, one choice, and optional `response_format.json_schema`.
Responses uses `max_output_tokens` and optional `text.format`; both strict schema
forms set `strict: true`. Those are the provider's
[structured-output formats](https://developers.openai.com/api/docs/guides/structured-outputs).
For example, select a Responses endpoint and strict output in the same Binding:

```ts
settings: { model: 'your-model', api: 'responses', structuredOutput: 'json-schema' },
slots: {
  http: {
    kind: 'http', method: 'POST',
    url: 'https://api.openai.com/v1/responses', bearerEnv: 'OPENAI_API_KEY',
  },
},
```

Both APIs request `store: false`, omit tools, and validate structured answers
locally. Strict output requires support from the selected endpoint and model;
rejection is a failure, never a retry in prompt mode. Without a supplied
`responseSchema`, either setting requests ordinary text. Settings guide the
method; the grant enforces any required body restrictions.

Only settled responses are accepted. Chat requires one complete choice;
Responses accepts assistant text/refusals and ignores reasoning metadata.
Tool requests, asynchronous or failed responses, unknown termination reasons,
malformed replies and non-200 HTTP statuses fail without echoing provider error
bodies. Refusal and explicit token exhaustion remain `blocked` and `limit`
outcomes. No request is retried, including after cancellation or uncertain dispatch.

The exact Agent Run contract declares optional updates. This HTTP implementation
rejects a requested channel before dispatch; it supplies no streaming or ACP
updates. Native clients remain available for those features.
HTTP grants default to a 256 KiB canonical request and 1 MiB response. Larger
requests and answers require explicit `requestBytes` / `responseBytes` policy,
up to 8 MiB / 12 MiB. The Flow requests `response: 'json'` and interprets the
decoded API value, avoiding an extra JSON-string wrapper around large answers.
The shared 1 MiB rendered prompt, 8 MiB answer text and JSON/1 complete-value
bounds remain unchanged. Each request stays within the grant's timeout (at most
60 seconds) and enclosing deadline. Oversized values fail rather than being
clipped. Caller-supplied context is not host-attested provenance.

The separate filesystem export is:

```ts
import { readPackageSkills } from '@jigging/agent-method/skills'

const selected = await readPackageSkills(new URL('./', import.meta.url), ['answer-check'])
```

Place that literal URL in the caller's package-root module; the reader never infers a root
from `dist/` or the process working directory. Supply a `file:` directory URL
ending with `/`. Selected trees must contain only real directories and regular
UTF-8 files, with no symlinks anywhere in their directory paths. Reads check
file identity and size; callers should supply an immutable package. This is a
bounded source reader, not an authenticated filesystem or admission boundary.
Traversal is bounded to 4,096 entries and 4,096 bytes per relative file path.

## Bounds and structured output

Selected Skills sort by unsigned UTF-8 bytes, as do their file paths. Duplicate
Skill names or paths reject. Plain guidance preserves its explicit sequence
and requires unique nonempty labels. Labels occupy a separate namespace from
Skills and are ordinary data, not provenance or permission.

Skills plus guidance share 64 groups and 1,024 files/text items. Their UTF-8
content plus instructions is bounded to 1 MiB. The rendered prompt, including
JSON escaping, labels, paths and schema instructions, has a separate 1 MiB
bound. Oversized content is rejected rather than truncated.

The schema profile requires the root declaration
`https://flow.jig.md/schemas/schema-1.json` and a nonempty closed object with
every property required. Nested nodes support closed objects, bounded arrays,
strings and safe integers; only string/integer nodes can be nullable. String
enums are supported. Booleans, numbers, references, optional properties and
open objects are outside this deliberate profile. Optional descriptions are
accepted. Limits are 256 KiB canonical schema bytes, depth 8, 32 properties per
object, 128 total properties, 256 array items, 256 total enum values and 120,000
property-name/enum Unicode scalar values. Enums with over 250 values are limited
to 15,000 string scalar values. Nullable string enums contain both null and at
least one string. JSON/1's finite safe-number, Unicode, duplicate-member and
absolute value bounds apply throughout.

## Build and adapt

In the repository, install workspace dependencies at the root, build the FLOW
SDK first (`just flow::build`), then run `just agent::build`. The package recipe
builds only this package. Supported development inputs are Bun 1.3.3,
TypeScript 7.0.2, Node types 24.13.3 and Just 1.43.1 or newer.

To adapt extracted source, run `bun install --ignore-scripts`, then `just build`.
Bun packs workspace references as ordinary versioned development dependencies.
Retain the generated Bun lock for reproducible local development. The packed
library and runtime use Node-compatible ESM and need no development installation.

Change `src/index.ts` for prompt preparation or interpretation,
`src/schema.ts` for schema checking, or `skills/` for package guidance.
Run `just test`, then `just pack --destination <directory>`. Review and adopt
the complete artifact under your host's normal source rules. The rebuilt
`dist/flow.js` is what the root entrypoint executes.

The pack recipe builds first and calls Bun's ordinary packer. To pack existing
output, use `bun pm pack --ignore-scripts --destination <directory>`. Neither
path publishes, mutates source manifests or embeds dependency archives.
Rebuilding extracted source requires its declared dependency versions to be
available; unpublished development uses ordinary source workspaces.

Tests cover preparation/results, JSON/1 bounds, package reads, ordinary Flow
wiring, source inclusion, dependency versions and standalone runtime imports.
They do not establish provider quality, real-client compatibility or containment.

MPL-2.0 covers this package and its adapted Jig algorithms. The bundled FLOW
SDK is Apache-2.0; see `LICENSE`, `THIRD_PARTY_NOTICES` and
`licenses/flow.LICENSE` for the corresponding notices.
