# FLOW Package/1

> *Status: prerelease specification candidate.*

A FLOW package is one immutable logical file tree. Its only required file is
an exact-case root `FLOW.md`. A package may add zero or one obvious root
implementation named `flow.<suffix>`.

Package identity depends only on the tree's canonical paths and exact file
bytes. It does not depend on Git, a package registry, the source directory, or
the runtime chosen by a host.

## 1. Package tree

A source adapter selects one component subtree and stages every descendant
regular file. `FLOW.md` must be at the staged root. Package/1 has no ignore
file, package-manager filtering, dependency exclusion, or generated-file
exception: a regular file inside the selected tree is package content.

Empty directories have no Package/1 meaning. Symlinks and other special files
are invalid. A filesystem adapter rejects a multiply linked source inode unless
it can prove that every alias is inside the same selected, nonprotected tree.
Accepted hardlinks become independent path-and-content records; inode identity
is not package data.

Inspection and execution use the same privately staged bytes. They never
reopen visible source after its package digest has been computed. A mutable
directory adapter uses descriptor-relative reads and retries detected changes;
it must not claim atomic source-snapshot provenance when its source mechanism
does not provide it.

Two source mechanisms produce the same Package/1 digest exactly when they
present the same canonical logical file map.

## 2. `FLOW.md` Metadata/1

`FLOW.md` is valid UTF-8 without a BOM and contains Unicode scalar values only.
It begins with an exact `---` delimiter line and ends its frontmatter at the
next exact `---` delimiter line. Delimiters may use LF or CRLF independently.
The bytes through the closing delimiter are limited to 262,144 bytes. The
remaining bytes are the Markdown body and retain their exact line endings.

The minimum document is:

```yaml
---
name: resize-image
description: Resize an image to the requested dimensions.
---
```

`name` is a `LocalName`: 1–64 lower-ASCII characters matching:

```text
[a-z0-9]+(?:-[a-z0-9]+)*
```

It is a friendly package-local label, not global identity. `description` is
1–16,384 Unicode scalars of human-readable text.

Metadata/1 has this closed unnamespaced vocabulary:

```text
name          required LocalName
description   required non-empty string
uses          optional map of capability slots
outcomes      optional map of custom outcome descriptions
attachments   optional map of attachment access modes
```

Unknown unnamespaced fields reject. An extension key is exactly `x-` followed
by a `LocalName`. Its bounded JSON-shaped value is inert package metadata and
can never acquire core Metadata/1 meaning.

Frontmatter uses the YAML 1.2 JSON schema with string mapping keys. Exact plain
`null`, `true`, `false`, and JSON-number scalars become their JSON values;
other admitted scalars become strings. Duplicate keys, explicit tags, anchors,
aliases, merge keys, non-string mapping keys, and implementation-specific
scalar types reject. The parsed value must satisfy FLOW JSON/1 and these
additional bounds:

```text
nesting depth          16
total nodes         4,096
entries per map       256
items per sequence    256
```

### Capability uses

Each `uses` key is a `LocalName`. A slot has exactly one of these forms:

```yaml
uses:
  index:
    contract: ./contracts/index.capability.json
  scratch:
    local: true
```

`contract` names one package-local Capability Contract/1 descriptor. An author
reference begins with exact `./`, then uses one or more canonical package path
segments. It cannot contain an empty, `.`, `..`, backslash, absolute, encoded,
or escaping form. The referenced regular file must exist in the staged package.

A host derives contract identity, version, and digest from the descriptor. Those
values are not copied into `FLOW.md`. The `local: true` form deliberately names
a nonportable local seam. The two forms are mutually exclusive.

### Outcomes and attachments

Each `outcomes` key is a `LocalName` with a nonempty description. `done`,
`failed`, `cancelled`, and `error` are reserved and cannot be declared as
custom outcomes.

Each `attachments` key is a `LocalName`. Its value is exactly `read` or
`read-write`. Metadata declares required attachment names and maximum access;
attachment-source mapping is host policy outside Package/1. A host may expose
that mapping through an explicit configuration mechanism.

### Format evolution

Metadata/1 has no `flow` or `format` field. A future core vocabulary must use a
new discriminator or entrypoint convention and is invalid under Metadata/1.
The Markdown body remains the package's public procedure and description; a
host cannot infer that prose and an implementation are equivalent.

## 3. Implementation entrypoint

A package may contain at most one root regular file whose name matches:

```text
flow.<suffix>
```

`suffix` is 1–16 lowercase ASCII letters or digits. Nested files and names with
more than one suffix are ordinary resources.

If the implementation begins with `#!`, its first line must be exactly:

```text
#!/usr/bin/env <selector>
```

The line may end in LF or CRLF. `selector` is 1–64 characters matching
`[A-Za-z0-9][A-Za-z0-9._+-]*`. Arguments, `env -S`, absolute interpreter
paths, interpolation, and shell commands are not part of this selector. The
selector identifies implementation semantics; it does not prescribe how a
host installs or invokes a runtime.

No entrypoint means the package contains instructions only. Package validity
does not imply that a particular host can execute it.

## 4. Conventional schemas

A Run package may contain these exact optional root files:

| File | Value validated |
|---|---|
| `input.schema.json` | Invocation input |
| `settings.schema.json` | The complete immutable Run settings object |
| `result.schema.json` | The complete `{ "outcome", "output" }` result |

Each present file must compile as FLOW Schema/1 during inert package
inspection. Without an input schema, any JSON/1 input is valid. Without a
settings schema, only `{}` is valid settings. Without a result schema, the
Run/1 envelope and declared-outcome rules still apply.

The result schema covers the complete result so it can correlate each outcome
with its output shape.

## 5. Canonical paths and limits

Each logical path:

- is a Unicode 15.1 NFC string;
- is relative and uses `/` as its only separator;
- has one or more nonempty segments;
- contains no NUL, backslash, empty, `.` or `..` segment;
- has at most 64 segments;
- is at most 1,024 UTF-8 bytes; and
- has segments of at most 255 UTF-8 bytes.

The complete tree rejects NFC duplicates and collisions under Unicode 15.1
full default case folding. Case remains significant. Records are ordered by
unsigned UTF-8 path bytes; host locale and filesystem enumeration order have
no role.

An admitted package has these absolute validity ceilings:

```text
regular files                         65,536
bytes in one file                1,073,741,824
sum of file contents             4,294,967,296
```

Counters do not wrap. A host lacking capacity may report
`RESOURCE_EXHAUSTED`, but must not calculate a partial identity or silently
change these validity limits.

## 6. Package digest

For every file, let `P` be its canonical UTF-8 path bytes and `C` its exact
content bytes. Sort files by `P`, then compute:

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

Integers are unsigned, big-endian, fixed-width values. The public rendering is
`sha256:` followed by 64 lowercase hexadecimal digits.

The digest excludes source location, directories, timestamps, ownership,
mode bits, inode identity, runtime selection, host policy, and sandbox state.
Those are provenance or admission evidence, not package identity.

## 7. Required conformance

Conforming implementations must prove at least:

1. The minimum Metadata/1 document passes and every unknown unnamespaced field
   rejects.
2. BOM, invalid UTF-8, malformed delimiters, unsafe YAML features, invalid
   JSON/1 values, and every metadata bound plus one reject.
3. Zero or one root implementation passes; two reject; selector spelling is
   exact.
4. Every present conventional schema is compiled during inert inspection.
5. Missing, escaping, or case-mismatched author references reject.
6. Enumeration order, directories, modes, ownership, and timestamps do not
   change identity; path, content, or extra-file changes do.
7. Traversal, absolute, backslash, NUL, non-NFC, case-fold collision, symlink,
   and unproved hardlink cases reject consistently.
8. Independent streaming digest implementations produce identical results.
