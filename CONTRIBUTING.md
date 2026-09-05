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
build dependencies, Bubblewrap 0.12, and common development tools. `FLOW_NODE`, `FLOW_NPM`,
`JIG_NPM`, and `PYTHON` point to those tools; Python is also on `PATH` for
conformance tests. The Bun pin follows Jig's exact build requirement, not the
latest Nix channel.

Direnv also loads the optional, gitignored `.env.local` file and adds
`packages/jig/bin` to `PATH`, so `jig` uses your checkout's built executable.
Put your operator-selected Agent environment variables in `.env.local`; never
commit it. After changing `.envrc`, run `direnv allow` again. Plain `nix-shell`
provides the toolchain only; the local configuration and Jig path are direnv
conveniences.

Shell entry warns if Jig's dependency directory or built launcher/entrypoint
is missing, with the commands to run. It does not install or build anything,
or check whether an existing build is up to date. Before using `jig`, run:

```sh
bun install --cwd packages/jig --frozen-lockfile --ignore-scripts
bun run --cwd packages/jig build
```

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

## Biome and Codex

The root development dependency pins Biome 2.5.12 to match `biome.json`.
Install it explicitly with `bun install --frozen-lockfile --ignore-scripts`
from the repository root. These commands accept file or directory paths:

```sh
bun run check:biome scripts/codex-biome.ts
bun run lint scripts/codex-biome.ts
bun run format scripts/codex-biome.ts
```

`check:biome` checks formatting, lint, and imports without writing. `format`
rewrites formatting only. Omit paths to check the repository, but do not run
broad formatting over an unrelated dirty worktree.

For Codex, merge this entry into the ignored `.codex/hooks.json`, preserving
any existing hooks:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "^apply_patch$",
      "hooks": [{
        "type": "command",
        "command": "bun \"$(git rev-parse --show-toplevel)/scripts/codex-biome.ts\"",
        "timeout": 30,
        "statusMessage": "Checking edited files with Biome"
      }]
    }]
  }
}
```

Review and trust it through Codex's `/hooks` menu before use, as described in
the [Codex hooks documentation](https://developers.openai.com/codex/hooks).
The hook checks only files named in an `apply_patch` call, skips deleted,
ignored, and out-of-repository paths, and returns findings without modifying
files. Shell-based edits are not covered. It neither installs Biome nor
changes hook trust. Existing style debt is not a reason to rewrite unrelated
files. Test the hook's selection logic without running Biome using
`bun run test:biome-hook`.

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
