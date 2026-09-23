---
title: Flow dependencies
---

# Flow dependencies

A Flow can reuse libraries while keeping its reviewed execution reproducible.
The alpha runs `FLOW.ts` with Jig's installed Bun runtime. Imports may reference
supported Bun/Node built-ins, package-local files, or prepared production dependencies.

Prepared execution trees are bounded to 32 MiB and 4,096 file/alias records.
Declare what the Flow imports at runtime as production dependencies. Tools used
only to develop or launch the project belong in `devDependencies`; a workspace
Flow can have its own manifest and runtime dependencies. Preparation-limit
errors identify the manifest to inspect; review does not silently omit a
declared runtime dependency to make the tree fit.

## Published packages

Place `package.json` beside `FLOW.ts` and declare your dependencies there. If
the package supplies a matching Bun text `bun.lock`, review installs it frozen:

```sh
jig review
```

If it has no lock, explicitly permit fresh resolution for this review:

```sh
jig review --allow-resolution-network
```

Jig resolves and validates the dependency graph, installs with lifecycle
scripts disabled, and retains the generated lock and exact dependency bytes
privately. It does not write `bun.lock` or `node_modules` into your Flow.
Execution still requires the normal review approval. `--yes` answers that
approval only; it never grants resolution networking.

The extra permission is significant: Bun can contact dependency-selected
destinations, including private-network or loopback services reachable from
your host, before Jig can validate the resolved graph. Requests cannot be
undone if resolution fails or you decline execution. The flag is not a
destination filter and does not enable Git, file, tarball, or
custom-registry dependencies. Known unsupported root declarations are rejected
before resolution; unsupported transitive dependencies may fail after requests.
Jig names each Flow before starting its resolution.

Prefer an authored lock when sharing reproducible dependencies across machines.
You can optionally generate one with Bun 1.3.3:

```sh
bun install --lockfile-only
```

This authoring command may use the network and Bun's cache; it writes `bun.lock`
without creating a local `node_modules` tree. The FLOW package contains the
manifest and lock, not an installed dependency tree.

During `jig review`, Jig fetches locked registry artifacts and prepares a
private execution snapshot. Even frozen installation needs network access for
locked artifacts; the extra flag permits fresh resolution, not merely internet
access. Invalid or stale supplied locks are errors even with the flag. Correct
those locks explicitly; Jig never silently replaces them.

`jig run` uses the admitted snapshot without fetching or installing. Later
reviews reuse it without another resolution permission while its source and
execution evidence still match. Any source change, including code-only edits,
or changed host support can require fresh resolution for an unlocked package.
The permission lasts only for this review. Declined preparation is not admitted
reuse. Missing or corrupt admitted bytes fail closed instead of being silently
resolved again. Separate machines resolving unlocked source may select different
versions: `jig.lock` identifies source, not a generated dependency lock.

## Local workspace packages

Use Bun workspaces to share a library before publishing it. Include the Flow
and library in the ancestor `package.json` workspace list:

```json
{ "private": true, "workspaces": ["apps/*/flows/*", "packages/*"] }
```

The Flow's dependency is ordinary Bun configuration:

```json
{ "dependencies": { "my-library": "workspace:*" } }
```

Run `bun install` at the workspace root and build libraries whose exports
point to generated files. Then run `jig review` from the Jig application.
No publication, copied library, or per-Flow installation is needed.

The Jig application itself may live at the workspace root or in a declared
member. Declare `npm:` Flow targets in that application's `dependencies`;
root applications need not move into a member directory. Root dependency
selection captures metadata and selected packages, not the whole repository.

If a supplied lock is stale, review identifies the manifest and mismatched
field. Update the authored lock with Bun and review again; Jig never repairs
a supplied lock implicitly.

Review captures the root manifest and lock, member manifests, and the selected
local dependency sources. A library's `files` list limits its captured source;
without one, its ordinary files are captured except `.git` and `node_modules`.
Capture never follows the local installation's links. Bun prepares the captured
graph with scripts disabled. Jig preserves its hoisted dependency layout and
workspace aliases within the retained snapshot, so nested versions and shared
library instances keep their usual resolution behavior.
Registry dependencies still use the locked default-registry policy above.

Workspace dependencies are recaptured on each review. When the complete inputs
and execution environment still match, Jig reuses that project's approved
preparation without installing or resolving again. Preparation is never shared
between separate Jig projects, even in the same workspace. Editing a library
invalidates reuse, even if its Flow is unchanged. Existing admissions continue
using their original bytes. When fresh preparation needs a missing root lock,
it requires explicit resolution permission; stale supplied locks require updating.

Root `patchedDependencies` is supported for exact package versions and bounded
root-relative `.patch` files. Jig captures those files, applies them through
Bun during preparation, and retains their exact bytes with the installation.
Changing a patch requires review; existing admissions retain the previous bytes.

Workspace members must have unique names and safe relative paths. Local member
locks, filesystem links, dependency overrides, member-level patches, and catalogs
are not supported. Missing members or build outputs fail explicitly, without
falling back to npm. This is review-time capture, not live workspace access
during a Run.
Preparation uses Jig's pinned Bun hoisted linker; it does not import the local
installation or provide an isolated-linker mode. Module-relative files stay
beside their modules. A Run's working directory remains disposable scratch.
Ancestor runtime configuration outside selected packages, such as a root
`tsconfig.json`, is not captured.

The repository examples use this workspace path. Follow the checkout's
[development setup](https://github.com/jiggy/jig/blob/main/CONTRIBUTING.md#development-shell)
once, then review and run an example from its own directory. For a standalone
distributed Flow, use published dependency versions or distribute its workspace.

Package-local source may also be imported relatively. A package without external
dependencies needs neither a dependency manifest nor a lock for execution.

Optional invocation input and complete-result schemas belong in `FLOW.contract.json`;
implementation settings use `settings.schema.json`. They follow
[FLOW Schema/0](https://flow.jig.md/spec/schema-files). A `FLOW.md` package uses
the bundled interpreter and needs no SDK dependency or installation. Its
resources do not trigger dependency preparation. See [execution policy](../spec/project-policy.md) for
the exact dependency preparation and admission rules.
