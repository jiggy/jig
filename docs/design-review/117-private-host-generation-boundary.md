# Private host-generation retention boundary

**Status:** reviewed private boundary with a corrected retention-feasibility
result. No host generation is admitted, rooted, or exposed through a public
API.

This review replaces the reverted host-extension Blob experiment. It records
why trusted host code is not another coordinator-owned content store, what the
smallest current implementation generation contains, and the remaining gates
before a Python/Linux recipe may be `READY`.

## 1. One generation, two roles

The current private Python/Linux implementation cannot be split into an
independent Adapter bundle and Backend bundle. Its authenticity checks use
module-local `WeakSet`s; values created by a second evaluation of those modules
are intentionally rejected.

The smallest honest generation therefore has two members:

```text
python-linux-coordinator/1
    Python/Nix runtime observation
    exact Python planning and execution
    Linux Backend construction

linux-cgroup-helper/1
    the separately executed privileged cgroup helper
```

The coordinator is evaluated once. Its closed ESM surface is:

```text
privateHostExtensionAbi = "jig-private-python-linux-coordinator/1"
createBackend
execute
observeRuntime
plan
```

`plan` is a boundary wrapper, not the source planner alias. As corrected by
[review 125](125-private-python-planning-intent.md), the host encoder projects
only an authentic direct-Python activation request into bounded canonical
inert bytes. The coordinator accepts exact reconstructable meaning without
claiming the foreign module's `WeakSet` provenance; the trusted loader must
correlate the result with its authentic request and protected admission before
production execution. Runtime, Backend, candidate, and execution brands remain
inside that one coordinator evaluation.

The helper remains a program rather than an imported coordinator module. A
future three-role design is earned only after the Adapter consumes a strictly
decoded inert Backend port instead of trying to authenticate an object branded
by another module instance.

This is a private compatibility boundary, not a generic registry. There are no
aliases, priorities, version ranges, configurable entrypoints, or project-
selectable implementation paths.

## 2. Measured bundle and load proof

Two self-contained Bun ESM bundles were built from the current implementation:

| Member | Bytes | SHA-256 |
|---|---:|---|
| coordinator | 438,120 | `c27688c035f11db72bb82dfec1e3e02f749cbcfcf1586efe17cbc759559dbe46` |
| helper | 12,693 | `f7bbbb6966a10947a6dea98a454c89b285a586bb383502767b4629d11bc34b7c` |

Adding each flat file to the active daemon-backed Nix store produced a
root-owned, mode `0444` regular file with identical bytes. The temporary build
directory was then deleted. In a fresh root Bubblewrap process, the repository
path was replaced with an empty `tmpfs`, the environment was cleared, and Bun
was invoked with:

```text
--no-env-file --no-install --config=/dev/null
```

The coordinator loaded from its Nix path, exposed exactly the five expected
exports, and ran the real observer against Python 3.13.14. The observer
reacquired a 22-store runtime closure and reproduced its exact private digest.
The helper also ran from its Nix path with the checkout hidden and failed with
its expected exit status 70 when deliberately given no trusted arguments.

This proves checkout-independent bundling and loading. It does not prove
durable retention, safe admission, or helper lifecycle recovery.

Production privileged-helper execution must retain the same closed startup
posture. The coordinator remains unprivileged; root in the feasibility probe
was used only to create the isolated inspection namespace. The exact Bun
runtime and an empty root-owned configuration are host-generation members or
dependencies. Root Bun receives an explicit empty environment, fixed working
directory, `--no-env-file`, `--no-install`, and the fixed config; it never
inherits project `.env`, `bunfig.toml`, home, or current-directory policy.

## 3. Why the private Blob store was reverted

The Blob experiment was a careful 1,269-line implementation and corpus for
retaining opaque coordinator-owned bytes. It was reverted because it did not
close the next security boundary:

- coordinator-owned mode `0400` bytes are not a root-owned helper;
- opaque bytes do not prove role, ABI, bundle closure, or loadability;
- Python, Bun, Nix, Bubblewrap, shell, and their required closures still need
  lifecycle retention;
- no production admission record consumed the Blob reference; and
- it duplicated filesystem publication and recovery machinery before a second
  storage implementation was required.

The trusted generation is one canonical protected value, not a synthetic store
directory or public file format:

```text
python-linux-host-generation/1
├── coordinator { ABI, top-level store path, byte count, member digest }
├── helper { ABI, top-level store path, byte count, member digest }
└── support members { role set, top-level store path, closure evidence }
```

Members are normalized by unique top-level store path; several roles may share
one root. The generation digest covers the complete canonical value. It
contains no volatile boot ID, cgroup inode, controller availability, or scope-
emptiness facts. Those belong only to a fresh activation preflight receipt.

Every named top-level store member is rooted separately beneath one
generation-owned root directory. Nix's existing reference graph then retains
that member's transitive closure. A `/nix/store/...` string in a canonical
record is not itself a Nix reference edge and cannot retain a runtime closure.
A separate probe found that a `nix-store --add` directory containing store-path
text and symlinks did not acquire those reference edges, so v1 does not invent
a synthetic one-object generation.

The canonical record and its complete bounded root set are one admission unit:
partial publication remains unavailable and retirement removes no member until
all durable owners of the generation have retired. A later non-Nix
implementation may justify a storage-neutral host-generation boundary; v1
does not invent one in advance.

The exact Nix client and daemon used to establish or inspect roots are
bootstrap host mechanisms. A generation root may retain their executable
closure for later reacquisition, but cannot serve as the proof that made the
root operation available initially.

Nix ownership is not authorization: any caller may add bytes to the store.
Before a generation may be rooted or loaded, its canonical registration and
generation digest must match one exact authenticated host-policy registration.
A qualifying privileged launcher must accept only that registered helper and
its registered Bun closure, never an arbitrary path supplied by a project,
Flow, or untrusted caller.

## 4. Corrected retention capability

The earlier probe tested the wrong root mechanism. The active Nix store is
reached through a daemon, and this environment's direct
`/nix/var/nix/gcroots` path resolves to a client-only mount. Direct links there
were correctly ignored by the active collector and their targets remained
dead. That result did **not** prove that collector-visible retention was
unavailable.

The corrected probe registered an indirect root whose absolute path is visible
identically to Jig and the daemon, using this exact command shape:

```text
nix-store --add-root <fresh-jig-owned-path> --indirect \
  -r <exact-store-member>
```

An independent daemon query enumerated the exact root, `--print-live` included
the uniquely chosen target, and `--print-dead` excluded it. The creating
process then exited. After unlinking the exact Jig-owned link, synchronizing
its local parent, and forcing root enumeration, the root disappeared and the
target became dead again. No garbage collection was run. The probe left no
root behind.

The feasible private mechanism is therefore a bounded set of ordinary Nix
indirect roots beneath one Jig-controlled host-state directory whose absolute
path is stable and shared with the daemon. It requires no privileged registrar,
Podman layer, copied closure store, or project grant. Flow/package code never
receives the root directory or Nix control surface. Atomic collision-safe
publication is still an implementation and proof gate: the probe did not
establish whether the Nix CLI refuses or replaces a preexisting root path.

The root tree remains inside the cooperative same-UID/local-filesystem model.
Its configured root must be a pinned effective-user-owned mode `0700`, non-
symlink directory. Before using that exact configured location, preflight
registers, queries, and removes one canary beneath it; success in the workspace
or any other directory does not prove same-absolute-path daemon visibility.

Jig creates or reacquires the deterministic generation directory. For every
normalized member, only two states are admissible: absent, or one safely
confined link whose exact target matches the canonical member. Exact partial
publication resumes idempotently; every other type, owner, target, unexpected
entry, or path identity is unavailable and is never deleted automatically.
Registration and daemon confirmation may be retried after acknowledgement
loss. The implementation must:

1. acquire the generation directory without replacement on first creation and
   prove its collision-safe member publication/recovery rule rather than rely
   on a racy path precheck or assumed Nix CLI replacement behavior;
2. register each bounded top-level store member through the exact trusted Nix
   CLI with an empty environment, fixed working directory, bounded output, a
   deadline, and an invocation proven to disable substitution and fallback;
3. synchronize the Jig-owned local directory;
4. independently enumerate the active daemon's roots and verify every exact
   target and its re-queried closure before admission; and
5. on retirement, remove only roots still owned by the retired generation,
   synchronize the directory, force enumeration, and confirm absence.

Creation and confirmation precede the protected `READY` compare-and-set, so a
process crash can leak a reconcilable root but cannot admit an unrooted
generation. Acquisition durably establishes a generation lease/spawn intent
only while the generation is active. That operation serializes with
retirement's no-new-acquisition fence. The owner then reverifies the complete
root set and closures; failure closes the owner and returns unavailable.

Retirement first commits the no-new-acquisition fence and moves the active head
away from the generation. Its expected root set remains protected while
existing owners drain. Only after the last lease and spawn intent is fenced may
retirement unlink exact owned roots and confirm daemon absence; protected
state marks removal complete only after that confirmation. A crash resumes
from the retained expectation. Creation crashes can therefore only leak roots,
while retirement crashes can only leave a fenced leak or idempotently removable
prefix—never a runnable unrooted generation. A reconciler compares only Jig's
private root tree with protected ownership and never mutates unrelated roots.

This establishes feasibility for coordinator-process retention under the
project's cooperative local-filesystem crash model; the protected directory,
publication protocol, and reconciler are not implemented yet. Nix's indirect-
root operation does not expose a parent-directory fsync acknowledgement from
the daemon, so it does **not** establish arbitrary power-loss ordering. If that
stronger model becomes a hard requirement, the upgrade trigger is a
preinstalled collector-namespace registrar restricted to Jig-owned roots with
explicit parent fsync—not a v1 dependency.

The full measured correction is frozen in
[review 122](122-private-indirect-gc-root-feasibility.md). The recipe remains
`UNAVAILABLE` until this mechanism and the other gates below are implemented
and admitted.

## 5. Remaining `READY` gates

Collector-visible retention is necessary but not sufficient. A runnable
generation still needs:

1. a canonical generation builder and strict acquirer;
2. an authenticated host-policy registration for its exact generation digest;
3. a process-crash-persistent, collector-confirmed generation root set and
   exact execution-closure proof;
4. durable ownership for every trusted executable used after admission:
   coordinator/helper Bun, Python, Nix query tool, Bubblewrap, shell, and their
   required closures, with the privileged launcher either included or
   separately retained and reverified as a host mechanism;
5. a root-owned helper launch with empty environment and fixed Bun policy;
6. a root-owned per-spawn recovery lock held from before admission through
   cgroup cleanup;
7. persisted owner, spawn-intent, materialization, and coordinator-epoch
   identities;
8. restart fencing before backing or roots are released; and
9. lock-first admission persistence and exact post-lock reverification.

The present helper kills and cleans its tree when the coordinator channel is
lost, but recovery cannot treat a missing cgroup as final until it acquires the
same per-spawn lock. No document or test may call the current recipe `READY`.

## 6. Next executable slices

The strict private `UNAVAILABLE` lock-first admission path proposed by the
original review is now implemented by
[review 121](121-private-unavailable-lock-first-apply.md). It remains evidence
of consent ordering and generation CAS, never evidence of execution support.

Two small private prerequisites can now advance independently:

1. finish the privileged helper's authorization boundary and produce one
   active Linux Backend preflight receipt (the ambient startup sub-boundary is
   now closed by [review 123](123-private-helper-startup-posture.md)); and
2. continue the canonical host-generation work: the inert eight-role
   observation/codec is now implemented by [review 124](124-private-python-linux-host-generation.md),
   while real bundle emission, durable root publication, authenticated
   acquisition, reconciliation, and retirement remain open.

Neither slice exposes a public Backend, host-generation, or retention API.
Neither may call the Python/Linux recipe `READY`. The later `READY` branch must
also add durable spawn ownership, restart fencing, and lock-first admission
reverification from §5. Its active preflight evidence must be rerun against and
name the exact acquired, rooted, authenticated generation; a checkout-based
preflight cannot qualify it.
