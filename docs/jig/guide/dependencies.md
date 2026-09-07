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
destination filter and does not enable Git, file, workspace, tarball, or
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

## Local or unreleased code

Keep reusable source inside the Flow package and import it relatively. If a
monorepo owns it elsewhere, your authoring tools can copy or bundle it into
the finished package before review.

Jig does not resolve symlinks or `file:`, `workspace:`, and Git dependency
sources. A package without external dependencies needs neither a dependency
manifest nor a lock for execution.

Optional input, settings, and result schemas follow
[FLOW Schema/1](https://flow.jig.md/spec/schema-files), including its required
`$schema` declaration. See [execution policy](../spec/project-policy.md) for
the exact dependency preparation and admission rules.
