---
title: Write a Flow in TypeScript or JavaScript
description: Write a callable method, run it on a compatible host, and check its result.
---

# Write a Flow in TypeScript or JavaScript

Put a procedure behind `handle()` so other software can supply input and receive its result.
The same method can later call code, Agent instructions, or other Flows through declared dependencies.

The illustrative classifier recognizes a few words and suggests `billing`, `technical`, or `manual`.
The application decides what to do with that suggestion.

## What you need

Complete [Run your first Flow](https://flow.jig.md/start/run.md) to prepare a Jig project and its qualified TypeScript runtime.
Keep the SDK version installed by that host's setup.
Check [host and runtime support](../reference/support.md) when choosing another execution environment.

## Write the method

In the tutorial project, save this as `flows/classify-request/FLOW.ts`:

```ts title="FLOW.ts"
import { handle, OperationError } from "@jigging/flow";

await handle(async (run) => {
  const input = run.input;
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.message !== "string"
  ) {
    throw new OperationError(
      "INVALID_INPUT",
      "Expected an object with a message string.",
    );
  }

  const message = input.message.toLowerCase();
  const queue = /charged|invoice|payment/.test(message)
    ? "billing"
    : /password|login|error/.test(message)
      ? "technical"
      : "manual";

  return { outcome: "done", output: { queue } };
});
```

`handle()` receives one host invocation and owns its protocol exchange.
The handler validates the input, applies the classification rules, and returns an outcome with data.
Running `node FLOW.ts` alone waits for a host request.

This example also works as JavaScript in `FLOW.mjs` with a supporting host.
Choose one implementation file per package.
For Jig, keep `FLOW.ts` and the Bun runtime qualified by its selected release.

## Run and inspect the result

For the Jig project, review the source and run the method:

```sh
jig review --allow-resolution-network
jig run flow:flows/classify-request --input '{"message":"I was charged twice."}' --json
```

Inspect the review and approve the intended source and grants.
A completed invocation contains this method result:

```json
{"outcome":"done","output":{"queue":"billing"}}
```

The host's JSON response also reports execution status and diagnostics.
[Call the method from your application](https://flow.jig.md/start/application.md) to consume that response through the host's public interface.

Supply `{"message":12}` to exercise the invalid-input path.
The handler raises `INVALID_INPUT` instead of returning a queue.
See [outcomes and failures](outcomes.md) for the distinction between a method's result and an operational error.

## Make it useful for your task

Add `refund` to the billing expression.
Review the changed source and run it with `{"message":"Please refund my order."}`.
The queue changes from `manual` to `billing`.
Use representative messages to judge whether that rule helps your application.

Known rules can stay in code.
For interpretation beyond those rules, a declared dependency can supply Agent judgment through the same calling boundary.
[Compose methods](compose.md) when the task needs another capability.

## Keep the boundary clear

Return [portable JSON values](../spec/json-values.md), and inspect a child's outcome before using its output.
Await owned calls before returning.
Use `run.signal` for cancellation-aware work and preserve operational failures.
The host owns deadline enforcement and execution cleanup.

After `handle()` starts, ordinary console diagnostics go to stderr.
Keep import-time logging and raw writes off protocol stdout.
The [SDK reference](../reference/sdk.md) covers calls, settings, attachments, channels, errors, and cancellation.

## Use the SDK with another host

Follow your host's dependency packaging instructions and use its qualified SDK revision.
For an independent SDK exercise, install the published prerelease in an empty directory:

```sh
npm init -y
npm pkg set type=module
npm install --save-exact @jigging/flow@alpha
```

Keep the resolved version and lockfile.
Your host supplies runtime execution and dependency preparation.
The [installed SDK exercise](https://flow.jig.md/implement/sdk.md#exercise-an-installed-sdk) provides a trusted local protocol check without a production host.
