# Jig and FLOW

Jig is a local host for [FLOW](docs/spec/package-format.md) packages. It
captures ordinary project files, shows the proposed change for review, admits
the approved bytes, and runs an exact target in a rootless Linux envelope.

The current release is a deliberately narrow direct-run alpha. It provides
three commands:

```text
jig init --bare <directory>
jig check [project] [--yes]
jig run <flow:path|binding:id> [--input JSON]
```

There is no setup command, daemon, runtime registry, or sandbox selector.

## Supported host

The alpha supports one host shape:

- Linux x86_64 with glibc;
- Bubblewrap 0.12 or newer at `/usr/bin/bwrap`;
- cgroup v2 with delegated `cpu`, `memory`, and `pids` controllers;
- a systemd user manager able to create transient scopes with `Delegate=yes`;
- unprivileged user, mount, PID, network, IPC, UTS, and cgroup namespaces.

Jig uses its compiled Bun executable as the fixed application and Flow
runtime. It acquires a transient delegated scope when `check` or `run` needs
one. This requires no `sudo` and exposes no host-control channel to Flow code.
An unsupported host fails closed.

## Quickstart

Install the alpha with an npm-compatible client:

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

Create this dependency-closed `flows/hello/flow.ts`:

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

`jig check` displays the complete project change and asks for approval. Use
`jig check --yes` only when approval is already explicit, such as in a
non-interactive acceptance test. The CLI carries its internal review token;
users do not manage plan IDs or admission records.

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

The alpha runs only a dependency-closed `flow.ts`. Jig invokes it with package
installation disabled and gives it no network or ambient `PATH`. Imports must
therefore be one of:

- a Bun or Node built-in supported by the fixed runtime;
- an explicit package-local file; or
- code already bundled or vendored into the FLOW package.

Jig does not run a package manager, lifecycle script, installer, or dependency
download for a Flow. Authors may use their normal toolchain before packaging;
the admitted package must already contain its complete executable closure.
For nontrivial Run/1 handling, bundle or vendor a conforming SDK rather than
growing the minimal protocol example above.

## Documentation

- [Specification map](docs/README.md)
- [FLOW Package/1](docs/spec/package-format.md)
- [FLOW Run/1](docs/spec/run-protocol.md)
- [FLOW Schema/1](docs/spec/schema-files.md)
- [Jig Project Authoring SDK](docs/spec/project-sdk.md)
- [Jig direct-alpha project policy](docs/spec/project-policy.md)

Jig is prerelease software. Services, Hooks, event sources, Agent providers,
Semantic Choice, Jig Graph, and extension registries are not part of this
alpha surface.
