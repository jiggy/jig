# Private deterministic resolution observation checkpoint

**Status:** implemented private, non-admissible checkpoint. It publishes no
Resolver, Runtime Adapter, recipe, lock, plan, consent, admission, generation,
or execution API.

This slice proves that one authentic retained package project can be combined
deterministically with one closed trusted-host planning observation without
reopening visible source. It deliberately stops before claiming that any
observed activation is retained, reacquirable, executable, or `READY`.

## 1. Why this is an observation

The host-planning input currently identifies Adapter, toolchain, inspection,
preparation, Backend, launch-envelope, runtime-closure, and authority facts by
digest and bounded revision text. Those values are useful for testing exact
coverage, selection, propagation, and semantic identity. A digest alone does
not retain the referenced bytes or identify how an extension export can be
reacquired after restart.

The implementation therefore uses explicit observation vocabulary:

```text
activation-recipe-observation/1
activation-planning-observation/1
package-project-resolution-observation/1
```

Every package resolution observation carries `admissible: false`. No later
plan, lock, admission, or execution owner may consume it as an exact recipe.
The next recipe boundary must first retain or authenticate every mechanism and
plan artifact needed to reacquire and execute the selected branch.

## 2. Provenance authentication

The pure reducer accepts one factory-authenticated package-project linker
value so its deterministic behavior can be tested, but its capture digest is
caller data. Its result is never authenticated.

Only this path authenticates capture provenance:

```text
factory-authenticated retained aggregate
    + factory-authenticated bounded host-planning observation
    -> retained resolution observation
```

The guard rejects a lookalike result and every result produced by pairing a
linked project with an arbitrary capture hash. This authentication means only
that the observation belongs to the retained aggregate. It does not promote
digest summaries into executable recipes.

Weak-set authentication is invocation-local. Persisted records must later be
strictly decoded, reacquire their referenced artifacts, and pass the owning
factory before a new authenticated view is minted.

## 3. Exact target coverage

Planning must answer exactly one activation request for every direct Run Flow
and every package Binding. Requests are canonically ordered and domain-
separated. A missing, extra, duplicate, wrong-target, or wrong-request answer
rejects the complete observation.

An intrinsically unavailable Service Binding makes every Binding which
requires its capability unavailable. Generic child-Flow candidates do not
propagate availability: they are selected and invoked later through normal
Flow-call resolution. No hidden Binding is synthesized for direct Run Flows.

The current private limit is 4,096 activation targets. One unavailable target
may retain at most 64 unique evidence digests, and the complete observation at
most 65,536. Evidence is copied, sorted, deduplicated, and frozen before
identity is derived.

## 4. Closed trusted-host input

Every planning record and nested union is copied from exact enumerable data
properties. Accessors, symbols, hidden or extra fields, non-plain objects,
Proxy values, sparse arrays, array subclasses, accessor-backed arrays, and
over-limit containers reject before sorting or hashing. The normalized value
contains no callback, command, host path, file descriptor, process handle, or
live lookup.

Preparation plan and Backend preparation-envelope observations must both be
absent or both be present. Extension observations use a bounded ASCII revision
token, but that token is not yet a durable registration lookup identity.

The closed runtime-predicate observation is either empty or contains only
`root-process-mappings`. This records the one reviewed v1 live kernel-file
predicate without creating a public registry. Entropy is unrepresentable. The
first exact Python witness must use the empty set and separately prove that
`/dev/urandom` is absent.

## 5. Identity

New private hashes use the byte preimage:

```text
ASCII(domain) || 0x00 || canonical JSON/1
```

Distinct domains cover retained project capture, activation requests, recipe
observations, planning observations, resolution inputs, observed semantics,
and propagated unavailable-Service evidence.

The checkpoint keeps three questions separate:

```text
captureDigest
    Which exact retained source/evaluator observation was used?

planningObservationDigest
    Which bounded host-policy and mechanism observation was supplied?

resolutionInputDigest
    Which exact capture plus planning observation was reduced?

semanticDigest
    Which normalized package behavior and observed dispositions resulted?
```

Changing only capture provenance leaves observed semantics unchanged but
changes the resolution-input identity. Changing policy changes the planning
and resolution-input identities. Changing an observed selected mechanism
changes semantics. Moving a Binding declaration without changing its ID or
normalized meaning does not change semantics; declaration location remains in
capture provenance.

This `semanticDigest` is observed semantic identity, not the final admission
semantic digest specified by project policy. The latter must include retained,
reacquirable exact recipes.

## 6. Evidence

The ordinary package corpus now proves:

- authentic linker and planning inputs;
- canonical target and evidence ordering;
- exact request coverage and request-to-observation ownership;
- unavailable Service dependency propagation without child-Flow propagation;
- capture, planning-input, and observed-semantic identity separation;
- declaration-provenance exclusion from semantics;
- explicit digest byte-domain vectors;
- preparation pair invariants and the closed runtime-predicate set;
- getter-free descriptor reads plus Proxy, sparse, subclass, and bound
  rejection; and
- immutable non-admissible output and rejection by the retained-provenance
  guard.

The complete `@jigging/jig` corpus passes with privileged Linux tests skipped
unless explicitly enabled.

## 7. Next boundary

The next slice must not persist this observation as a ready candidate. It
must retain and reacquire one generic executable recipe whose complete
selection and launch machinery comes from explicit trusted host policy:

```text
retained Package/1 artifact
    + authenticated Runtime Adapter registration and toolchain evidence
    + authenticated Sandbox Backend registration and finite owner limits
    -> retained READY or exact UNAVAILABLE disposition
    -> reviewed lock-first admission
    -> restart-safe spawn intent and derived launch envelope
    -> Run/1 completion, whole-tree fence, and cleanup
```

The first path remains one direct zero-configuration Run package. It should
close only the candidate Adapter, Backend, host-policy, lock, and root-Run
models needed for that vertical path, without assuming Nix or another package
manager. The archived host-runtime experiment and current roadmap are recorded
in
[`130-nix-experiment-disposition-and-next-slice.md`](130-nix-experiment-disposition-and-next-slice.md).
