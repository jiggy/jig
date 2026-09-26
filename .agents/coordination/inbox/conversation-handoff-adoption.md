# Make existing Agent conversations and handoff easier to adopt

Status: postponed follow-up awaiting triage; not a developer-alpha launch gate.
Package-selected contract import is implemented, and the public contract and
conversation guides already teach it.

## Problem

The remaining Agent package and incident-brief guidance needs to use the
implemented package-selected importer consistently. The incident-brief application
already implements bounded summary handoff; rebuilding it would not address the
burden of adopting its existing collaborators. Ordinary-consumer verification
of the complete documented path remains outstanding.

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
