# Open candidate: default Run targets and catalogue-wide routing

**Status:** both questions are resolved at the design level. Question A uses a
direct admitted Flow target. Question B uses the explicit per-slot
`projectRunTargets()` source selected by the clean-room experiment in review
160. The latter remains outside the public SDK until its private expansion and
Plan evidence pass.

## Requirements which survive

1. A simple discovered Run package should be runnable without one routine
   Binding declaration per package.
2. An application should be able to request semantic selection from a changing
   but explicitly reviewed candidate universe.

Neither requirement permits discovery to grant authority. Every executable
target and every semantic candidate must belong to one immutable admitted
generation before a Run can use it. Semantic Choice may rank only that frozen
set.

## Resolved A: the simple root target

The reviewed choice is a **direct admitted Flow target**. Jig does not create a
hidden default Binding.

The rejected alternative was an internal default Binding. Although it would
reuse one internal representation, it would make a user-facing customization
concept into hidden framework ontology, introduce surprising derived names,
and make a no-Binding project appear to contain Bindings it never authored.

An eligible direct target is Run-capable, valid with `{}` settings, and needs no
attachment, dependency, Agent, or instruction mapping. Operational availability
is not an eligibility condition: planning may admit the exact target as
`UNAVAILABLE`.

`flowRef("./flows/review")` and `bindingRef("strict-review")` are distinct
tagged references. Both compile to the same internal admitted-Run-target path,
which must share admission, authority, idempotency, Hook, generation,
revocation, sandbox, and scheduling behavior. Binding therefore retains its
plain meaning: one tailored configured use.

The complete disposition is in
[`107-project-authoring-sdk-slice.md`](107-project-authoring-sdk-slice.md).

## Resolved B: the changing project Run source

`projectRunTargets()` is an explicit Flow-call slot marker. Planning expands it
once against the complete immutable project candidate to direct-eligible Run
Flows and Run-capable package Bindings, retains the source kind, and freezes
the exact sorted targets for admission. Discovery alone changes nothing.

The competing named-view model added a namespace and string reference without
earning useful selection semantics. Named views, tags, filters, predicates,
and composition remain deferred. Ordinary TypeScript constants can reuse the
marker.

Expansion includes a consuming Run Binding itself; invocation-local filtering
removes every exact target already in the active owner chain, while the wait
graph rejects remaining non-runnable cycles. Existing
project work and activation limits reject oversized candidates atomically.
Semantic Choice/1's 256-candidate call bound is separate: more surviving
candidates makes ranking inapplicable rather than permitting truncation,
sampling, retrieval, or implicit batching.

The full rationale, probe evidence, normalized identity reuse, and
implementation gate are in review 160.
