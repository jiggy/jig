# Expected lifecycle walkthrough

## Aggregate add/remove sequence

1. G0 captures only `dispatcher`. Its explicit Binding suppresses a same-ID
   default and expands `allRuns()` to the empty snapshot. Apply admits that
   exact state; a call is terminal `BINDING_MISSING`.
2. Adding `echo-upper/` creates G1. Normalization derives `echo-upper`, computes
   the dispatcher's one-entry snapshot and its finite transitive authority,
   then emits one aggregate plan. Before apply, the active G0 snapshot remains
   empty. Applying G1 publishes both revisions atomically.
3. Adding `echo-reverse/` creates G2. Its snapshot is exactly
   `echo-reverse`, then `echo-upper`, ordered by unsigned UTF-8 LocalName. A
   G1 Run remains pinned to G1 while the plan is pending and after G2 applies.
   New G2 Runs see two candidates and terminate `BINDING_AMBIGUOUS` because no
   Semantic Choice Binding exists.
4. Removing `echo-upper/` creates G3. Until aggregate apply, new root Runs
   still use the active G2 generation. G3 apply atomically closes new G2
   admission and publishes the one-entry `echo-reverse` snapshot; existing G2
   Runs retain their pinned records until completion.

## Selection and ancestry

With one survivor Jig selects directly and creates one journaled child
operation. It never calls a ranker. With zero it commits `BINDING_MISSING`;
with two it commits `BINDING_AMBIGUOUS`.

Resolver unit coverage additionally evaluates G2 with active ancestry
`[echo-upper@G2, dispatcher@G2]`. The owner was already excluded at snapshot
construction; call-time ancestry filtering removes `echo-upper`, leaving only
`echo-reverse`, which is selected directly. Filtering may remove a pinned
member but cannot discover or add another. A real recursive topology therefore
requires an explicit `bindingRef()` or `candidates()` edge.

## Finite authority

Normalization walks the exact G2 dependency graph with a visited set:
`dispatcher -> {echo-reverse, echo-upper}`. Each revision contributes its
requested baseline once. Even if a future explicit closed edge creates a
cycle, revisiting a revision contributes no new authority and terminates. The
full reachable union appears in aggregate review; only exact snapshot
identities belong in the portable lock.
