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
and, for this alpha, one dependency-closed `flow.ts`. The generated `jig.ts`
explicitly discovers `./flows` and `./bindings`.

```console
jig check
jig run flow:flows/example --input '{}'
```

`jig check` shows the complete proposed project change and asks for approval.
`--yes` records an approval non-interactively. The CLI keeps review and
admission mechanics internal.

The Flow runtime has no network, ambient `PATH`, package installation, or
lifecycle scripts. A `flow.ts` may import supported built-ins and explicit
package-local files; every other dependency must already be bundled or
vendored into its FLOW package.

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
