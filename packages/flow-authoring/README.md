# FLOW contract authoring

Write one model and derive its invocation contract, explicitly selected Agent
schemas and implementation types. The resulting JSON needs no compiler in the
host that consumes it.

This private prerelease package is bundled with Jig. Its standalone API returns
artifacts as data and never edits project files or admits a Run. Jig's
[managed workflow](https://jig.md/guide/contracts) composes it with explicit
generation, checked publication and normal review: `jig review --generate-contracts`.

## Use the standalone compiler

Build with `just authoring::build`; qualify it with `just authoring::test`.
The API runs on Node 22 or newer. Bun installs/builds the workspace; the compiler
worker uses Node's resource and termination facilities.

An ordinary consumer of the built package uses:

```js
import { readFile } from 'node:fs/promises'
import { stampSource, compileContract } from '@jigging/flow-authoring'

const authored = await readFile('FLOW.contract.tsp', 'utf8')
const source = await stampSource(authored, { types: true })
const result = await compileContract(source)
// result.source contains the complete source with its explicit toolchain pin.
// result.artifacts contains filename -> UTF-8 text. Nothing has been written.
```

`stampSource` is an explicit selection of the installed toolchain and output
options, not a function to call silently when opening an unfamiliar package.
It returns new source text; the application chooses whether to retain it.
`compileContract` requires that pin and refuses a different installed toolchain.

A minimal authored body is:

```typespec
import "@jigging/flow-authoring/typespec";
using FLOW;

@invocation(Input, Result)
namespace Greeting;

@closed model Input {
  @minLength(1) name: string;
}

@closed model Result {
  outcome: "done";
  output: string;
}
```

The complete [drafter source](test/fixtures/drafter.tsp) reuses one Proposal in
its previous input, successful output, and explicitly generated
`proposal.schema.json`. `@agentResponse("./proposal.schema.json")` requests
a data projection, not an Agent call or authority.

## Artifacts and ownership

The prototype returns:

- `FLOW.contract.json`: the complete native Invocation Contract/1 descriptor.
- `FLOW.contract.d.ts`: implementation declarations, when `types: true`.
- Each explicitly selected `./name.schema.json`: an Agent response schema.
- Each `@channelContract("./name.channel.json", options)` model: a named channel agreement.
- The complete pinned authored source, separately as `result.source`.

Agent projection names cannot be `input.schema.json`, `result.schema.json` or
`settings.schema.json`: invocation and implementation settings keep their own
package declarations. Reserved names fail before any artifact packet is returned.

`FLOW.contract.json` is the native package invocation descriptor. Other hosts
consume that JSON without this compiler or Jig's local management records.

Native JSON remains independently editable and the authority for portable
contract meaning. A compilerless consumer cannot verify that it corresponds to
accompanying TypeSpec or regenerate an edited source declaration. Sharing only
the TypeSpec file is not a completed contracted distribution.

Keep authored source with completed outputs. The prototype does not maintain
a freshness database, rewrite existing outputs, silently reuse last-good
artifacts after failure, install tools or compile during Run.

## Exact initial authoring profile

The profile is `flow-authoring-typespec/1`, using TypeSpec **1.16.0** and the
fixed bundled FLOW decorator definitions. It compiles through TypeSpec's parser
and semantic checker, then lowers the checked graph directly into Schema/1.
It does not use or sanitize the general JSON Schema emitter.

One top-level namespace has one `@invocation(InputType, ResultType, options?)`.
Its options are `outcomes`, an exact `id`/`version` pair, `features`, and
`channels`. All models, scalars and unions live in that namespace. Unused
declarations are checked too.

| Authoring construct | Native representation |
| --- | --- |
| Named `@closed model` | Root `$defs` entry, object properties, explicit required list and `additionalProperties: false` |
| Named union | Root definition; `anyOf` normally, `oneOf` with explicit `@oneOf` |
| String-literal union | String `enum` in declaration order, duplicate values collapsed |
| Model property without `?` | Required, including when its type admits null |
| `?` property | Optional; no implicit null or default |
| `T[]` | Homogeneous array with `items` |
| `string`, `integer`, `float64`, `boolean` | Corresponding primitive; FLOW JSON/1 still applies |
| Supported scalar alias | Inlined primitive and constraints; derived bounds cannot erase base bounds |
| String/number/boolean literal | `const`; numbers must fit JSON/1, negative zero becomes zero |
| Null or other structural union | Explicit null type or union branches |
| Length/item/numeric bound decorators | Corresponding Schema/1 keywords, retaining Unicode-scalar length meaning |
| Explicit `@doc` | Description annotation; ordinary comments do not enter contract identity |

Definitions retain authored names matching Schema/1. Reserved generated names,
TypeScript type keywords and `Array` reject; no silent name mangling.
References are acyclic and local. Emission follows declaration/traversal order,
omits unauthored options, and performs no general schema optimization.
Refactoring definitions can change contract identity and validation-work
accounting even when ordinary accepted values remain alike.

The profile rejects imports other than its bundled library, executable
extensions, compiler directives, unknown/duplicate decorators, templates,
inheritance, model spreading, defaults, recursive graphs and unsupported types.
It supports the complete drafter, not every TypeSpec program or every possible
Schema/1 descriptor. Named operations, attachments and settings are not compiled
by this profile. Independently
authored native descriptors retain those features and their separate ownership.

The [review fixture](test/fixtures/progress.tsp) authors a named invocation and
optional progress port together. Each port explicitly supplies `direction` and
`contract`, optionally `required`, `delivery`, and receiver `start`. Its
`./name.channel.json` must be generated in the same source using
`@channelContract` on a closed model, with exact `id`, `version` and `semantics`.
Only definitions reachable from that model enter the channel agreement; editing
an unrelated input does not change the channel identity. Generated model names
and structure remain part of the agreement, so independently authored peers
must consume the same completed contract bytes, not merely similar types.
At most 63 channel and Agent-schema outputs are supported together.

An identified invocation can define its optional behavior vocabulary in the
same decorator:

```typespec
@invocation(Input, Result, #{
  id: "https://example.org/methods/review", version: "1.0.0",
  features: #{progress: "Publishes selected progress; completion remains a separate result."}
})
namespace Review;
```

`features` maps at most 256 distinct `LocalName` keys (up to 64 lowercase ASCII
characters with separating hyphens) to descriptions of 1–16,384 Unicode scalars.
It requires the exact identity pair, including for an empty map. The compiler
preserves the map in `FLOW.contract.json`; absence remains absent. Catalog
changes affect contract identity, not input/result schemas or generated types.
Package metadata `supports` and dependency `requires` refer to those names;
the compiler does not create either declaration. Catalog membership proves
neither implementation behavior nor granted powers.

The compiler never reads ancestor configuration or source-selected files.
Its virtual filesystem supplies the source and bundled authoring definitions;
only installed trusted TypeSpec library files are otherwise readable.

## Agent projections and types

Projection expands bounded references and validates the resulting graph
against the current narrow Agent schema profile. Supported string literals
become exact string enums; nullable strings/integers have the equivalent nullable
type representation. Optional properties, unsupported bounds, booleans,
non-integer numbers, nullable objects/arrays and other incompatible constructs
fail with the source location and requested output. No field becomes required
or nullable merely to satisfy a provider.

Generated declarations come from the lowered descriptor, not a second model.
They export named definitions plus `FlowInput` and `FlowResult`. Use them in
ordinary implementation code:

```ts
import type { FlowInput, FlowResult } from './FLOW.contract.js'

export function greet(input: FlowInput): FlowResult {
  return { outcome: 'done', output: `Hello ${input.name}` }
}
```

TypeScript does not enforce numeric/string/list bounds, safe integers, exact
object closure or arbitrary exclusive-union validation. The host still validates
actual JSON. These types neither validate Agent data nor confer authority.

## Reproducible source and bounded failure

`getToolchain()` identifies the installed tool/profile and a content digest
over the tool's compiled files, manifest and resolved dependency file graph.
The first source line is exactly `// flow-authoring: ` followed by canonical
compact JSON in field order `profile, tool, compiler, digest, types`, then LF.
`stampSource` creates that line with the real digest. Unknown options,
noncanonical/duplicate members and mismatched pins reject. No other FLOW reader
must understand this authoring-tool header.

The installed toolchain is trusted and must remain unchanged for the process
lifetime. The digest is a reproducibility identifier, not a compiler trust proof,
an immutable archive or protection against hostile concurrent tool-file edits.
Resolved transitive dependencies may differ between installations; that changes
the pin rather than silently claiming equivalence. Exact archived toolchain
distribution still needs qualification before managed host integration.

Source is limited to 64 KiB, 8,192 AST nodes and AST depth 64. Lowering has a
4,096-operation budget and depth 64; at most 1,024 definitions are emitted.
These are authoring-profile limits, not changes to FLOW's validator meter.
Expanded projections are bounded separately. Each output is at most 256 KiB;
the complete artifact packet is at most 1 MiB.

Compilation runs in a worker with a 128 MiB old-generation heap limit, bounded
diagnostics and at most ten seconds of execution. This is a resource boundary
for the trusted compiler, not an OS sandbox or a total-RSS guarantee.
Initial trusted-tool fingerprinting is separately bounded to 20,000 files and
128 MiB; it is not charged to the worker timeout.

```js
await compileContract(source, { signal, timeoutMs: 5000 })
```

Cancellation and timeout await worker termination and return an
`AuthoringError`, never a partial artifact packet. All requested projections
must succeed. Errors expose `diagnostic.code`, `message`, `line`, `column`
and, for projection failures, `output`.

This library does not publish files. Jig owns its separate managed publication,
recovery, captured-source freshness and admission boundaries.
