# Agent ACP Flow

Run one native Agent task as an ordinary, replaceable Flow. The method prepares
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
settlement remain errors. There are no extra prompts, tools, retries, resumed
sessions or implicit filesystem context.

A terminal essential-channel failure waits for the resource's separate result,
so an early disconnect cannot hide uncertain execution. Invalid ACP detected
locally cancels the resource and preserves that parsing error. Root cancellation
and deadline still interrupt either path.

Optional `events` carry selected public updates independently of the essential
ACP transport. If local presentation cannot keep up, this implementation
declares a `LAGGED` stream end, drops the remaining suffix and reports incomplete
progress through a fixed diagnostic. Active receivers observe the stream failure
through ordinary error handling; the final answer remains separate.

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
