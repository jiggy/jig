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
| Jig native Agent Run | The same explicit Skill contents and guidance | Native client integration using this library |

The ordinary Flow offers the exact Agent Run contract. Its result does not
attest caller context. A root can call the Agent Flow directly or through a specialist's
ordinary slot. Each uses its own Binding and grants. The specialist → Agent
branch reserves both child levels and excludes a concurrent second branch
under Jig's fixed aggregate resource budget. Two direct Agent siblings still fit.

## Pure library

```ts
import { prepareAgent, finishAgent } from '@jigging/agent-method'

const prepared = prepareAgent({
  instructions: 'Summarize this observation.',
  guidance: [{ label: 'observation', text: 'The second measurement was lower.' }],
})

// Inside an existing Run handler with the exact Exchange dependency:
const exchange = await run.call({
  operationId: 'summarize',
  slot: 'exchange',
  input: { ...prepared.request },
})
const result = finishAgent(prepared, exchange)
```

Declare the package's `contracts/agent-exchange/contract.json` as the `exchange`
dependency in the caller's `flow.meta.json`; include its channel closure too.
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
`AgentInput`, `AgentCallInput`, `SkillText`, `PreparedAgent`, `AgentResult`, `ExchangeInput`,
`ExchangeResult`, `JsonObject`, and `JsonValue` types.

`AgentInput` is `{ instructions, guidance?: [{ label, text }], responseSchema? }`.
Selected `SkillText` values are `{ name, files: [{ path, text }] }`; every Skill
requires `SKILL.md`. Names use lowercase letters, digits and separating hyphens,
up to 64 characters. Paths are relative to the selected Skill, with no empty,
`.` or `..` components, backslashes or NULs.

Preparation snapshots the input and returns frozen ordinary data:
`{ request: { prompt, responseSchema? } }`. It can be inspected, serialized,
cloned and adapted; finishing validates that data again. It is not an
authorization token. `projectResponseSchema` returns a fresh copy with only
the root FLOW `$schema` removed for a provider's structured-output API.

Exchange returns `{ outcome: 'done', output: { text, stop } }`, where `stop`
is `end-turn`, `refusal` or `limit`. Finishing returns
`{ outcome: 'done' | 'blocked' | 'limit', output: { text, structured? } }`.
With a response schema, a completed answer must contain valid matching JSON.
One complete `json` Markdown fence is accepted, as is raw JSON; surrounding
prose, duplicate members and malformed JSON reject. For blocked or limited
answers, non-JSON text is retained without `structured`. If such an answer
does contain JSON, that value must still match the requested schema.

Invalid inputs and prepared values throw `AgentMethodError('INVALID_INPUT')`;
explicit method bounds use `RESOURCE_EXHAUSTED`; invalid Exchange facts or
structured answers use `INVALID_RESULT`. Operational Exchange failures remain
failures and are never converted to a domain outcome or retried.

## Ordinary Flow and explicit Skills

The root `FLOW.ts` runs the bundled method through Run/1. Its input adds
`skills?: SkillText[]` to `AgentInput`. Omission supplies none. For example:

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

This Flow implements the non-streaming text-only
[Chat Completions wire API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
It requests one completion with an explicit token cap and `store: false`, without
tools. Structured output is requested in the prompt and checked locally, not
claimed to be enforced by every compatible endpoint. It accepts only a complete
single-choice response; tool requests, malformed replies and non-200 HTTP statuses
fail. Refusal and token exhaustion remain `blocked` and `limit` outcomes. No request
is retried, including after cancellation or uncertain dispatch.

The exact Agent Run contract declares optional updates. This HTTP implementation
rejects a requested channel before dispatch; it supplies no streaming or ACP
updates. Native clients remain available for those features.
HTTP limits further bound this method to a 256 KiB canonical request, 1 MiB
response and at most 60 seconds per request, shortened by the enclosing deadline
or grant. Oversized prompts fail rather than being clipped. This is not full
native-client replacement or host-attested caller provenance.

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
itself builds only this package. Its supported development inputs are Bun
1.3.3, TypeScript 7.0.2, Node types 24.13.3, Just 1.43.1 or newer, and the exact
FLOW SDK archive identified in `tooling/flow-sdk.json`. The packed library and
runtime use standard Node-compatible ESM; Bun also executes them.

In an extracted archive, run `bun install --ignore-scripts` for its recorded
development dependencies, then `just build`. Its manifest declares
`@jigging/flow` as `file:./tooling/flow-sdk.tgz`: the complete ordinary SDK
archive included with the method. `tooling/flow-sdk.json` records that archive's
package name, version and SHA-256. Normal installation uses those exact
candidate bytes, including their matching Run/1 types, without looking up an
SDK with the same version in a registry. TypeScript and Node type declarations
remain exact registry development dependencies in the manifest.

A consumer running existing
built output does not need these development tools. Change `src/index.ts` for
prompt preparation or interpretation, `src/schema.ts` for the bounded schema
method, or `skills/` for package guidance. Run `just test`, then `just build`
and `just pack --destination <directory>`. Review and adopt the resulting
complete artifact under your host's normal source rules. The rebuilt
`dist/flow.js` is what the root entrypoint executes; never hand-edit it.

The `just pack` recipe builds first, then runs `scripts/pack.ts`. In the
workspace, the packer obtains the entire built SDK through its ordinary public
package archive and stages the method's local SDK dependency. When repacking
an extracted artifact, it verifies and preserves the included SDK archive.
It changes no source workspace manifest and performs no publication. To pack
already built output without rebuilding, run
`bun scripts/pack.ts --destination <directory>` from the method package root.
Release and verification automation can set `FLOW_SDK_PACKAGE_ARCHIVE` to an
already tested complete SDK archive when packing the workspace; its name and
version must match the selected workspace SDK. That archive is included byte
for byte. Extracted-package repacking always uses its own included archive.
The archive is the build input identity; its provisional SDK version alone
does not identify candidate bytes.

`just test` covers method preparation/results, JSON/1 bounds, package reads and
ordinary Flow wiring with deterministic HTTP fixtures. After the initial
build, it also checks the complete SDK archive, local dependency locator,
digest and extracted-package repacking. Those tests do not
establish provider quality, real-client compatibility or host containment.

MPL-2.0 covers this package and its adapted Jig algorithms. The bundled FLOW
SDK is Apache-2.0; see `LICENSE`, `THIRD_PARTY_NOTICES` and
`licenses/flow.LICENSE` for the corresponding notices.
