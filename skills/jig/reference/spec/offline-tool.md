# Offline Tool native invocation

*Status: prerelease implementation candidate. Native qualification is pending.*

Use an Offline Tool slot to check or transform binary files inside a Run.
The operator selects the installed tool and its exact invocation. The Flow
supplies a held artifact and receives a fresh artifact with process evidence.

The [descriptor](https://jig.md/contracts/offline-tool/contract.json) has
ID `https://jig.md/contracts/offline-tool`, version `0.1.0` and digest
`sha256:14d5f56fe3cb3605ce098826d5a43cd788f8a1579e9714d18e64b0527e2c0962`.
It uses the ordinary FLOW call and file attachment interface.

## Select a tool

Import the descriptor into the calling package and declare its slot in
`FLOW.meta.json`. In this example, the operator has provisioned a Nix build
of an image converter and selected the absolute store path to its output.

```sh
jig import-contract jig:offline-tool flows/convert/contracts/offline-tool
```

```json
{"uses":{"convert":{"contract":"./contracts/offline-tool/contract.json"}}}
```

```ts
import { defineBinding } from '@jigging/jig'

const imageTools = '/nix/store/00000000000000000000000000000000-image-tools'
export default defineBinding({
  package: 'flows/convert',
  slots: {
    convert: {
      kind: 'tool',
      executable: `${imageTools}/bin/convert`,
      runtimeRoots: [imageTools],
      args: ['/jig-input/source/source.tiff', '/jig-output/preview.png'],
    },
  },
})
```

Replace the example root with the actual installed path. Each grant selects
one executable and up to eight distinct top-level store paths. Put any other
runtime data, such as fonts or a JVM archive, in separate store paths and
include them in `runtimeRoots`. The executable path must be inside one
selected root. A Binding can select at most eight Offline Tool slots.

The candidate requires an unprivileged x86_64 Linux execution host with a
system-managed Nix store and the normal Jig containment prerequisites.
Jig queries the local store for the selected roots and their prerequisites.
It verifies up to 256 archive hashes and includes the exact installation in
the target's review and execution identity. Jig mounts only those store paths
at their existing absolute locations. Install tools before review.

The host rechecks the admitted installation before dispatch and refuses
unavailable or changed installations.

Arguments and environment values are literal grant data. The tool starts in
`/work` with private scratch at `/tmp`. Jig supplies `HOME=/tmp`,
`XDG_CACHE_HOME=/tmp/cache` and `TZ=UTC`. The grant can select up to 32
arguments and 16 environment entries.

Each value holds at most 1,024 UTF-16
code units. Names use uppercase ASCII letters, digits and underscores.
Names beginning with `LD_`, `BUN_` or `JIG_` are reserved.

Jig grants no shell expansion, inherited network, credentials or host
environment. The entire installed runtime is available inside the scope.
Enable `nestedUserNamespaces: true` only for tools that need a nested sandbox.
The descendants still share the tool's Jig cgroup and outer isolation.

## Pass files and collect evidence

```ts
const converted = await run.call({
  operationId: 'make-preview',
  slot: 'convert',
  input: {},
  attachments: {
    source: { read: sourceArtifact },
    deliverables: { create: true },
  },
})
```

Jig projects the exact held source under `/jig-input/source` as read-only.
The fresh output tree is `/jig-output`. The caller supplies no executable,
command-line arguments, environment values or host paths.

Successful calls return `done` and the held artifact at
`converted.artifacts.deliverables`. Evidence includes:

- `toolDigest` for the verified installation and exact grant.
- `inputDigest` and `outputDigest` for the two file trees.
- `inputFiles` and `files` for their relative paths, byte counts and SHA-256
  digests. The tree digests also cover empty directories.
- `exitCode`, `signal`, `stopReason` and `cleanup` for observed settlement.

By default only exit status zero can deliver an artifact. Set `exitCodes` to
include a tool's documented findings status when it writes a complete report
on that status. Jig records process and file evidence. Application checks
decide whether the findings or files meet requirements.

Other exit statuses, capture failures, cancellation and deadlines return
operation failures. They may include `details.tool` with the tool and input
identities and observed process settlement. Failed calls grant no output
artifact. Successful delivery requires the existing whole-tree fence and
confirmed cleanup. The same owner recovers after coordinator loss without
dispatching the operation again.

## Limits

The tool receives up to 64 source files and 64 MiB of held input.
Output permits at most 64 regular files. The reviewed `outputBytes` ranges
from 4 KiB to 16 MiB and defaults to 16 MiB. The Linux filesystem capacity
uses kernel page granularity. Capture enforces the exact logical byte limit.

The timeout is 1 to 60 seconds and defaults to 60 seconds. The containing Run
and Flow deadlines can stop the call sooner.

The scope uses 512 MiB memory, 128 tasks and half a CPU. Jig reserves that
capacity under the existing root budget. Standard output and error are
drained. Use explicit report files for retained evidence.
