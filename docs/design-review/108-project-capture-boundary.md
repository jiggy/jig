# Project capture boundary

**Status:** reviewed implementation boundary for the next private Jig slice.

The Project Authoring SDK produces inert values. Those values are not a
project snapshot, a resolution plan, or admission evidence. Jig must cross
three explicit stages before desired state can become live:

```text
authored values
    -> captured project aggregate
    -> resolved admission candidate
```

Conflating these stages would either make mutable project files part of
resolution or turn the TypeScript evaluator into an accidental project
runtime.

## 1. Transient authored values

`defineJig()` and `defineBinding()` return bounded JSON/1 values. The future
evaluator obtains exactly one default export from each captured declaration
module and validates it with Project Authoring Schema/1.

Authored values have no durable identity or authority. They may contain source
instructions such as `discover("flows")`; they never contain discovered
members, package snapshots, provider choices, grants, locks, or runtime plans.

Evaluation is necessarily bootstrapped in two steps:

1. capture and evaluate `jig.ts` and its allowed static import closure;
2. expand the resulting sources, capture their members and declaration
   closures, then evaluate those declarations from captured bytes.

The evaluator will be implemented only after its semantic consumer exists. It
will have no package, resolver, authority, or admission responsibilities.

## 2. Captured project aggregate

The first record resolution may consume is one host-private captured
aggregate. It owns:

- the opened project-root identity;
- the complete captured configuration/declaration closure and exact evaluator,
  authoring-SDK, and toolchain identities;
- one membership receipt for every configured source, including a missing
  discovery root and the exact selected members and their origin roots;
- immutable complete Package/1 trees and their inspection facts; and
- normalized declaration values with source-closure provenance.

Every selected source path has one candidate-wide byte identity. If two
declaration closures share a file, both use the same captured blob. A changed
or conflicting second observation rejects or retries the whole capture.

Discovery expands to an exact finite member list during capture. Resolution
never runs discovery. Missing discovered roots are recorded empty; missing
exact members reject. Roots form an unordered union. Duplicate membership,
repeated physical identities, malformed selected members, and NFC or Unicode
case-fold collisions reject the complete aggregate.

Traversal is descriptor-relative beneath one opened project root. Every path
segment is opened without following symlinks. Calling the existing absolute
pathname package capturer after resolving a string is not sufficient because
an ancestor could be replaced. Protected `.jig` state is never project source.

After a Flow member is selected, Jig captures and inspects that exact opened
directory. Qualification and later inspection never use different pathname
observations. Mutable discovery roots are fingerprinted before and after
member capture; an observed change retries the whole capture. This catches
ordinary concurrent edits but does not claim an atomic filesystem snapshot or
defeat a malicious mutate-and-revert race.

The existing anonymous `O_TMPFILE` package snapshot is invocation-local. A
complete captured aggregate is durable only after all referenced bytes have
been copied into protected Jig content-addressed storage. A digest without
retained bytes is not a snapshot. Active generations retain their artifacts
until every pinned Run and Mount drains.

No later stage reopens visible source. Parsing, transpilation, evaluation,
package inspection, schema/contract recompilation after restart, resolution,
planning, apply, and materialization consume protected captured artifacts.
Any failure disposes the whole unpublished aggregate.

## 3. Resolved admission candidate

Resolution consumes only a captured aggregate and exact immutable snapshots of
the active generation, lock, host policy, installed registrations, Runtime
Adapters, Sandbox Backends, and provider generations. Its private result pins:

- exact direct Flow and Binding target identities;
- the dependency graph and contract compatibility;
- settings, attachment, and skill projections;
- readiness recipes or exact unavailability;
- requested and would-grant authority;
- lock and generation proposals; and
- every resolution-input snapshot identity.

Apply is a compare-and-set over that result. It does not reevaluate modules,
rediscover members, reread source, reselect providers, or silently substitute
new host machinery. A missing retained artifact invalidates the candidate.

Direct Flows and configured Bindings remain distinct source identities:

```ts
type RunTargetIdentity =
  | { readonly kind: "flow"; readonly path: string }
  | { readonly kind: "binding"; readonly id: string };
```

They converge only in the internal planned execution path.

## 4. Two digests, two questions

A source-capture digest and a semantic candidate digest answer different
questions:

```text
capture digest
    Which exact source observation produced this candidate?

semantic candidate digest
    Which executable behavior, dependencies, authority, and exact artifacts
    would this admission install?
```

The capture digest includes declaration bytes and evaluator provenance. A
comment or formatting edit therefore creates a new capture. The semantic
candidate digest is computed only from normalized resolved meaning; it still
includes exact executable Package/provider artifacts, so executable source
changes are never formatting-only.

An apply request is bound to the exact reviewed capture and active-generation
base. If either pointer changes, that request is stale. Jig may independently
resolve the newer capture. When its semantic digest is identical, Jig records
the new capture as equivalent observation without manufacturing an authority
or behavior change and without replacing pinned execution artifacts. It never
silently retargets the old apply request.

## 5. First implementation checkpoint

The next slice is deliberately smaller than the durable aggregate:

1. add descriptor-relative opened-directory Package/1 capture;
2. privately capture one Flow source as an invocation-local cleanup owner;
3. derive zero-configuration direct Run targets from the captured inspection;
4. prove discovery, exact membership, collisions, mutation isolation, partial
   failure cleanup, and direct-target eligibility.

This checkpoint publishes no API and makes no durability or admission claim.
It must not add the evaluator, aggregate schema, locks, readiness, Runtime
Adapter or Sandbox selection, host registrations, Semantic Choice, Hooks, or
authority planning.

The subsequent order is:

```text
protected durable content store
    -> pure package/Binding semantic aggregate over injected values
    -> bounded TypeScript evaluator
    -> resolution and admission
```

The ordering gives each mechanism a proven consumer and keeps the evaluator
from becoming a general-purpose TypeScript loader.

## 6. Public schema disposition

`project-authoring-1.schema.json` remains the only public project schema. It
describes one authored default-export value, not a project aggregate.

The captured aggregate and resolved candidate remain private records. A public
normalized Project Policy schema is withheld until Hooks, Semantic Choice,
host-capability registrations, the lock, host policy, and durable candidate
storage have closed. Compiled Schema objects themselves need not be serialized:
protected package artifacts retain the exact schema/contract bytes and verified
digests from which Jig can recompile.
