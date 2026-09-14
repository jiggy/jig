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
| Agent client, model, and credentials | The review chooser or exported operator environment; see [Agent settings](#agent-settings) |
| Flows, Bindings, and application settings | `jig.ts`; see [Project settings](#project-settings) |
| Input, deadline, and output for one Run | Command arguments; see [Per-command options](#per-command-options) |
| Bubblewrap executable | Absolute `JIG_BWRAP_PATH`; see [Host configuration](#host-configuration) |

Operator preferences are separate from reviewed project policy. Jig does not
automatically load project `.env` files. Export environment variables in your
shell or supply them through your process launcher.

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

`jig review` can remember an available client for the current project. For
explicit selection or automation, use the exported settings below.

| Setting | Purpose |
| --- | --- |
| `JIG_AGENT_CLIENT` | `codex`, `claude`, `pi`, or `api`; overrides the remembered client choice |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | OpenRouter credentials and model, using its Chat Completions endpoint |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Direct OpenAI or compatible API credentials and model |
| `OPENAI_BASE_URL`, `OPENAI_API` | Compatible HTTPS endpoint and wire format: `responses` (default) or `chat-completions` |
| `CODEX_PATH`, `CLAUDE_PATH`, `PI_PATH` | Absolute native-client executable override; otherwise Jig searches the operator’s eligible `PATH` entries |
| `CODEX_HOME` | Codex’s file-backed login directory; defaults to `~/.codex` |

Jig supplies no default API model. Select one API variable family at a time;
supplying both OpenRouter and OpenAI configuration is ambiguous. Credentials
alone do not select a client. Keep credentials outside `jig.ts`, Flow input,
and reviewed application settings.

Client, endpoint, model, or executable changes require a new review; rotating
only a credential does not. The [Agent guide](./agents.md) owns setup examples,
client requirements, login support, and switching instructions.

## Project settings

`jig.ts` declares the project’s Flows and Bindings. A Binding configures an
invocation with application `settings`, selected child `slots`, and any
supported command policy. These values are reviewed before they can execute.
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
| `--yes` | `review` | Approve the displayed revision without an interactive prompt; does not select an Agent or grant resolution-network permission |
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
`XDG_STATE_HOME` relocates remembered Agent choices, normally stored at
`~/.local/state/jig/agent-choices`, separately for each canonical project
directory. Neither location transfers project approval.
