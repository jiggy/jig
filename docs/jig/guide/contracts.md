# Author contracts once

Jig can generate validation contracts and TypeScript types from one TypeSpec
declaration. Plain `FLOW.contract.json` remains equally valid: consuming a
finished Flow does not require TypeSpec or its compiler.

In an existing Flow package, add `FLOW.contract.tsp`:

```typespec
import "@jigging/flow-authoring/typespec";
using FLOW;

@invocation(Input, Result)
namespace Greeting;

@closed model Input { name: string; }
@closed model Result { outcome: "done"; output: string; }
```

Match `Input` and `Result` to your implementation. Then, from the project:

```sh
jig review --generate-contracts
```

This explicitly selects Jig's bundled authoring tool and permits it to write
the generated files **before** the separate execution-approval question. It
does not grant dependency-resolution networking; add `--allow-resolution-network`
only when you also authorize resolving missing dependency locks.

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

## One model, related outputs

Decorate a closed model with `@agentResponse("./proposal.schema.json")` to
request a standalone Agent response schema. A shared model edit then updates
invocation validation, that projection, and implementation types together.
Optional fields and constraints unsupported by the Agent profile cause an
error identifying the source location; they are never weakened for a provider.

The supported single-file language, complete drafter example and resource bounds
are documented in the
[authoring package](https://github.com/jiggy/jig/tree/main/packages/flow-authoring).
This profile supports input, complete result, custom outcomes, named invocation
identity, optional feature catalogs, channel agreements, and explicit Agent projections—not every TypeSpec
feature or arbitrary FLOW contract field. Settings and attachments remain
separate declarations; use native JSON where the profile does not fit.

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

To reuse a complete invocation contract from an installed package, use
`jig import-contract npm:<package> <new-directory>`. Jig resolves the nearest
installation from the destination's parent, so project-root and member-local
dependencies use the same command. For an independently supplied contract, use
`jig import-contract <descriptor.json> <new-directory>`. The destination parent
must exist. Jig copies only the validated descriptor and its referenced channel
agreements, preserving bytes and relative paths. The copy is a project-owned
snapshot; upgrading the dependency does not silently change it. Import does
not fetch dependencies, run code, overwrite a destination or approve work.

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
different unowned file causes a conflict. Preserve those edits and resolve the
conflicting file before regeneration; Jig does not guess which version wins.

To omit implementation types, change `types` to `false` in the managed source
header and run `jig review --generate-contracts`. Removed projections and disabled types
are removed only when their files still match the previously managed bytes.
All outputs must validate before any are published.

To return to handwritten JSON, move `FLOW.contract.tsp` outside the package and
run `jig review --generate-contracts`. Jig relinquishes the unchanged outputs together;
JSON, remaining projections and declarations become manually maintained.
The preceding source and affected files remain in local `.jig/authoring` recovery
records. They are not part of the portable package.

## Failure and portability

A compilation failure leaves previous outputs intact but stale. Interrupted
publication blocks normal review; `--generate-contracts` settles the recorded batch before
processing further edits. Recovery refuses any file containing a third value.
It does not rerun the Flow or approve execution. Separate packages may finish
generation before another fails; these are per-package batches, not a project-wide
atomic write. Existing admitted Runs remain unchanged.

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
