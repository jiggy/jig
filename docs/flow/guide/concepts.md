---
title: Concepts and questions
description: Understand Flows, finite invocation, capability compounding, portable contracts, and host independence.
---

# Concepts and questions

FLOW's core idea is capability compounding: useful methods become a starting
point for further capability. These definitions introduce its boundaries;
the linked specifications define exact requirements.

| Term | Meaning | Exact or explanatory source |
| --- | --- | --- |
| FLOW | Independent package and invocation standard | [Why FLOW exists](./understand.md) |
| Flow | Package containing one reusable method | [Package/0](../spec/package-format.md) |
| `FLOW.<ext>` | The package's single implementation; `FLOW.md` selects Markdown | [Package/0](../spec/package-format.md) |
| `FLOW.meta.json` | Optional readable metadata and dependency declarations | [Package/0](../spec/package-format.md) |
| Host | Consumer that supplies invocation and local execution policy | [Run/0](../spec/run-protocol.md) |
| Runtime | Program or library advancing a method's internal execution | [The boundary](./understand.md#a-small-boundary-room-for-the-method) |
| Run/0 | Protocol for one finite process exchange | [Run/0](../spec/run-protocol.md) |
| Outcome | Method-declared result meaning, paired with output data | [Run/0](../spec/run-protocol.md) |
| Schema | A declared shape used to validate a portable value | [Schema/0](../spec/schema-files.md) |
| Invocation contract | Optional input/result contract, optionally named for independently maintained collaborators | [Invocation Contract/0](../spec/invocation-contracts.md) |
| Channel contract | Exact declared meaning for live messages | [Channel Contract/0](../spec/channel-contracts.md) |

## Is FLOW tied to Jig?

No. Jig is one host. FLOW does not require Jig's admission, containment,
provider, or persistence model. Another host can implement the public boundary
and choose its own local policy.

## Is every Flow executable?

Every package contains an implementation, but it needs a compatible host to
execute. A Markdown implementation requires an interpreter; other languages
likewise require runtime support.

## Can every Skill run unchanged?

No. Many prose and text-resource methods fit Markdown/0, but its current
profile has no general native tools or script execution and rejects unsupported
tool declarations. [Skill compatibility](./skills.md) lists the differences;
the [Markdown tutorial](./markdown.md) shows its input, calls and results.

## Does portability mean every host runs every package?

No. A host must support the implementation and the required public interfaces.
SDK availability and host support are separate. Missing support must stay
visible rather than silently substituting a different method.

## Must a method use an Agent or graph library?

No. Ordinary code can implement a Flow. Agents, Skills, tools, libraries, and
graphs are choices inside the method, not mandatory categories in the standard.

## Must I define an invocation contract?

No. Formal contracts earn their place when independently maintained consumers
need an exact interface. A sophisticated procedure does not automatically need
every optional mechanism. Start from the [authoring path](./start.mdx).

## Do methods bring their own permissions?

A method can describe the interfaces it needs. The receiving host supplies
local authority; a declaration does not grant credentials, access, or provider
selection rights.

## Does reuse guarantee improvement?

No. Evaluation establishes whether reuse, adaptation, or combination adds
usable capability. A portable method can still be wrong or unsuitable for a
new setting. Compounding is the ambition, not an automatic property of copying.
