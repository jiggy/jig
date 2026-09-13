---
title: One caller, three implementations
description: Run the same caller with a code classifier, an Agent classifier, and a method combining both. Learn the shared contract and the review boundary.
---

# One caller. Code, Agent, or both.

A support application needs a suggested queue for an incoming request.
Start with explicit labels in code, try an Agent's interpretation, then
combine them. **The application calls the same method contract each time.**

The [request-triage source](https://github.com/jiggy/jig/tree/main/examples/request-triage)
contains four Flow packages: one intake caller and three classifiers. This is
a small authored example of composition. It returns a suggestion; it does not
send messages, issue refunds, or connect to a ticketing service.

## The boundary the caller sees

Every classifier accepts `{"message":"…"}` and returns a normal method result:

```json
{ "outcome": "done", "output": { "queue": "billing" } }
```

The queue is `billing`, `technical`, or `manual`. Manual classification is a
valid suggestion when the request cannot be confidently categorized. The
other declared outcomes, `blocked` and `limit`, carry `output.reason`.

Each package supplies `input.schema.json` and `result.schema.json`. Jig
validates the input before execution and the result before admitting success.
The input permits one nonempty message of at most 4000 characters. Valid shape
does not establish that the selected queue is appropriate.

The intake method is the whole caller:

```ts title="flows/intake/triage.ts"
import type { RunContext, RunResult } from '@jigging/flow'

export async function triage(
  run: Pick<RunContext, 'input' | 'runChildFlow'>,
): Promise<RunResult> {
  return run.runChildFlow({
    operationId: 'classify-request',
    slot: 'classifier',
    input: run.input,
  })
}
```

It calls one configured slot. The host validates the child result before
returning it. The caller passes the outcome through, and execution errors
propagate without retry. Its source contains no decision about how to classify.

## Three ways to do the work

| Implementation | Procedure | Agent calls per request |
| --- | --- | --- |
| Code | Recognize `[billing]` or `[technical]` at the start, ignoring capitalization and outer whitespace. Otherwise suggest `manual`. | None |
| Agent | Ask an Agent to interpret the message and validate its structured queue suggestion. | One |
| Mixed | Apply the same prefix rule; when no label matches, ask an Agent and validate its result. | Zero or one |

The Agent methods request a bounded structured response using Jig's
[Agent Run capability](./agents.md). The Flow supplies the task. The operator
chooses the client, model, and credentials. Each implementation stays inside
its own package and uses the public FLOW SDK.

Code and Agent judgment occupy the same compositional level through these
methods. The mixed method changes the way work happens inside the boundary;
it does not require the caller to manage an Agent conversation.

## Run all three

Follow [installation and supported-host setup](./index.md), then prepare the
checkout using [workspace setup](./dependencies.md#local-workspace-packages).
Configure an [Agent](./agents.md) for the Agent-capable packages before review.
The checked-in example includes those packages even when you select the code
Binding; the code classifier itself makes no Agent call.

From `examples/request-triage`:

```sh
jig review
jig run binding:intake --input @fixtures/labeled.json
jig run binding:agent --input @fixtures/labeled.json --timeout 2m
jig run binding:mixed --input @fixtures/labeled.json --timeout 2m
```

Inspect the source and review, then approve before running. Noninteractive
`jig review --yes` records approval only when you have already authorized it.

The synthetic labeled fixture says:

```json
{ "message": "[billing] Please explain the two charges on my invoice." }
```

Code and mixed return `done` with `{"queue":"billing"}`. The Agent is asked to
suggest the same queue, but can choose differently or return `blocked` or
`limit`. Inspect the method's outcome as well as the CLI's execution status.
The page does not claim identical classification behavior.

## Change the implementation, keep the caller

Each Binding uses the same intake package. `bindings/intake.ts` begins with:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/intake',
  slots: { classifier: 'flow:flows/code' },
})
```

Change only `flow:flows/code` to `flow:flows/mixed`. Review and approve that
change, then invoke the same Binding with the unlabeled fixture:

```sh
jig review
jig run binding:intake --input @fixtures/unlabeled.json --timeout 2m
```

The fixture describes a duplicate invoice charge without a prefix. Before the change, this Binding suggests `manual`.
After the change, it requests Agent interpretation, which may suggest `billing`.
The caller source, command, and result contract stay the same.

Until the new revision is approved, Runs continue to use the previously
accepted target. Jig does not hot-swap methods or let a model invent a target
by naming it. Undo the Binding edit and review again to restore the baseline.

## What this makes possible

The same arrangement lets a method gain interpretation, replace some reasoning
with code, or add checks without forcing its callers to adopt a different
composition model. The application still chooses which implementation fits
its needs and which powers it is willing to supply.

A shared interface is not behavioral equivalence. Cost, latency, accuracy,
side effects, and required powers can differ. In this example, both explicit
labels and Agent suggestions may be misleading. Any real dispatch policy
needs application-owned checks and appropriate authorization. The instruction
to treat request text as untrusted data is guidance, not an injection defense
proved by this example.

The deterministic tests cover the shared caller, direct branches, malformed
Agent results, `blocked` and `limit` propagation, and no replay after failure:

```sh
bun test examples/request-triage/test
```

They use Agent substitutes and establish application behavior, not model
quality or host containment. Continue with [how Jig works](./understand.md),
then [workflow design](./workflow-design.md) when your application needs more
than this single handoff.
