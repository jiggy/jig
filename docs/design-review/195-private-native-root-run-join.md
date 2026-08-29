# Private Bun native root-Run join checkpoint

**Status:** accepted on 2026-08-29 after focused state and materialization
tests, a real cgroup-v2/Bubblewrap execution proof, and independent
adversarial review. This checkpoint makes the one exact prepared Bun Binding
recipe executable by the private root owner. It does not enable prepared child
`flow/call`, publish a Runtime Adapter, Sandbox Backend, dependency, or
preparation interface, or make an external Jig alpha operable.

## Closed boundary

The private root controller now performs one complete composition:

```text
admitted Bun Binding recipe
    -> create or recover its exact root-owned preparation
    -> require successful durable preparation closure
    -> reacquire the protected composite prepared tree
    -> compute its complete materialization checksum
    -> persist the root plan against that checksum
    -> materialize one detached read-only Run backing
    -> execute flow.ts with the prepared package-local @flowmd/sdk
    -> validate the result against the original source Package/1
    -> fence, release, admit, close, and remove every transient resource
```

Project Session host policy supplies the already selected worker path and
digest. The proof-host helper resolves and hashes the built internal worker,
but the packed Jig artifact continues to exclude `dist/internal/**`. Missing
worker selection makes the native target unavailable during planning; it does
not fall back to a dependency-free recipe, ambient installer, registry, or
Markdown interpretation.

No Candidate, Plan/2, Lock/3, Package/1, Project Authoring, Root
Administration, or FLOW wire value changed. The root's private plan reuses its
existing materialization-allocation checksum field for the complete prepared
byte tree. The separately retained prepared reference remains the durable
artifact identity and is not relabelled as Package/1.

## Durable ordering and recovery

Preparation and root execution are serialized in the admission transaction:

- a new preparation may be allocated only while the root lifecycle contains
  its initial allocation and no execution checkpoint;
- a root plan may follow an allocated preparation only after successful
  preparation outcome, artifact publication, release, and closure;
- a failed closed preparation cannot be converted into a root plan;
- root release is refused while any preparation remains open; and
- allocation-versus-plan races have exactly one semantic winner after the
  ordinary bounded admission-busy retry.

The root controller recovers preparation work before its admitted fast path
and before classifying older root ownership. It never creates a preparation
after a root plan exists. Same-epoch non-owners continue to return
`preparation-in-progress`; replacement coordinators may fence and close older
preparation work but cannot redispatch it. A root plan without the required
prior preparation is protected-state failure, not permission to prepare
again.

The successful preparation snapshot is correlated again with the authentic
recipe: parent Run, source request and package, recipe and preparation
observations, dependency member, worker, Runtime Support Closure, Backend
mechanism, root deadline, candidate, artifact, release, and closure must all
agree before the prepared record is opened. Record or source drift therefore
fails before final package dispatch.

## Deadlines, failure, and launch meaning

Preparation retains the already durable outer root deadline. The final
activation's own wall-clock ceiling begins only after preparation succeeds;
preparation time is not silently charged twice, while the outer root deadline
still bounds the whole operation. User cancellation is passed to the
preparation owner, and the Backend's absolute deadline remains authoritative.
The exact durable preparation failure classification is preserved rather than
being overwritten by a later coordinator timer. Its private diagnostic message
remains internal; Root Administration receives a closed code-specific message
which cannot disclose worker, store, helper, or runtime paths.

The same boundary now maps unexpected trusted-host execution exceptions to one
generic root failure message instead of copying exception text into the
durable/public terminal. Component-owned protocol failures remain governed by
Run/1; private host paths are not a debugging channel.

Final Bun command flags and process/runtime-device requirements now live on
the authentic direct or native recipe and are consumed from that recipe by
both direct and root execution. The controller no longer carries a second
unhashed copy of Bun launch policy. Runtime paths remain host-local and are
revalidated before use.

The final Run mounts only Runtime Support Closure members and the detached
prepared lease read-only. It receives empty ambient authority, private
process visibility, and the exact least-mode runtime devices already proven
by the Linux Backend. Result outcome and `result.schema.json` admission reopen
the original retained Package/1; installed dependency bytes cannot change
authored result meaning.

## Evidence and non-claims

Focused evidence passes:

```text
preparation/root ordering and recovery state       3 tests, 48 expectations
native relation/store/result regression corpus    35 tests, 226 expectations
Project Session and native planning regressions    16 tests, 100 expectations
real prepared SDK root Run                          1 test, 24 expectations
TypeScript build                                    passed
independent cgroup/device residue check              zero residue
host /dev/urandom                                    char 1:9, mode 0666
```

The hostile root imports `serve` from the package-local installed
`@flowmd/sdk` while Bun runs with `--no-install`, validates its complete Run
result, and proves `/package` is not writable. Its durable terminal and closed
preparation can be reopened without another dispatch. The final check finds no
Jig Run cgroups, private device directories, root materializations, or owner
directories.

This is private root-only readiness for the one exact Binding shape. Generic
direct recipe execution and child `flow/call` still refuse native recipes.
Coordinator-loss and cancellation behavior of the preparation and root owners
remain supported by their independently proven state machines, but this
checkpoint does not claim a new exhaustive combined crash matrix. A prepared
child owner must earn its own join rather than inheriting this root authority.

One inherited liveness debt also remains explicit: after a call reports
`fence-unconfirmed`, a different caller in the same coordinator epoch observes
the preparation as `in-progress` and cannot take it over. Closing and reopening
the finite Project Session creates the replacement epoch which may fence that
work without redispatch. Same-session takeover needs a real durable invocation
owner; merely allowing arbitrary current-epoch recovery would reintroduce
duplicate-owner races. This checkpoint neither adds that owner nor claims
same-session pending convergence.

The next product gates remain the production host trust root and bounded
installed project acquisition/CLI, canonical public lock schema, release
metadata, and fresh-host Operational Baseline/1. None of those is solved by
making this private root path executable.
