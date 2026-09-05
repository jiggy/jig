---
title: Jig direct alpha
sidebar: false
---

# Jig direct alpha

Jig is a local host for [FLOW](https://flow.jig.md/) packages. Its first alpha
deliberately exposes one finite product path:

```text
jig init --bare <directory>
jig review [project] [--yes]
jig run <target> [--input JSON] [--timeout DURATION]
```

Install the current alpha directly from npm:

```console
npm install --global @jigging/jig@0.1.0-alpha.10
```

`jig init --bare my-project` creates a new project directory; the destination
must not already exist. Add packages beneath `flows/`, review them with
`jig review`, and run an admitted `flow:<path>` or `binding:<id>` target.
Interactive `jig review` asks for approval. In a noninteractive environment,
inspect its review and rerun it with `--yes` only when approval is explicit.
There is no separate apply command: the same finite `review` invocation carries
the reviewed proposal into admission.

- The [repository quickstart](https://github.com/jiggy/jig#quickstart) provides
  a complete first Flow and the supported-host requirements.
- The [use-case catalogue](../use-cases.md) records uniformly scoped product
  hypotheses for future probes and tutorials.
- [Choosing a workflow structure](./workflow-design.md) explains where Agent
  judgment, deterministic checks, graph structure, and host authority belong.
- [Candidate orchestration patterns](../orchestration-patterns.md) records the
  reusable methods those use cases may test.
- [Project Authoring SDK/1](../spec/project-sdk.md) defines inert `jig.ts` and
  Binding authoring values.
- [Project and execution policy](../spec/project-policy.md) defines capture,
  review, admission, and exact direct-Run behavior.
- The [security boundary](https://github.com/jiggy/jig/blob/main/SECURITY.md)
  states the threat model, host requirements, and fixed resource limits.

Optional package schema files use [FLOW Schema/1](https://flow.jig.md/spec/schema-files)
and begin with the exact root declaration
`"$schema": "https://flow.jig.md/schemas/schema-1.json"`. Dependency-free
packages omit `bun.lock`; an empty or stale lock is not a valid fixture.
When a `flow.ts` imports `@jigging/flow` or another production dependency,
first create that package's own `package.json`, then run
`bun install --lockfile-only` from the package directory with Bun 1.3.3. Keep
the resulting text `bun.lock`, but do not place `node_modules` in the Flow
package. Lock generation is author-side and may use the network and Bun's
author-side cache even though it creates no project-local `node_modules`. On
the first `jig review` after those inputs change, Jig fetches the exact locked
artifacts and materializes a private execution snapshot through a contained
trusted preparation process with default-registry network access and lifecycle
scripts disabled. A declined review may therefore leave retained inert
preparation evidence without admitting it.

For unreleased code, prefer readable package-local source and relative imports.
A monorepo may copy or bundle shared code into the finished Flow package before
`jig review`; Jig does not resolve symlinks, `file:`, `workspace:`, or Git
dependencies and does not own that author-side step. `jig run` never installs
or fetches dependencies.

The Jig-specific machine files are published under
[`/schemas/`](https://jig.md/schemas/project-authoring-1.schema.json). FLOW's
portable specifications and machine files remain independently published at
[flow.jig.md](https://flow.jig.md/).

The alpha's child-call slice is exact and deliberately small. A Binding may
map at most 256 LocalName `slots` to other selected direct Flow packages;
omission means `{}`. Those targets come from the same admitted generation,
while a direct `flow:` Run has no slots. Each Run/1 `flow/call` exchanges only
JSON/1 input and a complete JSON/1 result with a fresh child context: settings
and attachments are empty, it has no slots, and its deadline cannot exceed the
parent's. Run/1 governs operation identity, duplicate joins and conflicts,
cancellation, and uncertainty; uncertain dispatch is not automatically
replayed. Jig supplies no separate child history, administration, scheduler,
catalogue, or resolver.

The alpha admits one active child operation per parent; excess distinct
concurrent calls receive `RESOURCE_EXHAUSTED`, while sequential calls remain
available.

One experimental [Agent Run capability](../spec/agent-run.md) is also
available through ordinary Run/1 `effect/call`. An Agent-capable Flow carries
the exact Jig-owned descriptor, may project an explicit package-local skill
subset, and can use the structured result to select one of its Binding's exact
child slots. The host may use the official OpenAI JavaScript SDK against an
operator-selected OpenAI-compatible endpoint, or run native Codex, Claude
Code, or Pi through one private ACP mechanism. Direct configuration uses
`OPENAI_API_KEY` and `OPENAI_MODEL`; optional `OPENAI_BASE_URL` and `OPENAI_API`
select the HTTPS endpoint and either the `responses` (default) or
`chat-completions` wire shape. Jig supplies no default model. Client, API,
endpoint, model, executable path, and credentials are trusted host
configuration. There is no package-selected provider, provider registry, or
semantic router.

Root Runs default to 30 seconds. `--timeout` accepts a positive integer plus
`ms`, `s`, `m`, or `h`, up to 24 hours. Children share the parent's remaining
absolute deadline; they cannot extend it. Acquisition precedes that execution
deadline, and mandatory fencing and cleanup may settle afterward.

On success, `jig run` prints one JSON object containing `status`, `outcome`,
`output`, and bounded `diagnostics`. This is the command result; FLOW's
`result.schema.json` validates the nested `{ outcome, output }` Run result.
Omitting `--input` supplies `{}`.

The direct alpha excludes Services, Hooks, Journal providers, a public Agent
provider SPI, Agent sessions, Semantic Choice, Jig Graph, schedulers,
catalogues, runtime registries, sandbox registries, and compatibility formats.
Its public surface grows only after one concrete vertical earns it.
