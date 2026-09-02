# Jig and FLOW

Jig is a local host for [FLOW](docs/flow/spec/package-format.md) packages. It
captures ordinary project files, shows the proposed change for review, admits
the approved bytes, and runs an exact target in a rootless Linux envelope.

The current release candidate is a deliberately narrow direct-run alpha. It
provides three commands:

```text
jig init --bare <directory>
jig check [project] [--yes]
jig run <flow:path|binding:id> [--input JSON]
```

There is no setup command, daemon, runtime registry, or sandbox selector.

## Supported host

The alpha has been independently tested on a provisioned Ubuntu 24.04 x86_64
host. Other Linux x86_64 hosts meeting the requirements below have not yet been
independently validated; Jig fails closed when a required capability is absent.

The required host shape is:

- Linux x86_64 with glibc 2.17 or newer and an SSE4.2-capable baseline CPU;
- Bubblewrap 0.12 or newer at `/usr/bin/bwrap`;
- GNU `readlink -f` at `/usr/bin/readlink` or `/bin/readlink`;
- cgroup v2 with delegated `cpu`, `memory`, and `pids` controllers;
- a systemd user manager able to create transient scopes with `Delegate=yes`;
- unprivileged user, mount, PID, network, IPC, UTS, and cgroup namespaces.

The glibc and SSE4.2 floors come from the selected Bun baseline runtime.

Installing `@jigging/jig@0.1.0-alpha.1` also installs the exact external
runtime dependency `@oven/bun-linux-x64-baseline@1.3.3`. Bun is not embedded in
or bundled with Jig. npm verifies the installed package; Jig selects only that
closed package-local path, authenticates its version, revision, and digest
before evaluator or Flow bytes execute, and revalidates it before each launch.
`check` and `run` acquire a transient delegated scope without `sudo` or a
host-control channel exposed to Flow code.

Flow Runs are fixed at 30 seconds, 256 MiB aggregate memory, 48 aggregate
PIDs, and 50% of one CPU. Project evaluation is fixed at 3 seconds, 256 MiB,
64 PIDs, and 50% CPU. Locked dependency preparation is fixed at 60 seconds,
512 MiB, 64 PIDs, and one CPU. The threat boundary and private reporting
channel are documented in [SECURITY.md](SECURITY.md).

## Quickstart

Install the alpha with npm:

```console
npm install --global @jigging/jig@0.1.0-alpha.1
```

Create a project and one Flow package:

```console
jig init --bare hello-jig
cd hello-jig
mkdir -p flows/hello
```

Create `flows/hello/FLOW.md`:

```markdown
---
name: hello
description: Return a greeting for the supplied name.
---

# Hello
```

Declare the exact FLOW SDK in `flows/hello/package.json`:

```json
{
  "private": true,
  "dependencies": {
    "@jigging/flow": "0.1.0-alpha.1"
  }
}
```

With Bun 1.3.3 available as an authoring tool, generate its text lock without
installing a project-local dependency tree:

```console
cd flows/hello
bun install --lockfile-only
cd ../..
```

Create `flows/hello/flow.ts`:

```ts
import { serve } from "@jigging/flow";

await serve(async (run) => {
  const name = typeof run.input === "object" && run.input !== null &&
      !Array.isArray(run.input) && typeof run.input.name === "string"
    ? run.input.name
    : "world";
  return { outcome: "done", output: { message: `Hello, ${name}!` } };
});
```

Review and admit the project:

```console
jig check
```

`jig check` displays the complete project change, including the exact current
and proposed Package/1 content digests, and asks for approval. It does not
replace reviewing editable source with your editor or version-control tools.
When both standard input and output are terminals, Jig prompts for approval.
Otherwise it prints the review and exits with `JIG_APPROVAL_REQUIRED`; inspect
that output, then use `jig check --yes` only when approval is explicit. The CLI
carries its internal review token; users do not manage plan IDs or admission
records.

A target is marked changed when its package identity or exact execution
evidence changes. Package digests are shown once in the package section;
host-specific evidence remains private.

Run the admitted Flow:

```console
jig run flow:flows/hello --input '{"name":"Ada"}'
```

The terminal result is JSON:

```json
{"diagnostics":{"stderr":"","stderrBytes":0,"stderrTruncated":false},"outcome":"done","output":{"message":"Hello, Ada!"},"status":"succeeded"}
```

A Binding is addressed explicitly as `binding:<id>`. Jig never guesses an
unprefixed target.

## Dependency rule

The alpha follows normal Bun package authoring. A `flow.ts` may import:

- a Bun or Node built-in supported by the fixed runtime;
- an explicit package-local file; or
- a production dependency declared in a package-local `package.json` and
  locked by a package-local text `bun.lock`.

Do not add `node_modules` to the FLOW package. Generate the lock with Bun
1.3.3—for example, `bun install --lockfile-only`—and let `jig check` prepare
the exact locked production tree. Preparation runs the release-owned Bun
installer in the same rootless envelope as a Run, with lifecycle scripts
disabled. The alpha accepts only integrity-pinned packages from the default
npm registry; unsupported sources fail during `check`.

Jig retains the prepared tree beside the reviewed source package and pins it
in the admitted target. `jig run` then uses only those retained bytes, with no
network, installation, lifecycle scripts, or ambient `PATH`. Bundling a
dependency into package-local files remains valid, but is no longer required.
An unchanged later `jig check` reuses the exact admitted tree when the source,
runtime, and containment evidence still match; missing or changed evidence
fails closed or is prepared again before another review.

## Documentation

- [Jig website](https://jig.md/)
- [Jig direct-alpha guide](docs/jig/guide/index.md)
- [FLOW website](https://flow.jig.md/)
- [FLOW Package/1](docs/flow/spec/package-format.md)
- [FLOW Run/1](docs/flow/spec/run-protocol.md)
- [FLOW Schema/1](docs/flow/spec/schema-files.md)
- [Jig Project Authoring SDK](docs/jig/spec/project-sdk.md)
- [Jig direct-alpha project policy](docs/jig/spec/project-policy.md)

Licenses are mapped in [LICENSES.md](LICENSES.md). FLOW is founder-stewarded
under the public process in [Governance.md](Governance.md), and contributions
use the [DCO 1.1 process](CONTRIBUTING.md). Maintainer prerelease steps are in
[RELEASING.md](RELEASING.md).

Jig is prerelease software. Services, Hooks, event sources, Agent providers,
Semantic Choice, Jig Graph, and extension registries are not part of this
alpha surface.
