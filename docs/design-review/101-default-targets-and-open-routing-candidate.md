# Open candidate: default Run targets and catalogue-wide routing

**Status:** Question A is resolved by the direct admitted Flow target; Question
B remains open. The failed design probes exposed both requirements but did not
earn a catalogue-wide routing mechanism.

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

## Question B: the open candidate universe

Two plausible declarations remain:

### Explicit catalogue-wide source

A small helper denotes every eligible admitted Run target in a named catalogue
or view. The project plan expands and freezes it before activation.

### Named admitted view

Project policy separately declares a reusable candidate view; Flow-call slots
reference that view. This is more explicit and extensible, but risks creating a
query language and additional files before they are needed.

The probe spelling `allRuns()` is not reserved. A future design must specify:

- where the candidate boundary is authored;
- how additions/removals appear in the approval delta;
- collision, recursion, and liveness filtering;
- what portable identity enters `jig.lock`; and
- how large sets fail or are deliberately staged without silent truncation.

Semantic Choice/1 now deliberately limits one ranking call to 256 candidates.
That is not a candidate-universe cap: expansion and deterministic filtering
remain exact, and more than 256 surviving candidates makes the chooser
inapplicable rather than permitting truncation, sampling, retrieval, or
implicit batching.

## Acceptance method for Question B

Do not settle the remaining question inside another probe. First publish two
minimal, competing authoring interfaces with their normalized data models.
Give only those interfaces and the stable platform documentation to independent
consumers. Choose the smaller model that supports a changing reviewed universe
without granting discovery or Semantic Choice admission power.
