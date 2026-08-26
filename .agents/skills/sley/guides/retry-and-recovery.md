---
description: Retry one transient handler safely, resume from a local fallback, and recover a failed Flow with settled-work context.
---

# Retry and recovery

A service fails once and succeeds on the next call. Retrying sounds harmless.
The danger is forgetting that Sley repeats the entire Node handler, including
every state write and external effect you placed around that call.

Retry answers “should this complete operation run again?” Recovery answers
“what should the graph do when it still fails?” Use either only when the
application can explain the failure and the consequence.

## Retry a transient operation

The service below fails twice, then succeeds. The handler commits state only
after the fallible call succeeds.

{% tabs %}
{% tab title="Python" %}

```python
import asyncio

from sley import Context, Failure, Flow, RetryPolicy, node


class TransientError(Exception):
    pass


calls = 0


def fetch_value() -> str:
    global calls
    calls += 1
    if calls < 3:
        raise TransientError("service unavailable")
    return "ready"


def is_transient(failure: Failure) -> bool:
    return isinstance(failure.cause, TransientError)


@node(
    retry=RetryPolicy(
        max_attempts=3,
        should_retry=is_transient,
        delay_ms=10,
    )
)
def fetch(context: Context) -> None:
    value = fetch_value()
    context.state["value"] = value


async def main() -> None:
    state = await Flow(fetch).run({})
    print(calls, state["value"])


asyncio.run(main())
```

Output:

```text
3 ready
```

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { Flow, node } from '@jigging/sley'

import type { Failure } from '@jigging/sley'

class TransientError extends Error {}

let calls = 0

function fetchValue(): string {
  calls++
  if (calls < 3) throw new TransientError('service unavailable')
  return 'ready'
}

function isTransient(failure: Failure): boolean {
  return failure.cause instanceof TransientError
}

const fetch = node<{ value?: string }>(
  (context) => {
    const value = fetchValue()
    context.state.value = value
  },
  {
    retry: {
      maxAttempts: 3,
      shouldRetry: isTransient,
      delayMs: 10,
    },
  },
)

const state = await new Flow(fetch).run({})
console.log(calls, state.value)
```

Output:

```text
3 ready
```

{% endtab %}
{% endtabs %}

`max_attempts` / `maxAttempts` counts the first call, so `3` means at most
three total attempts. The predicate and delay callback are synchronous. A
delay callback receives the attempt that just failed and its `Failure`.

Retry is considered only for a handler failure while attempts remain. A policy
that returns false stops retry immediately. A policy throw or invalid return
becomes `retry_policy`; an invalid handler return becomes `invalid_outcome` and
is not retried.

## Make the whole handler safe to repeat

Each attempt receives the same `context.state` object and `context.input` value.
A failed attempt discards every buffered `emit` and `end`, but Sley cannot undo:

- state mutations;
- database or filesystem writes;
- messages sent to another service;
- charges, uploads, or other external effects.

Validate first, perform the fallible operation, then commit state and control.
Use application idempotency keys when the operation itself may complete before
the client observes failure.

Do not stack provider retries and Sley retries without calculating the maximum
combined attempts. Provider request timeouts also remain service-client
configuration; Sley does not add a handler timeout.

## Resume from Node recovery

Node recovery receives the final `Failure` and a fresh Context carrying the
same branch input. Emit an intentional route to replace failure with normal
control.

{% tabs %}
{% tab title="Python" %}

```python
import asyncio

from sley import Flow, RetryPolicy, node


calls = 0


def fetch_handler(context):
    global calls
    calls += 1
    raise ConnectionError("service unavailable")


def recover_fetch(context, _failure):
    context.emit("fallback")


@node
def read_cache(context):
    context.state["value"] = "cached"


fetch = node(
    fetch_handler,
    retry=RetryPolicy(max_attempts=2),
    recover=recover_fetch,
)
fetch.link(read_cache, "fallback")

state = asyncio.run(Flow(fetch).run({}))
print(calls, state["value"])
```

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { Flow, node } from '@jigging/sley'

let calls = 0

const readCache = node<{ value?: string }>((context) => {
  context.state.value = 'cached'
})

const fetch = node<{ value?: string }>(
  () => {
    calls++
    throw new Error('service unavailable')
  },
  {
    retry: { maxAttempts: 2 },
    recover(context) {
      context.emit('fallback')
    },
  },
)
fetch.link(readCache, 'fallback')

const state = await new Flow(fetch).run({})
console.log(calls, state.value)
```

{% endtab %}
{% endtabs %}

Both programs print `2 cached`: two failed attempts, then one recovery route.

Recovery runs once after retry stops. One or more explicit control calls
replace the failure and route from the Node. If recovery makes no control call,
the exact failure propagates. There is no implicit unlabelled emission from a
recovery callback.

When recovery itself throws or returns an application value, the replacement
Failure identifies `node_recovery` or `invalid_outcome`; its `previous` field
retains the failure recovery was handling.

## Recover a failed Flow

Flow recovery handles failure from any activation or from `combine`. It runs
after the scope stops admitting new work and waits for its already-running
local wave.

{% tabs %}
{% tab title="Python" %}

```python
import asyncio

from sley import Flow, ScopeFailure, node


def dispatch(context):
    context.emit("work", 1)
    context.emit("work", -1)


def work(context):
    if context.input < 0:
        raise ValueError("negative job")
    context.end(context.input * 2)


def recover_batch(context, failure: ScopeFailure):
    context.state["completed"] = [
        terminal.output for terminal in failure.terminals if terminal.has_output
    ]
    context.end()


dispatch_node = node(dispatch)
work_node = node(work)
dispatch_node.link(work_node, "work")
batch = Flow(dispatch_node, recover=recover_batch)

state = asyncio.run(batch.run({}))
print(state["completed"])
```

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { Flow, node } from '@jigging/sley'

import type { Context, ScopeFailure } from '@jigging/sley'

interface State {
  completed?: unknown[]
}

const dispatch = node<State>((context) => {
  context.emit('work', 1)
  context.emit('work', -1)
})

const work = node<State, number>((context) => {
  if (context.input < 0) throw new Error('negative job')
  context.end(context.input * 2)
})

function recoverBatch(context: Context<State>, failure: ScopeFailure): void {
  context.state.completed = failure.terminals.filter((terminal) => terminal.hasOutput).map((terminal) => terminal.output)
  context.end()
}

dispatch.link(work, 'work')
const batch = new Flow(dispatch, { recover: recoverBatch })

const state = await batch.run({})
console.log(state.completed)
```

{% endtab %}
{% endtabs %}

Both programs print one completed sibling result: `[2]` in Python and `[ 2 ]`
in Node.js.

`ScopeFailure.terminals` contains branches that settled before failure.
`primary` is the controlling Failure. `result` contains the exact
`ScopeResult` only when `combine` failed after receiving it.

Explicit recovery control replaces both the failure and settled terminal set,
then routes from the Flow occurrence. The `end()` above converts the failed
scope into one successful hard terminal. With zero control calls, Flow recovery
propagates the failure and original terminals unchanged.

You can now place retry around repeatable work and recovery where the right
scope has enough context to choose a fallback. For every failure and result
field, use [Runtime semantics](../reference/runtime-semantics.md) and the
language API references.
