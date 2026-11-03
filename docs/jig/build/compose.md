---
title: Compose methods
description: Reuse the greeting through an exact slot, validate child results, and stop on failure.
---

# Compose methods

Turn the greeting into a small group-welcome method.
A coordinator calls the existing greeting once per name and collects its messages.
The greeting stays independently callable.

This exercise teaches the composition boundary without an Agent or external effects.
For a useful application, the [contact importer](../examples/contact-import.md) applies the same boundary to reading, mapping, checking, and export.

## Before you start

Use the approved `hello-jig` project from [Run your first Flow](../start/index.md).
Run commands from its root directory.
No additional library or Agent account is required.

## 1. Create a coordinator

```sh
jig new welcome-group
```

This creates editable source without installing, approving, or running anything.
The generated package declares its own FLOW SDK dependency.
If `jig.ts` uses explicit membership, add `flows/welcome-group` to its `flows` list.
The first tutorial uses discovery, which already includes it.

Replace `flows/welcome-group/FLOW.meta.json`:

```json
{
  "name": "welcome-group",
  "description": "Collect greeting messages for one to three names.",
  "uses": { "greeting": {} }
}
```

`uses` declares the `greeting` slot: the dependency this method can call.
The empty declaration is an anonymous interface requiring an explicit project selection.
It grants no authority and selects no implementation by itself.

Replace `flows/welcome-group/FLOW.ts`:

```ts
import { handle } from '@jigging/flow'

await handle(async run => {
  const names = run.input
  if (!Array.isArray(names) || names.length < 1 || names.length > 3 ||
      names.some(name => typeof name !== 'string' || name.length > 80)) {
    throw new TypeError('Supply one to three names, each at most 80 characters.')
  }

  const messages: string[] = []
  for (const [index, name] of names.entries()) {
    const result = await run.call({
      operationId: `greeting-${index}`,
      slot: 'greeting',
      intent: 'Create one welcome message',
      input: name,
    })
    if (result.outcome !== 'done') return result

    const output = result.output
    if (!output || typeof output !== 'object' || Array.isArray(output) ||
        !('message' in output) || typeof output.message !== 'string') {
      throw new TypeError('The greeting returned an unexpected message.')
    }
    messages.push(output.message)
  }
  return { outcome: 'done', output: { messages } }
})
```

Each `operationId` identifies one child call within this invocation.
Awaiting calls in sequence makes the order explicit.
The coordinator checks each complete result before using its output.
A non-`done` outcome returns unchanged, and execution failures propagate.

## 2. Select the greeting

A **Binding** is project configuration for one Flow and its dependencies.
Create `bindings/welcome-group.ts`:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/welcome-group',
  slots: { greeting: 'flow:flows/hello' },
})
```

The Binding selects the exact greeting behind the slot.
The coordinator imports no child implementation and performs no runtime discovery.
Review resolves the relation and retains it with the accepted revision.

## 3. Review and run

```sh
jig review --allow-resolution-network
jig run binding:welcome-group --input '["Ada","Grace"]'
```

Inspect both methods and their selected route before approval.
The resolution flag permits dependency preparation, with the [same network conditions](./dependencies.md#fresh-resolution-and-network-access) as before.
Run selects `binding:welcome-group` because this Binding owns the explicit child route.
Running `flow:flows/welcome-group` does not borrow that route.

After the first tutorial's greeting change, expect:

```json
{
  "status": "succeeded",
  "outcome": "done",
  "output": {
    "messages": ["Welcome, Ada!", "Welcome, Grace!"]
  }
}
```

The greeting remains usable on its own:

```sh
jig run flow:flows/hello --input '"Mei"'
```

Your [application client](../start/application.md) can call the coordinator by selecting `binding:welcome-group` and supplying an array.
Its execution, outcome, and cleanup checks still apply.
Use an intentional new task record for that separate invocation.

## Change one useful behavior

Change the greeting text in `flows/hello/FLOW.ts`.
Review that change and run the group again.
Every group message uses the new accepted greeting without changing the coordinator.

A shared interface allows replacement but does not guarantee equal behavior.
An Agent-backed greeting could use the same calling boundary with different powers, costs, and answer quality.
The operator must configure and review those differences.

## Watch invalid input stop

```sh
jig run binding:welcome-group --input '[]'
```

Expect execution failure rather than a successful empty group.
Validation happens before the first child call.
The coordinator also rejects more than three names and names longer than 80 characters.

If a child fails later, the coordinator does not invent a successful result or repeat that call.
Earlier completed effects are not rolled back.
This example only produces messages, so it has no external changes to undo.
Ctrl-C requests cancellation of owned work.
Follow [Troubleshooting](../reference/troubleshooting.md#inputs-and-execution) when execution or cleanup is uncertain.

## Apply the boundary to real work

Keep each method responsible for one useful input and result.
Compose it through a declared slot, check the outcome, and pass only the data its task needs.
Application code owns decisions based on those results.

- [Preview contacts](../examples/contact-import.md) with interchangeable code, Agent, and mixed mappers.
- [Handle a disputed charge](../examples/support-case.md) by checking an Agent proposal against supplied records and policy.
- [Design a project](./design.md) when settings, powers, and shared methods need distinct owners.
- [Design reusable Flows](https://flow.jig.md/guide/design) for portable method boundaries.
