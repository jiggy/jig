---
description: Test application logic directly, then run small real Sley graphs to verify routing, state, terminals, and failures.
---

# Test a Flow

A graph can look right and still route the wrong outcome, mishandle an empty
fan-out, or recover at the wrong boundary. You do not need to mock Sley to catch
those mistakes.

Test domain logic as ordinary code. Test graph behavior by running a small real
`Flow`. This keeps failures readable and avoids mocks that reproduce the
runtime you meant to verify.

## Start with one observable outcome

The smallest useful graph test supplies state, runs the Flow, and asserts the
returned state.

{% tabs %}
{% tab title="Python" %}

```python
import asyncio

from sley import Flow, node


def test_priority_route() -> None:
    @node
    def choose(context):
        context.emit("priority" if context.state["amount"] >= 100 else "standard")

    @node
    def priority(context):
        context.state["lane"] = "priority"

    @node
    def standard(context):
        context.state["lane"] = "standard"

    choose.link(priority, "priority")
    choose.link(standard, "standard")

    state = asyncio.run(Flow(choose).run({"amount": 125}))

    assert state["lane"] == "priority"


test_priority_route()
```

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import assert from 'node:assert/strict'
import { Flow, node } from '@jigging/sley'

async function testPriorityRoute() {
  const choose = node<{ amount: number; lane?: string }>((context) => {
    context.emit(context.state.amount >= 100 ? 'priority' : 'standard')
  })
  const priority = node<{ amount: number; lane?: string }>((context) => {
    context.state.lane = 'priority'
  })
  const standard = node<{ amount: number; lane?: string }>((context) => {
    context.state.lane = 'standard'
  })

  choose.link(priority, 'priority')
  choose.link(standard, 'standard')

  const state = await new Flow(choose).run({ amount: 125 })

  assert.equal(state.lane, 'priority')
}

await testPriorityRoute()
```

{% endtab %}
{% endtabs %}

Save the example as `test_flow.py` or `test-flow.mts`, then run it with
`python test_flow.py` or `node test-flow.mts`. It exits silently when the
assertion passes.

This test exercises the definition, route, handler, and state boundary together.
It does not need a constructed `Context` or a mocked runner.

## Inspect failures without catching `RunError`

Use `start()` when the assertion concerns terminal or failure data:

{% tabs %}
{% tab title="Python" %}

```python
import asyncio

from sley import Flow, node


@node
def validate(context):
    context.state["validated"] = True
    raise ValueError("amount must be positive")


async def check_failure():
    result = await Flow(validate).start({"amount": -1}).result()

    assert result.status == "failed"
    assert result.failure.kind == "handler"
    assert result.state["validated"] is True


asyncio.run(check_failure())
```

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import assert from 'node:assert/strict'
import { Flow, node } from '@jigging/sley'

interface State {
  amount: number
  validated?: boolean
}

const validate = node<State>((context) => {
  context.state.validated = true
  throw new Error('amount must be positive')
})

const result = await new Flow(validate).start({ amount: -1 }).result()

assert.equal(result.status, 'failed')
if (result.status === 'failed') {
  assert.equal(result.failure.kind, 'handler')
  assert.equal(result.state.validated, true)
}
```

{% endtab %}
{% endtabs %}

Use `run()` in tests that care only about the completed state. Its `RunError`
contains the same failed result when error throwing is the behavior under test.

## Cover the boundaries your graph uses

Do not turn every application into a copy of Sley's conformance suite. Add the
cases that can change your workflow's outcome:

- the unlabelled path and each named decision;
- empty input when a dispatcher can emit no branches;
- `end()` without output versus `end(None)` or `end(undefined)`;
- combine pass-through versus terminal replacement;
- the attempt on which retry succeeds or stops;
- partial terminals visible to Flow recovery;
- a cycle reaching its explicit activation limit.

Compile-only tests are useful for topology policies. Assert the one field that
matters, such as a scope's concurrency, instead of snapshotting the complete
description. Element IDs and unrelated names should not make an application
test noisy.

Use a fake for an external service, not for Sley. Close over the fake or pass it
through a small handler factory, then run the same graph topology as the
application. The [Integration boundaries](integration-boundaries.md) guide
shows that dependency shape.

Your tests now protect decisions and boundaries rather than implementation
noise. When a failure needs diagnosis rather than an assertion, learn how to
[inspect topology and results](inspection.md) without treating logs as graph
control.
