---
title: FLOW specifications
sidebar: false
---

# FLOW specifications

FLOW is a founder-stewarded, openly implementable package and process
standard. This site publishes its current prerelease specifications directly
from the source repository.

A **Flow** packages one reusable method. For an executable Flow, Run/1 carries
the host's invocation and the method's `{ outcome, output }` result. The host
supplies local authority; the method keeps its own implementation.

![A Flow package contains descriptive files and an executable method. Operator choices configure a host, such as Jig, which invokes the method through Run/1.](./flow-boundary.svg)

Every package has `FLOW.md`; implementation, schemas, and capability contracts
are optional. The Run SDK helps implement the exchange. FLOW defines these
portable boundaries, while each host decides which implementations it supports.

- [JSON/1](../spec/json-values.md) defines bounded portable values.
- [Schema/1](../spec/schema-files.md) defines conventional
  `input.schema.json`, `settings.schema.json`, and `result.schema.json` files.
- [Package/1](../spec/package-format.md) defines the portable package.
- [Run/1](../spec/run-protocol.md) defines one finite process exchange.
- [Run SDK/1](../spec/run-sdk.md) defines TypeScript and Python SDK behavior.
- [Capability Contract/1](../spec/capability-contracts.md) defines optional
  machine-verifiable capability descriptors.

The exact machine-readable FLOW files are published under
[`/schemas/`](https://flow.jig.md/schemas/schema-1.json). The Run/1 conformance
corpus remains in the
[source repository](https://github.com/jiggy/jig/tree/main/conformance/run-1).

FLOW does not specify project admission, permissions, sandboxing, persistence,
agent policy, or semantic routing. Those are host responsibilities. The
[Jig site](https://jig.md/) documents one FLOW host.
