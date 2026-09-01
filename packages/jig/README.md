# `@jigging/jig`

Jig is a local, secure host for admitted FLOW packages. The direct-run alpha
candidate has one finite command surface:

```text
jig init --bare <directory>
jig check [project] [--yes]
jig run <flow:path|binding:id> [--input JSON]
```

There is no `jig setup`. `check` and `run` transparently acquire the rootless
authority they need or fail closed.

## Install

The package is not yet published. Once the alpha clears its release gates:

```console
npm install --global @jigging/jig@0.1.0-alpha.1
```

The packed artifact contains Bun 1.3.3 as its fixed executable and its
Jig-owned support files. It has no runtime npm dependencies.

## Supported host

The alpha requires:

- Linux x86_64 with glibc;
- Bubblewrap 0.12 or newer at `/usr/bin/bwrap`;
- cgroup v2 with delegated `cpu`, `memory`, and `pids` controllers;
- a systemd user manager with transient delegated scopes; and
- unprivileged user, mount, PID, network, IPC, UTS, and cgroup namespaces.

It does not use `sudo`, download a runtime, or expose host control to Flow
code.

## Use

```console
jig init --bare my-project
cd my-project
```

Place packages under `flows/<name>/`. Each package has exact-case `FLOW.md`
and, for this alpha, one `flow.ts`. The generated `jig.ts`
explicitly discovers `./flows` and `./bindings`.

```console
jig check
jig run flow:flows/example --input '{}'
```

`jig check` shows the complete proposed project change and asks for approval.
`--yes` records an approval non-interactively. The CLI keeps review and
admission mechanics internal.

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
[`docs/README.md`](https://github.com/jigmd/jig/blob/main/docs/README.md).

This is a prerelease alpha. It does not expose Services, Hooks, event sources,
Agent providers, Semantic Choice, Jig Graph, runtime registries, or sandbox
registries.
