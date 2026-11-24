---
title: Skill compatibility
description: Check the package, resource, tool, and execution differences between SKILL.md and the current FLOW Markdown profile.
---

# Skill compatibility

A Skill can supply instructions and resources for a callable Markdown method.
Its required environment must also fit the receiving host and Markdown/0 profile.
For a worked adaptation, follow [Bring a Skill](../build/skills.md).

[Package/0](../spec/package-format.md) and [Markdown/0](../spec/markdown-runtime.md) define the exact requirements.
This page explains the differences that affect current execution.

## Instructions, resources, and context

| Skill material or behavior | Current Markdown/0 behavior |
| --- | --- |
| Ordinary instructions | A host-selected Agent interprets them during one finite invocation. |
| `name`, `description`, `license`, `compatibility`, string-valued `metadata` | Recognized frontmatter, subject to FLOW validation. Environment prose grants no powers. |
| Referenced text files | Read on demand from captured package-local UTF-8 files, within the interpreter's limits. |
| Bundled scripts | Preserved as files. The interpreter supplies no general shell or script-execution action. |
| Binary assets, workspace editing, arbitrary files, or network access | Required effects need separately supported and authorized implementations. |
| Harness-specific tools and permission patterns | Unsupported `allowed-tools` values prevent invocation. Slots require explicit declarations and host configuration. |
| Conversation history or ongoing interaction | The caller supplies explicit input. The originating Agent session is not implicitly available. |
| Discovery and automatic activation | The host or application owns selection. Renaming an entrypoint does not install a catalogue. |

The [Agent Skills specification](https://agentskills.io/specification) leaves execution to the receiving Agent and describes tool pre-approval as experimental.
Preserving files alone cannot supply a missing tool, data source, or enforced restriction.

## Tool restrictions

Markdown/0 enforces `allowed-tools` during execution qualification:

| Value | Available actions |
| --- | --- |
| Omitted | Eligible authored recipes and captured-resource reads, subject to host grants. |
| Empty after trimming ASCII spaces | Reasoning and returning a result. Resource reads and call/send/receive effects are unavailable. |
| Exactly `Read` after that trimming | Captured-resource reads. Call/send/receive effects are unavailable. |
| Any other nonempty value | Whole-invocation qualification fails before reasoning or effects. |

For example, `Bash(git:*) Read` is unsupported by this profile.
`Read` covers captured package-local text, rather than an arbitrary workspace.
Required endpoint settlement remains available under tool restrictions.

The restriction applies even when a particular input would not use the named tool.
Removing it changes the authored declaration and supplies no replacement capability.
A code runtime must also qualify restriction enforcement or report the package execution-unsupported.

## Package differences

A Flow contains exactly one root `FLOW.<ext>` implementation.
For `FLOW.md`, optional metadata belongs in frontmatter, with no root `FLOW.meta.json` beside it.
Optional `FLOW.contract.json` owns input/result schemas, custom outcomes, and ports.

The frontmatter uses a bounded YAML subset.
Duplicate keys, anchors, aliases, explicit tags, merge keys, and unknown top-level metadata prevent execution.
Inert extension fields use the documented `x-<name>` form.
Package/0 also defines valid paths and file types, including its rejection of symlinks.

Passing a Skill format validator proves neither FLOW package validity nor execution support.
The receiver must qualify the required runtime, resources, dependencies, and powers.

## Recipe and interpreter limits

Root-level lowercase `flow` fences acquire recipe meaning in `FLOW.md`.
Quote or nest a displayed recipe when it is only an example.
Resource prose cannot register new recipes, slots, or tools.

| Profile bound | Current limit |
| --- | --- |
| Markdown body | 256 KiB |
| Aggregate loaded-resource text | 1 MiB |
| Reasoning calls | At most 32 |

Loaded resource text remains retained rather than silently summarized.
See [Markdown/0 profile bounds](../spec/markdown-runtime.md#lifecycle-profile-and-bounds) for the complete limits.

## Check the task and its constraints

Check four things separately: package validity, execution qualification, task achievement, and preservation of required constraints.
A `done` result establishes neither a correct answer nor compliance with every prose instruction.
A procedural restriction written in prose does not establish its enforcement.
Result schemas can reject unsuitable shapes, such as null where an artifact is required.
Validate generated artifacts or execution evidence to establish task completion.

A required effect may be moved into an authorized code specialist and called through a declared dependency.
That produces an adapted method, whose host must support the selected implementations.
