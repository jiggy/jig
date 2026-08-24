# Open candidate: default Run targets and catalogue-wide routing

**Status:** non-normative interface question. The failed design probes exposed
two real ergonomic requirements but did not earn their proposed mechanisms.

## Requirements which survive

1. A simple discovered Run package should be runnable without one routine
   Binding declaration per package.
2. An application should be able to request semantic selection from a changing
   but explicitly reviewed candidate universe.

Neither requirement permits discovery to grant authority. Every executable
target and every semantic candidate must belong to one immutable admitted
generation before a Run can use it. Semantic Choice may rank only that frozen
set.

## Question A: the simple root target

Two plausible models remain:

### Internal default Binding

Jig normalizes a narrowly eligible simple package into the same internal
Binding representation used by configured variants.

Advantages:

- one execution, admission, revocation, Hook, and lock path;
- no public second target kind; and
- simple packages are immediately ergonomic.

Risks:

- a hidden derivation algorithm becomes surprising policy;
- name collisions and eligibility boundaries become framework magic; and
- a Binding intended for customization becomes mandatory internal ontology.

### Direct admitted Flow target

The admitted catalogue exposes a simple package revision directly as a Run
target, while configured Bindings remain explicit variants and capability
uses.

Advantages:

- the public model says exactly what happened; and
- Binding keeps its intended role as reusable configuration/customization.

Risks:

- Jig must prove that direct targets do not create a second security,
  idempotency, Hook, or revocation path; and
- target references need an unambiguous kind and collision rule.

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

## Acceptance method

Do not settle these questions inside another probe. First publish two minimal,
competing authoring interfaces with their normalized data models. Give only
those interfaces and the stable platform documentation to independent
consumers. Choose the smaller model that satisfies both requirements without
granting discovery or Semantic Choice admission power.
