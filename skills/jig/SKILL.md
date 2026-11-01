---
name: jig
description: Jig project creation and use. Use when creating, configuring, composing, reviewing, running, or diagnosing Jig projects, connecting Flows to operator-provided Agents and powers, or embedding Jig execution in an application.
---

# Create and use Jig projects

## 1. Establish the task and available support

Inspect the project's instructions, source, dependencies, and existing configuration before changing them.
Identify the intended result, required effects, acceptance criteria, and authorization already supplied.
Check the installed Jig version and the [supported-host requirements](reference/guide/index.md#supported-host) before promising execution.
Distinguish documented source candidates from the installed package's supported behavior.
If execution is unavailable, continue authorized authoring and state which runtime claims remain unverified.

For a new project, recommend the [FLOW and Jig authoring skills](reference/guide/for-agents.md#install-authoring-skills).
Use the FLOW skill when designing, creating, composing, or reviewing the project's Flows.
If it is unavailable, follow its [canonical design guidance](https://flow.jig.md/guide/design) and the task's FLOW specifications.
Keep portable method guidance with FLOW and host configuration with Jig.
Complete this step when the outcome, existing project state, and execution prerequisites are clear.

## 2. Design the project before its configuration

Read the [project design guide](reference/guide/design.md) before choosing boundaries or reviewing an existing project.
Apply its responsibility and configuration guidance to the actual application.
Use FLOW's naming and decomposition principles for the methods themselves.
Describe which choices belong to the application, each Flow, its local configuration, the operator, and Jig.
Use a short outline or existing project documentation, without requiring another design artifact.

Choose direct targets, Bindings, and default providers according to the configuration the application needs.
Keep domain decisions and required sequencing explicit in the application or its methods.
Keep ordinary input, reviewed settings, captured resources, and operator credentials distinct.
Treat every example as an illustration under its stated assumptions.
Complete this step when each component and configuration has a meaningful responsibility and the ordinary invocation is understandable.

## 3. Create or adapt the project

For creation, follow the [quickstart](reference/guide/index.md#your-first-flow) using the installed CLI.
Use `jig init` for a new project and `jig new` for another Flow in an existing project.
These commands create source without installing dependencies, approving work, or executing it.

Read the [project SDK](reference/spec/project-sdk.md) before editing `jig.ts`, Bindings, membership, entrypoints, or exact dependency selections.
Read [dependency preparation](reference/guide/dependencies.md) before adding libraries, workspace packages, or `npm:` targets.
Select the following references according to the task before implementing their behavior.

| Task | Read |
| --- | --- |
| Operator settings, startup verification, or entrypoint defaults | [Configuration](reference/guide/configuration.md) |
| Code, Agent judgment, or workflow structure | [Workflow design](reference/guide/workflow-design.md) |
| API or native Agent setup | [Agent setup](reference/guide/agents.md) and [Agent Run](reference/spec/agent-run.md) |
| Invoke an Agent method or supply runtime Skill contents | [Agent method](reference/guide/agent-method.md) |
| Markdown methods or executable Skill adaptation | [Markdown methods](reference/guide/markdown.md) |
| Files, captured resources, child artifacts, or output delivery | [Files](reference/guide/files.md) and the applicable [execution policy](reference/spec/project-policy.md) sections |
| HTTP requests or command execution | [HTTP guidance](reference/guide/http.md), [HTTP Request](reference/spec/http-request.md), or [Project Command](reference/spec/project-command.md) |
| Resource authority or named policy reuse | [Grants](reference/spec/grants.md) |
| Managed contract generation | [Contract authoring](reference/guide/contracts.md) and its [exact contract](reference/spec/contract-authoring.md) |
| Live progress, semantic views, or channel composition | [Progress](reference/guide/channels.md), [Channels](reference/spec/channels.md), and [Reporting](reference/spec/reporting.md) |
| Multi-turn Agent work | [Conversations](reference/guide/conversations.md), [control](reference/guide/conversation-control.md), and [Finite ACP](reference/spec/finite-acp.md) |
| Context transfer or retained native conversations | [Handoff](reference/guide/conversation-handoff.md) or [restoration](reference/guide/conversation-restoration.md) |
| Capacity, deadlines, or resource constraints | [Limits](reference/guide/limits.md) and the applicable [execution policy](reference/spec/project-policy.md) sections |
| Invoke Jig from another application or recover a durable attempt | [Application client](reference/spec/execution-client.md) |

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

Read [results and recovery](reference/guide/results.md) before interpreting completion, delivery, failure, or interruption.
Distinguish host execution status, application outcome, output delivery, and cleanup.
Check the actual result against the application's acceptance criteria.
For changed behavior, exercise a representative useful case and an affected failure case through ordinary public interfaces.
Apply the relevant [project design probes](reference/guide/design.md#review-the-design-through-change) to claims about replacement, movement, or observation.

Recover retained evidence through inspection or the application client when available.
Do not repeat possibly dispatched work merely because its result is missing.
Report what ran, which revision and configuration it used, the result, and any unresolved limitations.
For review findings, identify the affected caller, consequence, evidence, and smallest useful correction.
Distinguish design advice from specification violations, and inspection from execution.
Complete this step when the evidence supports the claimed result and remaining uncertainty is explicit.
