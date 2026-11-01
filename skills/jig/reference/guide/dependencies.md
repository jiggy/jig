---
title: Flow dependencies
---

<!-- Generated from docs/jig/guide/dependencies.md. Edit the source, then run just sync-skills. -->


# Flow dependencies

Use a library from an approved Flow. This example escapes HTML characters
in `<note>` with `escape-html`.

## Before you start

Use a project from the [quickstart](index.md) and Bun 1.3.3 for authoring. Jig
runs `FLOW.ts` with its installed Bun runtime. A Flow can import supported
Bun/Node built-ins, its own files, and declared production dependencies.

## Published packages

### 1. Add the dependency

From the project root:

```sh
jig new escape
bun add --cwd flows/escape escape-html@1.0.3
```

Bun records the dependency in `flows/escape/package.json` and writes its lock.
Keep both files with the Flow. Runtime imports belong in `dependencies`.
Development-only tools belong in `devDependencies`.

Declare every runtime library in the Flow that imports it, including
`@jigging/flow`. Installing the SDK only at the application root does not
declare it for a nested Flow. Jig prepares the Flow's declared dependency
closure, not the application's ambient `node_modules`.

The application manifest separately declares dependencies used by `jig.ts`
and its `npm:` Flow targets. A library import and an invocation slot are
different dependencies.

If `jig.ts` uses explicit membership, add `flows/escape` to its `flows` list.

### 2. Use the library

Replace `flows/escape/FLOW.ts`:

```ts
import escapeHtml from 'escape-html'
import { handle } from '@jigging/flow'

await handle(run => {
  if (typeof run.input !== 'string') throw new TypeError('Supply a string.')
  return { outcome: 'done', output: escapeHtml(run.input) }
})
```

### 3. Review and run

```sh
jig review
jig run flow:flows/escape --input '"<note>"'
```

Review may fetch the locked packages. It disables installation scripts and asks
for approval before execution. Run uses the approved copy without fetching or
installing packages.

### 4. Check the result

Expect execution status `succeeded`, method outcome `done`, and output
`&lt;note&gt;`. Try input `"A & B"`. Expect `A &amp; B`. Review again if you
change the code or dependencies.

## If preparation fails

| Observation | Action |
| --- | --- |
| No authored lock exists | Decide whether to permit fresh resolution for this review. Read the network conditions below. |
| The supplied lock is stale or invalid | Update it with Bun. Review again. Jig does not repair it implicitly. |
| `PACKAGE_BUN_LOCK_VERSION_UNSUPPORTED` | Use a [supported lock format](#lock-formats). Changing dependency sources cannot fix the format. |
| `PACKAGE_BUN_MANIFEST_SOURCE` | Replace unsupported sources with default-registry versions or [declared workspace members](#local-workspace-packages). A `file:` archive is not supported. |
| A workspace member or build output is missing | Correct the declaration or build the library. Jig does not fall back to npm. |
| `PACKAGE_BUN_OUTPUT_LIMIT` | Inspect the reported manifest and runtime dependencies. Increase the documented [dependency preparation limits](limits.md#override-dependency-preparation-limits) when the complete tree is necessary. |
| Approved bytes are missing or corrupt | Preserve the reported evidence. Jig refuses instead of resolving packages again. |

## Fresh resolution and network access

When no lock exists, the operator can permit fresh resolution for this review:

```sh
jig review --allow-resolution-network
```

Bun can contact dependency-selected destinations before Jig validates the
resolved graph, including host-reachable private and loopback services.
Declining execution or failing resolution cannot undo those requests. The flag
does not filter destinations or authorize network access during Runs. `--yes`
approves execution only.

`--yes` does not grant resolution permission.

External dependencies must use the supported default registry.
Declared local workspaces use the [workspace path below](#local-workspace-packages).
Git, file, tarball, and custom-registry dependencies remain unsupported. Known unsupported root
declarations fail before resolution. Transitive declarations may fail after
requests.

Jig identifies each Flow before resolution.

Jig retains generated locks and prepared packages privately. Review does not
write `bun.lock` or `node_modules` into your Flow. Separate machines resolving
unlocked source may select different versions. `jig.lock` identifies source.

It is not the generated dependency lock.

## Lock formats

Prefer an authored lock when sharing dependencies across machines.
Generate the text lock:

```sh
bun install --lockfile-only
```

This command may use the network and Bun's cache. Run it beside the package
manifest with a supported Bun version:

| Authoring version | Text lock | Supported hosts |
| --- | --- | --- |
| Bun 1.3.3 | Version 1 | Linux and Mac |
| Bun 1.4.2 | Version 2 | Mac |

Jig installs valid supplied locks frozen, without conversion. Frozen
installation still fetches locked registry artifacts. Resolution permission
permits fresh version selection. It is not permission merely to fetch locked
bytes.

Invalid or stale locks remain errors even with that permission.

### When the dependency lock is out of date

`PACKAGE_BUN_LOCK_STALE` means package declarations changed after the supplied
`bun.lock` was created. Review identifies the manifest, field and lock when known.
It provides a command to update that lock. Run the command from the reviewed
project directory. If the workspace root is two levels above, use:

```sh
bun install --lockfile-only --ignore-scripts --cwd '../..'
```

The command updates the authored lock and may use the network. Inspect the
changed lock, then repeat `jig review`. Updating a lock does not approve
execution. `--allow-resolution-network` permits resolution when a lock is
missing.

It does not repair a supplied lock. In a workspace, update the root lock. Do
not add a separate lock beside each Flow.

Root `name` or `version` edits do not make a lock stale. Bun does not reliably
retain that metadata. Jig still checks dependency selections and member metadata.
Root manifest changes still require review.

### Consuming a frozen candidate

Use the candidate's exact published dependency versions in each importing Flow.
A moving `@alpha` tag does not identify frozen bytes.
Generate a supported lock to retain the resolved registry versions and integrity.

Installing an SDK archive at the application root does not supply a nested
Flow's execution dependencies. Declaring that archive as a Flow-local `file:`
dependency is also unsupported. For an unpublished candidate, use a declared
workspace with the package's exported files present before review.

A complete built package archive can instead supply an ordinary workspace
member. Extract the whole archive unchanged into that member:

```sh
mkdir -p packages/flow-sdk
tar -xzf /absolute/path/to/flow-candidate.tgz --strip-components=1 -C packages/flow-sdk
```

Declare both the importing Flow and extracted library in the workspace root:

```json
{ "private": true, "workspaces": ["flows/*", "packages/*"] }
```

Declare the SDK in the importing Flow's `package.json`:

```json
{ "dependencies": { "@jigging/flow": "workspace:*" } }
```

Keep the archive's manifest, exports, and files unchanged.
Follow the [workspace steps below](#local-workspace-packages) to install and review.
This consumes extracted regular files through workspace capture, not an archive
dependency. Private TypeScript sources are not required when exported files
already exist.

## Local workspace packages

Use ordinary Bun workspaces to share a library before publishing it. Declare the
Flow and library in the ancestor root:

```json
{ "private": true, "workspaces": ["apps/*/flows/*", "packages/*"] }
```

Declare the dependency in the Flow:

```json
{ "dependencies": { "my-library": "workspace:*" } }
```

1. Run `bun install` at the workspace root.
2. If exported generated files are missing, build those libraries before review.
3. Run `jig review` from the Jig application.

No publication, copied library, or separate Flow installation is needed. An
exact dependency version also selects a same-name workspace member at that
version. Outside a declared workspace, that exact version uses registry
preparation.

The Jig application can be the root or a declared member. Declare its `npm:`
Flow targets in that application's `dependencies`. When the outer workspace
declares the application or Flow, its membership list controls selection.
Include nested Flows explicitly.

An application's own workspace list cannot expand the outer root. An application
may retain its own workspace declaration for standalone use.

If a supplied lock is stale, follow the [lock recovery instructions](#when-the-dependency-lock-is-out-of-date)
to update the workspace root lock and review again.

### Capture, reuse, and supported boundaries

Review captures declared workspace inputs and selected local sources. Existing
approvals keep their original bytes. Review again after code, dependency, or
patch changes. Preparation may reuse that project's approved dependencies when
installer inputs and preparation support still match.

It is never shared between Jig projects.

Ensure exported files exist before review. Missing members or outputs fail without
registry fallback. Members need unique names and safe relative paths. Root
`patchedDependencies` supports exact versions and bounded root-relative `.patch`
files.

Member locks, filesystem links, overrides, member-level patches, and catalogs
are unsupported. The local installation is not an execution input. A Run's
working directory is disposable scratch.

[Workspace capture](../spec/project-policy.md#workspace-dependency-capture) owns
root selection, captured files, aliases, linker behavior, and patch handling.
[Prepared execution](../spec/project-policy.md#prepared-execution-and-limits)
owns reuse conditions and preparation bounds. Follow the checkout's
[development setup](https://github.com/jiggy/jig/blob/main/CONTRIBUTING.md#development-shell)
before running repository examples. Distribute a standalone Flow with published
dependency versions or its declared workspace.

## Limits and other package files

Prepared production trees default to 32 MiB and 4,096 file/alias records per
package. Set `limits.dependencies.maxPreparedBytes` and `maxPreparedFiles` in
`jig.ts`, or use their environment overrides. The [limits reference](limits.md)
owns supported ranges, precedence, shared budgets, and fixed constraints.

A package with no external dependencies needs neither a dependency manifest nor
a lock for execution. Relative imports of its own source files remain supported.

A `FLOW.md` package uses the bundled interpreter and needs no SDK dependency or
installation. Its resources do not trigger dependency preparation.
[Project policy](../spec/project-policy.md#4-flow-members-and-direct-targets)
owns the exact capture, preparation, reuse, and admission requirements.
