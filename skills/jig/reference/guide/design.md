---
title: Design understandable Jig projects
description: Compose useful methods with clear local configuration, operator choices, portable source, and evidence for the application's result.
---

<!-- Generated from docs/jig/guide/design.md. Edit the source, then run just sync-skills. -->


# Design understandable Jig projects

Build a project whose purpose, components, configuration, and results are easy to explain and change.
Jig supplies reviewed execution and locally authorized powers.
Flows supply the methods your application combines.

This guide covers project design.
The [quickstart](index.md) teaches creation and execution.
The [project SDK](../spec/project-sdk.md) and [execution policy](../spec/project-policy.md) define exact host behavior.

## In this guide

- [Start with the useful outcome](#start-with-the-useful-outcome)
- [Build from meaningful Flows](#build-from-meaningful-flows)
- [Keep responsibilities distinct](#keep-responsibilities-distinct)
- [Make configuration earn its place](#make-configuration-earn-its-place)
- [Keep powers with their owner](#keep-powers-with-their-owner)
- [Make the project easy to move](#make-the-project-easy-to-move)
- [Make results and recovery understandable](#make-results-and-recovery-understandable)
- [Review the design through change](#review-the-design-through-change)

## Start with the useful outcome

Describe the work the application makes possible before choosing its components.
Identify its inputs, promised result, required effects, and evidence of success.
Make uncertainty and unsuccessful outcomes part of that promise.
Choose the simplest composition that delivers it under the required authority and lifecycle boundaries.

Use the [agent guide](for-agents.md) to add FLOW and Jig skills for Agent-assisted project work.
Keep the application's own instructions focused on its domain, acceptance criteria, and delegated authority.
Link to shared guidance instead of copying it into every project.

A reader should find the ordinary invocation without understanding the complete internal design.
Use a reviewed [project entrypoint](configuration.md#project-entrypoint) when it simplifies that invocation.
Keep advanced options with the situations that need them.
An entrypoint supplies defaults, while an explicit target bypasses those defaults.

## Build from meaningful Flows

Apply FLOW's [design guidance](https://flow.jig.md/guide/design) when choosing component boundaries, names, and public promises.
That guide owns meaningful decomposition, orthogonal responsibilities, composition, and portable method design.
Use the FLOW skill when authoring or reviewing those methods.

Keep the application's coordination readable through its child calls and outcome handling.
Give each child the inputs and effects its capability needs.
Compose Flows through invocation slots rather than importing another Flow's private implementation.
Keep ordinary library helpers inside the method that owns them.

Make domain decisions explicit in the application or its methods.
Jig does not need a new primitive for each application policy, graph, or Agent technique.
Use [workflow design](workflow-design.md) to choose where code, Agent judgment, and additional coordination help.

## Keep responsibilities distinct

Give each choice one clear owner so unrelated changes remain local.
Use this division when reviewing a project:

| Responsibility | Owner |
| --- | --- |
| Domain procedure, prompts, validation, and bounded control | The Flow |
| Purpose, acceptance policy, domain state, and user experience | The application |
| Reusable local settings, exact child selections, and proposed grants | A Binding, when that configuration is needed |
| Agent clients, credentials, infrastructure, and acceptable powers | The operator |
| Review, admission, containment, limits, and accountable execution | Jig |

A Binding is a reusable project-local configuration for one Flow.
It lets local choices vary without rewriting the method.
The [project SDK](../spec/project-sdk.md) defines which choices it can express.

Keep presentation dependent on application state and observed facts.
Required work belongs in the method's explicit execution path.
Optional progress listeners should not acquire responsibility for completing the application.
Use [channels](channels.md) for observation and [results](results.md) for terminal evidence.

## Make configuration earn its place

Start with a direct Flow target when its empty settings and resolved dependencies satisfy the task.
Add a Binding for a meaningful configured use, explicit child selection, reviewed resource, or grant.
A Binding for every Flow is unnecessary.
Name each Binding by its configured role when several uses need distinction.

Use ordinary input for job data and `settings` for reviewed configuration.
Settings form one complete value and are not merged with per-run overrides.
Keep declarations inert.
Do not read files, request network access, fetch secrets, or run application work while evaluating project declarations.

Use [default providers](../spec/project-sdk.md#default-providers-by-contract) for a project-wide choice of an ordinary contract implementation.
Use an explicit slot when one configured use needs a different implementation.
Jig resolves these choices during review and retains exact routes.
An explicit selection must match rather than silently fall back.

Direct targets use their own empty settings and reviewed routes.
Running a Flow directly never borrows configuration from a Binding that happens to select it.
Verify the intended target with `jig inspect <target>` after approval.

**Example: Reusing a method with local guidance.**

Two teams could use one document-summary method with different reviewed audience guidance.
Separate Bindings could name those configured uses without copying the method.
If audience guidance changes for each job, ordinary input could be the better boundary.
The choice depends on what the application considers reusable configuration.

Keep small resource policies inline where they are used.
Extract a named [grant](../spec/grants.md) when reuse or independent ownership makes that policy easier to maintain.
Avoid layers of configuration that only rename another declaration.

## Keep powers with their owner

Let the operator choose Agent clients, credentials, and resource policies through the documented [setup](agents.md).
Supply method instructions and bounded context through the method's interface.
Keep secrets out of Flow source, inputs, settings, artifacts, and diagnostics.
Declaring a dependency or installing a skill does not grant it execution authority.

Give each configured method only the powers and data needed for its responsibility.
Keep consequence policy in the application, including any approval already delegated by its owner.
Do not add repeated manual approvals for work already authorized.
An Agent's plausible answer cannot enlarge that authority.

Keep source changes and execution approval distinct.
Review the proposed source, selected implementations, settings, and grants before admitting changed work.
Use existing authorization to decide whether approval can be automated.
Dependency-resolution permission and authority-change approval have separate meanings in [review](configuration.md#per-command-options).

Treat a replacement as a change worth checking.
A matching contract establishes interface compatibility, not equivalent judgment, effects, quality, or cost.
Review the new selection and exercise the application's acceptance cases.

## Make the project easy to move

Keep the method's dependencies and resources with their declared owners.
Each importing Flow declares its own runtime dependencies.
The project manifest separately declares dependencies used by `jig.ts` and its `npm:` targets.
Use ordinary declared workspaces when sharing local libraries.
Follow [dependency preparation](dependencies.md) for supported locks and required build output.

Use project-relative paths in declarations and declared attachments for external job files.
Pass attachment paths supplied by the host to the method.
Avoid assumptions about a developer's checkout, home directory, or ambient `node_modules`.
Binding attachments are reviewed resources, while per-run inputs are captured for each invocation.
Use [file guidance](files.md) to choose the appropriate lifetime.

Keep project membership understandable when reorganizing directories.
`discover()` selects immediate members and does not recurse or interpret globs.
Update discovery roots or exact membership when moving components.
Binding package paths resolve from the project root.

Share source, declared dependencies, supported dependency locks, and `jig.lock` as appropriate for the project.
The protected `.jig/` directory contains local admission and lifecycle state.
It does not move as project source or transfer permission to another host.
Review on the destination host with its operator's configuration and supported execution prerequisites.

## Make results and recovery understandable

Define what completion means before adding a progress display.
Required checks and effects must finish before the application reports its promised outcome.
Keep proposals visibly provisional until application checks accept them.
Choose output that lets the recipient understand both the result and any remaining decision.

Read execution status, application outcome, output delivery, and cleanup evidence separately.
A successful invocation can return an unsuccessful domain outcome.
An optional channel completing does not establish that the method completed.
Use [results and recovery](results.md) for those distinctions and diagnostic steps.

Choose a retained output destination when the user needs files beyond temporary storage.
Jig never replaces an earlier result directory.
Preserve useful partial evidence when later work fails.
Do not describe an undelivered result as saved.

Bound repeated work by explicit stopping conditions and the applicable limits.
Wait for owned work to settle after interruption.
Preserve uncertainty when a remote effect might already have occurred.
Do not automatically replay such work to obtain a cleaner-looking result.
Cancellation cannot reverse a completed external consequence.

## Review the design through change

Use the project's ordinary public commands and artifacts to verify its claims.
Select the checks relevant to the boundaries changed and the qualities promised.
Test a useful result and an affected failure case.

| Probe | Evidence to seek |
| --- | --- |
| Explain | A reader can trace the entrypoint, child responsibilities, required powers, and result without reading every implementation. |
| Reconfigure | A local policy or setting changes at its owner without unrelated method edits. |
| Replace | Another matching implementation passes the same application checks after review. |
| Move | A separate consumer project uses declared dependencies and local approval without private checkout knowledge. |
| Fail | Invalid input or a failed child produces an understandable outcome and preserves relevant evidence. |
| Stop | Cancellation settles owned work and leaves external effects honestly described. |
| Observe | Removing optional observation preserves required work and the promised result. |

Judge the whole consumer task, including setup, configuration, invocation, and recovery.
Remove indirection that adds no useful capability or enforceable boundary.
Keep the boundaries that make the work independently understandable, replaceable, and accountable.
Report inspection separately from execution when required host or provider support is unavailable.
