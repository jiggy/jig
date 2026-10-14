---
title: Choose an Agent
---

# Choose an Agent

An Agent-capable Flow delegates intelligent work through an agreed interface.
Choose its implementation once for your project. Callers supply the task and
selected Skills. Jig keeps the selected method's resources and credentials
separate from the caller.

Both the HTTP and native ACP implementations are ordinary, replaceable Flow
packages. The [reusable Agent method](agent-method.md) can also be imported as a
pure library. Jig grants their underlying resources rather than implementing the
Agent on their behalf.

The current alpha reads exported environment variables for both `jig review` and
`jig run`. Project `.env` files are not loaded automatically.

## Choose for the work you need

The shared Agent contract describes the interface, not support for every
optional feature. Choose the implementation and grant before starting expensive
work:

| Needed behavior | HTTP Agent | Native ACP Agent |
| --- | --- | --- |
| One bounded answer, including a checked structured result | Supported with a compatible configured API | Supported with a qualified client |
| Public live updates | Not supported by this implementation | Optional `events` channel |
| Same-session follow-up or interruption | Not supported | Conversation channels. `maxTurns` bounds the total turns |
| Native retention or restoration | Not supported | Separately enabled native grant and qualified client. Inspect the final retention receipt |

Declare behavior that the complete calling method requires, for example
`"requires": ["conversation"]` beside its `uses.agent.contract` reference. The
HTTP implementation declares `supports: []`. ACP declares `events`,
`conversation`, and `sessions`. `jig review` rejects a required name missing
from the selected implementation's claims before the caller starts. It does not
switch the chosen implementation automatically.

Check three separate facts:

1. The method claims to implement the behavior.
2. Its reviewed resources permit it.
3. This execution actually completes. Review checks declarations and known
   host/resource prerequisites without running the package or calling a model.
   It cannot prove an arbitrary Flow's behavior or infer its resource use. A
   one-turn grant still cannot provide a follow-up, and a valid answer is not
   evidence of retained native state. See the
   [exact feature definitions](../spec/agent-run.md#declare-required-agent-behavior).

## API access

Declare `@jigging/agent-method` in your project's `package.json` dependencies.
Use a published version with its Bun lock, or `workspace:*` for a local Bun
workspace member. The ordinary Flow supports Chat Completions and Responses. Its
Binding selects model and API behavior. Its exact HTTP grant selects the
endpoint and credential name. The operator supplies that credential through the
environment.

Create `bindings/agent.ts`:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'npm:@jigging/agent-method',
  settings: { model: 'your-model', maxCompletionTokens: 4096 },
  slots: {
    http: {
      kind: 'http', method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      bearerEnv: 'OPENAI_API_KEY',
    },
  },
})
```

Choose a model supported by the endpoint. Export the named credential. For a
gateway, use its exact URL and credential name. See
[OpenAI-compatible gateways](agent-method.md#use-an-openai-compatible-gateway)
for formats and limits.

Then select the Binding in `jig.ts`:

```ts
import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  flows: discover('./flows'),
  bindings: discover('./bindings'),
  defaultProviders: { 'https://jig.md/contracts/agent-run': 'binding:agent' },
})
```

`binding:agent` names your discovered `bindings/agent.ts`. Jig does not supply
or install an Agent Binding. Its `package` selects the implementation and its
slots configure that implementation's resources. The mapping is by contract, not
by the consumer's local slot name. With exactly one eligible configured Agent,
the `defaultProviders` line is optional. A missing explicitly selected Binding
remains a configuration error.

Matching code and Markdown Flows use that reviewed selection. An explicit
Binding slot can choose another matching implementation. See
[default providers](../spec/project-sdk.md#default-providers-by-contract).

The `npm:` selector uses declared dependency preparation. It does not traverse
the live installation tree at execution time. Review the
[grant](../spec/grants.md) before invoking the Binding:

```sh
jig review
jig run binding:agent --input '{"instructions":"Explain a useful way to check an assumption."}'
```

Jig holds the credential and network access. The method interprets the HTTP
response. Use [the method guide](agent-method.md#invoke-the-ordinary-flow) to
supply Skills, schemas and application checks.

## Local clients

For a new project, choose your installed client while creating its ordinary
files:

```sh
jig init my-project --agent codex
```

Replace `codex` with `claude` or `pi`, or use `--agent` without a value for an
interactive choice. Open the generated README for authentication prerequisites,
review and the first Run. Initialization writes the dependency and Binding shown
below. It does not install a client or approve its grant. The generated
dependency pins the tested ACP package version. Source-candidate builds still
require that version to be published or supplied through an ordinary workspace.

Declare `@jigging/agent-acp` in the project's `package.json` dependencies. Use
`workspace:*` when it is a member of your Bun workspace. Otherwise select a
published version and retain the Bun lock. The
[published package](https://www.npmjs.com/package/@jigging/agent-acp) contains
the runnable Flow. Its
[source package](https://github.com/jiggy/jig/tree/main/packages/agent-acp) also
documents building and packing a candidate from reviewed source. Create
`bindings/agent.ts`:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'npm:@jigging/agent-acp',
  slots: { native: { kind: 'acp', client: 'codex' } },
})
```

A simple native policy belongs directly in its Binding. Use a
[named grant](../spec/grants.md#reuse-a-named-policy-when-useful) when several
Bindings intentionally share one policy or it has a separate management owner.
No grants directory is required for inline policy.

Use the same project default shown above. `client` is required. Codex is only
the concrete choice in this example, not a product default or recommendation.
The same grant shape accepts `claude` or `pi`. Choose your installed client and
consult its
[configuration profile](../spec/finite-acp.md#native-client-profiles). The
package has no second client selector.

Add `model: 'your-model-id'` beside `client` in the grant to select a model for
that Binding. Omission uses the operator environment or the client's documented
default. Authentication stays with the operator. Review shows the exact grant,
model and installation before launch. Changing the grant requires renewed
approval.

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
must be corrected or unset. It does not fall back to PATH discovery. Review
shows the resolved executable so you can check which installation you selected.

Native runtime files keep their installation paths inside containment. Install
them outside reserved sandbox paths (`/dev`, `/jig`, `/proc`, `/run`, `/sys`,
`/tmp` and `/work`). Review reports a location error for a conflicting
executable, adapter or supporting file. Select an operator-owned installation
and review again.

Discovery skips relative PATH entries, the project tree, and ancestor
`node_modules` directories, including symlink routes through them. Shell aliases
are not visible to Jig. The adapters require supported native installations. A
shell wrapper or npm JavaScript launcher is not itself the native executable.
For Codex's current official npm layout, Jig finds the matching native package
without running the launcher. This also works with Volta's recorded global npm
installation.

Review shows the native binary that will run. No extra path setting is needed
for these layouts. Unsupported launchers still require an explicit native
executable. See the
[selection rules](../spec/finite-acp.md#native-client-profiles) for the
supported metadata and project exclusions.

### Codex

Install Codex and sign in as the OS user running Jig, using
[Codex's login instructions](https://developers.openai.com/codex/auth/). Jig
supports these Codex installations:

- Standalone Linux x86-64 binaries.
- Native packages using Nix's binary PATH wrapper.
- The current official npm layout, including Volta.
- Native Mach-O clients on qualified Macs. It retains the executable and
  required non-system shared libraries as individual reviewed files.

On Linux, for Codex's nested sandbox, Jig selects an unprivileged `bwrap` from
the installation wrapper's PATH prefix or your exported PATH. If none is
available, it uses the installation's matching `codex-resources/bwrap`. You do
not need that bundled directory when your package supplies Bubblewrap
separately. `JIG_BWRAP_PATH` configures only Jig's outer containment tool.

On qualified Macs, Codex uses the system `/usr/bin/sandbox-exec` helper. Select
a native installation for your Mac's architecture. No separate Bubblewrap
installation is needed. A missing or unverifiable system helper requires
repairing the supported host, not replacing it with another helper.

Review checks the installation without opening a native session. Codex 0.159.0
passes the separate offline startup check on Intel macOS 14.4.1, build 23E224.
Its contained profile can receive preference-change notifications while host
preference values remain inaccessible. A fresh check refuses configured managed
policy or unavailable preference synchronization before review selection and
every native launch. Keep managed settings intact and choose an integration that
supports them. Jig does not bypass operator policy.

Other macOS profiles still require separate qualification for this Codex path.
Startup qualification does not prove endpoint availability or online
subscription routing. Rosetta and Apple Silicon execution of this Codex profile
are currently refused.

The current adapter reads a file-backed login from `$CODEX_HOME/auth.json`,
defaulting to `~/.codex/auth.json`. Configure Codex with
`cli_auth_credentials_store = "file"` before signing in. Jig does not currently
read Codex's OS-keyring credentials.

An overridden `OPENAI_BASE_URL` must use HTTPS, without a username, password,
query or fragment. The selected endpoint must pass normal certificate
verification. A local HTTP server is not an accepted native Codex endpoint.

The current adapter supplies a short-lived credential to the contained client.
It does not give it your full authentication store or refresh credentials.

## Repair a client check

A selected ACP prerequisite failure stops the entire `jig review` before new
approval, including an otherwise unchanged review. This applies in terminals,
scripts and `--yes` use. It also applies when a code target is ready or input
might avoid the selected Agent branch. An unselected missing client does not
block review. Any earlier approved code and client remain unchanged. Run still
performs its normal admission and environment checks.

The error identifies the known cause, selected client and affected Binding/slot.
Its location refers to captured source:

- A verified client literal, when known.
- Selection context for a computed expression.
- The Binding file and logical slot, when no exact client line is known. Named
  policies point to their captured JSON file and identify affected recipients.
  The next review captures your edits afresh.

Repair the selected client's installation or exported path override. A rejected
`CODEX_PATH`, `CLAUDE_PATH` or `PI_PATH` is an override problem, not proof that
the client is uninstalled. An explicit override does not fall back to `PATH`.
Codex's supported npm and Volta layouts resolve to their native executable
without running the launcher. Shell aliases and functions are not executables.
An unsupported wrapper needs its underlying native file.

Helper and other setup failures have their own repair guidance.

Executable failures may list passively detected supported alternatives, labelled
as executable detection only. They do not establish authentication,
qualification or compatibility. To change clients permanently, edit the named
policy or inline Binding shown by the diagnostic and review again. You may
instead use an explicit [`jig review --agent codex`](agents.md#switching)
proposal for every selected ACP policy. Preserve turn limits and choose
model/retention changes deliberately. No interactive correction or automatic
source write occurs.

Retry guidance does not add networking or authority approval on your behalf.

Review checks prerequisites without starting a Flow or calling a model. It may
have prepared dependencies or performed separately requested contract generation
before failure. No new approval is recorded. `--details` expands the retained
observed report, discloses its bounds and identifies checks that did not finish.
It does not run extra checks. `jig review --json` is unsupported.

Run and inspection keep their existing machine-output options.


An **installation** error means the executable or its required runtime files
could not be verified. Use a supported Linux x86-64 installation on Linux, or a
native installation matching your architecture on a qualified Mac. Pi requires
its standalone 0.84.4 distribution, including `package.json` and the theme
directory beside its executable. A **sandbox** error identifies Codex's separate
helper check. Follow the host-specific instructions above. An unsupported
**wrapper** requires selecting the underlying native executable with the
appropriate absolute path override.

Review cannot prove that a later native session or model call will succeed.
After a client starts, use
[execution failure recovery](results.md#recover-from-execution-failure). Do not
repeat uncertain work to diagnose setup.

## Continue a conversation

For applications that revise an answer or interrupt a running turn, see
[continuing conversations](conversations.md). The same ordinary Agent package
uses paired control/reply channels. An explicit `maxTurns` grant bounds further
prompts. One-shot calls require neither change.

## Switching

For a lasting project choice, edit the ordinary Binding source. The diagnostic
identifies the captured Binding and its `native` slot, or the named JSON policy
selected by a slot such as `native: 'grant:agent'`. Simple policies are inline:

```ts
slots: { native: { kind: 'acp', client: 'codex' } },
```

Choose `codex`, `claude`, or `pi`, keep the turn limits and required
conversation features, and configure the client's authentication. A model pin
belongs to the chosen client. Replace it deliberately or omit it to use that
client's default. Codex-only `retainSessions` must remain with Codex or be
deliberately removed when the application no longer needs native retention. Then
review and approve the changed selection before running:

```sh
jig review
jig run
```

You can also propose one client for the current review without editing source:

```sh
jig review --agent codex
jig run
```

`review --agent` requires one value: `codex`, `claude`, or `pi`. It changes only
`client` in every selected ACP policy, including inline, named/shared and
computed policies. Review shows the source client, effective client, argument
origin and affected recipients before normal approval. The approved lock and
`jig inspect` retain the effective choice. Run uses that exact approval without
another flag. HTTP Agents and ordinary package/provider routes are unaffected.

Turn limits and other policy fields remain intact. An actual cross-client change
with a pinned model or incompatible native retention refuses the whole request.
Jig does not clear or translate either field. The argument also refuses when no
ACP resources are selected. A same-client choice still undergoes the normal
prerequisite checks.

New or changed resource authority requires the same explicit approval as a source edit.
`--yes` alone does not grant it.

The argument is not remembered for the next review. Repeat it when reviewing
later code edits, or edit the Binding for persistence. A later bare `jig review`
uses its newly captured source client again and explains that proposed change.
If that review fails, the earlier approved code and client remain together.
Newly edited code is not authorized with the old client.

If the selected client fails review, follow
[client-check recovery](#repair-a-client-check). The failed review does not
approve newly edited code or replace the earlier approved client.

Choose a different ordinary Agent package in its Binding when switching between
native ACP and HTTP access. Client, endpoint, model and executable changes
affect admitted execution identity. Rotating only a credential does not require
another review.

To use API access, select the ordinary Agent Binding in project defaults. A
missing or incompatible selection fails. Jig does not silently choose another
provider. Exporting an API key alone does not configure an Agent.
