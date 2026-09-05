# Contributing

Contributions are welcome through the public repository process. Each commit
must carry a Developer Certificate of Origin sign-off:

```text
Signed-off-by: Name <email@example.com>
```

Use `git commit --signoff` to add it. The sign-off certifies the DCO 1.1 text
below. Contributors retain their copyright. This project requires no
copyright assignment or separate contributor license agreement and receives
no broad commercial-relicensing grant.

Contributions are made under the license assigned to their destination in
[`LICENSES.md`](LICENSES.md). A contribution to a FLOW Draft Specification also
constitutes acceptance of the Community Specification License 1.0, including
its patent terms and exclusion procedure. Do not submit third-party material
unless its license is compatible and its provenance and required notices are
included.

## Development shell

With Nix and direnv installed and direnv hooked into your shell, enter the
repository and approve its environment:

```sh
direnv allow
```

Alternatively, run `nix-shell` from the repository root. The first entry fetches
the pinned Nixpkgs toolchain: Bun 1.3.3, Node 24 with npm, Python with package
build dependencies, Bubblewrap 0.12, Just 1.43.1, and common development tools.
`FLOW_NODE`, `FLOW_NPM`, `JIG_NPM`, and `PYTHON` point to those tools; Python is also on `PATH` for
conformance tests. The Bun pin follows Jig's exact build requirement, not the
latest Nix channel.

Direnv also loads the optional, gitignored `.env.local` file. Both direnv and
`nix-shell` put `packages/jig/bin` first on `PATH`, so `jig` uses your checkout's
built executable.
Put your operator-selected Agent environment variables in `.env.local`; never
commit it. After changing `.envrc`, run `direnv allow` again. Plain `nix-shell`
does not load that local environment file.

From the repository root, `bun i` installs the root tooling and all TypeScript
packages under `packages/` as Bun workspaces. The root `bun.lock` is generated
by Bun and ignored; regenerate it as needed, never maintain it by hand.
Example Flows, site tooling, and conformance fixtures keep their separate
dependency installations.

Shell entry warns in bold red when Jig is missing or incompletely built, or
when its successful-build version differs from `packages/jig/package.json`.
It prints the command to run, but never installs or builds automatically:

```sh
bun i
just jig::build
```

The shell compares `jig --version` (embedded at build time) with the source
manifest. This is a version check, not source-change detection: rebuild after
source edits even when the package version has not changed.

The shell supplies Bubblewrap locally and sets `JIG_BWRAP_PATH` to its exact
Nix-store executable. No system-wide Bubblewrap installation is needed.
Running Jig still requires the [supported host configuration](README.md#supported-host).
On NixOS, enable the unmodified runtime's loader support in your host configuration:

```nix
programs.nix-ld.enable = true;
```

Apply that through your normal NixOS configuration workflow. Outside this
shell, `JIG_BWRAP_PATH` can name another operator-installed Bubblewrap ≥0.12;
Jig does not search ambient `PATH` and never falls back from an invalid explicit
selection. Systemd user delegation and namespaces must also be available. The
shell does not configure these host facilities, and independent NixOS host conformance
has not yet been established. Rebuild Jig after pulling launcher changes; an
older `packages/jig/bin/jig` is generated output, not the updated source. Keep Agent
credentials and model choices in your operator environment or ignored
`.env.local`, never in the tracked shell configuration.

## Development tasks

Repository tasks live in justfiles, not package manifests. Run `just` to list
them, including package modules. Use Just 1.43.1 or newer outside the Nix shell.
Install dependencies with `bun i` first; tasks never install their own tools.

```sh
just build                    # Both TypeScript packages
just jig::build               # Jig only
just flow::test                # SDK tests
just jig::test                 # Jig tests
just test-tooling              # Shell and recipe wiring
just test-release              # Full unprivileged gate; needs FLOW_NODE and Python
just jig::pack --destination /tmp/jig-artifacts
```

Each package also has a local justfile: `just build` in `packages/jig`
builds Jig. Packing is explicit: `just jig::pack` or `just flow::pack`
builds first and then packs. There is no automatic `prepack` hook.
The release publisher still consumes already tested archives without rebuilding.

## Biome

The root development dependency pins Biome 2.5.12 to match `biome.json`.
The root `bun i` installs it with the package workspaces. These tasks accept
file or directory paths:

```sh
just biome-check scripts/development-shell.test.ts
just lint scripts/development-shell.test.ts
just format scripts/development-shell.test.ts
```

`biome-check` checks formatting, lint, and imports without writing. `format`
rewrites formatting only. Omit paths to check the repository, but do not run
broad formatting over an unrelated dirty worktree.

## Developer Certificate of Origin 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this license
document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have the
    right to submit it under the open source license indicated in the file; or

(b) The contribution is based upon previous work that, to the best of my
    knowledge, is covered under an appropriate open source license and I have
    the right under that license to submit that work with modifications,
    whether created in whole or in part by me, under the same open source
    license (unless I am permitted to submit under a different license), as
    indicated in the file; or

(c) The contribution was provided directly to me by some other person who
    certified (a), (b) or (c) and I have not modified it.

(d) I understand and agree that this project and the contribution are public
    and that a record of the contribution (including all personal information
    I submit with it, including my sign-off) is maintained indefinitely and
    may be redistributed consistent with this project or the open source
    license(s) involved.
