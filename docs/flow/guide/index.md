---
title: FLOW specifications
---

# FLOW specifications

FLOW lets you build applications from reusable methods that combine Agent
instructions and executable code. Package useful work as a **Flow**, call it
from code, and combine it with other Flows to accomplish more.

An executable Flow gives a method a defined input and result, so a program can
invoke it without an Agent first interpreting its instructions. The method
can use ordinary code, Agent judgment, or both. The specifications below define
the small package and process boundaries that make those pieces work together.

![A Flow package contains descriptive files and an executable method. Operator choices configure a host, such as Jig, which invokes the method through Run/1.](./flow-boundary.svg)

Every package has `FLOW.md`; implementation, schemas, and capability contracts
are optional. The Run SDK helps implement the exchange. FLOW defines these
portable boundaries, while each host decides which implementations it supports.

New to FLOW? [Start building a method](./start.mdx) or read
[why this boundary exists](./understand.md) before exploring the exact contracts.

## Author a Flow

Both SDKs implement the same portable Run SDK/1 contract:

| Language | Package | Start here |
| --- | --- | --- |
| TypeScript | `@jigging/flow` | [SDK quickstart](https://github.com/jiggy/jig/tree/main/packages/flow-sdk) |
| Python | `jiggy-flow` | [Python guide](./python.md) |

A host's language support is separate from FLOW's SDK availability.

## Specifications

- [JSON/1](../spec/json-values.md) defines bounded portable values.
- [Schema/1](../spec/schema-files.md) defines conventional
  `input.schema.json`, `settings.schema.json`, and `result.schema.json` files.
- [Package/1](../spec/package-format.md) defines the portable package.
- [Run/1](../spec/run-protocol.md) defines one finite process exchange.
- [Run SDK/1](../spec/run-sdk.md) defines TypeScript and Python SDK behavior.
- [Capability Contract/1](../spec/capability-contracts.md) defines optional
  machine-verifiable capability descriptors.
- [Channel Contract/1](../spec/channel-contracts.md) defines optional direct
  communication ports and named message meaning.

The exact machine-readable FLOW files are published under
[`/schemas/`](https://flow.jig.md/schemas/schema-1.json). The Run/1 conformance
corpus remains in the
[source repository](https://github.com/jiggy/jig/tree/main/conformance/run-1).

FLOW does not specify project admission, permissions, sandboxing, persistence,
agent policy, or semantic routing. Those are host responsibilities. The
[Jig site](https://jig.md/) documents one FLOW host.

## Status and stewardship

These prerelease specifications are published directly from the source
repository. FLOW is openly implementable; its decision process is described in
[the governance document](https://github.com/jiggy/jig/blob/main/Governance.md).
