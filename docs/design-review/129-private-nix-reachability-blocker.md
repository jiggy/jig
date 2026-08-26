# Private Nix reachability and launcher-order correction

**Status:** reviewed production blocker. No reachability implementation from
this investigation is accepted. The Python/Linux recipe remains
`UNAVAILABLE`.

This review closes an unsafe candidate for the same-path reachability gate
left open by
[review 127](127-private-host-root-convergence.md), and corrects the order of
the later restricted-launch work. It does not weaken the retained-generation
or registration observations already implemented.

## 1. A root query is not an observation-only boundary

The rejected candidate first reconverged the protected generation and then,
for every exact member, invoked:

```text
nix-store --store daemon -q --roots <store-member>
```

It would have accepted only one exact:

```text
<configured-jig-root> -> <expected-store-member>
```

line, surrounded the query with protected link and generation revalidation,
and returned only process-local `admissible: false` evidence. An exact line is
useful point-in-time evidence that the active daemon walked and dereferenced
that path. The rejection is not based on the evidence being meaningless.

The operation used to obtain it is the problem. Exact Lix 2.95.2 source shows
that `--roots` computes a reverse closure, asks the daemon for its global root
map, and filters the result afterward. The daemon's `findRoots` traversal:

- recursively scans all GC roots and profiles;
- follows indirect roots; and
- unlinks stale entries beneath its global `gcroots/auto` directory while
  constructing the answer.

The relevant source at Lix commit
`609bc41e6f60d750b5bca6b5a8e66cf0c5d5fbe3` is:

```text
lix/legacy/nix-store.cc:530-555
lix/libstore/daemon.cc:612-628
lix/libstore/gc.cc:55-63
lix/libstore/gc.cc:263-359
```

Therefore this query is neither passive nor confined to Jig-owned state. It
may remove stale daemon roots belonging to another user or service. Killing
the client cannot undo or fence a daemon-side mutation already accepted.
Hardening its parser, cancellation, or local inode checks cannot repair that
authority violation.

The production rule is:

> `nix-store -q --roots` is not a qualifying Jig reachability verifier and
> must not appear in the production observer or the ordinary shared-host
> corpus.

It may be used only in an isolated disposable store or VM whose complete root
set is owned by the test.

## 2. What the host measurement established

A bounded development measurement distinguished two paths:

- a root under the workspace's identical host bind was named exactly by the
  active daemon; and
- a root under `/run/host-services` was locally valid but invisible to the
  daemon and was treated as stale.

That result explains the missing boundary but does not become a production
mechanism. The daemon is outside this environment's visible PID and mount
namespaces. The client-visible `/nix/var/nix/gcroots` is not the daemon's
collector tree, and root inside the client namespace does not change that.

Lix 2.95.2 also exposes no daemon-side `AddPermRoot` worker operation.
`AddIndirectRoot` only creates an auto link to the client-supplied pathname;
it does not dereference that pathname before acknowledging it. A later Nix
version's broad permanent-root operation would still not supply confined
removal, retirement ownership, or a fixed Jig-only namespace by itself.

No test artifact or host root from the rejected experiment was retained.

## 3. Smallest acceptable retention boundary

The next implementation requires one administrator-established mechanism
that operates in the active daemon collector namespace while owning only one
Jig subtree, conceptually:

```text
/nix/var/nix/gcroots/jig/
```

It may be a narrowly restricted registrar or an administrator-established
bind exposing that exact subtree as the only writable collector-tree view of
a separately confined registrar process. It is not a public FLOW, project
Binding, Sandbox Backend choice, or package capability.

The mechanism must:

1. preopen and authenticate its fixed Jig-owned collector subtree;
2. accept one authenticated canonical generation/member identity rather than
   arbitrary root paths;
3. keep each member protected through the Nix temporary-root protocol while
   publishing its direct root, so concurrent garbage collection cannot win;
4. create only deterministic exact links beneath the preopened subtree;
5. revalidate link and subtree identities and synchronize the owned directory
   before acknowledgement;
6. return one bounded exact receipt tied to the generation and collector
   subtree identity;
7. enumerate, verify, and remove only entries inside that Jig-owned subtree;
8. remove roots only after fenced no-new-acquisition retirement; and
9. remain unavailable to Flow and package code.

It must never enumerate, prune, mount, or mutate anything outside its
preopened Jig-owned collector subtree. Creating or exposing the dedicated
mount is administrator/bootstrap work, not registrar runtime authority. The
receipt is mechanism evidence, not a user grant or semantic observation.

The first implementation must also preserve these nonclaims:

- synchronizing the owned directory does not, by itself, prove durability
  across arbitrary power loss;
- a dedicated bind mount is host configuration, not a publication
  acknowledgement or retention receipt;
- a partial multi-member publication cannot produce a qualifying receipt; it
  remains bounded, non-admissible retention state until replay or
  reconciliation completes it; and
- temporary-root protection remains active until every direct root is
  published, the owned directory is synchronized, and final verification has
  succeeded.

Crash/restart publication and retirement behavior must be proven before this
mechanism may support a retained acquisition.

The registrar receipt proves collector-side retention only. It does not prove
that runtime or support paths retain identical identity in the later launcher
or payload mount namespace. The acquired launch transaction must freshly
prove those exact paths in its inherited launch namespace, and the Backend
must receipt the final Bubblewrap projection. The payload receives no writable
collector-tree view.

Cancellation before acknowledgement returns no receipt. A daemon effect
already accepted may leave only replayable exact same-generation retention
state; cancellation does not imply rollback. Every retry revalidates freshly.
Serialized or decoded receipt bytes cannot recreate a process-local brand or
authorize acquisition or launch.

This review defines no public registrar protocol, receipt schema, launcher
interface, FLOW capability, Binding, or Sandbox Backend API.

This design is intentionally not implemented speculatively. The current host
profile provides cgroup and general privileged development control, but it
does not provide a Jig-confined daemon collector subtree, a host-side
registrar in the daemon mount namespace, or a targeted exact add/verify/remove
RPC. Repository code alone cannot manufacture that boundary safely.

## 4. Restricted launch follows durable acquisition

The prior phase order placed a restricted launcher before durable
acquisition. That is reversed.

An authorizing launcher cannot safely accept the current proof Backend's
caller-shaped paths, mounts, cgroup name, command, environment, helper
arguments, or host registration selector. It also cannot authenticate a
one-shot launch before a durable spawn intent exists.

The required order is:

```text
confined retained-generation mechanism
    -> lock-first durable acquisition and one-shot spawn intent
    -> restricted launcher consumes only the opaque spawn-intent identity
    -> fresh fixed registration/generation/mechanism verification
    -> active Backend preflight
    -> package launch
    -> durable terminal and recovery reconciliation
```

Host-owned configuration and the protected acquisition record, not the
request, fix the registration selection, coordinator identity, registrar,
cgroup parent, launcher, and mount policy. The launcher derives every
executable path and argument from protected state. No retention receipt is
itself a lease, acquisition, launch ticket, readiness receipt, or reusable
freshness proof.

## 5. Exact blocker and restart point

The next code slice is blocked until the environment supplies one of:

- a Jig-confined daemon collector subtree exposed as the only writable
  collector-tree view of a separately confined registrar process;
- a host-side registrar operating in the daemon mount namespace; or
- a targeted daemon operation with exact Jig-scoped add, verify, and remove
  semantics.

When that exists, resume by proving the registrar in isolation against a
Jig-owned disposable collector tree. Only then connect its receipt to durable
acquisition and the restricted launcher in one owned transaction.

Until then:

- reviews 122 and 127 retain their no-passive-verifier conclusion;
- review 128 remains authentication observation only;
- the existing root converger remains retain-only and non-admissible;
- the current broad development `sudo` path remains proof infrastructure,
  not production authorization; and
- Python/Linux and Bun remain `UNAVAILABLE`.
