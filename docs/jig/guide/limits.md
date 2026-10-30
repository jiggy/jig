---
title: Limits and defaults
description: Find Jig's resource limits, supported overrides, fixed constraints, and policy owners.
---

# Limits and defaults

Use this reference when a review or Run reaches a resource limit. Find the
affected task, then use its supported control. Values apply independently
unless the table describes a shared budget. A larger package allowance does
not increase a Run's memory, deadline, or retained storage.

MiB means 1,048,576 bytes. File counts include alias records where dependency
preparation records them. The tables are checked against their implementation
owners during documentation checks. Exact admission and execution requirements
remain in [project policy](../spec/project-policy.md).

## Override dependency preparation limits

`PACKAGE_BUN_OUTPUT_LIMIT` means one package's prepared runtime dependency tree
exceeded its byte or file allowance. Check its production dependencies first.
When the complete runtime tree is necessary, increase its allowance in `jig.ts`:

```ts
import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  flows: discover('./flows'),
  bindings: discover('./bindings'),
  limits: {
    dependencies: {
      maxPreparedBytes: 64 * 1024 * 1024,
      maxPreparedFiles: 8192,
    },
  },
})
```

For one operator environment, supply the same fields through environment
variables. Values are decimal integers in bytes or file counts:

```sh
JIG_LIMITS_DEPENDENCIES_MAX_PREPARED_BYTES=67108864 \
JIG_LIMITS_DEPENDENCIES_MAX_PREPARED_FILES=8192 \
jig review
```

Each field resolves independently: **environment variable → `jig.ts` → built-in
default**. An invalid explicit value fails, including an empty environment
variable. Jig does not load project `.env` files automatically.

Both fields must be positive safe integers within the supported maxima below.
Their combination must also fit the canonical artifact capacity, including
maximum-length paths and archive metadata. Reduce either allowance if that
combination exceeds capacity. File content alone does not measure archive size.

When preparation exceeds an allowance, its diagnostic reports the effective
limit and source. Project limits form part of the reviewed configuration. An
environment override applies to that review's preparation. Later Runs consume
the retained bytes without preparing dependencies again. These controls grant
no network access or additional Run powers. Fresh resolution still requires
[`--allow-resolution-network`](dependencies.md#fresh-resolution-and-network-access).

## Choose the appropriate control

| Control | How to change it |
| --- | --- |
| Config / environment | Use the documented `jig.ts` key or environment variable. Precedence is field-specific as described above. |
| Run option | Use `jig run --timeout DURATION`. An approved entrypoint can provide a default. Explicit Run arguments replace it. |
| Reviewed grant | Change the resource policy in a Binding or named grant, then review the authority change. |
| Fixed | No config or environment override exists. The task explanation identifies the protected boundary. |
| Derived | Jig calculates the bound from other allocations. It has no independent override. |

An explicit Run option does not replace a reviewed grant. Each owner enforces
its allowance, and descendants share the remaining root deadline.

Linux enforces hard aggregate memory, process, and CPU ceilings. Mac applies
the same requested values through supervised sampling and termination. Short
overshoot is possible. Wall-clock deadlines and confirmed descendant fencing
still apply on both hosts. See
[host enforcement](../spec/project-policy.md#containment-and-lifetime).

<!-- limit-reference:start -->

## Prepare runtime dependencies

The prepared package controls apply to production dependencies of each selected package. Other preparation budgets remain fixed to bound review work.

| Setting or bound | Value | Control |
| --- | --- | --- |
| `limits.dependencies.maxPreparedBytes` | Default 32 MiB (33,554,432 bytes). Supported maximum 128 MiB (134,217,728 bytes) | Config / environment |
| `limits.dependencies.maxPreparedFiles` | Default 4,096. Supported maximum 65,536 | Config / environment |
| Captured source before installation, per package | 16 MiB (16,777,216 bytes) / 4,096 files | Fixed |
| Distinct actual preparations, per review | 16 | Fixed |
| Aggregate prepared content, per review | 256 MiB (268,435,456 bytes) | Fixed |
| Whole preparation phase deadline | 180 seconds | Fixed |
| Workspace members in execution layout | 256 | Fixed |
| Dependency aliases in execution layout | 4,096 | Fixed |
| Execution layout JSON | 1 MiB (1,048,576 bytes) | Fixed |
| Evaluation dependency closure | 128 MiB (134,217,728 bytes) / 8,192 files | Fixed |

Policy owners: [`project/limits.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/project/limits.ts), [`internal/bun-native-preparation-protocol.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/bun-native-preparation-protocol.ts), [`internal/bun-native-preparation-budget.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/bun-native-preparation-budget.ts), [`internal/bun-execution-layout.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/bun-execution-layout.ts).

## Retain captured packages

Archive capacity includes metadata and retained evidence. These fixed store bounds prevent unbounded durable growth. Dependency settings do not enlarge them.

| Setting or bound | Value | Control |
| --- | --- | --- |
| One canonical captured artifact | 192 MiB (201,326,592 bytes) | Fixed |
| Captured package store, per project | 1,024 MiB (1,073,741,824 bytes) | Fixed |
| Package/0 format files | 65,536 | Fixed |
| Package/0 format individual file | 1,024 MiB (1,073,741,824 bytes) | Fixed |
| Package/0 format aggregate content | 4,096 MiB (4,294,967,296 bytes) | Fixed |
| Logical package path | 1,024 UTF-8 bytes | Fixed |

Policy owners: [`package/capacity.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/package/capacity.ts), [`internal/package-artifact-store.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/package-artifact-store.ts).

## Bound a Run and its child work

The Run deadline covers its descendants. Fixed process budgets and derived branch reservations keep concurrently owned work inside the root allocation.

| Setting or bound | Value | Control |
| --- | --- | --- |
| Root Run deadline | Default 30 seconds. Maximum 86,400 seconds | Run option |
| Native Agent turns | Default 1. Range 1–8 | Reviewed grant |
| One Flow: memory / process tasks | 256 MiB (268,435,456 bytes) / 64 | Fixed |
| One Flow: CPU quota | 0.5 core | Fixed |
| Root: memory / process tasks | 1,792 MiB (1,879,048,192 bytes) / 576 | Fixed |
| Root: CPU quota | 3.5 cores | Fixed |
| Concurrent sibling Flows / exclusive leaf effects | 2 / 1 | Fixed |
| Maximum child Flow levels | 5, subject to whole-branch reservations | Derived |
| Flow cleanup deadline | 5 seconds | Fixed |

Policy owners: [`internal/root-run-timeout-policy.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/root-run-timeout-policy.ts), [`internal/root-operation-limits.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/root-operation-limits.ts), [`internal/native-agent-turn-policy.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/native-agent-turn-policy.ts).

## Capture and deliver files

Binding-retained reads and per-run attachments share the invocation input allowance. Fixed path and capture bounds protect descriptor traversal, transport and delivery.

| Setting or bound | Value | Control |
| --- | --- | --- |
| Invocation input / artifact input / output content | 8 MiB (8,388,608 bytes) / 16 MiB (16,777,216 bytes) / 16 MiB (16,777,216 bytes) | Fixed |
| Files / tree entries | 64 / 256 | Fixed |
| Relative path depth / length | 16 components / 512 UTF-8 bytes | Fixed |
| Input capture / file delivery deadline | 10 seconds / 20 seconds | Fixed |

Policy owners: [`internal/file-input-policy.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/file-input-policy.ts).

## Delegate HTTP requests

Request, response and deadline allowances belong to the reviewed HTTP grant. The original root deadline and supported maxima continue to apply.

| Setting or bound | Value | Control |
| --- | --- | --- |
| `requestBytes` | Default 256 KiB (262,144 bytes). Maximum 8 MiB (8,388,608 bytes) | Reviewed grant |
| `responseBytes` | Default 1 MiB (1,048,576 bytes). Maximum 12 MiB (12,582,912 bytes) | Reviewed grant |
| `timeoutMs` | Default and maximum 60 seconds | Reviewed grant |

Policy owners: [`project/grants.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/project/grants.ts).

## Run project commands and evaluations

These fixed profiles bound reviewed tools and their collected outputs. Evaluation phases also share the evaluation deadline and original root lifetime.

| Setting or bound | Value | Control |
| --- | --- | --- |
| Project Command input files / aggregate bytes | 64 / 256 KiB (262,144 bytes) | Fixed |
| Project Command arguments / bytes per argument | 32 / 1 KiB (1,024 bytes) | Fixed |
| Project Command stdin / retained stream | 16 KiB (16,384 bytes) / 64 KiB (65,536 bytes) | Fixed |
| Project Command deadline | 10 seconds | Fixed |
| Evaluation candidate source | 64 files / 8 MiB (8,388,608 bytes) | Fixed |
| Evaluation collected outputs | 64 files / 8 MiB (8,388,608 bytes) aggregate / 2 MiB (2,097,152 bytes) per file | Fixed |
| Evaluation memory / scratch capacity | 512 MiB (536,870,912 bytes) / 512 MiB (536,870,912 bytes) | Fixed |
| Evaluation total / generate / compile / test deadlines | 60 seconds / 15 seconds / 30 seconds / 15 seconds | Fixed |
| Author declarations evaluated per review | 256 | Fixed |
| Author evaluation deadline per entry: Linux / Mac | 3 seconds / 10 seconds | Fixed |

Policy owners: [`internal/private-project-command.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/private-project-command.ts), [`internal/project-evaluation-policy.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/project-evaluation-policy.ts), [`internal/project-evaluator-policy.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/project-evaluator-policy.ts).

## Exchange Agent protocol messages

These fixed ACP bounds protect one finite conversation. Additional reviewed turns share its byte and frame budgets. Environment variables cannot change the wire contract.

| Setting or bound | Value | Control |
| --- | --- | --- |
| One protocol frame | 16 MiB (16,777,216 bytes) | Fixed |
| Adapter aggregate bytes / frames | 8 MiB (8,388,608 bytes) / 64 | Fixed |
| Client aggregate bytes / frames | 32 MiB (33,554,432 bytes) / 8,192 | Fixed |
| Prompt / public answer text | 1 MiB (1,048,576 bytes) / 8 MiB (8,388,608 bytes) | Fixed |
| Updates / permissions | 4,096 / 256 | Fixed |
| Protocol identifier | 1 KiB (1,024 bytes) | Fixed |

Policy owners: [`internal/finite-acp-policy.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/finite-acp-policy.ts).

## Save checkpoints

The fixed checkpoint profile bounds retained evidence during one root lifetime. Checkpoint success does not reset any Run allowance.

| Setting or bound | Value | Control |
| --- | --- | --- |
| Encoded checkpoint request | 2 MiB (2,097,152 bytes) | Fixed |
| Checkpoint text files / aggregate text content | 64 / 1 MiB (1,048,576 bytes) | Fixed |
| Checkpoint saves | 16 | Fixed |

Policy owners: [`internal/private-run-checkpoint.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/internal/private-run-checkpoint.ts).

## Represent JSON values

JSON/0 is an interoperable value contract. Its representation bounds remain fixed, including when another configurable allowance is larger.

| Setting or bound | Value | Control |
| --- | --- | --- |
| Encoded document / string | 16 MiB (16,777,216 bytes) / 8 MiB (8,388,608 bytes) | Fixed |
| Nesting depth / total value nodes | 128 / 262,144 | Fixed |
| Entries in one object or array | 65,536 | Fixed |
| Member name / number token | 1 KiB (1,024 bytes) / 128 bytes | Fixed |

Policy owners: [`json.ts`](https://github.com/jiggy/jig/blob/main/packages/jig/src/json.ts).

<!-- limit-reference:end -->

## Related constraints and recovery

The dependency byte and file settings cover production preparation. They do
not change source capture, evaluation preparation, alias layout, aggregate
review budgets, or artifact storage. Reused admitted packages consume none of
the new-preparation count or aggregate output allowance.

The captured package store retains evidence from declined and superseded
reviews. It performs no implicit garbage collection and offers no selective
reclamation command. State deletion is not a capacity-recovery instruction.
Follow [results and recovery](results.md) when retained state prevents progress.

Workspace discovery also bounds members, manifests, locks, patches, and tree
traversal. See [workspace capture](../spec/project-policy.md#workspace-dependency-capture)
for those exact rules. A format's larger upper bound does not enlarge a host
task's smaller allowance.

For resource setup, see [Agent settings](agents.md), [HTTP access](http.md),
[files](files.md), and [checkpoints](../spec/run-checkpoint.md). Terminal and
installation preferences belong in [Settings and configuration](configuration.md).
