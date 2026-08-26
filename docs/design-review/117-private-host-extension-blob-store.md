# Private host-extension Blob/1 store

**Status:** implemented private exact-byte checkpoint. It is not FLOW
Package/1, a host-extension registration, an authenticated implementation
closure, an admission recipe, or a public Jig API.

The first Phase 5 slice adds the smallest durable substrate needed to retain
trusted host implementation bundles independently of the coordinator checkout.
It deliberately stores opaque bytes. Meaning, role, ABI, entrypoint, and
eligibility remain outside this layer.

## 1. Separate trust domain

Host implementation code is not a FLOW package:

```text
FLOW Package/1
    untrusted component content inspected before admission

Host-extension Blob/1
    trusted-host implementation bytes retained for later registration
```

Reusing Package/1 would conflate package authorship with the host code which
plans or enforces package execution. Blob/1 therefore has its own discriminator,
digest domain, bounded reference, and protected store namespace:

```text
kind:    host-extension-blob/1
digest:  SHA-256("JIG-Host-Extension-Blob/1" || NUL || bytes)
bytes:   1..16 MiB

<store>/host-extensions/v1/sha256/<first-two-hex>/<remaining-hex>.blob
```

The reference is inert. Strict decoding rejects Proxies, accessors, custom
prototypes, extra fields, alternate digest spellings, confused artifact kinds,
and invalid byte counts before deriving a store path.

## 2. Publication and acquisition

The caller supplies one opaque byte sequence. Publication checks the size
before taking its bounded private copy, writes a same-filesystem staging file,
synchronizes it, removes write permission, synchronizes it again, and publishes
with a no-replace hard link. The containing shard is synchronized after
publication and the dedicated staging directory is synchronized after cleanup.

Stage names contain the Linux boot ID, PID-namespace identity, PID, process
start time, exact digest, declared byte count, and a nonce. A recovery scan
holds the protected staging directory, fails closed on ambiguous `/proc`
evidence or unexpected entries, preserves a live publisher, and removes only a
regular expected-owner stage whose complete process lease is no longer live.
If the dead stage already has its final hard link, recovery derives the exact
shard from the stage identity, requires both names to be the same inode,
reverifies the bytes, and synchronizes the final shard before removing and
unconditionally synchronizing the staging directory. Concurrent collectors
treat a name already removed by another collector as completed recovery.
Publication runs the same scan before adding
another stage; host startup can invoke the explicit recovery operation. This
avoids accumulating named staging files after coordinator death without
introducing an artifact-store flock or a second manifest.

Concurrent publication of the same digest converges on one retained file.
An existing winner is always reverified. Corrupt state is reported and never
repaired, replaced, or silently accepted.

Acquisition:

1. strictly decodes the inert reference;
2. opens the protected directory chain without following symlinks;
3. verifies owner, regular-file type, non-writability, exact size, exact
   domain-separated digest, stable descriptor identity, and pathname identity;
4. closes the artifact and directory descriptors; and
5. returns an invocation-local copied capture.

The capture returns a fresh copy on every `read()` and zeroes its retained
bytes on `dispose()`. Later store mutation cannot change an already acquired
copy. Cleanup and resource-exhaustion failures are surfaced rather than
relabelled as valid acquisition.

The store root and every traversed directory must be owned by the coordinator
identity and not writable by group or others. Package code receives no path or
descriptor for this store. These checks protect the host/package boundary; they
do not defend against compromise of the trusted same-UID coordinator or host
administrator.

## 3. What this checkpoint proves

The focused corpus proves:

- the fixed digest-domain vector and exact byte ceiling;
- copy isolation and explicit capture disposal;
- strict inert-reference decoding without getter execution;
- concurrent no-replace publication without staging residue;
- recovery of early, synchronized, and post-link stage states after an actual
  publisher `SIGKILL`, while preserving the linked final file;
- preservation of a live publisher and collection after PID/start-time drift;
- refusal to repair corrupt retained state;
- refusal of special-file substitution;
- rejection of symlinked roots and symlinked or writable intermediate
  directories;
- JSON-decoded reacquisition in a fresh process; and
- survival of a captured copy after later store corruption.

The ordinary TypeScript build and the focused tests pass without changing a
public package export.

## 4. What remains unproved

Blob/1 does **not** prove that bytes are:

```text
a complete or self-contained bundle
valid JavaScript or an executable helper
owned by an approved host registration
compatible with a private ABI
the implementation named by a recipe
eligible on the current host
pinned by a live generation or Run
safe to load or execute
```

One self-contained bundle per closed role is the current minimal target. A
multi-member manifest is deferred until a real implementation cannot be made
self-contained.

## 5. Next boundary

The next private slice binds exact Blob/1 references to a closed set of host
roles and private ABIs:

```text
Adapter and launch planner
Sandbox Backend factory
privileged runtime helper
```

It must reacquire the bytes before validating and loading the named entrypoint.
A stable authenticated registration snapshot must contain those exact role
registrations and derived policy. Volatile Linux preflight facts—boot identity,
cgroup inode, current controllers, and current emptiness—belong in a separate
per-activation receipt and must not perturb registration identity.

Only after complete registrations, durable Nix runtime roots, strict persisted
state, visible-lock publication, and lock-first compare-and-set admission may
these artifacts participate in a `READY` generation. This checkpoint cannot be
promoted by treating a Blob reference as an authenticated registration.
