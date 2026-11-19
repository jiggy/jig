# JOB-001 Locate a workflow edit and its affected routes

> When a workflow owner requests a change, I want to see which decision controls that route and which other paths depend on it. Then I can change the intended behavior and preserve its neighbors.

The **coding agent** is the client. The **workflow owner** describes the change in application terms.
The agent can find files and read local logic. The difficult part is following connections across Flows, callers, and configuration.

## The decision before the edit

The basic request is “When J happens after A, go to C. Keep sending the other cases to B.”
A might call B directly. A might instead return a value to a coordinator that chooses the next Flow.
The caller may use a slot, a named handoff whose target a Binding selects. A Binding is a configured use of a Flow.
Each possibility points to a different place to edit.

Before its first edit, the agent should be able to answer three questions.

- Who makes the decision, and where is it in source or configuration?
- Where does work go today, and where should it go under the requested condition?
- Which other callers, configured uses, or independent entrypoints depend on the same code?

Show the relevant connections together. Let the agent expand a Flow or open its source as needed.
Wiring shows which calls are available. Caller code determines when it makes each call. A Run can show which calls occurred for one input.
If a destination depends on an unresolved choice, point to that choice and keep its possible destinations conditional.

## Use cases

| User goal | Relationship the agent needs |
| --- | --- |
| [UC-001 Redirect one conditional route](UC-001-redirect-one-route.md) | A result produced in one Flow controls the next call in another. |
| [UC-002 Change selected calls through one slot](UC-002-change-selected-slot-calls.md) | Several call sites share a target but represent different requests. |
| [UC-003 Change one configured use](UC-003-change-one-configured-use.md) | Bindings share the implementation and can select different children. |
| [UC-004 Insert validation before a write](UC-004-validate-before-a-write.md) | Several entrypoints can reach the same effect. |
| [UC-005 Find the consumers of a changed result](UC-005-trace-a-changed-result.md) | Some callers handle a result and others forward it. |
| [UC-006 Change a repeat and its exits](UC-006-change-a-repeat-and-its-exits.md) | One result repeats work, another rejoins the main route, and another stops it. |

## FEAT-001 Flow inspection

The [CLI experience contract](../../docs/jig/spec/cli-experience.md) defines `jig inspect --flow`.
The [source inspection guide](../../docs/jig/build/results.md#inspect-source-behavior) explains how to read its results and coverage limits.
The [route-change guide](../../docs/jig/build/design.md#change-a-conditional-route) connects inspection to the application source.

Each use case links to existing executable scenarios for the relationships it needs.
To assess the job, give an unfamiliar coding agent the ordinary request without filenames or selectors.
Record the decision it locates, the neighboring paths it identifies before editing, and which files it opens to connect them.
