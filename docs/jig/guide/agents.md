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

## Choose for the work you need

The shared Agent contract describes the interface, not support for every optional
feature. Choose the implementation and grant before starting expensive work:

| Needed behavior | HTTP Agent | Native ACP Agent |
| --- | --- | --- |
| One bounded answer, including a checked structured result | Supported with a compatible configured API | Supported with a qualified client |
| Public live updates | Not supported by this implementation | Optional `events` channel |
| Same-session follow-up or interruption | Not supported | Conversation channels; `maxTurns` bounds the total turns |
| Native retention or restoration | Not supported | Separately enabled native grant and qualified client; inspect the final retention receipt |

Declare behavior that the complete calling method requires, for example
`"requires": ["conversation"]` beside its `uses.agent.contract` reference.
The HTTP implementation declares `supports: []`; ACP declares `events`,
`conversation`, and `sessions`. `jig review` rejects a required name missing from
the selected implementation's claims before the caller starts. It does not
switch the chosen implementation automatically.

There are three separate facts: the method claims to implement the behavior,
its reviewed resources permit it, and this execution actually completes. Review
checks declarations and known host/resource prerequisites without running the
package or calling a model; it cannot prove an arbitrary Flow's behavior or
infer its resource use. A one-turn grant still cannot provide a follow-up, and
a valid answer is not evidence of retained native state. See the
[exact feature definitions](../spec/agent-run.md#declare-required-agent-behavior).

## API access

Use the [ordinary Agent package](agent-method.md). Its Binding selects the model
and API format; an exact HTTP grant selects the endpoint and names the secret
environment variable. For example, an OpenRouter grant can name
`OPENROUTER_API_KEY` directly. The package supports Chat Completions and Responses
without host-specific API dispatch or a default model.

First create the local `bindings/agent.ts` described in that guide (or use the
native-client definition below). Then select it in `jig.ts`:

```ts
import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  flows: discover('./flows'),
  bindings: discover('./bindings'),
  defaultProviders: { 'https://jig.md/contracts/agent-run': 'binding:agent' },
})
```

`binding:agent` names your discovered `bindings/agent.ts`; Jig does not supply
or install an Agent Binding. Its `package` selects the implementation and its
slots configure that implementation's resources. The mapping is by contract,
not by the consumer's local slot name. With exactly one eligible configured
Agent, the `defaultProviders` line is optional. A missing explicitly selected
Binding remains a configuration error.

Matching code and Markdown Flows use that reviewed selection. An explicit
Binding slot can choose another matching implementation. See
[default providers](../spec/project-sdk.md#default-providers-by-contract).

## Local clients

For a new project, choose your installed client while creating its ordinary files:

```sh
jig init my-project --agent codex
```

Replace `codex` with `claude` or `pi`, or use `--agent` without a value for an
interactive choice. Open the generated README for authentication prerequisites,
review and the first Run. Initialization writes the dependency and Binding shown
below; it does not install a client or approve its grant. The generated dependency
pins the tested ACP package version; source-candidate builds still require that
version to be published or supplied through an ordinary workspace.

Declare `@jigging/agent-acp` in the project's `package.json` dependencies. Use
`workspace:*` when it is a member of your Bun workspace; otherwise select a
published version and retain the Bun lock. The
[published package](https://www.npmjs.com/package/@jigging/agent-acp)
contains the runnable Flow. Its
[source package](https://github.com/jiggy/jig/tree/main/packages/agent-acp)
also documents building and packing a candidate from reviewed source.
Create `bindings/agent.ts`:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'npm:@jigging/agent-acp',
  slots: { native: { kind: 'acp', client: 'codex' } }, // choose codex, claude, or pi
})
```

Use the same project default shown above. `client` is required; Codex is only
the concrete choice in this example, not a product default or recommendation.
The same grant shape accepts `claude` or `pi`; choose your installed client and
consult its [configuration profile](../spec/finite-acp.md#native-client-profiles).
The package has no second client selector. Add `model: 'your-model-id'` beside
`client` in the grant to select a model for that Binding; omission uses the
operator environment or the client's documented default. Authentication stays
with the operator. Review shows the exact grant, model and installation before
launch; changing the grant requires renewed approval.

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

Native runtime files keep their installation paths inside containment. Install
them outside reserved sandbox paths (`/dev`, `/jig`, `/proc`, `/run`, `/sys`,
`/tmp` and `/work`). Review reports a location error for a conflicting executable,
adapter or supporting file; select an operator-owned installation and review again.

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

## Continue a conversation

For applications that revise an answer or interrupt a running turn, see
[continuing conversations](conversations.md). The same ordinary Agent package
uses paired control/reply channels; an explicit `maxTurns` grant bounds further
prompts. One-shot calls require neither change.

## Switching

Choose the new Binding configuration or replace its Flow package, then run `jig review` again.
Client, endpoint, model, and executable changes affect the admitted execution
identity. Use the same selection for the subsequent `jig run`; rotating only
a credential does not require another review.

To use API access, select the ordinary Agent Binding in project defaults.
A missing or incompatible selection fails; Jig does not silently choose
another provider. Exporting an API key alone does not configure an Agent.
