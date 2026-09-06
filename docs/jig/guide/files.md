---
title: Working with files
---

# Working with files

Give a Flow the files it needs and receive its deliverables without writing
your own capture or export program. Jig supplies the file boundary; the Flow
decides what its files mean.

```sh
jig run binding:repair --input @issue.json --attach source=./src --out ./review
```

`--input @issue.json` reads bounded JSON from a regular file. Inline JSON
continues to work. `--attach source=./src` supplies the directory to the
admitted Flow's declared `source` read attachment. `--out ./review` saves a
new result packet. Relative paths are relative to your command directory.

## Choose what to share

Without selectors, Jig captures regular files throughout the chosen directory.
To share less, repeat `--select` with exact relative paths:

```sh
jig run flow:flows/analyze --attach source=../project \
  --select source=src/main.ts --select source=README.md --out ./analysis
```

Unselected subtrees are not enumerated. Jig preserves binary and empty files;
empty directories are omitted. Symlinks, multiply linked files, special files,
protected host state, and nested mounts are rejected. Select intentionally:
capture does not detect secrets, and a Flow with Agent authority may send
selected contents to its operator-configured provider.

The current limit is eight declared attachments, including any writable one.
Input totals are bounded to 64 files, 8 MiB, 256 tree entries, 16 path components,
and 512 UTF-8 bytes per relative path.
The captured bytes are immutable during the Run; they are not a live mount
of your directory or a claim of an atomic repository revision.

## Receive one packet

A root Flow may declare one writable attachment. It begins empty and is
limited to 16 MiB. Jig supplies its contained path and collects files only
after execution is fenced and the result accepted. A Flow with no writable
attachment can still use `--out` to save its execution record.

Starting empty keeps your originals outside the Flow's write authority. The
size, file-count, and path limits bound memory, storage, and capture/export work.
Their current values are conservative Jig policy for small file jobs—not FLOW
requirements or demonstrated optimums. The output ceiling is enforced while
the Flow writes, not just checked afterward.

The output destination must not exist, must have an existing supported parent,
and must be outside every input root. For example, use a sibling destination
with `--attach source=.`; `--out ./review` would be inside that root.

```text
review/
  result.json       Jig's execution record and file manifest
  files/            The Flow's deliverables
```

The host record identifies the Run, admitted method/configuration, canonical
JSON input, captured files, and exported file sizes and SHA-256 digests.
It does not expose private host identities or include a digest of itself.
Exported directories are private (`0700`) and files are owner-readable/writable
(`0600`). A Flow's own `files/result.json` is just a deliverable, not host status.

## Understand failures

`status` describes execution; `delivery` describes publication. A valid custom
outcome such as `blocked` may include useful files. A failed process, invalid
result, or cancelled execution exports no partial Flow files. An invalid output
tree fails delivery without changing an already accepted execution outcome.

Publication exposes one complete packet without replacing an existing path.
This is atomic visibility, not a promise of persistence through power loss.
Cancellation before publication removes unfinished staging; cancellation after
publication does not retract the packet. The ordinary stdout record matches
the packet, but a later cleanup or acknowledgement failure can add a CLI error.
After connection loss, delivery may be unknown even though a packet exists.
If file metadata makes the report exceed JSON/1 limits, `JIG_REPORT_LIMIT`
preserves the execution terminal on stdout and reports delivery separately on
stderr; inspect the destination before starting new work.

Invalid input, missing attachment mappings, and a destination already occupied
at preparation time fail before package dispatch. Coordinator loss may leave
no terminal record; Jig's separate delivery owner removes unfinished staging.
Repeating the command always starts new work, never resumes an export.

Use Ctrl-C (SIGINT) to interrupt the command. `JIG_COMMAND_INTERRUPTED` may
arrive without a terminal packet; it does not prove that the Flow handler
started or received a cancellation signal.

`--timeout` bounds Run execution (30 seconds by default). Attachment capture and
export check separate 10- and 20-second budgets within the command's bounded
host overhead; cleanup is not skipped when either budget expires.

## Author a file Flow

Declare portable attachments in `FLOW.md`, then use the paths in
`run.attachments` through the ordinary FLOW SDK:

```yaml
attachments:
  source: read
  deliverables: read-write
```

Your method reads `run.attachments.source.path` and writes under
`run.attachments.deliverables.path`. It does not import Jig or choose host
paths. See the [tested-patch application](./tested-patch.md) for a complete
method with its own text validation and evidence checks.

This Jig profile currently supports attachments only on root invocations,
including configured Bindings. Child slots cannot select attachment-bearing
packages or inherit their parent's files. These host limits do not change
FLOW's portable attachment contract. Exact limits and lifecycle guarantees
are in the [project policy](../spec/project-policy.md#root-file-runs).
