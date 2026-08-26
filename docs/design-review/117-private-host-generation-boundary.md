# Private host-generation retention boundary

**Status:** reviewed private boundary with implemented retain-only convergence.
No host generation is admitted or exposed through a public API. The converger
produces only non-admissible local evidence and does not prove collector
retention.

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
| coordinator | 442,152 | `fdd1bfa2e4aa163c18fbd1af4bafd38351fa33f3a43effbbc5a4a7bc4dd7b614` |
| helper | 13,695 | `bfe4528e0e8909bdc0d46d4e36c3d84fd50586241493f4ceae82947256602ac0` |

Adding each flat file to the active daemon-backed Nix store produced a
root-owned, mode `0444` regular file with identical bytes. The temporary build
directory was then deleted. In a fresh root Bubblewrap process, the repository
path was replaced with an empty `tmpfs`, the environment was cleared, and Bun
was invoked with:

```text
--no-env-file --no-install --config=/dev/null
```

The coordinator loaded from its Nix path, exposed exactly the five expected
exports, and ran the real observer against the configured Python runtime. The
observer reacquired its runtime closure and reproduced its exact private
digest.
The helper also ran from its Nix path with the checkout hidden and failed with
its expected exit status 70 when deliberately given no trusted arguments.

This proves checkout-independent bundling and loading. It does not prove
durable retention, safe admission, or helper lifecycle recovery.

The earlier feasibility build is now an ordinary package build product and a
stronger proof checkpoint in [review 126](126-private-host-bundle-proof.md).
That gate restricts `/nix/store` visibility to the exact observed closure
union, exercises the planning-intent compatibility port, the four coordinator
operations, and the ABI export, tests the real helper's startup posture, and
completes one benign envelope.

Production privileged-helper execution must retain the same closed startup
posture. The coordinator remains unprivileged; root in the feasibility probe
was used only to create the isolated inspection namespace. The exact Bun
runtime is a host-generation role. Root Bun receives an explicit empty
environment, fixed working directory, `--no-env-file`, `--no-install`, and
`--config=/dev/null`; it never inherits project `.env`, `bunfig.toml`, home,
or current-directory policy.

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
├── roles[] { role, path, store path, byte count, file digest }
└── members[] { store path, role set, closure count, closure digest }
```

Members are normalized by unique top-level store path; several roles may share
one root. The generation digest covers the complete canonical value. It
contains no volatile boot ID, cgroup inode, controller availability, or scope-
emptiness facts. Those belong only to a fresh activation preflight receipt.

Every named top-level store member is assigned one deterministic path beneath
one generation-owned root directory. When the active daemon can dereference
and register that path, Nix's existing reference graph retains that member's
transitive closure. A `/nix/store/...` string in a canonical
record is not itself a Nix reference edge and cannot retain a runtime closure.
A separate probe found that a `nix-store --add` directory containing store-path
text and symlinks did not acquire those reference edges, so v1 does not invent
a synthetic one-object generation.

The canonical record is now durably selected by one private immutable
singleton intent before any root effect. That intent and a partially or fully
materialized root tree remain non-admissible retention state. A different
generation is rejected until a later acquisition/retirement design defines
safe replacement; this checkpoint provides no replacement or deletion path.

The exact Nix client used for closure queries and root re-addition is a
bootstrap host mechanism. A generation root may retain its executable closure
for later reacquisition, but cannot prove that the root operation was
available initially or that the daemon can dereference Jig's configured path.

Nix ownership is not authorization: any caller may add bytes to the store.
Retain-only publication may safely precede authentication because it cannot
authorize execution. Loading, acquisition, or admission still requires one
exact authenticated host-policy registration and a qualifying launcher that
accepts only that generation—not an arbitrary path supplied by a project,
Flow, or untrusted caller.

## 4. Implemented retain-only convergence

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

The original feasibility probe observed one exact link and global target
liveness after creator exit. Later adversarial measurement narrowed what that
proves. `nix-store -q --roots` reports direct and indirect/transitive roots,
censors inaccessible root sources for untrusted daemon clients, and performs
stale-root pruning while collecting its answer. Global `--print-live` and
`--print-dead` prove liveness, not the exact association between one configured
path and target. There is therefore no trustworthy passive exact-root verifier
in the interface used by this checkpoint.

The implemented protocol in
[review 127](127-private-host-root-convergence.md) deliberately avoids such a
verifier. It stores one authentic canonical generation as a protected SQLite
singleton, commits that immutable decision before any Nix effect, creates and
validates the complete bounded link set before the first effect, and then
unconditionally re-adds every same-path/same-target member. Before and after
each add it revalidates the existing descriptor-backed tree and freshly
inspects each exact link target; after the last add it reverifies every
generation role and closure and the immutable stored intent.

Measured Nix behavior makes that replay protocol convergent: root addition
replaces a preexisting symlink, refuses an ordinary file or directory, and
concurrent additions for different targets are last-writer-wins. Jig therefore
rejects every wrong target or wrong entry before spawning Nix and durably fixes
the only target legitimate callers may request. Same-generation publishers
and an old client that outlives its coordinator may race, but can issue only
the same commutative effect.

Successful convergence produces only a private process-local branded value
with `admissible: false`. It proves that this process read the committed exact
intent, successfully requested the complete effect set, freshly inspected the
exact local links, and freshly reobserved the generation. It does **not** prove
exact collector enumeration, same-path daemon reachability, power-loss
durability, persisted completion, acquisition, retirement, or `READY`. There
is no production canary, passive verifier, unlink, rollback, generation
replacement, or cleanup operation. Failures may leave only replayable exact
intended roots.

## 5. Remaining `READY` gates

Collector-visible retention is necessary but not sufficient. A runnable
generation still needs:

1. a strict acquisition operation over the implemented canonical generation;
2. an authenticated host-policy registration for its exact generation digest;
3. a qualifying independently justified same-path daemon-reachability gate,
   followed by a fresh exact convergence and execution-closure proof;
4. durable ownership for every trusted executable used after admission:
   coordinator/helper Bun, Python, Nix query tool, Bubblewrap, shell, and their
   required closures, with the privileged launcher either included or
   separately retained and reverified as a host mechanism;
5. a root-owned helper launch with empty environment and fixed Bun policy;
6. a root-owned per-spawn recovery lock held from before activation through
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

The real coordinator/helper bundle checkpoint is now implemented by
[review 126](126-private-host-bundle-proof.md). The remaining private
prerequisites can advance independently:

1. finish the privileged helper's authorization boundary and produce one
   active Linux Backend preflight receipt (the ambient startup sub-boundary is
   now closed by [review 123](123-private-helper-startup-posture.md)); and
2. continue the canonical host-generation work: the inert eight-role
   observation/codec is implemented by [review 124](124-private-python-linux-host-generation.md),
   exact bundle loading is proven, and retain-only convergence is implemented
   by [review 127](127-private-host-root-convergence.md), while qualifying
   reachability, authenticated acquisition, spawn recovery, and retirement
   remain open.

Neither slice exposes a public Backend, host-generation, or retention API.
Neither may call the Python/Linux recipe `READY`. The later `READY` branch must
also add durable spawn ownership, restart fencing, and lock-first admission
reverification from §5. Its active preflight evidence must be rerun against and
name the exact acquired, rooted, authenticated generation; a checkout-based
preflight cannot qualify it.
