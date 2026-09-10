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
| Ordinary `FLOW.ts` | Explicit caller guidance and selected Skills in this package | One Run/1 invocation and one Agent Exchange |
| Jig native Agent Run | Authenticated Skills in the active caller's admitted package | Jig's existing native integration, using this same library |

The ordinary Flow is anonymous. Its result does not establish native caller
context. With Jig's current topology a root can call the Agent Flow, which
calls Exchange. A specialist already running as a child uses the library
in-process or native Agent Run; it cannot insert another Flow level.

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
assertResponseSchema(schema: JsonObject): void
projectResponseSchema(schema: JsonObject): JsonObject
```

The package also exports `AgentMethodError`, `AgentMethodErrorCode`, and the
`AgentInput`, `SkillText`, `PreparedAgent`, `AgentResult`, `ExchangeInput`,
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

## Ordinary Flow and package Skills

The root `FLOW.ts` runs the bundled method through Run/1. Its input adds
`methodSkills?: string[]` to `AgentInput`. Omission selects none. For example:

```json
{
  "instructions": "Explain a way to check an assumption.",
  "methodSkills": ["answer-check"]
}
```

`methodSkills` names this package's immediate `skills/<name>/` directories,
each containing `SKILL.md`. It does not resolve names in the caller's package.
The `answer-check` Skill is included as a small editable example. There is no
settings schema or required Binding solely to select Skills.

Extract the complete archive into a real project directory, then add that
directory using ordinary Flow membership. An explicit installed real directory
can also be used where the host accepts it; package-manager symlinks still
receive that host's ordinary symlink rules. Running the packed `FLOW.ts` needs
no consumer build or registry dependency resolution.

The optional `events` send endpoint uses the exact included ACP public-updates
contract. The Flow forwards the unused endpoint itself to Exchange, without
consuming, relaying or interpreting updates. Unsupported event support fails
at the lower call before transfer or dispatch; the outer Flow may have begun.

The separate filesystem export is:

```ts
import { readPackageSkills } from '@jigging/agent-method/skills'

const selected = await readPackageSkills(new URL('./', import.meta.url), ['answer-check'])
```

Place that literal URL in your package-root module. The supplied `FLOW.ts`
does so, then passes it into the built runtime; the reader never infers a root
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
ordinary Flow wiring with deterministic Exchange fixtures. After the initial
build, it also checks the complete SDK archive, local dependency locator,
digest and extracted-package repacking. Those tests do not
establish provider quality, real-client compatibility or host containment.

MPL-2.0 covers this package and its adapted Jig algorithms. The bundled FLOW
SDK is Apache-2.0; see `LICENSE`, `THIRD_PARTY_NOTICES` and
`licenses/flow.LICENSE` for the corresponding notices.
