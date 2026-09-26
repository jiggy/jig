# Semantic Router: bounded choice of a method

Give this Flow a task and a finite set of eligible methods. It asks your ordinary
Agent to choose an ID or abstain. Your application validates the returned decision
and invokes its own reviewed slot. The router never loads or executes candidates.
Use an explicit menu instead when the caller already knows which method it needs.
The prompt asks the Agent to distinguish mandatory requirements from
preferences, abstain when no description supports every requirement or missing
information prevents that judgment, and use a stated default only among
suitable candidates. These are instructions to a probabilistic Agent, not
deterministic guarantees. Descriptions guide judgment; they do not guarantee it.

```json
{
  "task": "Give me the main points without changing the language.",
  "candidates": [
    { "id": "a7", "description": "Translate supplied prose to French." },
    { "id": "b2", "description": "Summarize prose in its original language." }
  ]
}
```

A completed selection returns:

```json
{ "outcome": "done", "output": { "candidateId": "b2", "reason": "The task asks for a summary in the original language." } }
```

`candidateId: null` is an explicit completed abstention. Agent refusal or exhaustion
returns `blocked` or `limit` with only `{ reason }`. Operational errors propagate;
there is one Agent call and no retries or fallback. An empty set abstains without
calling an Agent. One eligible method still needs an applicability judgment.

## Use in another project

Copy this complete package, including `contracts/`, into a member of your ordinary
Bun workspace, for example `methods/router`. Include `methods/*` and your caller
package in the workspace list. Declare `"semantic-router-flow": "workspace:*"`
in the Jig application's dependencies and in any caller importing the boundary
validator. The package's own manifest declares its public SDK and Agent library
versions. Run `bun install` at the workspace root; this TypeScript package needs
no build or private repository tooling. This source package is not published on npm.

Configure an ordinary Agent using the public [Agent guide](https://jig.md/guide/agents).
In your caller metadata declare `"uses": { "router": {} }`. In its Binding select
`router: 'npm:semantic-router-flow'`; your project's Agent default supplies the
router's named Agent dependency. Review with `jig review --allow-resolution-network`
when resolving an unlocked dependency tree. Then run your caller normally.

```ts
import { checkRoutingResult } from 'semantic-router-flow/decision'

const input = { task, candidates }
const decision = checkRoutingResult(
  await run.call({ operationId: 'route', slot: 'router', input }),
  candidates,
)
if (decision.outcome !== 'done' || decision.output.candidateId === null) {
  // Return or retain an unsuccessful application result; do not dispatch.
} else {
  // Resolve the ID in YOUR fixed candidate-to-slot map and call that exact slot.
}
```

The same validator accepts a replacement router's result. Keep candidate data and
the map under application control; ticket text must not replace them. Adding,
renaming or reordering candidates changes data and reviewed wiring, not the generic
prompt. Candidate descriptions should explain capabilities, constraints, tradeoffs,
and any desired default; do not supply credentials or unnecessary private data.
Descriptions are still natural-language input to an Agent and can influence its
judgment, including through instruction-like text. Supply only application-owned,
reviewed descriptions. Membership validation limits the returned ID; it does not
make a candidate suitable, neutralize prompt injection, or authorize dispatch.

## Bounds and evidence

Input is exactly `{ task, candidates }`: at most 16 candidates, each exactly
`{ id, description }`. IDs are distinct ASCII letters/digits/underscore/hyphen,
start with a letter or digit, and occupy at most 64 bytes. Task and description
text are nonempty UTF-8 without NUL, respectively at most 16,000 and 4,000 bytes.
The complete serialized input is at most 32 KiB. Reasons occupy at most 2,000 bytes.
These runtime checks supplement the anonymous invocation schema.

Retain the supplied context, candidate identities and descriptions, decision,
and subsequent execution outcome in application evidence. Host records separately
retain exact execution identity. Cancellation and deadlines remain ordinary Run
behavior. Neither a valid ID nor a reason proves the selected method is suitable.
This is bounded semantic dispatch, not catalogue discovery, installation, or an
authority grant. Controlled responses test mechanics; live evaluation measures
judgment separately. Do not use a router result as a permissions or policy check.
