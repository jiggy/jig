---
title: Working with files
---

# Working with files

Give a Flow read access to selected files and collect its output in a new result
directory. This example copies one UTF-8 text file. Your original stays outside
the Flow's write access.

## Before you start

Use a project from the [quickstart](index.md) on a supported host. The author
declares which files the Flow needs. The operator selects the input directory
and output destination.

## Author a file Flow

Create the Flow from your project root:

```sh
jig new copy
```

If `jig.ts` uses explicit membership, add `flows/copy` to its `flows` list.
Create `flows/copy/FLOW.contract.json`:

```json
{
  "$schema": "https://flow.jig.md/schemas/invocation-contract-0.schema.json",
  "attachments": { "source": "read", "deliverables": "read-write" }
}
```

Replace `flows/copy/FLOW.ts`:

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { handle } from '@jigging/flow'

await handle(async run => {
  const text = await readFile(join(run.attachments.source.path, 'note.txt'), 'utf8')
  await writeFile(join(run.attachments.deliverables.path, 'note.txt'), text, 'utf8')
  return { outcome: 'done', output: { file: 'note.txt' } }
})
```

The Flow uses the supplied attachment paths. It does not import Jig or choose
host paths.

## Review and run the copy

Create a small input directory, then review and run:

```sh
mkdir input
printf 'Hello from a file.\n' > input/note.txt
jig review --allow-resolution-network
jig run flow:flows/copy --attach source=./input --out ./copy-result
cat copy-result/files/note.txt
```

The starter declares the FLOW SDK dependency. If its lock is missing, review
needs the resolution permission shown above. That permission may contact
dependency-selected destinations before approval. Read
[dependency preparation](dependencies.md#fresh-resolution-and-network-access)
before granting it.

Inspect the source and proposed authority before approving execution.

Expect `Hello from a file.` in the copied file. The Run should report execution
status `succeeded`, outcome `done`, and confirmed delivery. The packet contains:

```text
copy-result/
  result.json       Jig's execution record and file manifest
  files/note.txt    The copied text
```

For another Run, choose a new destination. Jig never overwrites an existing
result directory. Try changing the input text. Per-run inputs are captured
afresh without source review.

Review again if you change the Flow or its contract.

## If the copy does not complete

| Observation | Action |
| --- | --- |
| Input or attachment validation fails | Correct the input and declared mapping. These checks fail before package dispatch. |
| `note.txt` is absent | Supply that file in the selected input directory. Inspect the reported execution failure before new work. |
| The destination already exists | Choose a new directory. A repeated command starts new work. It does not resume delivery. |
| Delivery or cleanup is uncertain | Inspect the destination and retained evidence. Follow [Results and recovery](results.md) before further work. |
| Ctrl-C interrupts the command | Wait for cleanup. An interruption may leave no terminal packet and does not prove the handler started. |

Execution and delivery are separate facts. An accepted execution result can
survive failed delivery. A delivered file does not prove application
correctness. See [delivery and interruption](#understand-failures) for
checkpoints and exact failure behavior.

## Choose what to share

Use `--attach NAME=DIRECTORY` for each declared read attachment. Relative paths
resolve from the command directory. Without selectors, Jig captures regular
files throughout the chosen directory. Repeat `--select` to restrict capture to
exact relative paths:

```sh
jig run flow:flows/analyze --attach source=../project \
  --select source=src/main.ts --select source=README.md --out ./analysis
```

Unselected subtrees are not enumerated. Capture preserves binary and empty
files. Empty directories are omitted. Symlinks, multiply linked files, special
files, protected host state, and nested mounts are rejected.

Capture does not detect secrets. A Flow with Agent authority may send selected
content to its configured provider. Select only the files you intend to share.

Captured bytes stay unchanged during the Run. They are not a live directory
mount or an atomic repository snapshot. Input limits are eight declared
attachments, including any writable one, and these aggregate bounds:

| Limit | Maximum |
| --- | --- |
| Files | 64 |
| Bytes | 8 MiB |
| Tree entries | 256 |
| Path components | 16 |
| Relative path length | 512 UTF-8 bytes |

`--input @question.json` supplies JSON input from a selected regular file.
Inline JSON also works. Jig captures and parses it before execution. It is not a
file attachment.

Its parent may use ordinary path aliases, but the selected file cannot be a
symlink.

## Keep a resource with a Binding

For reference data that should change only after review, declare it in a
Binding:

```ts
import { defineBinding } from '@jigging/jig';

export default defineBinding({
  package: './flows/analyze',
  attachments: { reference: './resources/reference' },
});
```

The Flow declares `reference: "read"` and uses `run.attachments.reference.path`.
Paths in the Binding resolve from the project root. Review shows the complete
file manifest and digest. Approval keeps that captured copy.

Later edits or deletion of the source directory do not change approved Runs.
Review again to propose new contents.

A bound name cannot be overridden with `--attach`. Other read attachments still
need per-run mappings. Combined inputs share the same 64-file/8-MiB limit. Only
the selected root Binding receives its resources automatically.

Direct `flow:` calls do not borrow them. Children need explicit mappings.

Capture retains the complete selected regular-file trees even if you decline
execution approval. Bound resources are not secret storage. Choose small,
intentional directories. Tool bundles are ordinary code under existing sandbox
permissions.

See the
[resource boundary](../spec/project-policy.md#reviewed-binding-attachments) for
native binaries, executable permissions, and argument restrictions.

## Compose file work

Keep children independently runnable. In the caller Binding, map only the
attachments each child needs:

```ts
slots: {
  copy: {
    target: 'flow:flows/copy',
    attachments: {
      source: { from: 'source' },
      deliverables: { create: true },
    },
  },
},
```

The caller declares `source: "read"`. The child declares `source: "read"` and
`deliverables: "read-write"`. The child receives the caller's immutable source
view and one fresh empty output owned by the call:

```ts
const copied = await run.call({
  operationId: 'copy-1',
  slot: 'copy',
  input,
  attachments: { deliverables: { create: true } },
})
```

After successful child completion and cleanup, `copied.artifacts.deliverables`
holds its immutable output. Another slot with `source: { supplied: 'read' }`
can receive it through `attachments: { source: { read: artifact } }`. The
fixed `from` mapping is not repeated in call attachments and cannot be overridden.
Every child attachment needs a reviewed mapping. Calls never choose writable
host paths.

The same slot can run repeatedly or alongside a sibling, with a fresh destination
for each operation. A caller does not need writable output merely to coordinate
file work. To forward a held artifact, declare `artifactResults: ["final"]` in
its `FLOW.contract.json` and return `artifactResults: { final: artifact }`
alongside the handler's ordinary outcome and output. Result artifact names
are separate from domain result schemas.

Forwarding retains the same immutable
bytes rather than merging files into the caller's writable tree. Failed or
uncertain work does not become a successful artifact. Jig does not retry it
automatically.

[Child file policy](../spec/project-policy.md#child-file-runs) owns exact
mapping, artifact limits, lifecycle, and cleanup requirements.

## Receive one packet

Omit `--out` when a reviewed root target declares writable deliverables or
forwarded `artifactResults`. Jig chooses a fresh packet directory in
operating-system temporary storage for each invocation. It reports the exact
destination on stderr, including with `--json`.

Earlier packets remain intact, but the operating system may clear temporary
storage. Use `--out ./review` to choose a retained location. It replaces any
entrypoint output default and never overwrites an existing destination. The
chosen destination stays identical through command reexecution. A refusal does
not automatically retry work or choose another path.

A root Flow may declare one writable attachment. It begins empty and is
limited to 16 MiB. Jig supplies its contained path and collects files only
after execution is fenced and the result accepted. A Flow with neither a
writable attachment nor declared artifact results returns its result on stdout
without creating a packet by default. It can still use `--out` to save its
execution record. Declared artifact results permit forwarding but do not
require it: the handler may return an empty selection.

The destination must be absent, have an existing supported parent, and lie
outside every per-run input root. For `--attach source=.`, choose a sibling
destination. `--out ./review` would be inside that input root. The destination
stays fixed through command reexecution.

Refusal does not automatically retry work or choose another path. Binding source
directories are not reopened during execution.

```text
review/
  result.json       Jig's execution record and file manifest
  files/            The Flow's deliverables
```

Ordinary packets keep the root's native writable files directly under `files/`.
Forwarded results instead occupy `files/<result-name>/`. For example,
`artifactResults: { final: artifact }` places that snapshot's `patch.diff` at
`files/final/patch.diff`. Forwarding does not merge snapshots into the mutable
root output. Conflicting composed paths fail rather than overwrite files.
Checkpoint-associated snapshots use `files/artifacts/<association-name>/`,
alongside the checkpoint's explicit text files.

The host record identifies the Run, admitted method/configuration, canonical
JSON input, captured files, and exported file sizes and SHA-256 digests.
It does not expose private host identities or include a digest of itself.
Exported directories are private (`0700`) and files are owner-readable/writable
(`0600`). A Flow's own `files/result.json` is just a deliverable, not host status.
Use [recorded result inspection](results.md#reopen-a-saved-result) to read a
saved packet without starting work.

## Understand failures

`status` describes execution. `delivery` describes packet publication.
`delivery.source` is `final`, `checkpoint`, or `none`. An application outcome
such as `blocked` can include useful files.

Failed, invalid, or cancelled execution exports no partial scratch files.

A [checkpoint-enabled Flow](../spec/run-checkpoint.md) can retain explicit
progress. After cleanup, Jig delivers its latest accepted checkpoint with the
failed or lost execution status intact. The record identifies that checkpoint or
keeps `checkpoint: null` when none was accepted. Without confirmed cleanup,
delivery fails.

Checkpoint support does not require a writable root attachment or `--out`.
The original protected attempt retains the latest accepted aggregate, including
optional currently held artifact associations. A coordinator can therefore save
progress without owning a writable output tree. Releasing a live reference
prevents using that reference for a new selection. It does not erase an already
accepted checkpoint or forbid an exact duplicate of its accepted save.

Applications can use the [execution client](../spec/execution-client.md) to
persist preparation before submission, read retained results and export later
without rerunning the method. `source: 'final'` selects final retained bytes.
`source: 'checkpoint'` selects the latest accepted aggregate after confirmed
cleanup and preserves the original failed/lost status. An optional
`artifactResult` selects one final snapshot, published without its result-name
prefix, and is not valid with checkpoint selection. Publication still requires
an absent destination and does not confer independent authenticated provenance.

The live artifact budget is 256 references, 16 snapshots, and 256 MiB including
materialized bytes. It is not the durable retention allowance.

Prepared requests
choose a retained artifact allowance up to 256 MiB. Final and latest checkpoint
bytes share it. Attempt inputs, retained bytes and reservations share a 4 GiB
store, separate from review's 1 GiB Package/0 archive. These are logical capacity
limits, not a physical filesystem space or `ENOSPC` guarantee. See the
[exact capacity rules](../spec/execution-client.md#capacity-and-time-limits).

Other lost Runs may have no terminal record.

Publication exposes one complete packet, with no power-loss persistence
guarantee. Cancellation removes unfinished copy staging but does not retract a
published packet. Connection loss can leave delivery unknown even when the
packet exists. `JIG_REPORT_LIMIT` keeps the terminal on stdout and reports
delivery separately on stderr.

Inspect the destination before new work. Repeating the command always starts new
work.

`--timeout` bounds execution, with a 30-second default. Capture, export, and
cleanup have separate bounds.
[Root file policy](../spec/project-policy.md#root-file-runs) owns exact
collection, publication, modes, report limits, and interruption behavior.
[Results and recovery](results.md) explains how to act on execution and delivery
uncertainty.
