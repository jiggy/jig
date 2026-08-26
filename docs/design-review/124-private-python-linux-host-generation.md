# Private Python/Linux host-generation checkpoint

**Status:** implemented and host-tested inert observation/codec checkpoint.
It canonically identifies the fixed implementation roles and their bounded Nix
members. It does not persist or root them, prove coordinator/helper behavior,
authorize host use, or make any recipe `READY`.

## 1. Closed stable identity

The private observer accepts exactly these roles:

```text
coordinator
helper
coordinator-bun
helper-bun
python
bubblewrap
nix-store
bash
```

The privileged launcher is intentionally absent. It is not a Nix generation
member and remains a separately installed and authenticated host mechanism.
Volatile cgroup scope, controller, boot, payload-identity, timeout, and
preflight facts are also absent.

Each role records only:

```text
fixed role name
canonical role-file path
top-level Nix store member
byte count
SHA-256 file digest
```

The observer does not stamp or infer an ABI merely because a caller assigns a
file to a role. The generation kind and fixed roles state the intended private
protocol. The subsequent [real-bundle checkpoint](126-private-host-bundle-proof.md)
proves that the exact emitted bytes implement that surface; host-policy
registration remains open.

Several roles may share one member. Unique top-level members are sorted and
record the fixed-order role subset, closure count, and a domain-separated
SHA-256 digest of the bounded, sorted, duplicate-free complete closure query.
The full closure list is validated transiently rather than copied into the
generation up to eight times. Every later use must re-query the exact member,
revalidate every protected closure object, and compare both count and digest.

The generation identity is:

```text
JIG-Python-Linux-Host-Generation/1
  canonical JSON/1 of kind + observer revision + roles + members
```

It contains no project, approval, grant, policy, admission, root, active-head,
lease, or `READY` field.

## 2. Exact observation mechanics

Role paths are canonicalized once and must resolve beneath an immutable Nix
store member. Every role is a bounded root-owned non-writable regular file.
Top-level and closure objects may be directories or flat store files, but must
be canonical root-owned non-writable objects.

The exact Nix query path comes from the already authentic private Python/Nix
runtime observation. The hardened query uses:

```text
argv0: nix-store
cwd: /
environment: empty
--store daemon
--option substitute false
--option fallback false
-qR <exact top-level member>
```

Both output streams are bounded and decoded as fatal UTF-8, and the process
has a hard deadline. Preserving `argv0` is essential on the measured Lix
multicall executable: resolving the front `nix-store` symlink to `nix` without
that argv0 changes the accepted legacy grammar.

## 3. Codec does not mint provenance

The encoder emits bounded canonical JSON/1 plus one terminal LF. The strict
decoder rejects alternate encoding, unknown fields, missing or reordered
roles, unsorted or duplicate members, inconsistent role/member relations,
noncanonical paths, invalid bounds, and a mismatched derived digest.

Decoded bytes produce a frozen
`PrivatePythonLinuxHostGenerationIntent`. They do **not** receive the
module-private observed-generation brand and are rejected by
`requirePrivatePythonLinuxHostGeneration()` and live verification. This is a
deliberate separation:

```text
strict decode
    proves canonical inert integrity

live observe + reverify
    proves current protected bytes and closures

future host-policy registration
    must separately authorize that exact generation digest
```

An inert file may later be compared byte-for-byte with an independently
observed and authorized generation. It cannot authorize itself after restart.

## 4. Evidence

The dedicated host gate adds the emitted coordinator and helper as unrooted
flat Nix store objects, combines them with the real Bun, Python, Bubblewrap,
Nix, and Bash files, and proves:

- the complete fixed role set;
- unique sorted member normalization and shared-member deduplication;
- flat-file and directory store members;
- fresh exact closure queries and protected closure objects;
- canonical encode/decode round trip;
- decoded-intent and forged-lookalike rejection; and
- live role and closure reverification.

The codec assertions themselves create no GC root, cgroup, or running process.
The same gate now also performs the separately delimited checkout-independent
load and benign envelope proofs recorded by [review 126](126-private-host-bundle-proof.md).
That envelope is fenced and its cgroup is removed before the gate succeeds.
The two content-addressed bundle objects remain unrooted Nix data and may be
reused by later runs.

The ordinary Jig suite continues to pass with this host gate skipped.

## 5. Exact non-claim and next boundary

The following [real-bundle checkpoint](126-private-host-bundle-proof.md) now
emits the reviewed coordinator/helper programs in the ordinary package build,
adds those exact bytes to Nix, observes them as the generation roles, and
proves checkout-independent load and helper behavior. The generation codec
remains unchanged and inert.

It also adds no:

- configured root directory or same-path canary;
- durable, fsynced generation intent;
- collision-safe publisher serialization;
- indirect root publication or daemon root confirmation;
- acquired execution owner, lease, retirement, or cleanup authority;
- authenticated host policy, restricted launcher, active preflight, restart
  recovery, admission connection, or `READY` evidence.

The next slices are therefore ordered:

1. durably write this inert expected value before any Nix root mutation;
2. serialize one publisher, run the exact configured-root canary, and publish
   and read-only verify every unique member; and
3. leave production retirement and activation acquisition closed until a
   host-global authenticated state machine and durable spawn owners exist.

Failure after a future root mutation must remain a diagnosable safe leak. No
fresh coordinator may infer deletion authority from this inert value alone.
