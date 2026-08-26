# Private indirect GC-root feasibility correction

**Status:** historical host-feasibility measurement, with its proof boundary
corrected by [review 127](127-private-host-root-convergence.md). It does not
admit a host generation and does not make any recipe `READY`.

## 1. Question and prior error

Review 117 correctly proved checkout-independent Nix-store loading, but its
first retention probe created direct links through this client's
`/nix/var/nix/gcroots` mount. The active daemon collector ignored those links.
The review then generalized that result into a missing registrar capability.

That generalization was wrong. The direct path is a client-only mount in this
environment; it was not evidence about the daemon's supported indirect-root
operation. This correction preserves the original bundle/load evidence and
all independent `READY` gates.

## 2. Measured positive proof

The workspace is mounted at the same absolute path in the client and the host
namespace. The active Nix daemon's ordinary indirect-root operation created
and registered a fresh root link beneath that path in one command:

```text
nix-store --add-root <fresh-same-path-jig-owned-link> --indirect \
  -r <exact-test-store-path>
```

The chosen store object was dead before the probe. After the creating command
returned and its process exited, independent queries established all of the
following:

- the requested link existed and resolved to the exact store object;
- `nix-store -q --roots <store-object>` enumerated that root;
- the active daemon's `--gc --print-live` output included the object; and
- its `--gc --print-dead` output excluded the object.

One independently completed probe then reacquired the exact target, unlinked
only its fresh root, synchronized the local parent, and forced another root
enumeration. The root was no longer enumerated, the object was no longer live,
and it was dead again. No garbage collection was run. All probe-owned roots
and local paths were removed.

Later hostile measurement showed that this query is not an exact passive
verifier. `nix-store -q --roots` includes transitive roots, censors source
paths inaccessible to an untrusted daemon client, and may prune stale root
state while answering. `--print-live` and `--print-dead` establish global
liveness only. The observations above remain feasibility evidence that an
indirect-root effect survived creator exit; they do not prove a durable exact
path-to-target association or authorize passive verification.

The negative direct-root result was also reproduced: a root under the
client-only collector path did not make its target live. This distinguishes
the mechanisms rather than discarding the earlier observation.

## 3. Smallest retained-generation design

Use one private canonical `python-linux-host-generation/1` record and a
bounded, sorted set of top-level Nix store members. The initial Nix-member role
map covers the exact coordinator bundle, helper bundle, coordinator/helper Bun,
Python, Bubblewrap, Nix query tool, shell, and every other Nix-store support
member the closed recipe invokes. Members are normalized by unique top-level
store path, so several roles sharing one member create one root rather than
nominal duplicates. A privileged launcher outside the Nix store is not a root-
set member; it must be durably installed, authenticated, and reverified as a
separate host mechanism.

Each unique top-level member receives one indirect root at a member-specific
path under one deterministic generation-digest directory:

```text
<private-jig-host-state>/runtime-roots/<generation-digest>/<member>
```

The state root is host-selected, Jig-controlled, unavailable to package code,
and must eventually be proven reachable at the same absolute path by the
daemon. Under the current
cooperative same-UID/local-filesystem model it is a pinned effective-user-
owned mode `0700`, non-symlink directory. It is not a FLOW package field,
project grant, Binding, Backend choice, or public directory convention. The qualifying
same-path reachability mechanism remains deferred; the retain-only checkpoint
does not add a removable production canary or infer reachability from another
directory.

Do not first manufacture a single Nix generation object. A separate
architecture probe added a directory containing store-path text and symlinks
with `nix-store --add`; querying the resulting object showed no reference edges
to those members. Rooting that object would falsely leave the real members
collectible. Rooting the bounded top-level members is both smaller and honest;
Nix's recorded references retain each transitive closure.

## 4. Retain-only convergence

The implemented private operation uses the exact observed Nix CLI with an
empty environment, fixed working directory, bounded output, a deadline, and
substitution and fallback disabled. One protected mode-`0600` SQLite database
stores exactly one immutable canonical generation. An absent singleton is
inserted, the exact same value is idempotent, and any other generation fails.
The transaction commits and is reverified before the first Nix child starts;
the database contains no completion, owner, lease, or readiness field.

For each normalized member the protected tree permits only an absent path or
one owner-created exact same-target symlink. Before the first Nix effect Jig
creates every absent link and validates the complete bounded tree. Any wrong
target, regular file, directory, unexpected entry, or changed path identity
fails without invoking Nix. It then unconditionally re-adds every member. Each
effect must return the exact requested root path; Jig synchronizes, revalidates
the existing descriptor-backed tree, and freshly inspects the exact links
before and after each add. Finally it freshly reverifies all generation roles
and closures and the immutable stored intent.

The immutable singleton makes concurrent effects safe without holding a
database transaction around subprocesses. Every legitimate publisher—and an
old Nix client that outlives its coordinator—can request only the same
path/target pairs. A restart simply replays every effect. The result is a
private process-local branded convergence value with `admissible: false`, not
a durable completion receipt or passive collector proof.

This checkpoint has no acquisition, active head, lease, replacement,
retirement, unlink, rollback, or production cleanup authority. Those lifecycle
operations require their own fenced design. Current failures may retain exact
durably intended roots; they cannot make the generation runnable.

## 5. Exact durability claim

This mechanism survives loss of the coordinator process in a narrower sense:
protected intent remains, and recovery can safely repeat the same exact
path/target operations. The host corpus proves recovery while one old
same-target Nix client outlives its killed coordinator. It does not claim that
the resulting association is externally enumerable or passively complete.

The Nix indirect-root operation does not expose an acknowledgement that the
daemon's own auto-root parent directory was fsynced. The present proof
therefore makes no arbitrary-power-loss claim. It has the same cooperative
local-filesystem/process-crash boundary as the implemented unavailable
admission checkpoint.

If exact passive association, independently proven same-path reachability,
strict subprocess serialization, or arbitrary-power-loss ordering becomes
mandatory, the narrow upgrade is a preinstalled registrar confined to one
Jig-owned collector-namespace subtree. That additional privileged authority is
not justified by this retain-only checkpoint.

## 6. Rejected alternatives

- Direct links through the client-only collector mount: measured ineffective.
- Temporary roots or open descriptors: disappear with process/connection
  failure.
- One-way daemon permanent roots: the current checkpoint deliberately accepts
  replayable retained leaks but establishes no safe-removal authority.
- A privileged registrar now: unnecessary for monotonic same-target replay;
  it remains the upgrade trigger for the stronger guarantees listed in §5.
- Rootful Podman or an OCI image: adds another privileged lifecycle and store
  without solving Jig's ownership protocol.
- Copying closures: Nix absolute paths and reference semantics make this a new
  package/store implementation, recreating the reverted Blob-store problem.
- A synthetic single generation object: measured not to retain its named
  members.

## 7. What remains open

Retain-only convergence is implemented, not admissible. `READY` still
requires:

- a qualifying independently justified same-path daemon-reachability gate;
- exact authenticated host-policy registration and a restricted launcher;
- a hardened privileged helper launch and active Backend preflight receipt;
- generation acquisition plus persisted coordinator epoch, spawn intent,
  materialization, and cgroup ownership;
- one kernel-released per-spawn recovery fence shared by helper and restart
  recovery;
- restart reconciliation before cleanup or root retirement; and
- lock-first admission plus exact post-lock reverification.

The qualifying preflight must name and execute against the exact acquired,
rooted, authenticated generation. A checkout-based preflight remains useful
development evidence but cannot qualify `READY`.

Until those gates are implemented and tested, the Python/Linux candidate stays
`UNAVAILABLE`.
