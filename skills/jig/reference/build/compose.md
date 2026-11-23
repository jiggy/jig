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

Use a brief greeting for one configured group and preserve the standard greeting for the other.
This optional test runs both Bindings through the installed Jig on a [supported Linux host](../start/index.md#supported-host).
Use Node.js 22 or newer to run the test and Bun 1.4.4 to prepare the locks.
Start with the group project above and set the standard greeting to `Welcome, ${name}!`.

Install the same Jig release locally as in the [application tutorial](../start/application.md#before-you-start).
For a packed candidate, pass its absolute `.tgz` path to `npm install --save-exact`.
Use that local executable for both review and the test.

```sh
./node_modules/.bin/jig new brief-hello
```

Set the `description` in `flows/brief-hello/FLOW.meta.json` to `Greet one person briefly.`
Replace `flows/brief-hello/FLOW.ts`:

```ts
import { handle } from '@jigging/flow'

await handle(run => ({ outcome: 'done', output: { message: `Hi, ${run.input}.` } }))
```

Save this invocation contract as `FLOW.contract.json` in both `flows/hello` and `flows/brief-hello`:

```json
{
  "$schema": "https://flow.jig.md/schemas/invocation-contract-0.schema.json",
  "input": { "type": "string" },
  "result": {
    "type": "object",
    "properties": {
      "outcome": { "const": "done" },
      "output": {
        "type": "object",
        "properties": { "message": { "type": "string" } },
        "required": ["message"],
        "additionalProperties": false
      }
    },
    "required": ["outcome", "output"],
    "additionalProperties": false
  }
}
```

Move the standard options into `config/welcome-group.ts`.

```ts
export default {
  package: 'flows/welcome-group',
  slots: { greeting: 'flow:flows/hello' },
} as const
```

Update `bindings/welcome-group.ts` to use those options.

```ts
import { defineBinding } from '@jigging/jig'
import welcomeGroup from '../config/welcome-group.ts'

export default defineBinding(welcomeGroup)
```

Create `bindings/brief-welcome-group.ts`.

```ts
import { defineBinding } from '@jigging/jig'
import welcomeGroup from '../config/welcome-group.ts'

export default defineBinding({
  ...welcomeGroup,
  slots: { ...welcomeGroup.slots, greeting: 'flow:flows/brief-hello' },
})
```

The brief Binding shares the standard declaration and selects a different greeter.
Discovery includes the new Flow and Binding.
If you use explicit membership, add both paths to `jig.ts`.
Save `fixtures/group.json` with this input for both calls:

```json
["Ada", "Grace"]
```

Generate and keep the Flow dependency locks:

```sh
bun install --lockfile-only --cwd flows/hello
bun install --lockfile-only --cwd flows/brief-hello
bun install --lockfile-only --cwd flows/welcome-group
```

Create `test/wiring.test.mjs`:

```js
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const project = new URL('../', import.meta.url)
const jig = fileURLToPath(new URL('node_modules/.bin/jig', project))

test('only the brief group uses the brief greeting', async t => {
  const cases = [
    { target: 'binding:brief-welcome-group', greeter: 'flow:flows/brief-hello', messages: ['Hi, Ada.', 'Hi, Grace.'] },
    { target: 'binding:welcome-group', greeter: 'flow:flows/hello', messages: ['Welcome, Ada!', 'Welcome, Grace!'] },
  ]
  for (const { target, greeter, messages } of cases) {
    await t.test(target, () => {
      const args = ['run', target, '--input', '@fixtures/group.json', '--timeout', '30s', '--json', '--record-calls']
      const stdout = execFileSync(jig, args, {
        cwd: project,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      })
      const result = JSON.parse(stdout)
      assert.equal(result.status, 'succeeded')
      assert.equal(result.outcome, 'done')
      assert.deepEqual(result.output?.messages, messages)
      const evidence = result.callEvidence
      assert.equal(evidence?.coverage, 'complete')
      assert.equal(evidence.runId, result.runId)
      assert.deepEqual(
        evidence.calls.map(call => [call.caller, call.slot, call.target, call.state, call.outcome]),
        messages.map(() => [target, 'greeting', greeter, 'returned', 'done']),
      )
    })
  }
})
```

From the project root, review the new source and both selections:

```sh
./node_modules/.bin/jig review
```

Approve the exact revision after inspection.
Before testing further source or Binding edits, complete review and approve the changed revision.
Jig can still use the earlier approval after an edit or a declined review.
The test uses existing approval and leaves review to the project operator.

```sh
node --test test/wiring.test.mjs
```

Expect both Binding subtests to pass.
The test checks execution status, method outcome, and the exact messages separately.
The recorded calls check the exact greeter that returned each result.
`--record-calls --json` includes that evidence in the Run result.
Result-only checks need no packet directory.

Await each subtest so only one Run uses the project at a time.
The results cover these inputs and these invocations.

To see the regression, copy the source and dependency locks into a disposable sibling directory.
Run `npm ci` in that copy.
Select `flow:flows/brief-hello` in its `config/welcome-group.ts` too.
Review and approve that copy after inspecting the changed selection.
Run the same test command there.
The brief route still passes, and the standard route fails on its message assertion despite a successful Run with outcome `done`.

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

Require `complete` coverage before checking the exact retained calls. The
offer calls `binding:offer-producer` through `sample`, then the producer
calls `binding:specialist` through `post-edit`. The book calls
`binding:shared-producer` through `production`, then the producer calls
`binding:standard` through `post-edit`. All four calls should have state
`returned` and outcome `done`.

An equivalent reviewer can produce identical files, so check the caller,
slot, target, and returned outcome in the saved evidence. Run your full
native suite for the other entrypoints and cases before accepting the change.
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
