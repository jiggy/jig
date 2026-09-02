# `@jigging/jig`

Jig is a local, secure host for admitted FLOW packages. The direct-run alpha
has one finite command surface:

```text
jig init --bare <directory>
jig check [project] [--yes]
jig run <flow:path|binding:id> [--input JSON]
```

There is no `jig setup`. `check` and `run` transparently acquire the rootless
authority they need or fail closed.

## Install

```console
npm install --global @jigging/jig@0.1.0-alpha.1
```

Installing Jig also installs `@oven/bun-linux-x64-baseline@1.3.3` as an exact
external runtime dependency. Bun is not embedded in or bundled with the
`@jigging/jig` archive. npm verifies the installed package; Jig selects only
that closed package-local path, authenticates its version, revision, and digest
before evaluator or Flow bytes execute, and revalidates it before each launch.

## Supported host

The alpha has been independently tested on a provisioned Ubuntu 24.04 x86_64
host. Other Linux x86_64 hosts meeting the requirements below have not yet been
independently validated; Jig fails closed when a required capability is absent.

The alpha requires:

- Linux x86_64 with glibc 2.17 or newer and an SSE4.2-capable baseline CPU;
- Bubblewrap 0.12 or newer at `/usr/bin/bwrap`;
- GNU `readlink -f` at `/usr/bin/readlink` or `/bin/readlink`;
- cgroup v2 with delegated `cpu`, `memory`, and `pids` controllers;
- a systemd user manager with transient delegated scopes; and
- unprivileged user, mount, PID, network, IPC, UTS, and cgroup namespaces.

The glibc and SSE4.2 floors come from the selected Bun baseline runtime.

Jig commands do not use `sudo`, download runtimes, or expose host control to
Flow code. Runtime installation is handled once by npm with the Jig package.

Flow Runs are fixed at 30 seconds, 256 MiB aggregate memory, 48 aggregate
PIDs, and 50% of one CPU. Project evaluation is fixed at 3 seconds, 256 MiB,
64 PIDs, and 50% CPU. Locked dependency preparation is fixed at 60 seconds,
512 MiB, 64 PIDs, and one CPU. See the repository
[`SECURITY.md`](https://github.com/jigmd/jig/blob/main/SECURITY.md) for the
threat boundary and private reporting channel.

## Use

```console
jig init --bare my-project
cd my-project
```

Place packages under `flows/<name>/`. Each package has exact-case `FLOW.md`
and, for this alpha, one `flow.ts`. The generated `jig.ts`
explicitly discovers `./flows` and `./bindings`.

The paired `@jigging/flow@0.1.0-alpha.1` package provides the small Run/1
authoring API. Declare it exactly in the Flow's `package.json`, generate a text
`bun.lock` with Bun 1.3.3 and `bun install --lockfile-only`, then serve one
finite Run:

```ts
import { serve } from "@jigging/flow";

await serve(async (run) => ({
  outcome: "done",
  output: { received: run.input },
}));
```

```console
jig check
jig run flow:flows/example --input '{}'
```

`jig check` shows the complete proposed project change, including exact
current and proposed Package/1 content digests, and asks for approval. It is
not a source-file diff; inspect editable source with your normal tools. When
standard input and output are both terminals, Jig prompts for approval.
Otherwise it prints the review and exits with `JIG_APPROVAL_REQUIRED`; `--yes`
records an already explicit approval. The CLI keeps review and admission
mechanics internal.

A target is marked changed when its package identity or exact execution
evidence changes. Package digests appear once in the package section;
host-specific evidence remains private.

For ordinary dependencies, place `package.json` and text `bun.lock` beside
`flow.ts`; do not include `node_modules`. `jig check` prepares the frozen
production dependency tree inside the same rootless envelope, using the fixed
Bun runtime, the default npm registry, and no lifecycle scripts. Unsupported
or unlocked sources fail before admission.

The admitted Run uses only the retained prepared bytes. It has no network,
ambient `PATH`, package installation, or lifecycle scripts. Packages with no
runtime dependencies continue to run directly, and already bundled
package-local code remains valid. An unchanged `jig check` reuses the admitted
prepared tree only while its source and host evidence still match.

Bindings use an explicit target:

```console
jig run binding:reviewer --input '{}'
```

Jig never guesses an unprefixed target.

The complete runnable example and current specification map are in the
[repository README](https://github.com/jigmd/jig#readme) and
[`docs/jig/guide/index.md`](https://github.com/jigmd/jig/blob/main/docs/jig/guide/index.md).

This is a prerelease alpha. It does not expose Services, Hooks, event sources,
Agent providers, Semantic Choice, Jig Graph, runtime registries, or sandbox
registries.

Copyright © 2026 Victor Duarte <zvictor> and contributors.
