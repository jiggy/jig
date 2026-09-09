---
title: Flow dependencies
---

# Flow dependencies

A Flow can reuse libraries while keeping its reviewed execution reproducible.
The alpha runs `flow.ts` with Jig's installed Bun runtime. Imports may reference
supported Bun/Node built-ins, package-local files, or prepared production dependencies.

## Published packages

Place `package.json` beside `flow.ts` and declare your dependencies there. If
the package supplies a matching Bun text `bun.lock`, review installs it frozen:

```console
jig review
```

If it has no lock, explicitly permit fresh resolution for this review:

```console
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

```console
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

Review captures the root manifest and lock, member manifests, and the selected
local dependency sources. A library's `files` list limits its captured source;
without one, its ordinary files are captured except `.git` and `node_modules`.
Generated installation links are never followed. Bun prepares the captured
graph with scripts disabled; Jig retains a self-contained tree of regular files.
Registry dependencies still use the locked default-registry policy above.

Workspace dependencies are recaptured and prepared on each review. Editing a
library changes the proposed execution revision, even if its Flow is unchanged.
Existing admissions continue using their original bytes. A missing root lock
requires the same explicit resolution permission; stale locks require updating.

Workspace members must have unique names and safe relative paths. Local member
locks, filesystem links, dependency overrides, patches, and catalogs are not
supported. Missing members or build outputs fail explicitly, without falling
back to npm. This is review-time capture, not live workspace access during a Run.
Dependency directories between the workspace root and a selected member, or
conflicting Flow-local and hoisted packages, currently fail preparation explicitly:
Jig cannot yet retain those layouts without changing module resolution.
Regenerating an otherwise valid lock does not fix this limit.

The repository examples use this workspace path. Follow the checkout's
[development setup](https://github.com/jiggy/jig/blob/main/CONTRIBUTING.md#development-shell)
once, then review and run an example from its own directory. For a standalone
distributed Flow, use published dependency versions or distribute its workspace.

Package-local source may also be imported relatively. A package without external
dependencies needs neither a dependency manifest nor a lock for execution.

Optional input, settings, and result schemas follow
[FLOW Schema/1](https://flow.jig.md/spec/schema-files), including its required
`$schema` declaration. See [execution policy](../spec/project-policy.md) for
the exact dependency preparation and admission rules.
