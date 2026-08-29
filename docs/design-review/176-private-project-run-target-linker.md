# Private project Run-target linker checkpoint

**Status:** implemented privately on 2026-08-29. This checkpoint closes only
the deterministic two-phase expansion selected by review 160. It does not
change retained project, lock, admission, Resolver, or runtime semantics.

## 1. Closed behavior

The ordinary Project Authoring linker continues to reject
`projectRunTargets()`. A separate private entry point accepts the sealed
authoring profile and requires its caller to supply the already-owned maximum
activation-target count.

The private linker:

1. prepares the complete immutable Flow and Binding candidate;
2. derives one canonical structural Run catalogue from that complete value;
3. rejects the whole candidate when the complete catalogue exceeds the
   supplied bound;
4. substitutes the same frozen catalogue value into every explicit
   `projectRunTargets()` slot; and
5. charges every substituted expansion to the existing aggregate semantic-work
   budget.

There is no truncation, retrieval, sampling, live catalogue read, fixed-point
iteration, or universe-specific limit. Empty expansion is valid. The catalogue
includes its containing Binding when that Binding is a structurally valid Run
target; runtime ancestor filtering remains a later responsibility.

## 2. Source identity

Every linked Flow-call slot now records the authoring source beside its exact
targets:

```text
exact
candidates
project-run-targets
```

This is a closed source discriminator, not a generic query language. The
dynamic marker is resolved to exact sorted target identities during linking,
but its source remains visible so later lock, review, and admission layers can
distinguish an intentionally changing project universe from a coincidentally
equal fixed list.

All markers in one link invocation share the same deeply frozen target array.
The public linker cannot produce the `project-run-targets` source.

## 3. Deliberate exclusions

This checkpoint does not yet:

- retain the source discriminator or expansion in the project aggregate;
- revise private lock or activation-request formats;
- change Candidate, Plan, admission, or generation identity;
- calculate a review delta;
- filter the pinned set for a particular caller;
- invoke Semantic Choice; or
- widen the existing single-child execution controller.

Those boundaries must be added in separate format, inspection, and runtime
checkpoints. Until the retained-format checkpoint lands, this private linker
is not used by the operational project path.

## 4. Evidence

The focused linker and catalogue suite passes 23 tests with 89 assertions,
including empty expansion, self-membership, multiple markers sharing one
catalogue, exact versus closed-candidate source identity, invalid and exceeded
caller bounds, Service-only aggregate-limit enforcement, aggregate work
exhaustion, immutability, and continued public rejection. The broader
linker/lock/resolution/admission regression passes 50 tests with 275
assertions, and the Jig TypeScript build passes.

The earned claim is only:

> One private linker can deterministically expand every explicit
> `projectRunTargets()` marker against one complete bounded project candidate
> without weakening public authoring or introducing runtime selection.
