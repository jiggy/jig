---
title: Jig direct alpha
sidebar: false
---

# Jig direct alpha

Jig is a local host for [FLOW](https://flow.jig.md/) packages. Its first alpha
deliberately exposes one finite product path:

```text
jig init --bare <directory>
jig check [project]
jig run <target> [--input JSON] [--timeout DURATION]
```

- The [repository quickstart](https://github.com/jigmd/jig#quickstart) covers
  installation, supported hosts, and the complete three-command path.
- [Project Authoring SDK/1](../spec/project-sdk.md) defines inert `jig.ts` and
  Binding authoring values.
- [Project and execution policy](../spec/project-policy.md) defines capture,
  review, admission, and exact direct-Run behavior.
- The [security boundary](https://github.com/jigmd/jig/blob/main/SECURITY.md)
  states the threat model, host requirements, and fixed resource limits.

Optional package schema files use [FLOW Schema/1](https://flow.jig.md/spec/schema-files)
and begin with the exact root declaration
`"$schema": "https://flow.jig.md/schemas/schema-1.json"`. Dependency-free
packages omit `bun.lock`; an empty or stale lock is not a valid fixture.

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
child slots. The host currently fixes one OpenRouter Responses provider and
model; there is no provider registry or semantic router.

Root Runs default to 30 seconds. `--timeout` accepts a positive integer plus
`ms`, `s`, `m`, or `h`, up to 24 hours. Children share the parent's remaining
absolute deadline; they cannot extend it. Acquisition precedes that execution
deadline, and mandatory fencing and cleanup may settle afterward.

The direct alpha excludes Services, Hooks, Journal providers, configurable
Agent providers, Agent sessions, Semantic Choice, Jig Graph, schedulers,
catalogues, runtime registries, sandbox registries, and compatibility formats.
Its public surface grows only after one concrete vertical earns it.
