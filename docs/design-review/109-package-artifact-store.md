# Private Package/1 artifact store

**Status:** reviewed private implementation boundary; not a public CAS API.

The captured project aggregate cannot survive a coordinator restart while its
Package/1 members exist only in anonymous `O_TMPFILE` snapshots. Jig therefore
needs one protected durable representation before it can build the aggregate.
This slice retains exactly Package/1 values and nothing else.

## 1. Identity

The only private reference is:

```ts
interface PackageArtifactRef {
  readonly kind: "flow-package/1";
  readonly digest: PackageDigest;
}
```

`PackageDigest` accepts exactly `sha256:` followed by 64 lowercase hexadecimal
digits. The reference identifies the exact Package/1 value expected in the
protected store. Successful publication or acquisition proves current
retention; the bare reference does not. It does **not** prove:

- where the source came from;
- which project discovery observation selected it;
- that `FLOW.md` was valid;
- that an entrypoint is runnable;
- that dependencies or authority were resolved; or
- that the package was admitted.

Source-capture and semantic-candidate digests remain distinct identities. The
current direct-target observation still contains only `packageDigest`; a later
durable aggregate will carry `package: PackageArtifactRef` after publication.

## 2. Stored representation

The store persists the exact byte sequence already defined as the Package/1
SHA-256 preimage:

```text
ASCII("FLOW-Package/1\0")
|| u64be(fileCount)
|| repeated canonical path/content records
```

This is not a second archive format. It is the normative, self-delimiting
Package/1 identity encoding. Persisting it as one regular file gives Jig:

- exact paths independent of the store filesystem's path equivalence;
- streaming writes and reads without whole-package buffering;
- no internal symlink, hard-link, or special-file surface;
- full verification through one opened descriptor; and
- atomic create-if-absent publication using a same-filesystem hard link.

No manifest is stored. It would duplicate paths and sizes already committed by
the canonical bytes and introduce a second atomicity authority. A future index
may be a disposable derived cache, never identity-bearing state.

The private layout is an implementation detail:

```text
<protected-root>/packages/v1/sha256/<first-two-hex>/<remaining-hex>.pkg
```

Host paths never enter project values or artifact references.

## 3. Publication transaction

The store root must already be a real directory owned by the Jig coordinator's
effective user and not writable by group or others. Jig opens and pins that
identity, traverses each internal component relative to pinned directory
descriptors with `O_NOFOLLOW`, validates the same owner and permissions, and
has every publisher synchronize each parent before relying on a child name.
Flow code never sees or writes this root.

Publication is:

1. validate the claimed Package/1 digest before deriving a path;
2. create an unpredictable owner-only staging file in the final shard with
   `O_EXCL | O_NOFOLLOW`;
3. stream the canonical Package/1 encoding from the captured snapshot while
   independently enforcing Package/1 limits and hashing it;
4. require the computed digest to equal the capture's claim;
5. `fsync`, make the staging inode read-only, and `fsync` again;
6. reopen, decode, hash, and require exact EOF from the stored bytes;
7. hard-link the staged inode to the final digest name, which atomically
   succeeds only when that name is absent;
8. verify both names identify the same regular file and synchronize the shard;
9. unlink the staging name and synchronize the shard again.

When another publisher wins, Jig removes its own stage, fully verifies the
existing final object, synchronizes the shard, and returns the same reference.
It never overwrites or repairs a corrupt existing object. A final object may
exist after a reported directory-sync failure; a retry verifies it rather than
assuming absence or rolling it back.

Normal failures remove their own staging name; a failed close, unlink, or
directory synchronization is surfaced, together with the primary failure when
there is one. Crash leftovers have no
addressable artifact identity and are ignored by acquisition. Bounded startup
cleanup and quotas belong to later store ownership work, not Package identity
or garbage collection.

## 4. Acquisition

Every acquisition traverses the protected store through pinned directory
descriptors, opens the final name with `O_NOFOLLOW`, requires the expected owner
and a read-only regular file, decodes the canonical envelope, enforces all
Package/1 ceilings, validates UTF-8 paths, canonical ordering and collisions,
hashes every byte, requires exact EOF, and rechecks descriptor/path identity.
During that same verification pass Jig copies the canonical bytes into an
anonymous file and seals it read-only.

Acquisition does not rewrite or repair store objects. It synchronizes the final
shard before returning so that a reader racing the short interval between a
publisher's hard link and directory `fsync` cannot make an uncommitted name
look durable. Ancestor names were synchronized before publication made the
final object visible.

The returned invocation-local `CapturedPackage` holds only that sealed anonymous
snapshot and serves member ranges by offset. Later host-store mutation cannot
change bytes already acquired under the verified digest. The view never returns
the durable store path. Runtime materialization must copy from it into the Run's
private sandbox tree; the durable store is not mounted into package code.

Read-only mode is defense in depth against accidental host mutation, not the
security boundary. Protection comes from host ownership, non-exposure, and the
Sandbox Backend's denial of the store. Any later corruption is a hard
`PACKAGE_ARTIFACT_CORRUPT` failure, not a cache miss.

## 5. Deliberate omissions

This is an add-only private Package/1 store, not a general content-addressed
storage subsystem. It adds no:

- public store or blob API;
- generic digest type or multiple hash algorithms;
- source provenance or inspection cache;
- aliases, remote storage, compression, or per-file deduplication;
- manifest, database, locks, or mutable metadata;
- refcounts, leases, garbage collection, quotas, or compaction; or
- admission, lockfile, generation, or authority semantics.

Retention ownership becomes meaningful only when the durable project aggregate
and active-generation pinning exist. Deletion must not be designed before those
owners exist.

## 6. Next boundary

The next slice may build the smallest pure project aggregate over injected,
already-captured authoring values and `PackageArtifactRef`s. It must not reopen
visible source or expose this store as project configuration. The bounded
TypeScript evaluator still follows that semantic consumer.
