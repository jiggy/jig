---
title: Handle outcomes and failures
description: Distinguish a method's decision from execution failure and handle both before using its output.
---

# Handle outcomes and failures

A method can finish successfully and tell its caller that a person must decide what happens next.
Use a domain outcome for that answer.
Use an operational error when the invocation cannot perform its declared work.

This guide extends the illustrative [request classifier](https://flow.jig.md/start/run.md).
Its `manual` suggestion becomes a declared `needs-review` outcome.
The application retains responsibility for the next action.

## Declare a domain outcome

Save this as `flows/classify-request/FLOW.contract.json`:

```json
{
  "$schema": "https://flow.jig.md/schemas/invocation-contract-0.schema.json",
  "outcomes": {
    "needs-review": "A person must choose the request's queue."
  }
}
```

The descriptor declares the additional normal outcome.
`done` remains available implicitly.
An anonymous descriptor is sufficient for this local declaration.

Replace the classifier's final return with:

```ts
return {
  outcome: queue === "manual" ? "needs-review" : "done",
  output: { queue },
};
```

Review the source and run a message the rules cannot classify:

```sh
jig review --allow-resolution-network
jig run flow:flows/classify-request --input '{"message":"Please help."}' --json
```

The host reports successful execution with this method result:

```json
{"outcome":"needs-review","output":{"queue":"manual"}}
```

The method completed its job by reporting the need for review.
It has neither selected a team nor changed the customer's account.

## Handle the answer at the caller

Inside a Flow, `run.call()` returns domain outcomes as ordinary result data:

```ts
const result = await run.call({
  operationId: "classify:1",
  slot: "classifier",
  input: run.input,
});
if (result.outcome === "needs-review") {
  console.error("The request needs a person's judgment.");
}
```

Decide how your own method handles each accepted outcome.
Declare any custom outcome you forward in your own descriptor.
Returning the child's data alone loses the meaning supplied by its outcome.

At an application boundary, first check the host's execution and cleanup status.
Then branch on the method outcome before using its output.
The [application tutorial](https://flow.jig.md/start/application.md) shows the public client exchange.

## Preserve operational failure

The classifier raises `INVALID_INPUT` when `message` has the wrong type.
A missing dependency can produce `UNAVAILABLE`.
Such failures reject the SDK call with `OperationError`.

| Observation | Caller response |
| --- | --- |
| Successful execution with `done` | Check and use the output. |
| Successful execution with `needs-review` | Present or retain the request for the required decision. |
| Operational error | Handle the reported failure and its cause. |
| Cancellation or uncertain execution | Inspect the host's evidence before deciding what work may safely start. |

Test the invalid-input path with `{"message":12}`.
It should fail rather than return a successful queue suggestion.
Keep operational errors visible instead of converting every exception into `done`.

Use cancellation-aware work and `finally` blocks for resources your method owns.
The host owns deadline enforcement and execution settlement.
Cancellation alone leaves previously dispatched external effects subject to their actual state.

Next, [validate the values](validation.md) that cross the method boundary.
