---
name: jig
description: Jig project creation and use. Use when creating, configuring, composing, reviewing, running, or diagnosing Jig projects, connecting Flows to operator-provided Agents and powers, or embedding Jig execution in an application.
---

# Create and use Jig projects

## 1. Establish the task and available support

Inspect the project's instructions, source, dependencies, and existing configuration before changing them.
Identify the intended result, required effects, acceptance criteria, and authorization already supplied.
Check the installed Jig version and the [supported-host requirements](reference/start/index.md#supported-host) before promising execution.
Distinguish documented source candidates from the installed package's supported behavior.
If execution is unavailable, continue authorized authoring and state which runtime claims remain unverified.

For a new project, recommend the [FLOW and Jig authoring skills](reference/for-agents.md#install-authoring-skills).
Use the FLOW skill when designing, creating, composing, or reviewing the project's Flows.
If it is unavailable, follow its [canonical design guidance](https://flow.jig.md/guide/design) and the task's FLOW specifications.
Keep portable method guidance with FLOW and host configuration with Jig.
Complete this step when the outcome, existing project state, and execution prerequisites are clear.

## 2. Design the project before its configuration

Read the [project design guide](reference/build/design.md) before choosing boundaries or reviewing an existing project.
Apply its responsibility and configuration guidance to the actual application.
Use FLOW's naming and decomposition principles for the methods themselves.
Use `jig inspect --flow` to locate approved relationships, effective settings, contracts, and captured source members.
For unreviewed projects, use source and project guidance. Approval remains a separate decision.

Before changing a shared method, inspect potential callers with `jig inspect --flow <target> --impact`.
Use `--source FILE` with that target to inspect retained implementation bytes.
Without a target, `--source FILE` selects captured project declarations, including Binding modules.

Check workspace changes before treating those bytes as the current editing context.
Explain handoffs through supplied data, returned outcomes, caller reactions, and reachable powers.
Use meaningful identities in graph source, and source-supported alternatives in sequence notation.
Keep configuration facts, source interpretations, application reports, and observations distinct.
Treat descriptions and intents as authored claims. Verify behavior from source or observations.


Describe which choices belong to the application, each Flow, its local configuration, the operator, and Jig.
Use a short outline or existing project documentation, without requiring another design artifact.

Choose direct targets, Bindings, and default providers according to the configuration the application needs.
Keep domain decisions and required sequencing explicit in the application or its methods.
Keep ordinary input, reviewed settings, captured resources, and operator credentials distinct.
Treat every example as an illustration under its stated assumptions.
Complete this step when each component and configuration has a meaningful responsibility and the ordinary invocation is understandable.

## 3. Create or adapt the project

For creation, follow the [quickstart](reference/start/index.md#1-create-the-project) using the installed CLI.
Follow [composition](reference/build/compose.md) when connecting child methods.
Use `jig init` for a new project and `jig new` for another Flow in an existing project.
These commands create source without installing dependencies, approving work, or executing it.

Read the [project SDK](reference/spec/project-sdk.md) before editing `jig.ts`, Bindings, membership, entrypoints, or exact dependency selections.
Read [dependency preparation](reference/build/dependencies.md) before adding libraries, workspace packages, or `npm:` targets.
Select the following references according to the task before implementing their behavior.

| Task | Read |
| --- | --- |
| Operator settings, startup verification, or entrypoint defaults | [Configuration](reference/reference/configuration.md) |
| Code, Agent judgment, or workflow structure | [Workflow design](reference/understand/workflows.md) |
| API or native Agent setup | [Agent setup](reference/build/agents.md) and [Agent Run](reference/spec/agent-run.md) |
| Invoke an Agent method or supply runtime Skill contents | [Agent method](reference/build/agent-method.md) |
| Markdown methods or executable Skill adaptation | [Markdown methods](reference/build/markdown.md) |
| Files, captured resources, child artifacts, or output delivery | [Files](reference/build/files.md) and the applicable [execution policy](reference/spec/project-policy.md) sections |
| HTTP requests or command execution | [HTTP guidance](reference/build/http.md), [HTTP Request](reference/spec/http-request.md), or [Project Command](reference/spec/project-command.md) |
| Resource authority or named policy reuse | [Grants](reference/spec/grants.md) |
| Managed contract generation | [Contract authoring](reference/build/contracts.md) and its [exact contract](reference/spec/contract-authoring.md) |
| Live progress, semantic views, or channel composition | [Progress](reference/build/channels.md), [Channels](reference/spec/channels.md), and [Reporting](reference/spec/reporting.md) |
| Multi-turn Agent work | [Conversations](reference/build/conversations.md), [control](reference/build/conversation-control.md), and [Finite ACP](reference/spec/finite-acp.md) |
| Context transfer or retained native conversations | [Handoff](reference/build/conversation-handoff.md) or [restoration](reference/build/conversation-restoration.md) |
| Capacity, deadlines, or resource constraints | [Limits](reference/reference/limits.md) and the applicable [execution policy](reference/spec/project-policy.md) sections |
| Invoke Jig from another application or recover a durable attempt | [Application tutorial](reference/start/application.md) and [client contract](reference/spec/execution-client.md) |

Use operator-selected Agents, credentials, and powers through their documented configuration.
Installing an authoring skill does not configure a runtime Agent or grant execution authority.
Complete this step when the project expresses the intended method, configuration, and dependencies through documented public interfaces.

## 4. Review and execute the intended revision

Read the relevant [review and execution policy](reference/spec/project-policy.md) before changing authority or starting work.
Inspect the source and proposed changes during `jig review`.
Use the authorization already supplied when deciding whether to approve that exact revision.
Use `--yes` only when that approval is already authorized.
When authorization is missing, present the concrete proposed changes for the operator's decision.

Treat dependency-resolution network permission separately from execution approval.
Do not use it to repair an authored stale lock or grant runtime network access.
Review changed source and configuration before expecting them to execute.
Runs consume approved bytes rather than current unreviewed edits.

Confirm the target and its approved configuration with `jig inspect` when selection is uncertain.
Invoke the intended `flow:`, `binding:`, or declared `npm:` target, or the approved project entrypoint.
For application integration, use the documented client and preserve its attempt identity across recovery.
Complete this step when the intended approved revision has produced terminal evidence, or a precise prerequisite prevents execution.

## 5. Verify the result and explain the evidence

Read [results](reference/build/results.md) before interpreting completion, delivery, failure, or interruption.
Use [troubleshooting](reference/reference/troubleshooting.md) for diagnosis and recovery steps.
Distinguish host execution status, application outcome, output delivery, and cleanup.
Check the actual result against the application's acceptance criteria.
For changed behavior, exercise a representative useful case and an affected failure case through ordinary public interfaces.
Apply the relevant [project design probes](reference/build/design.md#review-the-design-through-change) to claims about replacement, movement, or observation.

Recover retained evidence through inspection or the application client when available.
Do not repeat possibly dispatched work merely because its result is missing.
Report what ran, which revision and configuration it used, the result, and any unresolved limitations.
For review findings, identify the affected caller, consequence, evidence, and smallest useful correction.
Distinguish design advice from specification violations, and inspection from execution.
Complete this step when the evidence supports the claimed result and remaining uncertainty is explicit.
