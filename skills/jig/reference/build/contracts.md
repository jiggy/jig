# Author contracts once

Jig can generate validation contracts and TypeScript types from one TypeSpec
declaration. Plain `FLOW.contract.json` remains equally valid: consuming a
finished Flow does not require TypeSpec or its compiler.

## Before you start

Use the greeting project from [your first Flow](../start/index.md).
Generation needs [Node 22 or newer](#runtime-requirements), in addition to Jig.
This example adds validation without changing the greeting implementation.
Its input is a string and its output contains a message.

## Declare the greeting contract

Add `flows/hello/FLOW.contract.tsp`:

```typespec
import "@jigging/flow-authoring/typespec";
using FLOW;

@invocation(string, Result)
namespace Greeting;

@closed model Message { message: string; }
@closed model Result { outcome: "done"; output: Message; }
```

From the project root, generate the files and review the change:

```sh
jig review --generate-contracts --allow-resolution-network
```

`--generate-contracts` selects Jig's bundled authoring tool and permits generated writes **before** the separate execution-approval question.
`--allow-resolution-network` permits fresh dependency resolution for the unlocked greeting.
Dependency-selected requests can occur before approval.
Use only `--generate-contracts` when an authored lock avoids fresh resolution.

Jig discovers the packages selected by `jig.ts`, including explicit membership
and custom Flow roots. It produces `FLOW.contract.json`, `FLOW.contract.d.ts`,
and a toolchain header in the original `.tsp` file. Subsequent source edits use
the same command. Ordinary `jig review` checks locally managed files without
compiling and explains stale or interrupted generation. `--yes` does not imply
`--generate-contracts`. `jig run` never generates anything.

Import the generated types in ordinary implementation code:

```ts
import type { FlowInput, FlowResult } from './FLOW.contract.js'
```

Types are editor/compiler assistance, not validation of Agent output or runtime
bounds. The generated JSON still governs actual invocation validation.

Run the approved greeting:

```sh
jig run flow:flows/hello --input '"Ada"'
```

Expect outcome `done` and `output.message` containing the greeting for Ada.
Try input `{}` to see validation refuse it before the handler starts.
The contract now requires a string, even though the original handler supplied a fallback for other input.

Change the string input and run again without another review.
Review is required when you change the implementation or contract source.
For generation or publication failures, follow [contract troubleshooting](../reference/troubleshooting.md#contract-generation-fails-or-is-interrupted).

## One model, related outputs

Small private Agent response schemas usually belong beside their single call;
substantial or reused schemas may use an ordinary descriptive adjacent file.
They do not become `FLOW.*` declarations or the Flow's public result envelope.
See [response schema authoring](agent-method.md#request-a-structured-answer).

When two interfaces actually share constraints, decorate a closed model with
`@agentResponse("./proposal.schema.json")` to request a standalone Agent response
schema. A shared model edit then updates invocation validation, that projection,
and implementation types together.
Optional fields and constraints unsupported by the Agent profile cause an
error identifying the source location; they are never weakened for a provider.
Keep distinct schemas when the public interface needs constraints absent from
the Agent profile. Managed projections are edited through their declaration and
explicit regeneration, under the [generated-file ownership](#generated-file-ownership)
rules; ordinary projects do not need a compiler for handwritten schemas.

The supported single-file language, complete drafter example and resource bounds
are documented in the
[authoring package](https://github.com/jiggy/jig/tree/main/packages/flow-authoring).
This profile supports input, complete result, custom outcomes, named invocation
identity, optional feature catalogs, channel agreements, and explicit Agent projections—not every TypeSpec
feature or arbitrary FLOW contract field. Settings and attachments remain
separate declarations; use native JSON where the profile does not fit.

Standalone schema files such as `settings.schema.json` need the exact root
identifier `"$schema": "https://flow.jig.md/schemas/schema-0.json"`. Embedded
schemas in `FLOW.contract.json` do not repeat it. FLOW Schema/0 is a bounded
JSON Schema dialect; an arbitrary JSON Schema keyword or external `$ref` is not
accepted. Review identifies the affected file and field and gives a correction.
See [FLOW schema files](https://flow.jig.md/spec/schema-files) for the supported
keywords, local references and limits.

## Type-check child calls

Use `jig types` to check settings reads and declared child calls in a TypeScript Flow.
The command reads `uses` in the caller's `FLOW.meta.json` and the exact package-local bundles it references.
It also uses the validated `settings.schema.json` beside `FLOW.ts`.
Handwritten JSON and compatible TypeSpec-generated JSON use the same path.
Run the command from the project root with the caller's package directory.

```sh
jig types flows/worker > flows/worker/FLOW.calls.d.ts
```

Save the declaration separately from `FLOW.contract.d.ts`, which describes the implementation's own interface.
The command emits only to stdout and reads the selected package as data.
Use TypeScript 4.7 or newer to check the declaration with `NodeNext` module resolution.
Import its `RunContext` as a type and apply it once inside the ordinary FLOW SDK handler.
This assertion relies on the declaration matching the Flow's current contracts and its validated settings.

```typescript
import { handle } from '@jigging/flow'
import type { RunContext } from './FLOW.calls.js'

await handle(async (context) => {
  const run = context as RunContext
  const result = await run.call({
    operationId: 'review',
    slot: 'review',
    input: { text: 'Draft' },
  })
  if (result.outcome === 'done') {
    return { outcome: 'done', output: result.output.summary }
  }
  return { outcome: 'done', output: result.output.request }
})
```

This example assumes the `review` contract defines a `done` result with `summary` and a `needs-evidence` result with `request`.
Regenerate after changes to `uses`, its contract bundles, or `settings.schema.json`.
If you need to preserve the previous declaration, redirect to a temporary file and move it after successful generation.
TypeScript checks the code that uses the declaration. Review still checks implementation selection, and the runtime validates input and results.

For dynamic slot selection, narrow the slot before calling or build a union of complete requests.
Each request must pair its slot with valid input for that slot.
The result type covers the slots in that union.

An explicit `never` check can flag an added outcome after regeneration.
A catch-all can continue to handle that outcome when it uses fields common to the results it handles.

The declaration keeps the SDK's call options, channels, attachments, and artifact handles.
Each uncontracted slot keeps the SDK's broad input and result types.
Without declared slots, `call` keeps its SDK type.

Read settings through the same context. For example, a required `route` with
`"enum": ["summary", "detail"]` gives `run.settings.route` that string union.
Optional properties can be `undefined`. Settings without projectable fields
keep the SDK's broad object type.
`jig check` and review still validate the actual settings in each Binding.

The projection covers these shapes for settings fields and single-operation contracts.

- It projects scalar `const` and `enum`, explicit scalar types, object properties and required names, and homogeneous array `items`.
- It includes `done` and the contract's named outcomes. Direct `outcome` and `output` properties can distinguish result shapes across up to 32 root `oneOf` or `anyOf` alternatives.
- It widens integers to `number` and tuple arrays to arrays of JSON values. It keeps objects open and leaves bounds, references, and other schema constraints to runtime validation.
- Unprojected values and fields beyond 12 schema levels stay broad. Slots with named-operation contracts retain broad SDK input and result types.

The command refuses declarations over 256 KiB. You can always use the ordinary FLOW SDK context.

## Named methods with progress

Declare identity and ports explicitly; the compiler does not infer semantics:

```typespec
@invocation(Input, Result, #{
  id: "https://example.org/methods/review", version: "0.1.0",
  channels: #{progress: #{
    direction: "send", contract: "./progress.channel.json", required: false
  }}
})
namespace Review;

@closed model Input { source: string; }
@closed model Result { outcome: "done"; output: string; }

@channelContract("./progress.channel.json", #{
  id: "https://example.org/channels/review-progress", version: "0.1.0",
  semantics: "Selected review progress; messages do not establish review success."
})
@closed model Progress { phase: "reading" | "checking"; message: string; }
```

Include the same import and `using FLOW` as the first example. Generation owns
the complete invocation/channel bundle; share its generated JSON with callers.
Channel ports can also declare `delivery`, and receive ports can declare `start`.
Ports can also reference an existing package-local agreement, such as
`contract: "./contracts/shared/events.json"`, without a `@channelContract`
declaration. Generation validates and records those borrowed bytes; it never
overwrites or deletes them. Editing a borrowed agreement requires explicit
regeneration before review. The generated descriptor still references that
file, so distribute the complete bundle.

Jig's [standard library](https://jig.md/contracts/index.md) uses the `jig:` namespace.
Browse it with `jig import-contract --list`; for example,
`jig import-contract jig:agent-run contracts/agent-run` copies the installed
Agent agreement and all of its referenced channels and license. This selects
an agreement, not an Agent implementation or permission to invoke one.

To reuse a complete invocation contract from another installed package, use
`jig import-contract npm:<package> <new-directory>`. Jig resolves the nearest
installation from the destination's parent, so project-root and member-local
dependencies use the same command. For an independently supplied contract, use
`jig import-contract <descriptor.json> <new-directory>`. The destination parent
must exist. Jig copies only the validated descriptor and its referenced channel
agreements, preserving bytes and relative paths. The copy is a project-owned
snapshot; upgrading the dependency does not silently change it. Import does
not fetch dependencies, run code, overwrite a destination or approve work.

## Declare a collaborator in an existing Flow

Run this from the project root to add a named invocation agreement to an existing code Flow:

```sh
jig add-use flows/worker review=./flows/editor/FLOW.contract.json
```

Jig copies the complete agreement into `flows/worker/contracts/review`.
It adds `uses.review` to the existing `FLOW.meta.json`.
You can also select a standard `jig:` agreement or an installed `npm:` package.

Edit the caller to call `review` for the intended conditions.
Set its target in the caller's Binding.
Run `jig check`, then use `jig review` to decide whether to approve the changed project.
See the [command specification](https://jig.md/spec/cli-experience.md#collaborator-declaration) for its limits and interrupted-edit recovery.

## Name optional behavior

If implementations of a named contract can differ in optional behavior, put
the vocabulary in that contract's invocation options:

```typespec
@invocation(Input, Result, #{
  id: "https://example.org/methods/review", version: "0.1.0",
  features: #{progress: "Publishes selected progress; completion remains a separate result."}
})
namespace Review;
```

The generated `features` map enters the exact contract digest. Refresh callers'
copied bundles after changing it, then review normally. Feature names and their
descriptions are bounded, and even an empty catalog needs the exact identity.

An implementation that provides this behavior declares `"supports": ["progress"]`
in its metadata. A caller that needs it adds `"requires": ["progress"]` beside
the relevant `uses` contract reference. No additional compiler output or SDK
call is needed. Jig checks these declarations before the caller starts;
declarations do not establish behavioral honesty or resource authority. An
unconditional support claim must hold across the package's accepted settings.
The [Agent example](../spec/agent-run.md#declare-required-agent-behavior)
shows conversation, event and session requirements with their separate limits.

## Generated-file ownership

Jig replaces only outputs it previously generated, or adopts existing outputs
whose bytes already equal the requested result. An independently edited or
different unowned file causes a conflict. Jig does not guess which version wins.
For conflicts, follow [contract-generation troubleshooting](../reference/troubleshooting.md#contract-generation-fails-or-is-interrupted).

To omit implementation types, change `types` to `false` in the managed source
header and run `jig review --generate-contracts`. Removed projections and disabled types
are removed only when their files still match the previously managed bytes.
All outputs must validate before any are published.

To return to handwritten JSON, move `FLOW.contract.tsp` outside the package and
run `jig review --generate-contracts`. Jig relinquishes the unchanged outputs together;
JSON, remaining projections and declarations become manually maintained.
The preceding source and affected files remain in local `.jig/authoring` recovery
records. They are not part of the portable package.

## Publication and portability

Separate packages may finish generation before another fails.
Publication uses per-package batches rather than a project-wide atomic write.
Existing admitted Runs remain unchanged.

For failed or interrupted generation, follow [contract-generation troubleshooting](../reference/troubleshooting.md#contract-generation-fails-or-is-interrupted).

The publisher coordinates through Jig's project session. Individual replacements
are atomic; the complete file set is not an atomic filesystem snapshot. Stop
editing affected files during publication. Detection does not promise protection
against every unrestricted writer racing the final check and rename.

Distribute the `.tsp` source and generated files together. Another host can
consume the native JSON without understanding the authoring header or having a
compiler. Such consumption does not establish source/output freshness. Jig's
local ownership and recovery records do not travel as FLOW requirements.

## Runtime requirements

The fixed TypeSpec toolchain and its runtime dependencies ship inside Jig.
Generation additionally requires Node 22 or newer at a standard system location.
For another installation, set `JIG_AUTHORING_NODE_PATH` to its absolute executable.
Jig never selects a project executable or searches ambient `PATH` for this tool.
Consuming already-generated contracts needs neither Node nor compilation.

The compiler receives captured source as data, no project write access and no
operator environment or Agent credentials. No project imports, extensions,
configuration, installation or network requests are enabled. Its worker heap and
time are bounded; this is a trusted compiler boundary, not an OS sandbox or a
total-RSS guarantee. Cancellation waits for its process to stop. Lost coordinator
input cancels work; the trusted process has an independent 20-second ceiling.
