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
jig run <target>
```

- The [repository quickstart](https://github.com/jigmd/jig#quickstart) covers
  installation, supported hosts, and the complete three-command path.
- [Project Authoring SDK/1](../spec/project-sdk.md) defines inert `jig.ts` and
  Binding authoring values.
- [Project and execution policy](../spec/project-policy.md) defines capture,
  review, admission, and exact direct-Run behavior.
- The [security boundary](https://github.com/jigmd/jig/blob/main/SECURITY.md)
  states the threat model, host requirements, and fixed resource limits.

The Jig-specific machine files are published under
[`/schemas/`](https://jig.md/schemas/project-authoring-1.schema.json). FLOW's
portable specifications and machine files remain independently published at
[flow.jig.md](https://flow.jig.md/).

The direct alpha excludes Services, Hooks, Journal providers, Agent providers,
Semantic Choice, Jig Graph, runtime registries, sandbox registries, and
compatibility formats. Its public surface grows only after one concrete
vertical earns it.
