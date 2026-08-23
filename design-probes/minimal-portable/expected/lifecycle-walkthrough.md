# Tabletop lifecycle walkthrough

This is a nonnormative review narrative, not a proposed Journal, trace, CLI, or
serialization format. It records only the ordering this probe requires.

## Candidate and admission

1. Capture an immutable snapshot of `jig.ts`, the configured source
   memberships, both Binding declarations, and both FLOW package trees.
2. Parse package metadata and the optional conventional schemas without
   executing either implementation.
3. Resolve both Binding package references from the project root and validate
   their complete settings.
4. Against one captured host-policy snapshot, determine for each Binding either
   an exact staged activation recipe or an exact unavailable reason. The recipe
   pins the Adapter/toolchain, preparation plan, launch-planner identity,
   Backend plans, and authority envelope; no package code runs and no concrete
   launch plan exists before the prepared snapshot.
5. Present one aggregate semantic and authority delta. In unlocked mode, also
   propose the initial `jig.lock`; locked mode rejects its absence.
6. After digest-bound compare-and-set approval, publish one immutable admission
   generation containing both Binding identities and their readiness results.

## Ready root Run

For `count-long-words` on a generation where it is ready:

1. Validate the submitted value as bounded FLOW JSON/1.
2. Join or conflict on the project-local submission key. For a new key,
   atomically pin `count-long-words` and the current admission generation and
   allocate one Run.
3. Validate input against `flows/count-text/input.schema.json`.
4. Use only the implementation recipe pinned at apply. Verify its machinery,
   then create a distinct preparation child owner: commit durable spawn intent,
   seal and spawn the pinned preparation through its Backend, record the
   enforcement receipt, and require bounded quiescence or fencing. Accept the
   immutable prepared snapshot only after successful cleanup and safe-tree
   validation.
5. Give that sealed snapshot read-only to the pinned launch planner with the
   closed Run plan. Validate the derived concrete launch against the recipe and
   authority envelope; do not reselect current Runtime Adapters, toolchains,
   preferences, or Backends.
6. Commit a separate final-owner spawn intent, seal and spawn through the pinned
   Sandbox Backend, record its enforcement receipt, then keep one
   `flow/run` request pending while component work is owned by that request.
7. If a complete terminal response arrives, buffer it and close new child
   admission, then quiesce all pending owned operations and resources within
   the fixed bounds.
8. Only after quiescence, validate a normal result against
   `flows/count-text/result.schema.json` and commit success. Cleanup failure or
   expiry prevents success.

`compact-summary` follows the same lifecycle using its distinct Binding,
`render-summary` package, and pinned `deno` implementation recipe.

## Unavailable root Run

For an admitted Binding whose pinned state is unavailable:

1. Perform the same JSON/1 boundary check and submission-key join/conflict.
2. For a new key, pin the Binding/generation and allocate the Run.
3. Validate the input schema.
4. Commit the exact pinned `RUNTIME_*`, `SANDBOX_*`, or
   `IMPLEMENTATION_UNAVAILABLE` terminal result before preparation or spawn.
5. A later host repair and admission generation does not change this Run. The
   same key returns it; a deliberate retry needs a new key.
