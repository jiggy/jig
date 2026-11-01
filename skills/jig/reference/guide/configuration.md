---
title: Settings and configuration
description: Configure Jig’s startup verification, terminal appearance, Agent selection, and project settings.
---

<!-- Generated from docs/jig/guide/configuration.md. Edit the source, then run just sync-skills. -->


# Settings and configuration

Use this reference to adjust Jig for your terminal, host, and application. The
defaults work for the [first Flow](index.md). Change these settings when you
need a different operating preference.

## Jig version requirements

Projects can name the exact Jig version they were tested with in `package.json` under `engines.jig`.
Engine metadata records the host requirement without adding Jig to the project dependency graph.
Generated projects and repository examples supply this metadata.
Bare projects can omit it.

If review reports `PROJECT_JIG_VERSION_MISMATCH`, compare the displayed running and required versions.
Install the required version using the bun/npm command in the diagnostic, then retry review.
The check works offline and changes no files.
A newer release’s existence alone does not establish incompatibility.

For contributor builds, rebuild from Jig’s repository root with `just jig::build`.
The checkout launcher detects changed source or generated output even when the version number stays unchanged.
Ordinary installed packages receive installation instructions instead.
Run `jig --version` to identify the executing build.
See the [exact project requirement](../spec/project-policy.md#jig-version-requirements).

## Shell completion

Load completion for your shell:

```sh
# Bash
source <(jig completion bash)
# Zsh (after compinit)
source <(jig completion zsh)
# Fish
jig completion fish | source
```

Put the matching command in your shell startup file to keep it enabled. Target
suggestions read the current directory's last approval, never execute `jig.ts`,
install dependencies, or contact an Agent. Review newly added targets before
they appear. Unsupported or unreadable approval produces no suggestions.

## Where settings belong

| What you want to configure | Where to set it |
| --- | --- |
| Startup verification | `--verification` on `run`, `review`, or `inspect`. `JIG_VERIFICATION` for a shell default |
| Terminal appearance | `JIG_THEME`, `NO_COLOR`, and your terminal environment |
| Agent client, model, and credentials | Inline policy in an ordinary Agent Binding and operator credentials. See [Agent settings](#agent-settings) |
| ACP client for one reviewed proposal | `review --agent codex\|claude\|pi`. Source stays unchanged and later reviews start from source again |
| Flows, Bindings, and application settings | `jig.ts`. See [Project settings](#project-settings) |
| Prepared runtime dependency capacity | `limits.dependencies` in `jig.ts`, or `JIG_LIMITS_DEPENDENCIES_MAX_PREPARED_BYTES` and `JIG_LIMITS_DEPENDENCIES_MAX_PREPARED_FILES`. See [Limits and defaults](limits.md) |
| Application starting point and default Run arguments | `entrypoint` in `jig.ts`. See [Project entrypoint](#project-entrypoint) |
| Input, deadline, and output for one Run | Command arguments. See [Per-command options](#per-command-options) |
| Bubblewrap executable | Absolute `JIG_BWRAP_PATH`. See [Host configuration](#host-configuration) |

Operator preferences are separate from reviewed project policy. Jig does not
automatically load project `.env` files. Export environment variables in your
shell or supply them through your process launcher.

The [limits reference](limits.md) lists supported overrides, fixed constraints,
defaults, units, and policy owners. Dependency preparation resolves each field
from its environment variable, then `jig.ts`, then its built-in default.
Invalid explicit values fail instead of falling back.

## Project entrypoint

Give your application a starting point in `jig.ts` by copying the part of a
working command after `jig run`:

```ts
entrypoint: "binding:factory --input @batch.json --attach source=fixtures --timeout 8m",
```

A target alone, such as `entrypoint: "binding:factory"`, is also valid. After
`jig review`, run the application with `jig run`. Supply options to replace its
defaults, for example
`jig run --input @another-batch.json --out another-result`. An explicit target,
such as `jig run binding:agent`, uses none of these defaults.

Without an entrypoint, terminals offer a numbered chooser of ready approved
targets. Press Enter to cancel. Scripts must supply an exact target. Both paths
run the approved revision, not unreviewed edits.

Paths in the declaration are project-relative. Input files and source trees are
captured afresh for each invocation. Changing a job file does not require a new
review. Changing the entrypoint itself does.

Use quotes around arguments containing spaces.
Jig parses arguments without shell execution or variable expansion.
`jig inspect` shows the approved entrypoint.

When the selected target declares writable deliverables and you omit `--out`,
Jig chooses a fresh packet directory in operating-system temporary storage. Jig
reports the destination on stderr. The operating system may clear that storage.
Use `--out DIR` to choose a retained location. This argument replaces any
declared output default. The directory must not already exist and needs an
existing supported parent outside input roots.

Jig never replaces an earlier result. Result-only targets stay stdout-only
unless you supply `--out` to save their execution record. See the
[complete argument and override rules](../spec/project-sdk.md#project-entrypoint).

## Startup verification

Jig defaults to **cached** verification to avoid repeatedly hashing large
installed tools. It reuses hashes while file identity and metadata match, and
rehashes when they change. Use `--verification cached|strict|fast` to choose the
policy for a command.

| Mode | Installation check | Tradeoff |
| --- | --- | --- |
| `cached` (default) | Reuse hashes while file identity, permissions, size and modification/change times match | Detects ordinary tool updates. Relies on filesystem metadata between hashes |
| `strict` | Hash current tool bytes at every verification point | Stronger byte verification, with more startup work |
| `fast` | Reuse stored hashes without checking freshness | Changed tool bytes at the same path can go undetected |

Choose a mode explicitly:

```sh
jig run flow:flows/hello --input '"Ada"' --verification fast
jig review --verification strict
jig inspect --verification cached
```

The argument takes precedence over `JIG_VERIFICATION`. For a persistent shell or
CI preference, use `export JIG_VERIFICATION=cached` (or `strict` or `fast`).
When neither is supplied, Jig uses cached. Missing, invalid or repeated
`--verification` values are usage errors.

Fast mode suits operators who prioritize startup performance and trust their
installation to remain suitable. All modes hash files on a cache miss, so the
first use of a tool can take longer. Most savings come from avoiding repeated
hashing. Fast's extra benefit over cached depends on the installation and host.

The setting applies to review, Run and approved-target inspection. Saved-result
inspection (`jig inspect --result <directory>`) reads recorded evidence without
execution-environment verification. It is an operator preference, separate from
project configuration. Flow approval, retained package verification, sandbox
requirements, permissions, resource limits, cancellation and cleanup still
apply. Tool and runtime compromise remains outside Jig's threat model.

The private installation cache lives at
`$XDG_CACHE_HOME/jig/installation-verification`, or
`$HOME/.cache/jig/installation-verification` by default. It contains tool paths,
metadata and hashes, never credentials or project approvals. You can remove this
directory to force fresh hashes next time. Unsafe or unusable caches fall back
to full hashing. Strict bypasses the cache entirely. Inspection never writes it.

See the
[exact policy](../spec/project-policy.md#installation-verification-policy) for
the guarantees and limits.

## Terminal appearance

| Setting | Values and behavior |
| --- | --- |
| `JIG_THEME` | `one-dark` (default), `one-light`, or `macchiato`. Unknown values use One Dark |
| `NO_COLOR` | Any present value, including an empty value, disables colors and automatic inline animation. TUI keeps keyboard navigation and screen controls without color |
| `TERM=dumb` | Selects plain output without animation |
| `COLORTERM` | `truecolor` or `24bit` enables truecolor accents. Otherwise Jig uses 256-color accents when `TERM` contains `256color`, or basic terminal colors |

Choose the palette that fits your terminal background:

```sh
export JIG_THEME=one-light
```

Themes color structured terminal output without changing its values. Plain
output ignores the theme. Redirected streams contain no terminal colors or
animation. Use `--json` on `jig run` when you need machine-readable output in a
terminal. See the [CLI experience contract](https://jig.md/spec/cli-experience.md).

Structured review, inspection and Run output highlights keys, strings, numbers,
and literals. The shell setting applies before a project loads. Run JSON/NDJSON
is never highlighted.

Palettes use [Atom One Dark](https://github.com/atom/one-dark-syntax),
[Atom One Light](https://github.com/atom/one-light-syntax), and
[Catppuccin Macchiato](https://catppuccin.com/palette/) foreground accents.

## Agent settings

Use [Choose an Agent](agents.md) to configure API access or a native client.
That guide owns dependency selection, Bindings, grants, credentials and client
recovery. Credentials stay in the operator environment, outside Flow input and
package source.

Use [client switching](agents.md#switching) for permanent source changes or a
review-only `--agent` proposal. Exporting credentials alone does not select a
provider.

## Project settings

`jig.ts` declares the project’s Flows and Bindings. A Binding configures an
invocation with application `settings`, selected invocation `slots`, and any
supported resource grants. These values are reviewed before they can execute.
They do not select the operator’s credentials, terminal theme, or startup
verification preference.

See [project authoring](../spec/project-sdk.md) for the supported fields and
examples, and [Limits and defaults](limits.md) for enforced limits and overrides.

### Reading review changes

Review shows a field diff: `-` is the previous or removed value, and `+` is its
proposed replacement or addition. Nested headings keep each changed field in
context. Unchanged fields are omitted. `jig review --details` retains the
complete previous and proposed public policy.

A target can need renewed approval when its retained execution identity or a
selected child changes even though its public fields are identical. Review
explains this instead of repeating identical blocks. Private execution
identities remain private. Object key ordering alone is ignored. Array order is
significant.

## Per-command options

| Option | Command | Purpose |
| --- | --- | --- |
| `--input JSON` or `--input @FILE` | `run` | Supply JSON input. Omitted input is `{}` |
| `--timeout 2m` | `run` | Set the Run deadline within the supported limits |
| `--receive CHANNEL` | `run` | Receive a declared output channel. See [live progress](channels.md) |
| `--display MODE` | `run` | Select `auto` (TUI in suitable interactive terminals, ordinary output otherwise), `plain`, `tui`, or `web`. Operator-only |
| `--json` | `run` | Emit machine-readable JSON or NDJSON even in a terminal. Redirected stdout already uses this format |
| `--details` | `review` | Include unchanged policy and retained observed setup facts as context. Performs no additional checks |
| `--agent codex\|claude\|pi` | `review` | Propose only the client field in every selected ACP policy before qualification. Source unchanged, no remembered preference |
| `--yes` | `review` | Approve the displayed revision without an interactive prompt. Does not grant resource-authority changes or resolution-network permission |
| `--allow-authority-changes` | `review` | Explicitly approve changed resource delegation alongside the revision |
| `--generate-contracts` | `review` | Compile managed TypeSpec contracts before separate execution approval |
| `--allow-resolution-network` | `review` | Permit dependency-selected network requests before graph validation for this review only. Grants no Run network access |

Run `jig <command> --help` for the complete arguments for a command. See
[dependency review](dependencies.md) for resolution effects and retained
preparation, and [results and recovery](results.md) for output handling.

`--allow-resolution-network` produces one dependency preparation warning for the
entire review. Per-package progress identifies the package being prepared. This
permission gives Runs no network access.

## Host configuration

The [supported-host requirements](index.md#supported-host) describe the
execution prerequisites. Set `JIG_BWRAP_PATH` to an absolute path when
Bubblewrap is outside Jig’s normal host-tool locations.
Finding `bwrap` through your shell's `PATH` alone does not make it discoverable
by Jig. For a shell-installed executable, first check its path:

```sh
command -v bwrap
```

If this reports an absolute executable path, export that path before review:

```sh
export JIG_BWRAP_PATH="$(command -v bwrap)"
jig review --allow-resolution-network
```

Keep the setting in the environment used for later Jig commands.
An invalid explicit selection fails rather than falling back.
This setting selects Jig’s outer containment tool, not a native Agent’s
nested sandbox. It does not supply missing namespace or cgroup support.

`XDG_CACHE_HOME` relocates the installation verification cache described above.
The cache contains no project approval or credentials.
