# Scenario: one ticket through a software factory

This is a tabletop story, not an invocation guide.

## Admitted starting point

One reviewed project generation contains:

- exact package and host-capability revisions for every Binding;
- a canonical Journal Binding permitted to publish only the inbox Event type;
- one Hook revision from `inbox-producer` to `triage`;
- one Spindle triage package with two fixed outgoing strategy Flows;
- an exact Agent Run Binding for factory work;
- an exact Semantic Choice provider backed by a separate attachment-free Agent
  Binding;
- two approved research Flow Bindings in the triage slot's frozen candidate
  snapshot; and
- an operator-started repair Flow with only a staging workspace.

The missing `jig.lock` is allowed only for this fresh unlocked probe. The first
real plan would propose a complete lock and admission generation together.

## Happy path

1. A person explicitly starts `inbox-producer` with
   `examples/inbox-producer.input.json` and a project-local submission key.
   This probe deliberately has no watcher Service.
2. The producer reads `inbox/TICKET-001.md` from its read-only attachment and
   calls the exact Journal effect with a stable operation ID. It supplies only
   event type, data, and subject.
3. The Journal atomically commits the Event, append result, matching Hook
   selection, and derived-Run outbox record. The complete illustrative Event is
   shown in `examples/inbox-item-created.event.json`.
4. The Hook-derived `triage` Run receives that exact immutable Event, not only
   its `data` field. Its identity is deduplicated by Hook revision and Event ID.
5. Spindle presents the Router's actual local edges—`gauntlet` and
   `majority-vote`—to the exact `choice` capability. The returned opaque route
   ID maps to one already connected Flow. It contributes no parameters,
   authority, package discovery, or installation.
6. If `gauntlet` wins, its first node calls Jig through the
   `reference-research` slot with the Event and one intent. Jig's Resolver
   freezes and filters the two approved Binding revisions, then its configured
   Semantic Resolver may select one once. This is not the Spindle route.
7. The selected child Flow runs under its own Binding and package identity.
   It does not inherit triage's workspace, grants, or skills.
8. The sketch stops short of claiming how the child result and immutable root
   Event reach later nodes. Spindle still needs the smallest explicit
   runner-local value/state rule; Jig must not solve that with input mappers or
   implicit cross-Flow inheritance.
9. Agent nodes in the selected local strategy call the exact `agent` effect.
   For those operations only, Jig projects the triage package's admitted
   `skills/` tree read-only and gives the operation the exact workspace owned
   by `work-agent`. The Spindle caller has no workspace view. Reference research
   uses the same exact attachment- and tool-free `analysis-agent` Binding as the
   Semantic Choice adapter.
10. A complete root response is buffered; child admission closes; Agent,
   child-Flow, process, and projection owners quiesce or are fenced; only then
   can normal result validation and Run success commit.

## Distinct missing-repair path

For the negative fixture, deterministic filtering leaves zero eligible
research candidates. The unresolved `flow/call` and owning triage Run terminate
with `BINDING_MISSING`. That host-operation failure is not disguised as the
Flow's domain `blocked` outcome, which remains reserved for Router abstention.
It does not wait, reroute, or synthesize a provider.

An operator may deliberately start `create-missing-flow` with the durable
diagnostic. Its Agent writes a proposed package and Binding only to
`repair-staging/`. The proposal remains inert until normal project capture,
plan, review, and compare-and-set apply. A new ticket Event or explicit new
root attempt uses the later generation; the old Hook occurrence and Run are
never replayed or healed.

## What the scenario is not claiming

The shared `workspace/` is suitable only for this single-ticket tabletop. A
real concurrent factory needs an explicit workspace allocator, isolated
Bindings, or serialization. The probe also does not define how an external
inbox writer becomes a long-lived Service, how Spindle derives operation IDs,
how Spindle carries root input and named node results, or how a repair proposal
is imported into project source; those are recorded as open seams rather than
hidden behavior.
