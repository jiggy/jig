# Jig and FLOW

Jig is a local host for [FLOW](docs/spec/package-format.md) packages. It
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

The alpha supports one host shape:

- Linux x86_64 with glibc 2.17 or newer and an SSE4.2-capable baseline CPU;
- Bubblewrap 0.12 or newer at `/usr/bin/bwrap`;
- cgroup v2 with delegated `cpu`, `memory`, and `pids` controllers;
- a systemd user manager able to create transient scopes with `Delegate=yes`;
- unprivileged user, mount, PID, network, IPC, UTS, and cgroup namespaces.

The planned `0.1.0-alpha.1` artifact embeds Bun 1.3.3 as the fixed application
and Flow runtime. Jig acquires a transient delegated scope when `check` or
`run` needs one. This requires no `sudo` and exposes no host-control channel to
Flow code. An unsupported host fails closed.

Flow Runs are fixed at 30 seconds, 256 MiB aggregate memory, 48 aggregate
PIDs, and 50% of one CPU. Project evaluation is fixed at 3 seconds, 256 MiB,
64 PIDs, and 50% CPU. Locked dependency preparation is fixed at 60 seconds,
512 MiB, 64 PIDs, and one CPU. The threat boundary and private reporting
channel are documented in [SECURITY.md](SECURITY.md).

## Quickstart

The package is not yet published. Once the alpha clears its release gates,
install it with an npm-compatible client:

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

Create `flows/hello/flow.ts`:

```ts
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of lines) {
  const request = JSON.parse(line) as {
    jsonrpc: string;
    id: string;
    method: string;
    params: { input: { name?: unknown } };
  };
  if (request.jsonrpc !== "2.0" || request.method !== "flow/run") {
    throw new Error("expected one FLOW Run/1 request");
  }
  const name = typeof request.params.input.name === "string"
    ? request.params.input.name
    : "world";
  const response = JSON.stringify({
    jsonrpc: "2.0",
    id: request.id,
    result: {
      outcome: "done",
      output: { message: `Hello, ${name}!` },
    },
  });
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${response}\n`, (error) => error ? reject(error) : resolve());
  });
  break;
}
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

Do not add `node_modules` to the FLOW package. Generate the lock with Bun—for
example, `bun install --lockfile-only`—and let `jig check` prepare the exact
locked production tree. Preparation runs the release-owned Bun installer in
the same rootless envelope as a Run, with lifecycle scripts disabled. The
alpha accepts only integrity-pinned packages from the default npm registry;
unsupported sources fail during `check`.

Jig retains the prepared tree beside the reviewed source package and pins it
in the admitted target. `jig run` then uses only those retained bytes, with no
network, installation, lifecycle scripts, or ambient `PATH`. Bundling a
dependency into package-local files remains valid, but is no longer required.
An unchanged later `jig check` reuses the exact admitted tree when the source,
runtime, and containment evidence still match; missing or changed evidence
fails closed or is prepared again before another review.

## Documentation

- [Specification map](docs/README.md)
- [FLOW Package/1](docs/spec/package-format.md)
- [FLOW Run/1](docs/spec/run-protocol.md)
- [FLOW Schema/1](docs/spec/schema-files.md)
- [Jig Project Authoring SDK](docs/spec/project-sdk.md)
- [Jig direct-alpha project policy](docs/spec/project-policy.md)

Licenses are mapped in [LICENSES.md](LICENSES.md). FLOW is founder-stewarded
under the public process in [Governance.md](Governance.md), and contributions
use the [DCO 1.1 process](CONTRIBUTING.md).

Jig is prerelease software. Services, Hooks, event sources, Agent providers,
Semantic Choice, Jig Graph, and extension registries are not part of this
alpha surface.
