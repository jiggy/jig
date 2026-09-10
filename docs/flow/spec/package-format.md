# FLOW Package/1

> *Status: prerelease specification candidate.*

A FLOW package is one immutable logical file tree containing exactly one root
implementation named `FLOW.<ext>`. Markdown is an implementation format; a code
package has no required Markdown companion. Optional invocation declarations
live in `contract.json`, independently of implementation format.

Package identity depends only on canonical paths and exact file bytes. It does
not depend on Git, a registry, the source directory or the runtime selected by
a host. Valid package meaning does not establish local permission or support
to execute it.

## 1. Package tree

A source adapter selects one component subtree and stages every descendant
regular file. Package/1 has no ignore file, package-manager filtering, dependency
exclusion or generated-file exception: every selected regular file is content.

Empty directories have no meaning. Symlinks and other special files are invalid.
A filesystem adapter rejects a multiply linked source inode unless it proves
every alias lies inside the same selected, nonprotected tree. Accepted hardlinks
become separate path/content records; inode identity is not package data.

Inspection and execution use the same privately staged bytes. They never reopen
visible source after calculating the package digest. A mutable-directory adapter
uses descriptor-relative reads and retries detected changes; it cannot claim
atomic source-snapshot provenance when its source mechanism does not provide it.

Two source mechanisms produce the same Package/1 digest exactly when they present
the same canonical logical file map. Scripts, assets and references remain
ordinary captured resources. Their existence does not grant execution or reads.

## 2. Metadata/1

Metadata is optional. The owner depends on the implementation:

| Implementation | Sole metadata owner |
| --- | --- |
| `FLOW.md` | Optional frontmatter in that file. A root `flow.meta.json` beside it is invalid. |
| Any other `FLOW.<ext>` | Optional root `flow.meta.json`. Imported code and comment headers are never metadata. |

There is no merge or precedence. Ordinary `metadata.json` is an ordinary
resource. Metadata absence is an empty metadata object; names and descriptions
remain absent, with package paths available for display. Names need not match
directory names.

Present known fields are validated as follows:

| Field | Rule |
| --- | --- |
| `name` | Optional `LocalName`: 1–64 lower-ASCII characters matching `[a-z0-9]+(?:-[a-z0-9]+)*` as a complete string. |
| `description` | Optional nonempty human-readable string of 1–16,384 Unicode scalars. |
| `uses` | Optional map of dependency-slot `LocalName` keys to the declarations below. |
| `license` | Optional string describing licensing. |
| `compatibility` | Optional string describing environmental requirements. |
| `metadata` | Optional string-to-string map of descriptive metadata. |
| `allowed-tools` | Optional string whose execution restriction must be qualified and enforced by the runtime. |
| `x-<LocalName>` | Inert extension value satisfying the metadata and JSON/1 bounds. |

Malformed known fields reject package metadata. Unknown top-level fields remain
inspectable but prevent execution qualification; they never silently acquire
meaning. Extensions cannot grant powers or acquire core Metadata/1 meaning.
Invocation input/result schemas, outcomes, channels and attachments belong only
to `contract.json`; putting them in metadata does not declare them.

### Frontmatter and sidecars

`FLOW.md` is valid UTF-8 without a BOM and contains Unicode scalars only.
Optional frontmatter starts only when its first line is exactly `---` and ends
at the next line exactly `---`. Line endings are not part of the delimiter;
LF and CRLF are admitted. A started block without a closing delimiter rejects.
Empty frontmatter is empty metadata; a non-object YAML document rejects. Without
frontmatter, the entire file is the exact Markdown body.

The bytes through the closing delimiter are at most 262,144 bytes. A sidecar is
at most 262,144 original UTF-8 bytes, is parsed as JSON/1 with duplicate-member
checks, and must contain an object. Both metadata forms satisfy JSON/1 and:

```text
nesting depth          16
total nodes         4,096
entries per map       256
items per sequence    256
```

Frontmatter uses the bounded YAML 1.2 JSON schema with string mapping keys.
Exact plain `null`, `true`, `false` and JSON-number scalars become JSON values;
other admitted scalars become strings. Duplicate keys, tags, anchors, aliases,
merge keys, non-string keys and implementation-specific scalar types reject.
The body retains its exact bytes and line endings.

For example, this is a complete Markdown package:

```markdown
---
name: writing
description: Improve supplied prose while preserving its claims.
---
Return a concise revision. Preserve uncertainty and attribution.
```

### Dependencies

Each `uses` entry is exactly an empty object or an object containing one
`contract` reference:

```yaml
uses:
  reviewer:
    contract: ./interfaces/reviewer/contract.json
  archive: {}
```

The first entry expects a named [Invocation Contract/1](invocation-contracts.md)
and its complete channel closure. The second declares an uncontracted slot
available only through explicit host configuration, without an interchangeability
claim. One namespace covers Flow and native targets. There is no method selector
or separate local-effect marker.

An author reference starts with exact `./`, followed by one or more canonical
downward-only logical path segments. Empty, dot, dot-dot, backslash, C0 control,
DEL, absolute or escaping forms reject. Never decode or normalize author
references. Resolve by exact case to a regular file in the immutable package.
Hosts derive identity from that descriptor and
closure; metadata never repeats hashes, IDs or versions. Descriptor channel
references resolve relative to its own containing directory.

A declaration supplies neither a target nor execution authority. Required
dependencies must qualify before invocation. Unsupported explicit choices never
fall back to another implementation. Runtime-derived dependencies must be
disclosed during qualification; the Markdown profile reserves `markdown-agent`
for its own reasoning dependency.

### Environment and tool restrictions

Review displays compatibility/environment prose. Known missing required
facilities prevent qualification; a missing prerequisite discovered during work
fails before its requested effect. Parsing cannot certify arbitrary prose
requirements or an Agent's completion claim.

A runtime must explicitly qualify enforcement of a declared `allowed-tools`
restriction, or report execution unsupported. It cannot silently treat that
field as inert. [Markdown/1](markdown-runtime.md) defines its bounded projection;
this specification qualifies no code runtime's restriction enforcement.
Resources and text cannot grant native tools, filesystem authority, credentials
or provider configuration.

## 3. Implementation entrypoint

Exactly one root regular file has the exact uppercase basename `FLOW` and
one lowercase extension:

```text
FLOW.<ext>
```

`ext` contains 1–16 lowercase ASCII letters or digits. Missing or simultaneous
implementations reject. There is no companion requirement, fallback or alternate
case. Nested files and names with additional suffixes remain ordinary resources.

For a code implementation beginning with `#!`, the first line must be exactly:

```text
#!/usr/bin/env <selector>
```

The line may end with LF or CRLF. `selector` is 1–64 characters matching
`[A-Za-z0-9][A-Za-z0-9._+-]*`. Arguments, `env -S`, absolute interpreter paths,
interpolation and shell commands are not selectors. It identifies implementation
semantics, not installation or a host launch command.

`FLOW.md` can contain ordinary instructions, exact SDK recipes or both, under
[Markdown/1](markdown-runtime.md). A host must explicitly support and qualify its
selected parser/interpreter profile; absence of support fails visibly. A host
cannot substitute prose for a different executable implementation.

## 4. Invocation contract and settings

Only these optional exact root owners establish validation:

| File | Meaning |
| --- | --- |
| `contract.json` | [Invocation Contract/1](invocation-contracts.md): input, complete result, explicit outcomes, channels and caller attachments. |
| `settings.schema.json` | [Schema/1](schema-files.md): the complete immutable implementation settings object. |

Compile present declarations during inert inspection, before code or instructions
run. Without a contract, input is any bounded JSON/1, only `done` is a normal
outcome, output is bounded JSON/1, and there are no declared ports. An anonymous
contract may add only the local constraints needed; a named identity is optional.
Without a settings schema only `{}` is valid settings. No code inference,
environment fallback, per-call merge or defaults are inserted.

Exact root `input.schema.json` and `result.schema.json` are disallowed package
paths. Similarly named nested resources have no inferred invocation meaning.
There is no alternate declaration reader or schema/frontmatter mode.

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

Conforming implementations must establish:

1. Exactly one root implementation; absent, simultaneous and alternate-case
   entrypoints reject, with exact code-selector spelling.
2. Optional metadata has one owner; Markdown plus a sidecar rejects. Missing
   names/descriptions remain absent, while malformed known fields reject and
   unknown fields prevent execution qualification.
3. BOM, invalid UTF-8, unclosed frontmatter, unsafe YAML, duplicate JSON members,
   non-object metadata and every metadata bound plus one reject.
4. Present contract/settings declarations compile during inert inspection;
   removed root schema paths and misplaced invocation metadata cannot execute.
5. Missing, escaping or case-mismatched author references reject; invocation
   channel references retain descriptor-relative closure meaning.
6. Declared tool restrictions require actual qualified enforcement, and missing
   execution or reasoning support never silently substitutes another method.
7. Enumeration order, directories, modes, ownership and timestamps do not change
   identity; path, content and extra-file changes do.
8. Traversal, absolute, backslash, NUL, non-NFC, case-fold collision, symlink and
   unproved hardlink cases reject consistently.
9. Independent streaming digest implementations produce identical results.
