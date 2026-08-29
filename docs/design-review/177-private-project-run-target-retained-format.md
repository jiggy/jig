# Private project Run-target retained-format checkpoint

**Status:** implemented privately on 2026-08-29. This checkpoint closes the
retained-format and admission-identity portion of the changing Run-universe
design. It does not close caller-specific filtering, Resolver behavior,
Semantic Choice, or runtime dispatch.

## 1. One exact source remains part of admitted meaning

Every retained Flow-call slot carries both its canonical target list and one
closed source discriminator:

```text
exact
candidates
project-run-targets
```

The source is semantic input, not an explanatory annotation. A fixed
`candidates([...])` slot and a `projectRunTargets()` slot therefore have
different lock and activation-request identities even when they happen to
expand to the same targets in one project revision.

The changing source retains the complete sorted expansion derived from the
same immutable project candidate. Existing admitted operations consume that
frozen expansion and never re-expand against visible source or a live
catalogue.

## 2. Closed private format cut

The private portable lock advances to:

```text
private-package-project-lock/3
```

Lock/3 retains each Flow-call slot's source and exact target expansion. Its
strict decoder reconstructs the complete structural project Run catalogue
from the retained packages and Bindings and requires every
`project-run-targets` slot to equal that catalogue exactly. A missing target,
extra target, duplicate, noncanonical order, or invalid source/cardinality
combination rejects the complete value.

The private activation request advances to:

```text
activation-request/2
```

Activation Request/2 carries the same source and targets in the selected
Binding's slots. Strict restoration rebuilds its nested settings,
attachments, capability references, Flow-call sources, and target identities,
then verifies the request's self-digest. Admission additionally requires that
the request be the exact projection of its retained lock entry; a request
cannot alter a source, expansion, attachment, capability, or direct-Flow
configuration while preserving admission authority.

The retained pipeline enforces the existing aggregate activation-target
ceiling of 4,096 over every package Binding, including Service Bindings, plus
every direct Run Flow. Lock/3 decoding rechecks that aggregate, and activation
request construction rejects an aggregate above the same ceiling. A changing
slot may retain an empty complete catalogue; `exact` requires one target and
`candidates` requires at least two. No format silently truncates a catalogue.

The private admission store advances to schema v18 and rejects older or mixed
database-family files instead of migrating or choosing around protected
authority. Candidate/5 and Plan/2 remain unchanged because they already embed
and identify the self-versioned lock and activation-request values. This is a
private pre-release cut, not a public migration promise.

## 3. Consequences

The operational retained project path now uses the sealed evaluator followed
by the private two-phase linker. Candidate and Plan identity therefore include
the exact source intent and complete expansion before admission. Source
additions, removals, or target-meaning changes require the ordinary reviewed
Plan and explicit apply path; old generations remain immutable.

Strict decoding independently rejects a forged subset or superset for a
changing slot. The host does not trust a persisted marker merely because its
target list is structurally valid.

## 4. Deliberate exclusions

This checkpoint does not:

- filter the frozen set for an active caller or owner chain;
- decide input, readiness, authority, resource, liveness, or wait-graph
  eligibility;
- return `BINDING_MISSING` or `BINDING_AMBIGUOUS` for a runtime operation;
- invoke, persist, replay, or recover Semantic Choice;
- widen the current single-child execution controller;
- publish `projectRunTargets()` in Project Authoring SDK/1; or
- define a public lock, activation-request, admission-store, or migration
  contract.

The earned claim is only:

> One admitted private project generation now retains and revalidates the
> exact changing-source intent and its complete bounded expansion without
> turning that evidence into runtime selection authority.

## 5. Evidence

The closing focused matrix passed:

```text
retained link, lock/request restore, and admission tests          33 / 33
assertions                                                        246
real SQLite Plan/root/child/reopen paths                            5 / 5
SQLite assertions                                                  90
project-session and foreground format regressions                   8 / 8
project-session assertions                                         32
TypeScript build                                                   passed
```

The source-discriminator test proves that a fixed candidate list and a
changing source with the same exact expansion produce different lock,
activation-request, and resolved semantic identities. Existing contained
author-evaluator tests separately prove that only the sealed private authoring
profile can produce the marker; this format cut does not weaken that boundary.
