---
title: Select and recover methods
description: Choose among reviewed methods and recover useful partial work with application-owned checks.
---

# Select and recover methods

Use semantic selection when a task can fit several eligible methods.
Your configured Agent proposes one method or abstains. Your application checks the decision and controls execution.
Use an explicit route when the method is already known.

## Before you start

Configure an [ordinary Agent](agents.md) and complete a [composed method](compose.md).
Install the semantic selector in your application and any caller importing its validator:

```sh
bun add --exact @jigging/semantic-router@alpha
```

The package follows Jig's normal prerelease process. Source candidates require matching built archives until publication completes.
A package manifest or passing source test does not establish registry availability.

## Bind the selector

Declare the caller's slot in `FLOW.meta.json`:

```json
{ "uses": { "router": {} } }
```

Select the package in that caller's Binding:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/caller',
  slots: { router: 'npm:@jigging/semantic-router' },
})
```

The package declares its own `agent` slot using the Agent Run contract.
Your project's contract-keyed Agent default supplies the implementation. The operator retains provider, credential, model, and resource choices.
Install dependencies, inspect the proposed authority, then review the project.

## Check the complete result

```ts
import { handle } from '@jigging/flow'
import { checkRoutingResult, routingInput } from '@jigging/semantic-router'

await handle(async run => {
  const input = routingInput({
    task: 'Summarize the supplied prose without changing its language.',
    candidates: [
      { id: 'a7', description: 'Translate supplied prose to French.' },
      { id: 'b2', description: 'Summarize prose in its original language.' },
    ],
  })
  const result = await run.call({ operationId: 'select', slot: 'router', input })
  const decision = checkRoutingResult(result, input.candidates)
  return decision
})
```

A completed decision contains `candidateId` and `reason`. A null ID is explicit abstention.
`blocked` and `limit` contain a reason without a candidate ID. Operational errors remain separate failures.

The Flow makes one Agent call and never dispatches candidates. Empty sets abstain without Agent work.
A sole candidate still requires an applicability judgment.

Your application owns a fixed map from candidate IDs to reviewed slots.
Validate membership, then separately decide whether another execution is permitted. Model-supplied IDs cannot create routes, packages, or grants.

The prompt requests preservation of mandatory requirements and abstention when suitability is unsupported.
It allows defaults only among suitable candidates. These instructions do not make semantic judgment deterministic.
Candidate descriptions remain Agent-visible data that can mislead judgment. Exact membership does not prove suitability or prevent prompt injection.

See the [package README](https://github.com/jiggy/jig/tree/main/packages/semantic-router) for byte bounds and the complete public API.

## Recover useful partial work

The complete [draft recovery application](https://github.com/jiggy/jig/tree/main/packages/semantic-router/examples/recover-draft) demonstrates the selector inside another Flow.
It includes every worker, Binding, descriptor, adapter, and acceptance check.
One worker saves useful files before throwing. Another returns a report rejected by independent checks.

The recovery Flow performs these steps:

1. Await the original direct child call through settlement.
2. Retrieve that child's accepted checkpoint using the original operation ID.
3. Validate saved data and adapt it into the fallback's input format.
4. Ask the selector to choose among application-eligible methods.
5. Validate the decision and call the permitted fallback with the immutable saved artifact.
6. Check the replacement files independently and explicitly forward accepted final artifacts.

The application permits at most two worker attempts. It preserves the original result and recovery trace.
Absent checkpoints and unavailable checkpoints produce different stopped reasons.
Abstention, invalid repaired data, exhaustion, and rejected replacement work never trigger an extra attempt.

[Child Checkpoint](../spec/child-checkpoint.md) defines retrieval after actual child cleanup.
[File composition](files.md#compose-file-work) explains ordinary artifact handoff and explicit final forwarding.
Cancellation or uncertain external effects do not authorize replay. Applications must separately decide whether a replacement execution is permitted.
An available checkpoint or valid selected ID does not establish acceptable work.

Deterministic package and installed-host tests establish these mechanics.
Live Agent quality requires separate measured tasks, recorded configuration, explicit limits, and preserved unsuccessful judgments.
