# Project authoring SDK: first closed slice

**Status:** reviewed disposition for the first `@jigging/jig` authoring slice.

The failed probe cycle tried to consume a project SDK before one existed. This
slice closes the smallest useful replacement without inventing host-extension
identities or operational APIs.

## Decisions

1. `@jigging/jig` authoring exports construct inert, deeply immutable plain
   values. They do not inspect files, resolve packages, install providers,
   apply policy, or start work.
2. A narrowly zero-configuration Run package is an explicit **direct admitted
   Flow target**. Jig does not synthesize a hidden Binding for it.
3. A Binding means one tailored configured use. Services, settings,
   attachments, dependency mappings, Agent use, and instruction fallback still
   require a Binding.
4. Flow and Binding targets use tagged references. Raw target strings and
   namespace precedence are invalid.
5. Semantic candidates are finite closed sets. Open catalogue views remain an
   unresolved later interface.
6. Automatic shallow discovery proposes membership only. The existing
   aggregate plan/apply admission boundary remains the authority boundary.
7. The first machine schema describes normalized project-owned desired state,
   not resolved plans, locks, host registrations, runtime recipes, sandbox
   receipts, or active generations.
8. JSON Schema validates closed record shape and lexical constraints.
   Cross-record identity, reference, package-compatibility, attachment, and
   contract invariants belong to deterministic semantic normalization with
   pointer-addressed diagnostics.
9. The public authoring root never contains live administration methods.
   Future authenticated host control belongs at a separate entry point.
10. Host-capability Bindings remain withheld until installed registration
    identity, schema lookup, and provider ABI are closed. Package Bindings are
    sufficient to ship and test this slice.

## Direct target eligibility

A discovered package can be admitted directly as a Run target only when its
closed default configuration exists:

- it is Run-capable and not Service-only;
- `{}` satisfies its settings contract;
- no attachment mapping is required;
- no Flow/effect/Agent dependency mapping is required; and
- no instruction conductor or fallback choice is required.

Implementation and host machinery availability are deliberately not
eligibility conditions. A structurally valid target may be admitted
`UNAVAILABLE`, preserving the reviewed rule that an admission generation pins
readiness or exact unavailability without later substitution.

A direct target and a Binding target enter the same internal admitted-target
path. They share input validation, idempotent root admission, Hook pinning,
runtime and sandbox planning, authority inspection, generation pinning,
revocation, scheduling, and terminal history. Only their source identity
differs.

## First public vocabulary

The first package-authoring slice is intentionally small:

```ts
defineJig(...)
discover(...)
defineBinding(...)
flowRef(...)
bindingRef(...)
candidates(...)
```

The values are closed and JSON-like. Structural omissions normalize as
`settings: {}`, `slots: {}`, and `attachments: {}`. No omission selects a
provider, Agent, runtime, sandbox, authority, fallback, environment value, or
candidate.

Later gated additions include `defineHook`, `serviceExportRef`, instruction
Agent selection, `semanticChoice`, and the host-capability Binding branch.
Their reviewed semantics remain in the domain specifications, but they must
not be added merely to make an example compile.

## Representation rules

- Authors do not write a redundant format-version property.
- Normalized JSON carries the canonical `$schema` URI.
- Unknown keys reject.
- `undefined`, functions, getters, proxies, class instances, symbols, bigint,
  dates, maps, sets, sparse arrays, cycles, and non-finite numbers reject.
- Optional means absent, not `undefined` or `null`.
- Paths accept one authoring `./` prefix, normalize to project-relative `/`
  form, and reject absolute, escaping, empty, backslash, symlink, glob, NFC,
  and case-fold hazards during authoritative capture.
- Helpers provide early ergonomic validation, but their brands are not trust.
  The isolated evaluator and normalizer repeat every invariant.

## Explicit deferrals

This slice does not define an open semantic candidate universe,
host-capability registration tokens, generic grants, protected host producer
registration, Runtime Adapter or Sandbox Backend selection, administration
clients, environment interpolation, profiles, roles, inheritance, variants,
per-Run setting overlays, or the bounded TypeScript evaluator and aggregate
admission implementation.

Those deferrals are boundaries, not placeholders for probe code.
