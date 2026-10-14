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
      deliverables: { into: 'deliverables', directory: 'copies' },
    },
  },
},
```

Caller and child declare `source: "read"` and `deliverables: "read-write"`. The
child receives the caller's captured source and an empty output. Call it with
`await run.call({ operationId: 'copy-1', slot: 'copy', input })`. After
successful completion and cleanup, its complete files appear in the caller's
`deliverables/copies` folder.

Every child attachment needs a mapping. Call input cannot choose paths or
settings.

Use distinct child destinations. Existing or previously committed folders cannot
be reused. Failed or cancelled work publishes no partial folder. Cancellation
racing a completed commit may leave the complete folder with a cancelled or
uncertain response.

Inspect evidence before further work. Jig does not retry automatically.
[Child file policy](../spec/project-policy.md#child-file-runs) owns mapping,
shared limits, commit, and cleanup requirements.

## Receive one packet

A writable root attachment starts empty and is limited to 16 MiB, enforced while
the Flow writes. Jig collects output after execution is fenced and its result
accepted. The original input directory stays outside write access. These limits
are current Jig policy for small file jobs, not FLOW requirements or proved
optimums.

| Choice | Result |
| --- | --- |
| Writable target without `--out` | A fresh temporary packet. Jig reports its path on stderr, including with `--json`. The operating system may clear it. |
| Result-only target without `--out` | The result on stdout, without a packet. |
| Either target with `--out DIR` | A new packet at the chosen destination, replacing any entrypoint output default. |

The destination must be absent, have an existing supported parent, and lie
outside every per-run input root. For `--attach source=.`, choose a sibling
destination. `--out ./review` would be inside that input root. The destination
stays fixed through command reexecution.

Refusal does not automatically retry work or choose another path. Binding source
directories are not reopened during execution.

`result.json` contains the host's execution record and captured/exported file
manifests and digests. A Flow's own `files/result.json` is a deliverable, not
host status. Use [recorded result inspection](results.md#reopen-a-saved-result)
to read a saved packet without starting work.

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
