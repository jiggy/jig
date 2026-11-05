# Select a suitable method

Give this Flow a task and descriptions of eligible methods. Your configured Agent selects one candidate ID or abstains.
Your application validates the decision and decides whether to invoke its own reviewed slot.
Use an explicit route when you already know which method you need.

## Install and bind

Install `@jigging/semantic-router` in your application and any Flow that imports its validator:

```sh
bun add --exact @jigging/semantic-router@alpha
```

In your caller's `FLOW.meta.json`, declare the slot:

```json
{ "uses": { "router": {} } }
```

Select the ordinary package in its Binding:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/caller',
  slots: { router: 'npm:@jigging/semantic-router' },
})
```

Configure the project's [ordinary Agent](https://jig.md/build/agents) through the Agent Run contract default.
The selector declares an `agent` dependency. It contains no provider, credential, model, or execution-policy choice.
Install dependencies, inspect the proposed authority, and review the project before running it.

This source candidate enters the normal release process. Its versioned manifest alone does not establish npm availability.

## Validate the decision before dispatch

```ts
import { checkRoutingResult, routingInput } from '@jigging/semantic-router'

const input = routingInput({
  task: 'Give me the main points without changing the language.',
  candidates: [
    { id: 'a7', description: 'Translate supplied prose to French.' },
    { id: 'b2', description: 'Summarize prose in its original language.' },
  ],
})
const decision = checkRoutingResult(await run.call({
  operationId: 'select', slot: 'router', input,
}), input.candidates)

if (decision.outcome === 'done' && decision.output.candidateId !== null) {
  // Resolve this validated ID through your fixed reviewed slot map.
  // Your application separately decides whether execution is permitted.
}
```

Keep this independent boundary check when replacing the selector with another Flow.
IDs are opaque data. They never identify import paths, packages, or newly authorized routes.

| Result | Meaning |
| --- | --- |
| `done`, `{ candidateId: string, reason }` | The Agent proposed one supplied ID. |
| `done`, `{ candidateId: null, reason }` | The Agent abstained, or the eligible set was empty. |
| `blocked`, `{ reason }` | The Agent could not provide a decision. |
| `limit`, `{ reason }` | The Agent reached its limit. |
| Operational error | The call failed. No decision or automatic retry follows. |

The selector makes one Agent call. Empty sets abstain without calling the Agent.
A sole candidate still needs an applicability judgment. There are no hidden retries or fallback dispatches.
Malformed Agent output produces `INVALID_RESULT`. Invalid invocation data produces `INVALID_INPUT`.

## Limits and judgment

Input contains exactly `task` and `candidates`. Each candidate contains exactly `id` and `description`.

| Value | Bound |
| --- | --- |
| Candidates | At most 16 distinct IDs |
| ID | 1–64 ASCII bytes matching `[A-Za-z0-9][A-Za-z0-9_-]*` |
| Task | 16,000 UTF-8 bytes |
| Description | 4,000 UTF-8 bytes |
| Complete serialized input | 32 KiB |
| Reason | 2,000 UTF-8 bytes |

Text must contain nonempty valid Unicode without NUL. The validators snapshot accepted input and results.
The optional `progress` channel offers a Selection view through the bundled reporting agreement.
Reporting does not establish suitability or authorize execution.

The prompt treats mandatory requirements as hard constraints and preferences as secondary choices.
It requests abstention when descriptions cannot support the requirements. A stated default guides only among suitable candidates.
These instructions guide probabilistic judgment. Exact membership establishes neither semantic correctness nor resistance to misleading descriptions.
Applications own eligibility, reviewed descriptions, validation, and permission to execute another method.

## Recover retained work

The complete [draft recovery example](examples/recover-draft/README.md) composes this selector inside another Flow.
It retrieves a settled worker's checkpoint, validates and adapts retained data, and independently checks the replacement report.
Its workers preserve text, binary files, and empty files. It never repeats the original worker automatically.
Recovery policy remains application code. The package exports no generic recovery engine.

## Build and verification

From this package directory, run `just build`, `just test`, or `just pack --destination <directory>`.
Builds use public FLOW dependencies and the package-owned Agent and reporting builds.
The archive includes editable source, declarations, the complete Flow runtime, descriptors, tests, and the recovery example.
Installed consumers need no build hook or development dependency.

Deterministic checks establish boundaries and orchestration mechanics. They do not measure live Agent quality.
Admitted host tests separately exercise the installed selector and checkpoint composition on supported native hosts.
