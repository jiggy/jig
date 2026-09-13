---
title: Choose an Agent
---

# Choose an Agent

An Agent-capable Flow asks Jig to perform intelligent work. You choose the
client, model, and credentials on the host; the Flow supplies the task and its
selected Skills. Ordinary Flows that do not call an Agent need no configuration.

The current alpha reads exported environment variables for both `jig review`
and `jig run`. Project `.env` files are not loaded automatically.

## API access

For OpenRouter, export `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. Jig selects
OpenRouter's Chat Completions endpoint. These variables are sufficient; there
is no need to rename them to `OPENAI_*`.

For direct OpenAI access, export `OPENAI_API_KEY` and `OPENAI_MODEL`. An
OpenAI-compatible service can additionally set `OPENAI_BASE_URL` to its HTTPS
endpoint and `OPENAI_API` to `responses` or `chat-completions`. The default
wire format is `responses`; Jig supplies no default model.

Select one API variable family at a time. If both OpenRouter and OpenAI
variables are present, Jig asks you to resolve the ambiguity.

## Local clients

Select a supported client using `JIG_AGENT_CLIENT`: `codex`, `claude`, or `pi`.
For example:

```sh
export JIG_AGENT_CLIENT=codex
jig review
```

The current native adapters use ACP to request bounded Agent work. They do
not grant the Agent a terminal or access to your original repository.
Client-specific requirements are listed in the
[Agent Run specification](../spec/agent-run.md).

Jig finds the selected native client on your exported `PATH`, including an
operator-managed profile or `nix-shell`. You can select a particular executable
with an absolute `CODEX_PATH`, `CLAUDE_PATH`, or `PI_PATH`. An invalid override
must be corrected or unset; it does not fall back to PATH discovery. Review
shows the resolved executable so you can check which installation you selected.

Discovery skips relative PATH entries, the project tree, and ancestor
`node_modules` directories, including symlink routes through them. Shell aliases
are not visible to Jig. The adapters require supported native installations;
a shell wrapper or npm JavaScript launcher is not itself the native executable.

### Codex

Install Codex and sign in as the OS user running Jig, using
[Codex's login instructions](https://developers.openai.com/codex/auth/).
Jig uses Codex's matching installed `codex-resources/bwrap`; Codex checks that
helper's integrity. `JIG_BWRAP_PATH` configures Jig's outer containment, not
Codex's bundled helper.

The current adapter reads a file-backed login from `$CODEX_HOME/auth.json`,
defaulting to `~/.codex/auth.json`. Configure Codex with
`cli_auth_credentials_store = "file"` before signing in. Jig does not currently
read Codex's OS-keyring credentials.

The current adapter supplies a short-lived credential to the contained client;
it does not give it your full authentication store or refresh credentials.

## Switching

Choose the new client or API configuration, then run `jig review` again.
Client, endpoint, model, and executable changes affect the admitted execution
identity. Use the same selection for the subsequent `jig run`; rotating only
a credential does not require another review.

To return from a native client to API access, unset `JIG_AGENT_CLIENT` and
export the chosen API variables. A missing or incompatible client produces
an unavailable diagnostic; Jig does not silently select another provider.
