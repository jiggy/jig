# Private indirect GC-root feasibility correction

**Status:** measured host-feasibility correction. It changes one environmental
conclusion in review 117. It does not implement or admit a host generation and
does not make any recipe `READY`.

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
and visible at the same absolute path to the daemon. Under the current
cooperative same-UID/local-filesystem model it is a pinned effective-user-owned
mode `0700`, non-symlink directory. It is not a FLOW package field, project
grant, Binding, Backend choice, or public directory convention. Preflight must
register, query, and remove a canary beneath this exact configured root;
success in a different same-path directory is not transferable evidence.

Do not first manufacture a single Nix generation object. A separate
architecture probe added a directory containing store-path text and symlinks
with `nix-store --add`; querying the resulting object showed no reference edges
to those members. Rooting that object would falsely leave the real members
collectible. Rooting the bounded top-level members is both smaller and honest;
Nix's recorded references retain each transitive closure.

## 4. Publication, acquisition, and retirement

The private implementation must use the exact observed Nix CLI with an empty
environment, fixed working directory, bounded output, a deadline, and an
invocation proven to disable substitution and fallback. It creates or
reacquires the deterministic protected generation directory. For each
normalized member only two states are admissible: absent, or a safely confined
link with the exact canonical target. Exact partial publication resumes
idempotently. Any other type, owner, target, entry, or path identity is
unavailable and is never deleted automatically. Registration and daemon
confirmation may be retried after acknowledgement loss.

First creation must acquire the generation directory without replacement and
prove collision-safe member publication/recovery. The feasibility probe did
not establish whether `nix-store --add-root` refuses or replaces an existing
path, so a racy absence precheck or assumed CLI behavior is not an acceptable
substitute.

Publication order is:

1. validate the canonical generation record and authenticated host-policy
   registration;
2. requery every top-level object and exact closure;
3. register every absent member root or reacquire its exact existing link;
4. synchronize the Jig-owned root directory;
5. independently enumerate roots through the active daemon;
6. verify every role maps to its exact target and every exact closure remains
   present; and only then
7. qualify the root-set evidence for a later `READY` admission. `READY` remains
   forbidden until every gate in §7 passes.

A crash before step 7 can leak roots but cannot admit an unrooted generation.
The roots are deterministic protected state which a reconciler can compare to
canonical generation ownership.

Acquisition first durably establishes one generation lease/spawn intent only
while the generation is active. That operation and retirement's no-new-
acquisition fence serialize in protected state. The owner then reverifies the
canonical record, complete root set, daemon enumeration, and exact closures;
failure closes the owner and returns unavailable. Merely finding a store path
or symlink is insufficient. Root removal cannot begin while any owner exists.

Retirement first commits the durable no-new-acquisition fence and moves the
active head away from the generation. Its exact expected root set remains
recorded while existing owners drain. After the last lease and spawn intent is
fenced, removal unlinks only exact owned links, synchronizes the directory,
forces daemon enumeration, and confirms absence. Only then may protected state
mark root removal complete and remove the empty generation directory. A crash
at any point resumes from that retained expectation. Creation crashes can only
leak roots; retirement crashes can only leave a fenced leak or an idempotently
removable prefix—never a runnable unrooted generation. The reconciler is
confined to this private tree and never edits unrelated Nix roots.

## 5. Exact durability claim

This mechanism survives loss of the coordinator process: the root is daemon-
registered, externally enumerable, and reconstructible from protected
generation ownership. It uses no long-lived coordinator descriptor or
connection.

The Nix indirect-root operation does not expose an acknowledgement that the
daemon's own auto-root parent directory was fsynced. The present proof
therefore makes no arbitrary-power-loss claim. It has the same cooperative
local-filesystem/process-crash boundary as the implemented unavailable
admission checkpoint.

If arbitrary-power-loss ordering becomes mandatory, the narrow upgrade is a
preinstalled registrar which creates, removes, enumerates, and fsyncs only a
Jig-owned collector-namespace subtree. That additional privileged authority is
not justified for v1 by the current requirement or evidence.

## 6. Rejected alternatives

- Direct links through the client-only collector mount: measured ineffective.
- Temporary roots or open descriptors: disappear with process/connection
  failure.
- One-way daemon permanent roots: no sufficiently narrow safe-removal and
  reconciliation path was established.
- A privileged registrar now: unnecessary for the supported process-crash
  model.
- Rootful Podman or an OCI image: adds another privileged lifecycle and store
  without solving Jig's ownership protocol.
- Copying closures: Nix absolute paths and reference semantics make this a new
  package/store implementation, recreating the reverted Blob-store problem.
- A synthetic single generation object: measured not to retain its named
  members.

## 7. What remains open

Collector-visible retention is now feasible, not complete. `READY` still
requires:

- the canonical generation builder/acquirer and bounded root-set lifecycle;
- atomic collision-safe root publication and partial-publication recovery;
- exact authenticated host-policy registration;
- a hardened privileged helper launch and active Backend preflight receipt;
- persisted generation, coordinator epoch, spawn intent, materialization, and
  cgroup ownership;
- one kernel-released per-spawn recovery fence shared by helper and restart
  recovery;
- restart reconciliation before cleanup or root retirement; and
- lock-first admission plus exact post-lock reverification.

The qualifying preflight must name and execute against the exact acquired,
rooted, authenticated generation. A checkout-based preflight remains useful
development evidence but cannot qualify `READY`.

Until those gates are implemented and tested, the Python/Linux candidate stays
`UNAVAILABLE`.
