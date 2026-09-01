# Jig and FLOW specifications

This directory describes the current prerelease interfaces. Git history is the
archive for superseded proposals and design experiments.

## FLOW foundation

- [`spec/json-values.md`](spec/json-values.md) — bounded JSON/1 values.
- [`spec/schema-files.md`](spec/schema-files.md) — Schema/1 and the conventional
  `input.schema.json`, `settings.schema.json`, and `result.schema.json` files.
- [`spec/package-format.md`](spec/package-format.md) — the portable FLOW package.
- [`spec/run-protocol.md`](spec/run-protocol.md) — one finite Run/1 exchange.
- [`spec/run-sdk.md`](spec/run-sdk.md) — TypeScript and Python Run SDK behavior.
- [`spec/capability-contracts.md`](spec/capability-contracts.md) — optional
  machine-verifiable capability descriptors.

Machine schemas live in [`spec/machine/`](spec/machine/). The Run/1 corpus is
in [`../conformance/run-1/`](../conformance/run-1/).

## Jig direct alpha

- [`../README.md`](../README.md) — supported-host requirements and the planned
  installed quickstart.
- [`spec/project-sdk.md`](spec/project-sdk.md) — inert `jig.ts` and Binding
  authoring values.
- [`spec/project-policy.md`](spec/project-policy.md) — capture, review,
  admission, and exact direct-Run rules.

The direct alpha deliberately excludes Services, Hooks, Journal providers,
Agent providers, Semantic Choice, Jig Graph, runtime registries, sandbox
registries, and compatibility formats. Its installed command surface is
exactly `init --bare`, `check`, and `run`.

## Historical evidence

[`experiments.md`](experiments.md) is a non-normative Git locator for deleted
implementation experiments and the conditions under which their evidence may
be reconsidered. Git history remains the archive; the old implementations are
not current or compatible code.

The `https://flow.jig.md/...` values in prerelease machine files are provisional
identifiers, not claims that those URLs currently resolve.
