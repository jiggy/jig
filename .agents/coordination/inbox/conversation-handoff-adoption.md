# Make existing Agent conversations and handoff easier to adopt

Status: conversation walkthrough, package-selected guidance and reviewed incident
entrypoint delivered. The bounded independent native handoff attempt finished
unsuccessfully at its deadline; complete independent handoff adoption remains
unproved. Not a developer-alpha launch gate.

## Problem

An ordinary installed consumer completed the documented two-turn conversation,
including its actual final settlement, on one explicitly selected native model.
The incident-brief application implements bounded summary handoff. A
maintainer-authored installed native run completed it; the independent live
consumer did not receive a handoff packet. Its final terminal was
`DEADLINE_EXCEEDED`, with two independent-worker answers received but no final
worker settlements. The malformed-input case rejected before model work, and a
separate read-only ownership audit found both Runs fenced and released without
recorded residue. Those results do not qualify complete handoff adoption or
identify the deadline's cause. Deterministic application checks are separate
evidence. Further work should diagnose a concrete execution phase rather than
rebuild the application, tune prompts, or repeat the same campaign.
The private profiler now distinguishes native revalidation, containment, launch,
exchange, release and recovery without exposing content or changing authority.
An installed one-shot diagnostic exercised the working stages successfully;
it does not qualify the failed continuing/two-worker handoff path or explain
that failure. Complete independent handoff adoption remains unproved.

## Proposed scope

- Use the delivered package-selected importer in remaining Agent package
  guidance, removing installer-layout knowledge from the ordinary path.
- Apply that path to the existing incident-brief application instructions.
  Keep domain-specific revision policy in the application, not Jig.
- Explain required conversation/event mechanisms and operator grants only
  where needed. Keep one-shot use simple.
- Preserve the distinction between interruption requests, actual turn results,
  observation completeness and invocation settlement. A generated summary is
  fallible context, not authority or independently verified evidence.

## Completion

Verify complete contract import from both root-installed and member-local
dependencies in ordinary consumer projects without specifying physical
installation paths. Missing packages, unavailable descriptors and destination
conflicts must be actionable; invalid offline closures must reject without
replacing the destination. Preserve direct-file import and the project-owned
snapshot semantics: dependency upgrades do not silently replace reviewed
contract meaning. Import must remain offline, execute no package code and grant
no additional authority.

An ordinary consumer can follow the updated public materials to import the
installed contract, configure a compatible Agent, run a continuing conversation
and use the existing bounded handoff application without private maintainer
instructions, dependency injection or installation-layout edits. Verify the
documented path and an understandable unsupported-mechanism or failed-operation
case with focused checks; retain exact artifacts and assistance limits in `.tmp/`.
Any live-model validation needs a separately bounded, authorized brief.

## Exclusions

No new conversation API, host locks, queues, session-replacement primitives,
example-only launcher or general scheduler. No repeat of the historical provider
or comparative-benchmark campaigns; no claim of reliable summaries or handoff
benefit based solely on transport tests.

Owners: `docs/jig/guide/conversations.md`, `packages/agent-method/README.md`,
`examples/incident-brief/README.md`, and their applicable DOX contracts.
