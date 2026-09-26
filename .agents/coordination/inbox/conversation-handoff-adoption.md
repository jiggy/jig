# Make existing Agent conversations and handoff easier to adopt

Status: postponed follow-up awaiting triage; not a developer-alpha launch gate.
Depends on the selected interface from [installed-contract discovery](installed-contract-discovery.md).

## Problem

The public conversation guide teaches a physical `node_modules` descriptor
path. The incident-brief application already implements bounded summary handoff;
rebuilding it would not address the burden of adopting its existing collaborators.

## Proposed scope

- Use the delivered package-aware importer in the conversation guide and
  relevant Agent package guidance, removing installer-layout knowledge from
  the ordinary path.
- Apply that path to the existing incident-brief application instructions.
  Keep domain-specific revision policy in the application, not Jig.
- Explain required conversation/event mechanisms and operator grants only
  where needed. Keep one-shot use simple.
- Preserve the distinction between interruption requests, actual turn results,
  observation completeness and invocation settlement. A generated summary is
  fallible context, not authority or independently verified evidence.

## Completion

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
