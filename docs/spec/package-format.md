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

## 2. `FLOW.md` Metadata/1

The exact-case root filename identifies this as a FLOW package. V1 therefore
does not repeat a speculative `flow: 1` type/version marker in every document.
`FLOW.md` is valid UTF-8 without a BOM and contains Unicode scalar values only.
Its first four bytes are `---` followed by LF, or its first five bytes are
`---` followed by CRLF. The frontmatter ends at the first later line consisting
of exactly `---`, followed by LF, CRLF, or end of file. Delimiter line endings
may differ. The opening delimiter through the closing delimiter is at most
262,144 bytes. The remaining bytes are the Markdown body; Package/1 identity
continues to preserve their exact LF or CRLF spelling.

The frontmatter requires only:

```yaml
---
name: gauntlet-loop
description: Build and improve an artifact through repeated review.
---
```

`name` is a `LocalName`: a 1–64 character lower-ASCII slug matching
`[a-z0-9]+(?:-[a-z0-9]+)*`. It is a friendly package-local label, not global
identity. `description` is human- and Agent-readable text of 1–16,384 Unicode
scalars. Package identity remains source provenance plus the complete
Package/1 digest.

The complete unnamespaced Metadata/1 vocabulary is:

```text
name          required LocalName
description   required non-empty string
fallback      optional exact literal `instruction`; Run only
uses          optional map of LocalName capability slots
outcomes      optional map of custom LocalName to non-empty description; Run only
attachments   optional map of LocalName to `read` or `read-write`
service       optional exact integer 1; selects Service capability
provides      optional map of LocalName to descriptor path; Service only
```

Unknown unnamespaced fields reject. An extension key is exactly `x-` followed
by a `LocalName`; its bounded JSON-shaped value is inert and still ordinary
package bytes. No key admitted through that extension namespace can later gain
core meaning under Metadata/1.

Frontmatter uses the YAML 1.2 JSON schema with string mapping keys only. Exact
`null`, `true`, `false`, and JSON-number plain scalars resolve to their JSON
values; every other admitted plain or quoted scalar resolves to a string.
Duplicate keys, explicit tags, aliases, anchors, merge keys, non-string mapping
keys, and implementation-specific scalar types reject. The parsed root is a
mapping and its values must lie in the FLOW JSON/1 data domain. Its maximum
depth is 16 with the root at depth 1, it contains at most 4,096 total nodes,
and no mapping or sequence contains more than 256 entries. A node is the root
or one mapping key, mapping value, or sequence item; a container counts once at
its position rather than once per descendant. Mapping keys and values are
children at the same next depth. Each of `uses`, `provides`, `outcomes`, and
`attachments` therefore also has at most 256 members. Limits are checked before
semantic field validation and use non-wrapping arithmetic.

A package without `service` is Run-capable. It may declare `fallback` and
`outcomes`, and it must not declare `provides`. A package with `service: 1` is
Service-capable. It requires exact code, may declare `provides`, and must not
declare Run-only `fallback` or `outcomes`. V1 has no dual-mode package.

A portable consumed capability references the exact self-contained descriptor
bytes the consumer was authored against:

```yaml
uses:
  agent:
    contract: ./contracts/agent-run.capability.json
```

An author package reference is exactly `./` followed by one or more canonical
logical path segments from section 3. The prefix is reference syntax, not a
path segment, and is stripped once. No other dot segment, empty segment,
normalization, percent decoding, backslash, absolute form, or escape is
allowed. Resolution uses exact case and must name one regular file in the
already staged package.

`contract` uses that syntax to reference one Capability Contract/1 JSON
descriptor in this same package. Jig validates the descriptor and derives its
URI, exact version, and canonical digest; authors do not copy any of those
values into `FLOW.md`. Every dependency of a Service Mount is fixed before
provider initialization and remains pinned for that Mount. The only other
`uses` form is the explicit nonportable local seam:

```yaml
uses:
  scratch:
    local: true
```

The public and local forms are closed and mutually exclusive. Missing a
descriptor never implies a weaker public contract. Each `provides` value is
likewise an exact `./` author reference to a self-contained Capability
Contract/1 descriptor.

Custom outcomes cannot use the reserved `done`, `failed`, `cancelled`, or
`error` names. All authority- or protocol-bearing keys in `uses`, `provides`,
`outcomes`, and `attachments` are `LocalName`s.

Metadata/1 has no `format` field. Every document valid under Metadata/1 keeps
this complete core vocabulary and these semantics permanently. Any future core
field or semantic change—not only a visibly breaking one—must use a
discriminator such as `format: 2`, or a new entrypoint filename, whose presence
is invalid in Metadata/1. New hosts must continue to treat an absent
discriminator as Metadata/1. This supplies downgrade safety without taxing the
first format with a version field that distinguishes nothing.

The Markdown body is the executable procedure for instruction-only packages.
For exact-code packages it remains the public semantic description and
documentation; code is operational authority. A host cannot prove prose and
code equivalent.

An exact immediate subtree `skills/<LocalName>/` containing exact-case
`SKILL.md` is selectable Flow-local Agent context under the Agent contracts.
Jig identifies the subtree by directory LocalName but does not parse Skill
identity, dependencies, or precedence. Other directories remain ordinary
package resources. More than 64 selectable subtrees is still a valid package,
but cannot qualify for the v1 instruction conductor which selects all of them
through one bounded Agent Run call.

## 3. Canonical paths

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

## 4. Absolute validity ceilings

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

## 5. Exact package digest

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

## 6. Required conformance cases

1. Metadata/1 accepts its closed valid Run and Service forms and rejects BOM,
   invalid UTF-8 or Unicode, malformed or missing exact delimiters, every
   frontmatter ceiling plus one, `flow: 1`, `format`, invalid cross-mode
   fields, non-JSON-schema YAML values, malformed YAML features, unsafe or
   case-mismatched descriptor references, invalid extension keys, and unknown
   unnamespaced fields.
2. A future format cannot cause an old Metadata/1 parser to accept and
   reinterpret the same document.
3. Independent streaming implementations produce the same digest.
4. Length-prefix collision attempts produce different digests.
5. Enumeration order, directory entries, mode, owner, and timestamp changes do
   not change identity.
6. A path, content, or extra-file change changes identity.
7. CRLF and LF content produce different identities.
8. NFC, case-fold, traversal, absolute, backslash, NUL, symlink, and special
   file cases reject consistently.
9. Proven in-tree hardlinks behave as independent regular-file records;
   unproved, escaping, or protected-source aliases reject before staging.
10. Under concurrent source mutation, preparation and execution use exactly the
   privately staged tree whose digest was admitted; no later source reread can
   mix bytes into it. Snapshot-backed provenance is claimed only when the
   source adapter actually supplies an atomic immutable snapshot.
11. Every absolute ceiling passes at its maximum and rejects at maximum plus
   one; aggregate byte accounting cannot overflow.
12. Git, npm, OCI, and local adapters presenting an identical logical tree
    produce the same digest.
