---
title: Bring a Skill to FLOW
description: What transfers from SKILL.md, what Markdown/0 supports, and which differences affect execution.
---

# Bring a Skill to FLOW

A Skill can preserve a useful procedure in instructions, references, and scripts.
A Markdown Flow makes a procedure callable with input and an outcome. Simple
instruction-based Skills can become Flows by renaming `SKILL.md` to `FLOW.md`,
provided their package and requirements fit the supported runtime.

**The current Markdown/0 profile does not support every Skill unchanged.** A
file that parses is not necessarily executable, and an executable method still
needs the tools and data required to complete its task. This guide describes
the current differences; [Package/0](../spec/package-format.md) and
[Markdown/0](../spec/markdown-runtime.md) define the exact FLOW requirements.

## What transfers today?

The [Agent Skills specification](https://agentskills.io/specification) defines
the source format and resource conventions. It leaves execution dependent on
the receiving agent and describes tool pre-approval as experimental.

| Skill material or behavior | Current FLOW Markdown behavior |
| --- | --- |
| Ordinary instructions | Interpreted by the host-selected Agent during one finite invocation. |
| `name`, `description`, `license`, `compatibility`, string-valued `metadata` | Recognized frontmatter, subject to FLOW validation. Environment prose grants no capabilities. |
| Referenced text files | Read on demand from captured package-local UTF-8 files, within the interpreter's limits. |
| Bundled scripts | Preserved as files. The interpreter has no general shell or script-execution action. |
| Binary assets, workspace editing, arbitrary files or network access | Not supplied by Markdown's package-resource reader. Required effects need separately supported, authorized implementations. |
| Harness-specific tools and permission patterns | No general mapping to FLOW slots. Unsupported `allowed-tools` values prevent invocation. |
| Existing conversation context or ongoing interaction | FLOW supplies explicit invocation input and a finite result. A Skill cannot assume the originating agent's session is present. |
| Skill discovery and automatic activation | The host or application owns discovery and selection; renaming does not install a Skill catalogue. |

An optional descriptive field can be irrelevant to a task. A missing required
script runner, tool, data source, or enforced restriction is different: keeping
the prose does not preserve the method's behavior. Test the task itself, not
just whether the package loads or an Agent returns plausible text.

## Tool declarations are not ignored

FLOW currently treats `allowed-tools` as an execution restriction:

| Value | Markdown/0 behavior |
| --- | --- |
| Omitted | Authored effect recipes and package-local text reads are available, subject to host grants. |
| Empty string | No resource reads or effect recipes. Reasoning and returning a result remain available. |
| `Read` | Package-local text reads; no call, send, or receive effects. |
| Other nonempty values, including `Bash(git:*) Read` | The entire invocation is unsupported, before reasoning or effects. |

This is stricter than treating the Skill field as an optional pre-approval hint.
The restriction is checked even if this particular input would not need the
named tool. Removing it changes the authored declaration and does not supply
the tool. `Read` also does not mean access to an arbitrary workspace.

An unsupported declaration is therefore not currently effectless: it can stop
an otherwise achievable task. That is a limitation of this alpha profile, not
a requirement of the Agent Skills format. Conversely, removing a declaration
cannot make an unavailable tool work or preserve a restriction it used to enforce.

## Package and interpretation differences

A Flow has exactly one root `FLOW.<ext>` implementation. Markdown metadata lives
in its frontmatter, with no `FLOW.meta.json` beside it. Input/result schemas,
custom outcomes, and channel ports belong in optional `FLOW.contract.json`.

FLOW uses a bounded YAML subset: duplicate keys, anchors, aliases, explicit tags,
and merge keys reject. Unknown top-level metadata prevents execution; inert
extensions use the documented `x-<name>` form. Package paths and file types must
also satisfy Package/0, including its rejection of symlinks. Passing a Skill
format validator alone does not prove these conditions.

Root-level `flow` fences acquire recipe meaning in FLOW.md. A tutorial that
contains such a fence should quote or nest it when it is only an example.
Instructions in resources cannot introduce new recipes or tools. The interpreter
does not silently repair or discard incompatible declarations.

The initial interpreter has a 256 KiB body limit, 1 MiB aggregate loaded-resource
text limit, and at most 32 reasoning calls, alongside other
[profile bounds](../spec/markdown-runtime.md#lifecycle-profile-and-bounds).
Resources load on demand, but loaded content is retained rather than silently
summarized away. Large or long-running Skills can therefore exceed its limits.

## Adapt a procedure deliberately

First try a small prose-only method using the
[Markdown authoring guide](./markdown.md). Supply the data it needs as invocation
input or captured resources, and check its expected outcome.

For a procedure that needs another capability, declare a dependency and use a
`call` recipe. The host selects and grants its implementation. A code specialist
may own work that the Markdown interpreter cannot perform directly. This is an
adaptation of the method, not evidence that the original Skill works unchanged;
the selected host must actually support the required effects.

When evaluating an existing Skill, record its concrete required tools, inputs,
outputs, and constraints, then check that each is available and respected. A
missing implementation should produce an explicit unsupported requirement,
not a successful-looking answer that skipped the required work.

## What has been tried?

A bounded maintainer experiment used four Apache-2.0 Skills from
[Anthropic's pinned Skills repository](https://github.com/anthropics/skills/tree/33375500bcea98d610eb30ce10ac4e59b89c390d/skills),
renaming only the entrypoint and keeping its body and resources unchanged. It
ran the actual Markdown interpreter and HTTP Agent method with live Ministral
8B and Mistral Small responses. This was an interpreter experiment, not an
installed-host containment test or an independent usability study.

| Skill and bounded task | Package / execution qualification | Observed task result |
| --- | --- | --- |
| `brand-guidelines`: return a text style specification | Accepted | Both models returned the requested colors and fonts. No rendered artifact was tested. |
| `internal-comms`: draft a 3P update from supplied facts | Accepted | Both read the required guideline. Small produced the expected update; 8B selected a nonexistent recipe and stopped. |
| `slack-gif-creator`: generate and validate a GIF | Accepted | Neither produced a GIF. Small returned `done` with null output; 8B selected a nonexistent recipe. |
| `webapp-testing`: run a browser test and save a screenshot | Accepted | Neither executed a test. 8B read a script despite its run-before-read instruction; both ultimately returned invalid decisions. |

These cases distinguish four questions: does the package parse, does the runtime
admit its requirements, is the task achieved, and are its required constraints
preserved? A `done` outcome alone proves neither task achievement nor constraint
preservation. The browser case also shows that a procedural restriction written
in prose is not enforced merely because it is present in a Skill. Callers need
checks appropriate to the task: a result schema can reject null where an artifact
is required, but actual artifact validation or execution evidence is still needed.

## How could compatibility improve?

FLOW does not prescribe a sandbox or prohibit host-authorized script execution.
The current interpreter simply has no such action. Closer unchanged-Skill
support would need a runtime that exposes the required tools under explicit
host grants, maps their meanings accurately, and enforces mandatory restrictions
before effects. Pre-approval hints and hard restrictions must remain distinct.

Composition with an authorized code specialist is available today, but rewriting
a Skill that way is an adaptation. It is not the only possible architecture for
future support. Workspace access, script execution, binary output and session
context remain specific gaps to address and verify. Universal unchanged-Skill
compatibility is not a claim of this alpha.
