---
title: Settings and configuration
description: Configure Jig’s startup verification, terminal appearance, Agent selection, and project settings.
---

# Settings and configuration

Use this reference to adjust Jig for your terminal, host, and application.
The defaults work for the [first Flow](./index.md); change these settings when
you need a different operating preference.

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

Put the matching command in your shell startup file to keep it enabled.
Target suggestions read the current directory's last approval, never execute
`jig.ts`, install dependencies, or contact an Agent. Review newly added targets
before they appear. Unsupported or unreadable approval produces no suggestions.

## Where settings belong

| What you want to configure | Where to set it |
| --- | --- |
| Startup verification | `--verification` on `run`, `review`, or `inspect`; `JIG_VERIFICATION` for a shell default |
| Terminal appearance | `JIG_THEME`, `NO_COLOR`, and your terminal environment |
| Agent client, model, and credentials | An ordinary Agent Binding and operator credentials; see [Agent settings](#agent-settings) |
| Flows, Bindings, and application settings | `jig.ts`; see [Project settings](#project-settings) |
| Application starting point and default Run arguments | `entrypoint` in `jig.ts`; see [Project entrypoint](#project-entrypoint) |
| Input, deadline, and output for one Run | Command arguments; see [Per-command options](#per-command-options) |
| Bubblewrap executable | Absolute `JIG_BWRAP_PATH`; see [Host configuration](#host-configuration) |

Operator preferences are separate from reviewed project policy. Jig does not
automatically load project `.env` files. Export environment variables in your
shell or supply them through your process launcher.

## Project entrypoint

Give your application a starting point in `jig.ts` by copying the part of a
working command after `jig run`:

```ts
entrypoint: "binding:factory --input @batch.json --attach source=fixtures --out factory-result --timeout 8m",
```

A target alone, such as `entrypoint: "binding:factory"`, is also valid. After
`jig review`, run the application with `jig run`. Supply options to replace its
defaults, for example `jig run --input @another-batch.json --out another-result`.
An explicit target, such as `jig run binding:agent`, uses none of these defaults.

Paths in the declaration are project-relative. Input files and source trees are
captured afresh for each invocation; changing a job file does not require a new
review. Changing the entrypoint itself does. Use quotes around arguments containing
spaces. Jig parses arguments without shell execution or variable expansion.
`jig inspect` shows the approved entrypoint.

A fixed output directory must not already exist. Choose a new `--out` for the
next Run; Jig never replaces an earlier result. See the
[complete argument and override rules](../spec/project-sdk.md#project-entrypoint).

## Startup verification

Jig defaults to **cached** verification to avoid repeatedly hashing large
installed tools. It reuses hashes while file identity and metadata match, and
rehashes when they change. Use `--verification cached|strict|fast` to choose
the policy for a command.

| Mode | Installation check | Tradeoff |
| --- | --- | --- |
| `cached` (default) | Reuse hashes while file identity, permissions, size and modification/change times match | Detects ordinary tool updates; relies on filesystem metadata between hashes |
| `strict` | Hash current tool bytes at every verification point | Stronger byte verification, with more startup work |
| `fast` | Reuse stored hashes without checking freshness | Changed tool bytes at the same path can go undetected |

Choose a mode explicitly:

```sh
jig run flow:flows/hello --input '"Ada"' --verification fast
jig review --verification strict
jig inspect --verification cached
```

The argument takes precedence over `JIG_VERIFICATION`. For a persistent shell
or CI preference, use `export JIG_VERIFICATION=cached` (or `strict` or `fast`).
When neither is supplied, Jig uses cached. Missing, invalid or repeated
`--verification` values are usage errors.

Fast mode suits operators who prioritize startup performance and trust their
installation to remain suitable. All modes hash files on a cache miss, so the
first use of a tool can take longer. Most savings come from avoiding repeated
hashing; fast's extra benefit over cached depends on the installation and host.

The setting applies to review, Run and inspection. It is an operator preference,
separate from project configuration. Flow approval, retained package verification,
sandbox requirements, permissions, resource limits, cancellation and cleanup
still apply. Tool and runtime compromise remains outside Jig's threat model.

The private installation cache lives at
`$XDG_CACHE_HOME/jig/installation-verification`, or
`$HOME/.cache/jig/installation-verification` by default. It contains tool paths,
metadata and hashes, never credentials or project approvals. You can remove
this directory to force fresh hashes next time. Unsafe or unusable caches fall
back to full hashing. Strict bypasses the cache entirely; inspection never
writes it. See the [exact policy](../spec/project-policy.md#installation-verification-policy)
for the guarantees and limits.

## Terminal appearance

| Setting | Values and behavior |
| --- | --- |
| `JIG_THEME` | `one-dark` (default), `one-light`, or `macchiato`; unknown values use One Dark |
| `NO_COLOR` | Any present value, including an empty value, disables colors and animation |
| `TERM=dumb` | Selects plain output without animation |
| `COLORTERM` | `truecolor` or `24bit` enables truecolor accents; otherwise Jig uses 256-color accents when `TERM` contains `256color`, or basic terminal colors |

Choose the palette that fits your terminal background:

```sh
export JIG_THEME=one-light
```

Themes color structured terminal output without changing its values. Plain
output ignores the theme. Redirected streams contain no terminal colors or
animation. Use `--json` on `jig run` when you need machine-readable output in a
terminal. See the [CLI experience contract](../spec/cli-experience.md).

## Agent settings

Choose an ordinary Agent Flow through a reviewed Binding and contract-keyed
defaults. The Binding's grants define its permitted native client or HTTP
endpoint; credentials remain in the operator environment, outside Flow input
and package source. Review shows the exact selected routes and powers.

Native client paths and authentication are operator configuration. HTTP method
settings select API/model behavior within the grant's endpoint and body policy.
Rotating a credential alone does not change admitted meaning. Changes to client,
endpoint, model policy or installation require review.

See [Choose an Agent](./agents.md) for the current supported clients, grant
examples and credential settings. Jig does not infer a provider from credentials
or remember an implicit project-wide Agent choice.

## Project settings

`jig.ts` declares the project’s Flows and Bindings. A Binding configures an
invocation with application `settings`, selected invocation `slots`, and any
supported resource grants. These values are reviewed before they can execute.
They do not select the operator’s credentials, terminal theme, or startup
verification preference.

See [project authoring](../spec/project-sdk.md) for the supported fields and
examples, and [execution policy](../spec/project-policy.md) for enforced limits.

## Per-command options

| Option | Command | Purpose |
| --- | --- | --- |
| `--input JSON` or `--input @FILE` | `run` | Supply JSON input; omitted input is `{}` |
| `--timeout 2m` | `run` | Set the Run deadline within the supported limits |
| `--receive CHANNEL` | `run` | Receive a declared output channel; see [live progress](./channels.md) |
| `--json` | `run` | Emit machine-readable JSON or NDJSON even in a terminal; redirected stdout already uses this format |
| `--details` | `review` | Include unchanged policy as context in the review diff |
| `--yes` | `review` | Approve the displayed revision without an interactive prompt; does not grant resource-authority changes or resolution-network permission |
| `--allow-authority-changes` | `review` | Explicitly approve changed resource delegation alongside the revision |
| `--generate-contracts` | `review` | Compile managed TypeSpec contracts before separate execution approval |
| `--allow-resolution-network` | `review` | Permit dependency-selected network requests before graph validation for this review only; grants no Run network access |

Run `jig <command> --help` for the complete arguments for a command. See
[dependency review](./dependencies.md) for resolution effects and retained
preparation, and [results and recovery](./results.md) for output handling.

## Host configuration

The [supported-host requirements](./index.md#supported-host) describe the
execution prerequisites. Set `JIG_BWRAP_PATH` to an absolute path when
Bubblewrap is outside Jig’s normal host-tool locations. An invalid explicit
selection fails rather than falling back. This setting selects Jig’s outer
containment tool, not a native Agent’s nested sandbox.

`XDG_CACHE_HOME` relocates the installation verification cache described above.
The cache contains no project approval or credentials.
