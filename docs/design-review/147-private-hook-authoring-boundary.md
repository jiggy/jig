# Private Hook authoring boundary correction

**Status:** closed on 2026-08-27 for inert authoring evidence only. Hook
interval admission, Event selection, derived Runs, scheduling, and public
authoring remain open.

## 1. Why the first shape was rejected

The initial implementation added `hooks` and `defineHook` directly to the
already frozen Project Authoring SDK/1 and its public machine schema. Although
the declaration itself was inert, that silently changed a profile whose
independent-consumer gate had already closed. Removing only the root
`defineHook` export was insufficient: root `defineJig` would still have
accepted a field rejected by its own public schema, and the sealed evaluator
would have given the same `@jigging/jig` specifier context-dependent exports.

The correction keeps all three authorities consistent:

```text
@jigging/jig
    -> frozen Project Authoring SDK/1
    -> project-authoring-1.schema.json
    -> no Hook field or helper

@jigging/jig/experimental/hooks
    -> explicitly unstable Hook overlay
    -> private-project-authoring-hooks-1.schema.json
    -> private evaluator bundle and exact resolver branch
```

The experimental module is a development seam, not an implied SDK/2. A public
revision requires completed runtime semantics and a new independent consumer.

## 2. Relation identity is not execution identity

The initial `definitionDigest` mixed authored relation data with only part of
resolved publisher and target meaning. It could churn when an unrelated Event
type was added to the publisher, yet remain stable when behavior changed
through a transitive Binding dependency. It therefore could not safely name
an executable Hook revision.

The corrected lock contains one recomputable `relationDigest` over exactly:

```text
Hook ID and declaration path
publisher Binding reference and authenticated source spelling
exact Event type
exact Flow or Binding target reference
```

Strict lock decoding recomputes this digest. Adding unrelated publisher
authority does not change it; changing the selected type, publisher, or target
does.

Admission must later derive a distinct Hook revision from this relation plus
the exact selected publisher meaning, target activation request/closure,
admission generation, and interval boundary. The authoring/link layer cannot
mint that revision early.

## 3. Preserved exclusions

This checkpoint creates no Hook table, active interval, Journal selection,
derived Run, scheduler work, callback, wildcard, transformation, replay,
watcher, or public control-plane member. Hook declarations remain proposed
source until a later admission transaction pins their complete executable
meaning.
