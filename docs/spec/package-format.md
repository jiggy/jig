# FLOW Package/1

**Status:** reviewed FLOW specification; independent canonicalization fixtures
and two implementations remain a release gate.

A FLOW Package is one immutable logical file tree. `FLOW.md` is the only
required file. A code-backed package adds exactly one regular root file named
`flow.<suffix>` as defined by
[`runtime-adapters.md`](runtime-adapters.md). Package identity is independent
of Git, npm, OCI, a local directory, file metadata, and the eventual prepared
runtime tree.

## 1. Selected source tree

A source adapter selects one exact component subtree and presents it as a
logical map from relative path to file bytes. `FLOW.md` must be at that map's
root. Package/1 includes **every** descendant regular file in the selected
tree. It has no `.gitignore`, package-manager ignore rules, ambient dependency
exclusions, or source-specific filters.

SCM metadata, dependency caches, and generated preparation files are absent
only when they are outside the selected tree supplied by the source adapter.
If any such file is inside that tree, it is ordinary package content and
changes the package identity. Empty directories have no Package/1 meaning.

Symlinks and other special files are invalid. A source adapter copies every
admitted path and its bytes into a private immutable staging tree. A
filesystem-backed adapter rejects a multiply linked source inode unless it can
prove every alias is inside the same selected nonprotected tree; archive and
content-store adapters likewise admit hardlink records only when their target
is another admitted logical file. Accepted hardlinks become independent
path/content records, and inode identity is not package data. The Package/1
digest is computed from that staged logical map, and preparation and execution
consume the same staged bytes rather than reopening the source tree.

An adapter backed by an atomic immutable source snapshot may attest that the
staged map represents one source revision. A mutable-directory adapter instead
uses descriptor-relative, race-resistant reads and retries changes it detects.
It does not claim to detect a malicious mutate-and-revert race or to prove that
all staged path versions existed simultaneously. Such a capture still has one
exact Package/1 identity; its weaker source-revision fidelity is recorded in
provenance and may be rejected by host policy.

Two source mechanisms produce the same package digest exactly when they
produce the same admitted logical file map. FLOW does not claim that a Git
checkout and an npm publication necessarily contain the same files.

## 2. Canonical paths

Each logical path uses the Unicode 15.1 character database for both NFC and
full default case folding. It:

- is a Unicode-scalar string normalized to NFC;
- is relative and uses `/` as its only separator;
- has one or more non-empty segments;
- contains no NUL, backslash, empty, `.` or `..` segment;
- has at most 64 segments;
- is at most 1,024 bytes when UTF-8 encoded; and
- has segments of at most 255 UTF-8 bytes each.

Absolute paths and paths whose source spellings are not already NFC are
invalid. The complete tree is rejected if two source paths have the same NFC
form or if two canonical paths collide under Unicode 15.1 full default case
folding. FLOW preserves case; this is one fixed Package/1 collision check, not
a claim to model every host filesystem's equivalence rules. A host unable to
materialize an otherwise valid path reports activation unavailable rather than
changing the package or its digest.

Canonical records are ordered lexicographically by their unsigned UTF-8 path
bytes. Host locale and filesystem enumeration order have no role.

## 3. Absolute validity ceilings

An admitted Package/1 tree has at most:

```text
regular files                         65,536
UTF-8 bytes in one path                1,024
UTF-8 bytes in one path segment          255
path segments                             64
bytes in one file                1,073,741,824
sum of all file contents         4,294,967,296
```

All counters use non-wrapping arithmetic. Large corpora, model weights, and
working data belong in explicitly bound attachments or content-addressed
resources, not inside a FLOW package.

A host lacking local capacity may reject an otherwise valid package with
`RESOURCE_EXHAUSTED`. It must not call the package invalid, calculate a partial
identity, or silently impose a smaller Package/1 validity limit. The digest is
streamable and does not require holding the tree or a large file in memory.

## 4. Exact package digest

Integers below are unsigned, big-endian, fixed-width values. For every file,
let `P` be its canonical UTF-8 path bytes and `C` its exact content bytes. Sort
the files as specified above, then compute:

```text
SHA-256(
  ASCII("FLOW-Package/1\0")
  || u64be(fileCount)
  || for each file (
       0x01
       || u32be(byteLength(P))
       || P
       || u64be(byteLength(C))
       || C
     )
)
```

The public rendering is `sha256:` followed by exactly 64 lowercase hexadecimal
digits. Length prefixes and the record tag make the encoding unambiguous.

The digest includes file paths and bytes only. It excludes the root host path,
source URI and revision, directories, ordering in the source container,
timestamps, extended attributes, ownership, mode and executable bits, inode
or hardlink identity, Adapter data, dependency preparation, and sandbox state.
Those facts may be recorded separately as provenance or activation evidence.

An installed revision is identified by the tuple:

```text
resolved source URI
component subpath
source revision
Package/1 digest
```

The source tuple provides provenance; the digest provides exact tree identity.

## 5. Required conformance cases

1. Independent streaming implementations produce the same digest.
2. Length-prefix collision attempts produce different digests.
3. Enumeration order, directory entries, mode, owner, and timestamp changes do
   not change identity.
4. A path, content, or extra-file change changes identity.
5. CRLF and LF content produce different identities.
6. NFC, case-fold, traversal, absolute, backslash, NUL, symlink, and special
   file cases reject consistently.
7. Proven in-tree hardlinks behave as independent regular-file records;
   unproved, escaping, or protected-source aliases reject before staging.
8. Under concurrent source mutation, preparation and execution use exactly the
   privately staged tree whose digest was admitted; no later source reread can
   mix bytes into it. Snapshot-backed provenance is claimed only when the
   source adapter actually supplies an atomic immutable snapshot.
9. Every absolute ceiling passes at its maximum and rejects at maximum plus
   one; aggregate byte accounting cannot overflow.
10. Git, npm, OCI, and local adapters presenting an identical logical tree
    produce the same digest.
