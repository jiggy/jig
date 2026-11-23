---
title: Compose methods
description: Reuse the greeting through an exact slot, validate child results, and stop on failure.
---

# Compose methods

Turn the greeting into a small group-welcome method.
A coordinator calls the existing greeting once per name and collects its messages.
The greeting stays independently callable.

This exercise teaches the composition boundary without an Agent or external effects.
For a useful application, the [contact importer](https://jig.md/examples/contact-import.md) applies the same boundary to reading, mapping, checking, and export.

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
The resolution flag permits dependency preparation, with the [same network conditions](dependencies.md#fresh-resolution-and-network-access) as before.
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

## Test a scoped route

Create a starter with two group Bindings and a test through installed Jig.
Use a [supported host](../start/index.md#supported-host) and Node.js 22 or newer.

```sh
jig init scoped-greetings --starter scoped-greeting
cd scoped-greetings
jig check
jig review --allow-resolution-network
```

Inspect the proposed source and approve its exact revision.
The flag permits dependency resolution before approval.
See [dependency preparation](dependencies.md#fresh-resolution-and-network-access) for its scope.

```sh
node --test test/wiring.test.mjs
```

Both cases should pass.
The brief group selects `flow:flows/brief-hello`, and the standard group selects `flow:flows/hello`.
Both use `fixtures/group.json`, which you can also load in [Explorer](results.md#explore-before-starting-a-run).
The test checks successful execution, the domain outcome, and the messages.
It requires complete [call evidence](results.md#inspect-saved-child-calls) and checks each exact caller, slot, target, state, and outcome.

To change the brief group, follow the project README.
Use `jig check --diff` to see its moved slot before approval.
After reviewing the edit, run the same test with the intended expectation for the changed route.
The standard case should still pass with its original messages and calls.

#### Detect a wrong target with the same output

In a disposable copy of the starter, add `bindings/standard-copy.ts`:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({ package: 'flows/hello' })
```

In `bindings/welcome-group.ts`, select `binding:standard-copy` for the `greeting` slot.
Keep the original test, then review and approve that copy before running it.
The brief case passes and the standard group still returns the same messages.
Its test fails on the exact target assertion because the preserved route called the copy.

### Test callers in your application

Start each test configuration from a disposable copy of an application revision and its locks.
Keep the real callers and their Binding selections in that copy.
Select deterministic Flows for external collaborators, such as model-backed reviewers.
Keep production credentials and grants out of the test project.
If a slot names a contract, supply the same contract with each test implementation.
Review the test project before running it.

Exercise each affected entrypoint and at least one neighboring route that should keep its behavior.
For resumption, use an input that makes the application return a continuation at a known boundary.
Pass that continuation to the next Run.
Test direct invocation when callers share the same Binding.
Run the same assertions against a disposable copy with a deliberately broader selection to check that they detect the regression.

Record what each check establishes.

- `jig inspect --flow --topology --all --approved --json` shows configured destinations.
- The [live application map](results.md#follow-available-and-observed-calls) can show observed requests and outcomes. The map reports any observation limits.
- Check the command exit, root execution status, and expected domain outcome. If the application forwards child evidence, assert the exact values it received.
- Use `--record-calls --json` for [observed child calls](results.md#inspect-saved-child-calls). Require complete coverage before asserting absence.
- For file results, use `--out` with a fresh directory. Use `jig inspect --result` to verify the packet.
  Compare the relevant files with your expected output.

#### Get focused feedback on a route change

Run one changed entrypoint and one that should keep its behavior before you
run the full suite. For example, make a disposable copy of the `project/`
directory in the [publishing fixture](https://github.com/jiggy/jig/tree/main/packages/jig/test/fixtures/shared-binding-wiring).
Save `"resumed"` as `fixtures/manuscript.json` and commit it with your test
project. From that project, prepare its lock with `bun install --lockfile-only`,
then inspect and approve the initial project with `jig review`.

Give the offer sample its own post-edit reviewer and check the working diff.

```sh
jig specialize-slot binding:develop-offer --slot sample --as offer-producer \
  --select post-edit=binding:specialist
jig check --diff
```

Check that the offer selects the new producer and the book still selects the
shared producer. Run `jig review` and approve the intended revision before
running these two cases with the same fixture.

```sh
packets=$(mktemp -d)
jig run binding:develop-offer --input @fixtures/manuscript.json \
  --record-calls --out "$packets/offer" --json
jig run binding:coordinate-book --input @fixtures/manuscript.json \
  --record-calls --out "$packets/book" --json
jig inspect --result "$packets/offer" --calls --json
jig inspect --result "$packets/book" --calls --json
```

Check for successful execution and outcome `done` on both Runs. Open
`files/review/report.json` in each packet. The offer's `Epilogue` review
should be `specialist` with decision `revise`. The book's `Epilogue` review
should be `standard` with decision `accept`. Both whole-manuscript reviews
should stay `standard`.

Require `complete` coverage before checking these exact retained calls.

| Packet | Caller | Slot | Target | State | Outcome |
| --- | --- | --- | --- | --- | --- |
| Offer | `binding:develop-offer` | `sample` | `binding:offer-producer` | `returned` | `done` |
| Offer | `binding:offer-producer` | `post-edit` | `binding:specialist` | `returned` | `done` |
| Offer | `binding:offer-producer` | `review` | `binding:standard` | `returned` | `done` |
| Book | `binding:coordinate-book` | `production` | `binding:shared-producer` | `returned` | `done` |
| Book | `binding:shared-producer` | `post-edit` | `binding:standard` | `returned` | `done` |
| Book | `binding:shared-producer` | `review` | `binding:standard` | `returned` | `done` |

In the fixture's producer source, the `whole-book` operation uses `review` for both whole-manuscript handoffs.
Equivalent reviewers can produce identical files.
Check each caller, slot, target, state, and outcome in the saved evidence.
Run your full native suite for the other entrypoints and cases before accepting the change.
The publishing fixture's README gives the commands for its standalone suite.

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

- [Preview contacts](https://jig.md/examples/contact-import.md) with interchangeable code, Agent, and mixed mappers.
- [Handle a disputed charge](https://jig.md/examples/support-case.md) by checking an Agent proposal against supplied records and policy.
- [Design a project](design.md) when settings, powers, and shared methods need distinct owners.
- [Design reusable Flows](https://flow.jig.md/guide/design) for portable method boundaries.
