---
title: Flow dependencies
---

# Flow dependencies

A Flow can reuse libraries while keeping its reviewed execution reproducible.
The alpha runs `flow.ts` with Jig's installed Bun runtime. Imports may reference
supported Bun/Node built-ins, package-local files, or locked production dependencies.

## Published packages

Place `package.json` beside `flow.ts` and declare your dependencies there.
Using Bun 1.3.3, generate a package-local text lock:

```console
bun install --lockfile-only
```

This authoring command may use the network and Bun's cache; it writes `bun.lock`
without creating a local `node_modules` tree. The FLOW package contains the
manifest and lock, not an installed dependency tree.

During `jig review`, Jig fetches locked registry artifacts and prepares a
private execution snapshot. Preparation has registry network access inside
containment, with lifecycle scripts disabled. Declining the review may leave
inert prepared data, but grants no execution authority.

`jig run` uses the admitted snapshot without fetching or installing. Later
reviews reuse it while its source and execution evidence still match.
Changed dependencies require a new review.

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
