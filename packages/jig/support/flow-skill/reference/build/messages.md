---
title: Exchange messages
description: Publish structured progress from a Flow, receive it through a declared channel, and check the final execution result.
---

# Exchange messages

A channel lets a method send useful information before its result arrives.
In this example, a classifier publishes two progress messages and returns a queue suggestion.
The messages describe its work. The final result supplies the decision.

You will declare a send port, publish through the SDK, and receive messages with Jig's CLI.
The classifier and phase names are illustrative application choices.

## Before you start

Complete [Run your first Flow](https://flow.jig.md/start/run.md) to install Jig on a supported host.
This tutorial uses Jig's current TypeScript and direct-channel support, with no Agent configuration.
Keep the scaffold's qualified SDK dependency in the generated package.

Other hosts provide their own connection and invocation interfaces.
Check [Hosts, runtimes, and SDKs](../reference/support.md) before selecting one.

## Create the method

Choose a directory outside the first tutorial's project.
Create a separate project and method:

```sh
jig init flow-messages
cd flow-messages
jig new classify-request
```

Save this contract as `flows/classify-request/FLOW.contract.json`:

```json
{
  "$schema": "https://flow.jig.md/schemas/invocation-contract-0.schema.json",
  "input": {
    "type": "object",
    "properties": { "message": { "type": "string" } },
    "required": ["message"],
    "additionalProperties": false
  },
  "channels": {
    "progress": {
      "direction": "send",
      "required": false,
      "schema": {
        "type": "object",
        "properties": {
          "phase": { "enum": ["reading-request", "classified"] }
        },
        "required": ["phase"],
        "additionalProperties": false
      }
    }
  }
}
```

The local name `progress` identifies a send port.
Its inline schema describes each message.
`required: false` permits invocation without an observer. An unwired optional port is absent from `run.channels`.

Replace `flows/classify-request/FLOW.ts` with:

```ts
import { handle, OperationError } from "@jigging/flow";

await handle(async (run) => {
  const input = run.input;
  if (
    input === null || typeof input !== "object" || Array.isArray(input) ||
    typeof input.message !== "string"
  ) {
    throw new OperationError("INVALID_INPUT", "Supply a message string.");
  }

  const progress = run.channels.progress;
  if (progress?.direction === "send") {
    await progress.send({ phase: "reading-request" });
  }

  const message = input.message.toLowerCase();
  const queue = message.includes("charged")
    ? "billing"
    : message.includes("error") ? "technical" : "manual";

  if (progress?.direction === "send") {
    await progress.send({ phase: "classified" });
    await progress.close();
  }

  return { outcome: "done", output: { queue } };
});
```

The handler awaits publication and closes its writer before returning.
This example treats a connected publication failure as an invocation failure.
Optional wiring alone does not make send errors best-effort.

## Receive the messages

Review the source and contract, then approve the intended revision:

```sh
jig review --allow-resolution-network
```

The network option permits dependency resolution during review.
It grants no network access to the method.
After approval, connect the port and run:

```sh
jig run flow:flows/classify-request --receive progress --json --input '{"message":"I was charged twice."}'
```

Jig connects a command-owned receiver before dispatching the Flow.
The handler publishes through the endpoint supplied in `run.channels.progress`.
The CLI consumes concurrently, so the producer can advance while its receiver waits for messages.

Selected-channel machine output is newline-delimited JSON, rather than a single result object.
For this one-channel example, records appear in this order:

| Record | Meaning |
| --- | --- |
| `begin` | Reception began for `progress`, starting at sequence 1. |
| `data` | One ordered message in `value`, with its channel and sequence. |
| `end` | Reception closed or failed. |
| `terminal` | `result` contains the ordinary Jig execution result. |

The two data records are:

```json
{"type":"data","channel":"progress","sequence":1,"value":{"phase":"reading-request"}}
{"type":"data","channel":"progress","sequence":2,"value":{"phase":"classified"}}
```

The final `terminal.result` contains `status: "succeeded"`, `outcome: "done"`, and `output: {"queue":"billing"}`.
It can also contain Jig's diagnostics and execution metadata.

For a software consumer, parse complete stdout lines and keep stderr separate.
Check the terminal result's execution status and domain outcome before using its output.
A failed channel end, missing terminal, or incomplete final line means delivery was incomplete.
Use the [Jig channel output contract](https://jig.md/spec/channels#installed-subprocess-output) for exact record fields.

## Change the observation

Run again with `{"message":"The upload shows an error."}`.
The progress phases stay the same, and the final queue becomes `technical`.
Changing the input changes the method's decision without changing the observation interface.

For another checkpoint, add `finished` to the schema's phase enum.
Send `{ phase: "finished" }` before closing the writer, then review and run again.
Expect a third data record and the same final queue.

To exercise a connection failure, replace `--receive progress` with `--receive missing`.
Jig rejects the undeclared selection before the method starts and returns a failed terminal.
An unknown channel name creates no route or new authority.

## Keep observation separate from completion

A successful send establishes source acceptance, rather than processing or durable delivery.
A channel ending establishes no application outcome.
An application must still check the method's separate execution result and decide what to do with it.

Code callers can allocate a channel and pass endpoints to declared child ports.
Start producer work before awaiting its first message, and settle execution and observation separately.
Use broadcast when independent consumers need the same stream, subscribing before dispatch to receive its beginning.
The [SDK channel reference](../spec/run-sdk.md#9-channel-projection) defines transfer, disposal, cancellation, and ownership.

For an agreement between independently authored participants, use a [named channel contract](../spec/channel-contracts.md).
For other data checks, continue with [Validate inputs and results](validation.md).
