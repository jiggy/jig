---
title: Choose an Agent
---

# Choose an Agent

An Agent-capable Flow delegates intelligent work through an agreed interface.
Choose its implementation once for your project; callers supply the task and
selected Skills. Jig keeps the selected method's resources and credentials
separate from the caller.

Both the HTTP and native ACP implementations are ordinary, replaceable Flow
packages. The [reusable Agent method](agent-method.md) can also be imported as
a pure library. Jig grants their underlying resources rather than implementing
the Agent on their behalf.

The current alpha reads exported environment variables for both `jig review`
and `jig run`. Project `.env` files are not loaded automatically.

## API access

Use the [ordinary Agent package](agent-method.md). Its Binding selects the model
and API format; an exact HTTP grant selects the endpoint and names the secret
environment variable. For example, an OpenRouter grant can name
`OPENROUTER_API_KEY` directly. The package supports Chat Completions and Responses
without host-specific API dispatch or a default model.

Select the configured Binding once in `jig.ts`:

```ts
export default defineJig({
  flows: discover('./flows'),
  bindings: discover('./bindings'),
  defaults: ['binding:agent'],
})
```

Import `defineJig` and `discover` from `@jigging/jig`. Matching code and Markdown
Flows use that reviewed selection. An explicit Binding slot can choose another
matching implementation. See [project defaults](../spec/project-sdk.md#project-defaults).

## Local clients

Extract the complete `@jigging/agent-acp` artifact into `flows/agent`. Its
[source package](https://github.com/jiggy/jig/tree/main/packages/agent-acp)
documents building and packing the candidate; this guide does not assert
registry publication. Create `bindings/agent.ts`:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/agent',
  slots: { native: { kind: 'acp', client: 'codex' } },
})
```

Use the same project default shown above. The grant selects `codex`, `claude`,
or `pi`; the package has no second client or model selector. Operator environment
supplies the chosen client's model and authentication. Review shows the exact
native grant and installation before launch.

```sh
jig review
jig run binding:agent --input '{"instructions":"Explain one useful check."}' --receive events
```

The ordinary Flow interprets ACP responses and emits selected public updates.
The [finite ACP resource](../spec/finite-acp.md) owns the native client and its
restricted profile. The original repository and the Flow's source are not
mounted into that credential-bearing scope. Observation does not confer Agent
control or establish that the answer is correct.

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
Jig supports standalone Linux x86-64 Codex binaries and native packages using
Nix's binary PATH wrapper. It retains the executable and required shared
libraries as individual reviewed files.

For Codex's nested sandbox, Jig selects an unprivileged `bwrap` from the
installation wrapper's PATH prefix or your exported PATH. If none is available,
it uses the installation's matching `codex-resources/bwrap`. You do not need that
bundled directory when your package supplies Bubblewrap separately.
`JIG_BWRAP_PATH` configures only Jig's outer containment tool.

The current adapter reads a file-backed login from `$CODEX_HOME/auth.json`,
defaulting to `~/.codex/auth.json`. Configure Codex with
`cli_auth_credentials_store = "file"` before signing in. Jig does not currently
read Codex's OS-keyring credentials.

The current adapter supplies a short-lived credential to the contained client;
it does not give it your full authentication store or refresh credentials.

## Switching

Choose the new Binding configuration or replace its Flow package, then run `jig review` again.
Client, endpoint, model, and executable changes affect the admitted execution
identity. Use the same selection for the subsequent `jig run`; rotating only
a credential does not require another review.

To use API access, select the ordinary Agent Binding in project defaults.
A missing or incompatible selection fails; Jig does not silently choose
another provider. Exporting an API key alone does not configure an Agent.
