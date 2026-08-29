# Project Run-target review-delta checkpoint

**Status:** implemented privately on 2026-08-29. This checkpoint makes a
changing Run universe reviewable without making its derived summary another
authority model.

## 1. One navigation delta over complete evidence

The bounded Project Plan review already exposes complete current and proposed
portable state. Its `changes.flowCallSlots` index now names every Flow-call
slot whose current or proposed source is `project-run-targets`:

```text
<binding>/<slot>
    source.current
    source.proposed
    targets.added
    targets.removed
    targets.changed
```

Binding and slot identifiers are LocalNames, so `/` is an unambiguous
separator. Target entries are canonical `flow:<path>` or `binding:<id>`
identities.

The summary is deliberately derived. The full current and proposed lock and
target projections remain the review evidence, while only the retained Plan
digest is apply authority.

## 2. Private changes stay visible but undisclosed

A target is `changed` when its protected Candidate record changes, including
an implementation, request, final recipe, observation, unavailable code, or
evidence revision. The review emits only the affected target identity. It does
not expose private recipe, host-observation, evidence, runtime, Backend, or
coordinator values.

The renderer computes the complete raw target delta once and reuses the
resulting changed-identity set for every changing slot. It never compares a
large target record once per marker. Per-slot work is therefore only ordered
membership over that slot's already-bounded retained expansion.

## 3. Deliberate exclusions

This checkpoint does not:

- filter a slot for one caller;
- decide whether a target is runnable;
- persist a Resolver decision;
- invoke Semantic Choice;
- alter Plan/2, Candidate/5, Lock/3, or Activation Request/2; or
- publish the private `projectRunTargets()` authoring overlay.

It closes only the human-consent surface needed before later runtime use.

## 4. Evidence

```text
focused review rendering tests       6 / 6
assertions                              38
TypeScript build                    passed
```

The matrix covers source changes, additions, removals, private
recipe/observation/evidence-only target changes, redaction, multiple changing
slots sharing one raw target comparison, deterministic ordering, and the
existing complete-review size gate.
