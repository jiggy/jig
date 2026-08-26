---
description: Run independent branches under a Flow-local concurrency bound and place an explicit activation guard around graph cycles.
---

# Concurrency and cycles

Fan-out does not automatically make work concurrent, and concurrency does not
automatically make it faster. Start serial. Raise a Flow's local limit when its
branches are independent and spend meaningful time waiting on I/O.

That decision introduces two responsibilities: do not depend on settlement
order, and do not race on shared state. A deliberate cycle adds a third: prove
that it can stop.

## Run a bounded batch

Each worker returns its value with `end(value)`. The combiner sorts by the
source index because concurrent terminal order is settlement order.

{% tabs %}
{% tab title="Python" %}

```python
import asyncio

from sley import Context, Flow, ScopeResult, node


@node
def dispatch(context: Context) -> None:
    for index, number in enumerate(context.state["numbers"]):
        context.emit("work", {"index": index, "number": number})


@node
async def work(context: Context) -> None:
    item = context.input
    await asyncio.sleep((3 - item["index"]) * 0.01)
    context.end({"index": item["index"], "value": item["number"] * 2})


def collect(context: Context, result: ScopeResult) -> None:
    ordered = sorted(result.outputs, key=lambda item: item["index"])
    context.state["doubled"] = [item["value"] for item in ordered]


dispatch.link(work, "work")
batch = Flow(dispatch, concurrency=3, combine=collect)


async def main() -> None:
    state = await batch.run({"numbers": [1, 2, 3, 4]})
    print(state["doubled"])


asyncio.run(main())
```

Output:

```text
[2, 4, 6, 8]
```

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { Flow, node } from '@jigging/sley'

interface State {
  numbers: number[]
  doubled?: number[]
}

interface Item {
  index: number
  number: number
}

const dispatch = node<State>((context) => {
  context.state.numbers.forEach((number, index) => {
    context.emit('work', { index, number })
  })
})

const work = node<State, Item>(async (context) => {
  await new Promise((resolve) => setTimeout(resolve, (3 - context.input.index) * 10))
  context.end({
    index: context.input.index,
    value: context.input.number * 2,
  })
})

dispatch.link(work, 'work')
const batch = new Flow(dispatch, {
  concurrency: 3,
  combine(context, result) {
    const ordered = [...result.outputs]
      .map((value) => value as { index: number; value: number })
      .sort((left, right) => left.index - right.index)
    context.state.doubled = ordered.map((item) => item.value)
  },
})

const state = await batch.run({ numbers: [1, 2, 3, 4] })
console.log(state.doubled)
```

Output:

```text
[ 2, 4, 6, 8 ]
```

The TypeScript cast is local because `ScopeResult.outputs` is intentionally
`readonly unknown[]`; Sley does not infer a graph-wide output type.

{% endtab %}
{% endtabs %}

## Understand the limit

`concurrency=3` / `concurrency: 3` permits at most three activations in this
Flow to run at once. The current scheduler uses bounded waves: it waits for an
admitted wave before admitting more. The setting is an upper bound, not a
fairness or work-conservation guarantee.

Nested Flows apply their own limits. A nested Flow invocation occupies one
activation in its parent while its internal nodes use the child's bound. There
is no run-global concurrency setting.

Concurrency only overlaps work that yields to the host scheduler. It does not
turn synchronous CPU or blocking I/O into nonblocking work. Use native async
clients or deliberate host-language offload when needed.

## Keep concurrent state safe

Every branch shares `context.state` and any borrowed nested objects. Sley does
not serialize application reads and writes beyond the configured scheduling
bound.

Prefer one of these designs:

- workers read shared facts but publish results through `end(value)`;
- branches write disjoint state keys;
- an injected service owns its own synchronization;
- application code uses a normal lock or other host primitive.

Flow concurrency also does not coordinate provider limits across separate
runs. Put shared rate limiting and request timeouts in the service client.

## Guard a cycle

A cycle has no hidden visit limit. Add `max_activations` / `maxActivations` as a
backstop even when the normal logic has an exit.

{% tabs %}
{% tab title="Python" %}

```python
import asyncio

from sley import Flow, node


@node
def revise(context):
    context.state["attempts"] += 1
    if context.state["attempts"] >= 3:
        context.end()
        return
    # No control call: follow the unlabelled self-link.


revise.link(revise)
review = Flow(revise, max_activations=10)


async def run_review():
    state = await review.run({"attempts": 0})
    print(state["attempts"])


asyncio.run(run_review())
```

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { Flow, node } from '@jigging/sley'

const revise = node<{ attempts: number }>((context) => {
  context.state.attempts++
  if (context.state.attempts >= 3) {
    context.end()
    return
  }
  // No control call: follow the unlabelled self-link.
})

revise.link(revise)
const review = new Flow(revise, { maxActivations: 10 })
const state = await review.run({ attempts: 0 })
console.log(state.attempts)
```

{% endtab %}
{% endtabs %}

Both programs print `3`: the domain condition stops the loop before the guard
is needed.

The count applies to activations started in this Flow invocation. Retry attempts
and activations inside a nested Flow do not consume the parent's count. Sley
fails before starting work beyond the bound with an `activation_limit`
Failure; `run()` exposes it through `RunError`.

You can now bound both parallel work and repeated work without pretending the
scheduler owns your data safety. If one of those operations is transient,
[Retry and recovery](retry-and-recovery.md) places repetition at the smallest
responsible boundary.
