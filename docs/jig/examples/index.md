---
title: Jig examples
description: Follow complete applications from input through Agent work, code checks, and a useful result.
---

# Examples

Follow a concrete task through its methods, checks, and result.
Each walkthrough explains the required host, Agent configuration, source, and authority.

Start with [Run → Call](../start/index.md) if this is your first Jig project.
The examples add realistic tasks to that same review-and-run loop.

| Example | What it teaches | Result |
| --- | --- | --- |
| [Preview unfamiliar CSV contacts](./contact-import.md) | Swap code, Agent, and mixed mappers behind one interface. Validate rows with code. | A contact preview with invalid rows identified. |
| [Handle a disputed charge](./support-case.md) | Let an Agent interpret a request, then apply supplied account records and policy. | Eligibility evidence without issuing a credit. |
| [Turn an issue into a tested patch](./tested-patch.md) | Reproduce a failure, propose a change, and check it independently. | Patch evidence for a human merge decision. |
| [Run a small software factory](./software-factory.md) | Coordinate a fixed repair set with explicit selection and retained evidence. | Reviewed repair results with a human merge gate. |

Example policies are application choices.
They establish neither general domain correctness nor a requirement that every Jig application use manual approval.

[Build](../build/index.md) explains individual mechanisms.
[Understand](../understand/index.md) explains who owns their decisions and consequences.

## Prepare the source examples

These walkthroughs follow this repository's current source.
Their reporting dependency is not yet published to npm.
Prepare the complete workspace rather than installing each example from the registry.
The [first Flow](../start/index.md) remains the smaller installed-CLI introduction.

Clone the repository:

```sh
git clone https://github.com/jiggy/jig.git jig-examples
cd jig-examples
```

Follow the platform-specific [development-shell setup](https://github.com/jiggy/jig/blob/main/CONTRIBUTING.md#development-shell).
It supplies the selected Bun version, Node, Just, and required host tools.
Use Bun 1.3.3 on Linux and Bun 1.4.2 on the qualified Mac path.
Build from the checkout root:

```sh
bun install
just jig::build
export PATH="$PWD/packages/jig/bin:$PATH"
```

The build prepares the local reporting library and Jig's dependent packages.
Keep the complete checkout and its workspace links.
Each walkthrough starts from this checkout root and selects its own example directory.
You still need ordinary source review, execution approval, and any required Agent authentication.
A successful build alone establishes none of those permissions.
