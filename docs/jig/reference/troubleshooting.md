---
title: Troubleshooting
description: Diagnose setup, review, execution, conversation, and result problems while preserving evidence and avoiding uncertain replay.
---

# Troubleshooting

Find the failed task or diagnostic below, follow its recovery steps, then return to your task.
For result interpretation, see [Results](../build/results.md).
Setting definitions and numeric bounds remain in [Configuration](./configuration.md) and [Limits](./limits.md).

A missing result does not prove that execution never started.
Before repeating an invocation, inspect retained evidence and confirm that its owned work settled.

| Where the problem appears | Start here |
| --- | --- |
| Installation, Agent checks, dependencies, contracts, or review | [Setup and review](#setup-and-review) |
| Rejected input, execution failure, timeout, or interruption | [Inputs and execution](#inputs-and-execution) |
| HTTP service or request failure | [HTTP requests](#http-request-fails) |
| Agent provider response or method failure | [Agent execution](#agent-execution-fails) |
| Conversation turns, handoff, retention, or restoration | [Conversations](#conversations) |
| Missing updates, files, publication receipts, or retained state | [Results and retained state](#results-and-retained-state) |
| `JIG_CLEANUP_FAILED` or unresolved owned work | [Unconfirmed cleanup](#unconfirmed-cleanup) |

## Setup and review

### Host or approval prevents a Run

| Observation | Next action |
| --- | --- |
| Host support is missing | Check [supported hosts](../start/index.md#supported-host). Jig provides no weaker fallback. |
| The project has no approved target | Complete review and approval before running. |
| A source edit has no effect | Review the change. Runs use accepted source rather than live files. |

### Jig version or build mismatch

`PROJECT_JIG_VERSION_MISMATCH` identifies the running and required Jig versions.
Install the required version using the diagnostic's bun/npm command.
Then repeat review.
Run `jig --version` to identify the executing build.

For contributor builds, use the [documented development environment](https://github.com/jiggy/jig/blob/main/CONTRIBUTING.md#development-shell).
Rebuild from the repository root:

```sh
just jig::build
```

See [version requirements](./configuration.md#jig-version-requirements) before changing the project's requirement.

### Agent client check fails

A selected ACP prerequisite failure stops review without new approval or Flow/model execution.
This includes unchanged reviews, scripts, `--yes`, and reviews containing a ready code target.
An unselected missing client does not block review.
The earlier approved code and client remain unchanged.

Dependency preparation or requested contract generation may already have occurred.
Use the diagnostic's client and location to identify the repair.
Add `--details` for retained observations and unfinished checks.
It performs no additional checks.

| Observation | Action |
| --- | --- |
| Rejected `CODEX_PATH`, `CLAUDE_PATH`, or `PI_PATH` | Correct or unset the override. Jig did not fall back to `PATH`. |
| Installation files could not be verified | Follow [client installation requirements](../build/agents.md#local-clients) for your host and architecture. |
| Codex sandbox helper check fails | Follow the host-specific [Codex setup](../build/agents.md#codex). |
| `PROJECT_ACP_CODEX_LOGIN_LAYOUT` | Use a Jig version that supports your Codex authentication layout. Keep the authentication file intact. Do not remove metadata or reset login to change its layout. |
| An unsupported wrapper was selected | Select its underlying native executable with the appropriate absolute path override. |

Detected alternatives do not establish authentication or compatibility.
For a permanent change, edit the diagnostic's named policy or inline Binding.
For a [review client proposal](../build/agents.md#switching), repeat its client flag on later reviews.
Preserve turn limits and choose model or retention changes deliberately.

Recovery advice adds neither networking permission nor authority approval.
Do not repeat uncertain work to diagnose setup.
After a client starts, use [execution troubleshooting](#inputs-and-execution).

The [Agent setup contract](../spec/cli-experience.md#agent-setup-during-review) defines approval scope, captured locations, command behavior, and report limits.
[Client profiles](../spec/finite-acp.md#native-client-profiles) define supported layouts and qualification.

### Dependency preparation fails

| Observation | Action |
| --- | --- |
| No authored lock exists | Read the [network conditions](../build/dependencies.md#fresh-resolution-and-network-access) before allowing fresh resolution. |
| The supplied lock is stale or invalid | Update it using a supported Bun version. For stale locks, follow [lock recovery](#dependency-lock-is-out-of-date). |
| `PACKAGE_BUN_LOCK_VERSION_UNSUPPORTED` | Use a [supported lock format](../build/dependencies.md#lock-formats). |
| `PACKAGE_BUN_LOCK_REGISTRY_UNSUPPORTED` | Configure the default npm registry and regenerate the indicated lock. Review the new dependency versions. |
| `PACKAGE_BUN_MANIFEST_SOURCE` | Use default-registry versions or [declared workspace members](../build/dependencies.md#local-workspace-packages). |
| `PACKAGE_BUN_WORKSPACE_MOUNT` | Select the [mounted workspace root](../build/dependencies.md#separately-mounted-workspace-roots) explicitly, or use source without nested mounts. |
| `PACKAGE_BUN_WORKSPACE_SOURCE_MISSING` or `PACKAGE_BUN_SOURCE_ROOT_MISSING` | Restore the indicated source or correct its declaration or operator path. |
| `PACKAGE_BUN_WORKSPACE_SOURCE_SYMLINK` | Replace the link with ordinary source. Source-root selection does not permit links. |
| `PACKAGE_BUN_WORKSPACE_SOURCE_INVALID` | Use an ordinary directory at the indicated location. A link or another file type cannot serve as a directory. |
| `PACKAGE_BUN_WORKSPACE_SOURCE_ACCESS` or `PACKAGE_BUN_SOURCE_ROOT_UNREADABLE` | Check permissions at the indicated source location. |
| `PACKAGE_BUN_SOURCE_ROOT_INVALID` | Select a distinct directory below the workspace root that contains declared members. Omit the already selected project root. |
| `PACKAGE_BUN_WORKSPACE_SOURCE_UNAVAILABLE` or `PACKAGE_BUN_SOURCE_ROOT_UNAVAILABLE` | Check that the source remains stable and accessible on a qualified host. |
| A workspace member or build output is missing | Correct the declaration or build the library. Jig never falls back to npm. |
| `PACKAGE_BUN_PROJECT_COUNT_LIMIT` | Check the reported count, effective limit, and source. Increase [`maxPreparations`](./limits.md#override-dependency-preparation-limits) for a larger library, then repeat review. |
| `PACKAGE_BUN_OUTPUT_LIMIT` | Inspect runtime dependencies. Increase [preparation limits](./limits.md#override-dependency-preparation-limits) only when the complete tree is necessary. |
| Approved bytes are missing or corrupt | Preserve the evidence. Jig refuses without resolving again. |

### Dependency lock is out of date

`PACKAGE_BUN_LOCK_STALE` means package declarations changed after the supplied `bun.lock` was created.
Use the diagnostic's command to update that lock from the reviewed project directory.
For a workspace root two levels above, the command is:

```sh
bun install --lockfile-only --ignore-scripts --cwd '../..'
```

This updates the authored lock and may use the network.
Inspect the changed lock before repeating `jig review`.
Updating a lock does not approve execution.
Use a Bun version producing a [supported lock format](../build/dependencies.md#lock-formats).

`--allow-resolution-network` permits resolution when a lock is missing.
It does not repair a supplied lock.
In a workspace, update the root lock instead of adding a separate lock beside each Flow.

### Contract generation fails or is interrupted

A compilation failure leaves previous outputs intact but stale.
Correct the reported authoring error before generating again:

```sh
jig review --generate-contracts
```

Interrupted publication blocks normal review.
The same command settles the recorded batch before processing further edits.
Settling that batch neither reruns the Flow nor approves execution.

Preserve independently edited or unowned files and resolve conflicts before regeneration.
Recovery refuses bytes differing from both the recorded previous file and intended replacement.

Generation requires [the supported Node runtime](../build/contracts.md#runtime-requirements).
See [publication and portability](../build/contracts.md#publication-and-portability) for per-package publication and concurrent-editing limits.

### Reviewed environment changed

`REVIEW_REQUIRED` means the current execution environment differs from the approved revision.
No Flow started for that Run.
Run `jig review`, inspect and approve the proposal, then explicitly start a new Run.

A Jig rebuild, runtime change, Agent configuration change, or changed sandbox support can require review without a source change.
Machine output uses host-only `code: "REVIEW_REQUIRED"`, `details.reason: "EXECUTION_ENVIRONMENT_CHANGED"`, and `details.flowStarted: false`.
Review distinguishes environment-only changes from source, dependency, and permission changes.
The retained combined fingerprint does not identify which individual historical component changed.

If an application request finds a different approval, inspect the selected target and review its source.
Do not silently substitute another approval.

## Inputs and execution

### Input does not match the approved target

If input cannot be parsed, supply valid JSON.
For the greeting, use `--input '"Ada"'` to supply a quoted string.

Run `jig inspect <target>` to compare the input with the last approved contract.
If source or schemas changed, review and approve those changes first.
Otherwise, correct the input to match that contract.

For an `enum` error, choose one of the declared values.
Type errors report expected and received JSON types without printing rejected values.
For example, `Expected string; received object.` requires a JSON string.
Use `jig <command> --help` for command syntax and examples.
See [entrypoint selection](./configuration.md#project-entrypoint) when the wrong target was selected.

### Execution fails without diagnostics

An `EXECUTION_FAILED` result without captured diagnostic text does not establish whether the Flow started.
The public result supplies no more specific cause.
Keep the command and diagnostic code for investigation, and inspect any effects before starting new work.
For unavailable terminal or cleanup evidence, follow [unconfirmed cleanup](#unconfirmed-cleanup).

### Deadline is exceeded

`DEADLINE_EXCEEDED` may identify a contained HTTP request or Project Command's worker phase and limiting budget.
The budget can belong to the root Run, parent Flow, HTTP grant, or Project Command.
Inspect retained evidence before changing a limit or starting another Run.
Increasing `--timeout` helps only when the root Run was limiting and the work fits within its other limits.
Use [Limits and defaults](./limits.md) to find the owning control.

A timeout does not prove that a remote request was rejected or that a command had no effects.
The diagnostic reports an operation as not dispatched only when both conditions hold:

- Its effective deadline expired before dispatch.
- Jig has no unresolved owner for an earlier attempt with the same operation ID.

A retained prior owner keeps a retry uncertain even after Jig settles that owner.
Deadlines after launch retain uncertainty and the host's collected cleanup evidence.

### Protocol or result validation fails

A protocol error means the Flow did not complete Run/0 correctly.
Check its SDK revision and stdout use, then inspect the result and any effects.
Review source or dependency changes before starting new work.

`INVALID_RESULT` can mean an invalid Flow result or a rejected result from one of its operations.
Read the reported cause before changing a schema.
For example, an Agent method can reject an HTTP provider response while the Flow's own result contract remains unchanged.
Use [Agent execution troubleshooting](#agent-execution-fails) for provider and response errors.

### HTTP request fails

Use the reviewed grant and the caller's status check to identify the failing request.
The [HTTP guide](../build/http.md) explains the request boundary and its reference-document example.

| Observation | Next action |
| --- | --- |
| The named credential is unavailable | Supply it through the operator environment for review and execution. |
| The returned status fails the caller's check | Check the reviewed URL, credential, and remote service. The reference-document example requires status 200. |
| The response exceeds its grant | Inspect the expected document size before changing and reviewing `responseBytes`. |
| A timeout or network failure follows possible dispatch | Inspect retained evidence before repeating work. The remote operation may have occurred. |
| Cleanup is uncertain | Follow [unconfirmed cleanup](#unconfirmed-cleanup). Do not automatically replay the request. |

### Agent execution fails

Use the operation path to identify the selected method and Binding.
Jig does not automatically retry these requests.

| Observation | Next action |
| --- | --- |
| Selected native client fails review | Follow [client-check recovery](#agent-client-check-fails). |
| HTTP 401 or 403 | Check the operator credential and account permissions for the reviewed grant. Keep credentials in the operator environment. |
| HTTP 422 | Check the Binding's model, API format, output mode, and token settings. |
| HTTP 404 | Check endpoint and model availability. Either may explain the status. The exact cause can remain unknown. |
| HTTP 5xx | Check provider availability. The response does not prove whether remote work occurred. |
| `blocked` or `limit` | Read the method's output before choosing another action. |
| Transport, execution, or cleanup is uncertain | Preserve evidence. Do not automatically replay work. See [interrupted execution](#execution-is-interrupted) and [unconfirmed cleanup](#unconfirmed-cleanup). |

The [Agent method](../build/agent-method.md#http-outcomes) explains bounded HTTP error
details. Review changed settings or grants before new work.

### Execution is interrupted

Ctrl-C requests cancellation. Wait for cleanup before starting new work.
Completion may have won the race before cancellation.
Cancellation cannot reverse a completed consequence or retract an accepted remote request.

An interrupted command may exit without JSON when no terminal or output connection remains.
Handle that absence without automatic replay.
[Results](../build/results.md#read-an-interrupted-result) explains the available terminal record and exit status.
If cleanup cannot be confirmed, use the [cleanup procedure](#unconfirmed-cleanup).

## Conversations

### Conversation fails or loses observation

Preserve received turns and any known settlement. Inspect the
[helper's retained errors](../build/conversation-control.md#handle-errors-and-observation-loss).
Read `blocked` or `limit` output before choosing further work.
For `cancelled` or `error` turns, inspect settlement before choosing subsequent work.
Check incorrect answers against the supplied facts and correction.

For a selected-client review refusal, follow [client-check recovery](#agent-client-check-fails).
No new approval exists.

For incomplete progress, inspect the actual invocation result separately.
See [live-update troubleshooting](#live-updates-stop).
An accepted interruption does not establish cancellation.
Await the same turn using [interruption controls](../build/conversation-control.md#interrupt-a-turn).

For uncertain execution, follow [interrupted execution](#execution-is-interrupted).
Do not automatically replay work.
Follow [unconfirmed cleanup](#unconfirmed-cleanup) when cleanup remains uncertain.

### Conversation handoff fails

Preserve received answers and every branch result. Do not dispatch a successor
while the predecessor's turn or invocation remains unsettled. The
[handoff sequence](../build/conversation-handoff.md#settle-the-predecessor-before-dispatch)
describes the required order.

For uncertain interruption, follow [interrupted execution](#execution-is-interrupted).
For uncertain cleanup, follow [unconfirmed cleanup](#unconfirmed-cleanup).

### Conversation state is not retained

Inspect the final receipt after invocation settlement.
An `unavailable` receipt is not a reusable reference.
Keep an otherwise valid answer. Do not rerun completed work to obtain a receipt.

| Reason | Next action |
| --- | --- |
| `not-cleanly-closed` | Investigate why native shutdown needed termination. |
| `missing-history` or `unsupported-history` | Compare the installed client version and history features with the [collection profile](../spec/finite-acp.md#retained-native-state). |
| `capacity` | Check [snapshot bounds and expiry](../build/conversation-restoration.md#3-choose-the-reference-lifetime). |

Storage or cleanup errors remain invocation failures.
Follow [unconfirmed cleanup](#unconfirmed-cleanup)
when cleanup remains uncertain.

### Conversation restoration fails

Do not retry a reference after a failed claim.
Failed restoration does not start a fresh conversation.
Check the
[restoration requirements](../build/conversation-restoration.md#2-restore-in-an-authorized-invocation)
against the authorized recipient, ancestry, protected project, and native profile.
Changed accepted code or configuration may invalidate access.

Follow [unconfirmed cleanup](#unconfirmed-cleanup) for uncertain cleanup of owned work.

## Results and retained state

### Live updates stop

Live updates are optional observations. Their absence does not establish execution or application success.
Read the final result and any retained diagnostics, checkpoint, or saved report.
An ended update stream does not prove that owned work settled.
For conversation-specific observation errors, inspect the [conversation outcome](#conversation-fails-or-loses-observation).

### File input or destination is rejected

| Observation | Action |
| --- | --- |
| Input or attachment validation fails | Correct the input and declared mapping. These checks precede package dispatch. |
| A required input file is absent | Supply it in the selected input directory. Inspect the reported failure before starting new work. |
| The destination exists or overlaps an input root | For an explicitly chosen new Run, choose a destination meeting the [packet requirements](../build/files.md#receive-one-packet). |
| Delivery or cleanup is uncertain | Follow [result delivery recovery](#result-delivery-is-unconfirmed) before choosing further work. |

In the [file-copy example](../build/files.md#review-and-run-the-copy), the required input is `note.txt`.
For `--attach source=.`, use a sibling output directory instead of a child of that input root.
A new destination does not resume earlier delivery.

### Result delivery is unconfirmed

Inspect the original destination and retained evidence before starting new work.
Connection loss can leave delivery unknown even when a complete packet exists.
Repeating `jig run` starts new execution and does not resume the earlier delivery.

Read [file evidence](../build/files.md#read-file-evidence) to distinguish accepted results, checkpoints, and delivered artifacts.
Unfinished scratch files are not final results.

An application with its original prepared ticket can read retained results and export available bytes without executing again.
Use the [saved-ticket procedure](#applications-with-a-saved-ticket).
Do not choose another output path to bypass unresolved work.
If cleanup remains uncertain, follow [unconfirmed cleanup](#unconfirmed-cleanup).

### View publication is unconfirmed

Recover the original publication receipt before deciding to publish again:

```sh
jig views receipt --request PUBLICATION_ID --generation ARCHIVE_GENERATION --json
```

An accepted duplicate returns its original receipt and provenance without reinstalling removed views.
Generation-checked removal and reset require explicit current conditions.
The [archive contract](../spec/display-archive.md) owns capacity, evidence, and recovery limits.

### Retained state cannot be opened

`PROJECT_STATE_INVALID` means `.jig` is incompatible with the current build or damaged.
Reinstalling dependencies does not change that state.
Preserve `.jig` and `jig.lock` for recovery, together with the source and dependency locks.

Once prior work is confirmed stopped and cleaned up, move `.jig` and `jig.lock` outside the project.
Run `jig review` for fresh approval.
If cleanup is uncertain, [recover the owned work](#unconfirmed-cleanup) before replacing its state.

A capacity limit is a separate problem. State deletion is not a capacity-recovery instruction.
See [storage constraints](./limits.md#related-constraints-and-recovery) for the applicable limits.

### Unconfirmed cleanup

`JIG_CLEANUP_FAILED` means Jig could not confirm that owned work settled.
It does not establish whether processes remain running or whether external effects occurred.
When both phases fail, `Operation failure` and `Close failure` contain independent approved categories or `UNCLASSIFIED` for unknown causes.
`Operation: completed` means the command operation returned before close failed, without establishing a successful Flow or application outcome.

Preserve diagnostic codes, Jig version, command name, approximate invocation time, output directories, and any application recovery record.
Keep `.jig` and `jig.lock`.
If the original command still owns an attached terminal, request cancellation with Ctrl-C and await its cleanup observation.
Cancellation acknowledgement and process exit do not establish complete cleanup.
Do not delete project state or repeat the command to bypass unresolved work.

#### Applications with a saved ticket

If the task record already exists, recover that task before deciding whether to start different work.
If `AttemptClientError.uncertain` is true, use the recorded ticket without automatically submitting a new request.
The [application tutorial](../start/application.md#recover-after-interruption) shows how to read a saved task.

Use the original prepared ticket through `@jigging/jig/client` or `jig attempt`:

| Operation | Recovery use |
| --- | --- |
| `lookup` | Read the attempt's execution and cleanup observations without advancing work. |
| `cancel` | Request cancellation, then observe cleanup separately. |
| `result` | Read retained output and artifact availability when present. |
| `export` | Publish available retained bytes without executing the method again. |

Interpret execution, cleanup, and retained-byte observations independently.
Missing or expired history does not establish that execution never started.
Preserve the execution observation when output expires or becomes unavailable.
Missing bytes do not authorize repeating effects.
Keep tickets and request contents out of command arguments and public reports.
The [execution client contract](../spec/execution-client.md) explains saving the complete prepared request before submission.

#### Ordinary CLI runs without a ticket or packet

The attempt interface requires the original ticket.
Jig has no generic command to discover or force-clean an ordinary CLI invocation without that identity.
`jig inspect` reads approved target information and cannot establish that this invocation settled.
Saved-result inspection requires an existing packet and does not cancel work.

Without a recovery identity or usable packet, preserve state and request a maintainer-directed recovery procedure.
Report bounded diagnostic codes and version without attaching private state or application data publicly.
State that cleanup remains unconfirmed and no usable result is available.
A missing result or unknown cause does not permit replay.
