# Agent ACP Flow

Run a native Agent task or bounded conversation as an ordinary, replaceable Flow. The method prepares
explicit instructions, guidance and selected Skill text, receives the native
answer, and checks structured output through `@jigging/agent-method`.

The caller uses the same Agent Run input and result as any other implementation.
The package's sole `native` slot requires the finite ACP resource described in
`contracts/finite-acp/`. The host supplies its reviewed client configuration
and private authentication; this Flow has no provider, model, credential or
permission settings of its own.

`FLOW.ts` runs the bundled implementation. `src/flow.ts` contains the complete
finite protocol dialogue, not a call back to a privileged Agent method. It uses
only the public FLOW SDK and Agent method library. `./transport` separately
exports bounded text framing for implementations of the same resource; these
helpers authorize nothing.

## Results and limits

The Flow must receive a completed ACP answer **and** settled resource evidence.
It does not turn channel EOF, a stopped process or a model's claim into success.
Refusal returns `blocked`; a bounded model response limit returns `limit`.
Cancellation, broken transport, invalid structured output and failed process
settlement remain errors. Conversational callers explicitly supply command/reply
channels and use a grant with `maxTurns` (1–8); ordinary calls still perform one
turn. Native retention and restoration use an explicit session request and
separate reviewed authority, described below. Tools, retries and implicit
filesystem context are not supplied.

For conversational use, add `conversation: true` to input and connect direct
`commands` and `replies` channels from the complete contract bundle. Initial
input starts turn 0. After a settled result, send a `prompt` for the next turn;
`interrupt` targets a running turn and `close` names the last settled one.
See [Agent conversation controls](https://jig.md/spec/agent-run#continuing-conversations)
for complete shapes and failure behavior. Replies must fit 64 KiB and are
essential; optional `events` remain presentation only. A closed conversation
returns its settled turn count only after native cleanup.

A terminal essential-channel failure waits for the resource's separate result,
so an early disconnect cannot hide uncertain execution. Invalid ACP detected
locally cancels the resource and preserves that parsing error. Root cancellation
and deadline still interrupt either path.

Optional `events` carry selected public updates independently of the essential
ACP transport. If local presentation cannot keep up, this implementation
declares a `LAGGED` stream end, drops the remaining suffix and reports incomplete
progress through a fixed diagnostic. Active receivers observe the stream failure
through ordinary error handling; the final answer remains separate.

## Retain or restore native state

The restoration path is a source candidate requiring matching Agent/Jig
artifacts and separate qualification through an installed native client. Its
initial collection profile is Codex 0.154.0; this README does not establish
registry availability or successful live restoration.

In the native grant, review `retainSessions: true` separately from the client,
model and turn allowance. Initial Agent input can then include either
`session: { retain: true }` for a new conversation or
`session: { restore: reference }` for an opaque UUID from a previous final
receipt. Omission keeps the invocation ephemeral. A restore request also asks
for a successor snapshot when the new invocation settles.

The Flow passes the request to its finite resource. For restoration it requires
the host-owned session identifier in ready and advertised ACP resume support,
resumes that exact session, and reapplies current reviewed configuration before
the prompt. It does not read native files, replay a transcript or fall back to
a fresh conversation. Current grants and credentials remain host-owned.

Only the final invocation output contains a requested receipt:
`session: { status: 'retained', reference }` or
`session: { status: 'unavailable' }`. Conversational turn replies never contain
it; follow-up prompt controls cannot change the initial session request. With
the conversation helper, inspect `completed.settlement.output.session`.
`retained` requires a settled final turn, actual clean native exit, bounded
validated collection, complete fencing and cleanup, and atomic store commit.
Forced closure yields unavailable retention; a separately valid answer remains
usable. Calls without a session request omit the receipt.

A reference is claimed once under the current authorized recipient, ancestry
and exact native profile. Expired, foreign, changed-profile or reused references
fail visibly. A failed claimed invocation does not make its old reference
reusable. The project permits 16 available snapshots of at most 8 MiB each,
with 24-hour logical expiry and pruning on the next store access. State excludes
credentials and arbitrary workspaces; expiry is not a secure-erasure promise.
See the [restoration guide](https://jig.md/guide/conversations#restore-after-a-clean-close)
for calls and [Finite ACP](https://jig.md/spec/finite-acp#retained-native-state)
for exact authorization, collection and settlement requirements.

## Configure and run

Declare `@jigging/agent-acp` in the Jig project's `package.json` dependencies
(`workspace:*` for local source, or a published version with its Bun lock).
Create `bindings/agent.ts`:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'npm:@jigging/agent-acp',
  slots: { native: { kind: 'acp', client: 'codex' } },
})
```

Select `defaultProviders: { 'https://jig.md/contracts/agent-run': 'binding:agent' }`
in `jig.ts` with `bindings: discover('./bindings')` for matching callers, or use
an explicit slot. With one eligible provider the mapping is optional.
The example's client is a choice, not a Jig default; `codex`, `claude` and `pi`
use the same grant interface. The operator configures the native installation, model and
authentication described in [Choose an Agent](https://jig.md/guide/agents).

```sh
jig review
jig run binding:agent --input '{"instructions":"Explain one useful check."}' --receive events
```

## Build the complete artifact

From the package directory, after normal workspace preparation:

```sh
just build
just test
just pack --destination /path/to/artifacts
```

The archive includes source, runnable output, types and exact contracts.
To adapt extracted source, run `bun install --ignore-scripts`, then `just build`.
The packed manifest declares versioned SDK and method development dependencies;
retain the resulting Bun lock for reproducible local development.
The runnable bundle has no installation hook or runtime npm dependency.
Source version numbers do not establish registry availability.

Tests use the public `RunContext` and endpoint interfaces with in-process peers:

```sh
bun test packages/agent-acp/test
```
