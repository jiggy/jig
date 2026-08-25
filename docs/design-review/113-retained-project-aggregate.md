# Retained package-project aggregate checkpoint

**Status:** implemented private package-only checkpoint. It publishes no
project administration, resolution, consent, lock, admission, Runtime Adapter,
Sandbox Backend, Hook, or host-capability API.

This checkpoint closes the first complete consumer of project authoring. One
operation turns mutable package-only project source into one authenticated,
retained, pure-linked candidate. A failed operation never returns a usable
partial project.

## 1. One candidate owner

The operation opens the visible project root once and retains that descriptor
through the complete capture. All author modules, Binding discovery roots,
exact Binding members, and Flow source roots are traversed descriptor-
relatively beneath that owner. The visible root pathname is checked against the
opened device/inode identity throughout and immediately before publication.
Root replacement rejects the candidate.

The mutable-directory adapter still does not claim an atomic filesystem
snapshot or defeat a malicious mutate-and-revert race. Each selected file tree
and membership source performs its own bounded before/after verification. This
is the fidelity already specified for mutable Package/1 sources.

## 2. Two-stage declaration bootstrap

Project membership necessarily bootstraps from `jig.ts`:

```text
capture jig.ts static closure
    -> evaluate normalized Jig definition
    -> expand exact Binding membership
    -> recapture jig.ts + every Binding entry as one shared closure
    -> prove every bootstrap module and edge is unchanged
    -> reevaluate jig.ts and require the same normalized output digest
    -> evaluate every Binding entry from that shared closure
```

The recapture is not a merge of independently read modules. One module reached
by several entries has one byte identity in the complete closure. A Binding
source records missing discovery roots, exact selected members, their origin
roots, and canonical order. Discovery admits immediate regular
`<LocalName>.ts` files only. Exact membership remains fail-closed. Symlinks,
hardlinks, wrong kinds, duplicate IDs, protected paths, source mutation, and
NFC or Unicode case-fold collisions reject the complete operation.

Project evaluation happens twice intentionally. The first result supplies only
membership instructions. Only the second result, proven against the complete
closure, enters the aggregate.

## 3. Retention and linking order

All declaration evaluation succeeds before durable publication begins. Jig
then captures and inspects the configured Flow source beneath the same root,
publishes every exact Flow Package/1 tree, publishes the complete declaration
byte closure as a tagged author-closure artifact backed by the protected
Package/1 content store, verifies membership and root identity again, and runs
the existing pure package/Binding linker.

The linker accepts both direct SDK-authored Binding values used by its unit
boundary and evaluator-produced canonical Binding values. Both paths pass a
strict canonical normalizer; neither trusts arbitrary active objects.

Content-addressed objects written before a later failure may remain as
unreferenced store objects. They confer no authority and are eligible for
future store garbage collection. “No partial publication” means no aggregate,
candidate pointer, generation, lock, or admission record is returned or
advanced unless the complete operation succeeds.

## 4. Aggregate facts

The private aggregate retains:

- the opened root device/inode receipt;
- one capture digest over the exact root observation, memberships, artifact
  references, normalized values, and evaluator/toolchain identities;
- the complete author-closure artifact reference and closure digest;
- the final project evaluation receipt;
- every Binding evaluation receipt and its derived LocalName;
- every Flow source observation, retained package reference, and inspection;
  and
- the complete pure-linked package project.

Per-evaluation cgroup names and runtime counters remain enforcement evidence
on their receipts but do not perturb the source capture digest. The later
semantic admission digest remains a separate identity.

The aggregate is factory-authenticated and private. Resolution must not accept
lookalike caller objects.

## 5. Evidence

The ordinary corpus proves shared-root traversal, shallow declaration
discovery, missing-root receipts, strict exact membership, mutation detection,
root replacement, collision rejection, shared static closure capture, durable
declaration-byte retention, and unchanged Flow/linker behavior.

The privileged corpus constructs a real project containing `jig.ts`, a shared
helper, one discovered Binding, and one discovered executable Flow. It
evaluates the project bootstrap and complete closure plus the Binding through
the proven cgroup-v2/Bubblewrap evaluator, retains both artifact classes,
links the project, reacquires the author closure after all live capture owners
close, and confirms that no Jig cgroup remains.

## 6. Next boundary

The package-only retained aggregate is the immutable input for the next layer:

```text
retained aggregate
    -> deterministic resolution against exact host snapshots
    -> semantic and authority delta
    -> compare-and-set consent/admission
    -> immutable active generation
```

Before that layer can be public, the project language still needs reviewed
authoring and capture shapes for host-capability Bindings, Hooks, and optional
Semantic Choice. Those features must extend the aggregate rather than reopen
visible source or create parallel publication paths.
