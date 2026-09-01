---
title: Jig and FLOW specifications
sidebar: false
---

# Jig and FLOW specifications

This site renders the current prerelease interfaces directly from the
repository Markdown. Git history is the archive for superseded proposals and
design experiments.

## FLOW foundation

- [JSON/1](../spec/json-values.md) — bounded JSON values.
- [Schema/1](../spec/schema-files.md) — conventional `input.schema.json`,
  `settings.schema.json`, and `result.schema.json` files.
- [Package/1](../spec/package-format.md) — the portable FLOW package.
- [Run/1](../spec/run-protocol.md) — one finite process exchange.
- [Run SDK/1](../spec/run-sdk.md) — TypeScript and Python SDK behavior.
- [Capability Contract/1](../spec/capability-contracts.md) — optional
  machine-verifiable capability descriptors.

The exact machine-readable files are published under
[`/schemas/`](https://flow.jig.md/schemas/schema-1.json). The Run/1 conformance
corpus remains in the
[source repository](https://github.com/jigmd/jig/tree/main/conformance/run-1).

## Jig direct alpha

- [Installed quickstart](https://github.com/jigmd/jig#quickstart) — supported
  host requirements and the three-command product path.
- [Project Authoring SDK](../spec/project-sdk.md) — inert `jig.ts` and Binding
  authoring values.
- [Project and execution policy](../spec/project-policy.md) — capture, review,
  admission, and exact direct-Run rules.
- [Security boundary](https://github.com/jigmd/jig/blob/main/SECURITY.md) — threat
  model, host requirements, and fixed resource limits.

The direct alpha deliberately excludes Services, Hooks, Journal providers,
Agent providers, Semantic Choice, Jig Graph, runtime registries, sandbox
registries, and compatibility formats. Its installed command surface is
exactly `init --bare`, `check`, and `run`.

## Historical evidence

[Suspended experiments](../suspended-experiments.md) is a non-normative Git
locator for deleted experiments and the conditions under which their evidence
may be reconsidered. Git history remains the archive; the old implementations
are not current or compatible code.
