---
description: Integrate services without hiding ownership of validation, timeouts, rate limits, persistence, logging, or cancellation.
---

# Keep Integration Boundaries Explicit

The moment a handler calls a database, model, payment provider, or queue, it is
easy to let the graph runtime become the accidental owner of every surrounding
policy. Resist that pull.

Sley schedules graph work. Your application still owns the services that work
depends on and the policies shared beyond one Flow invocation.

| Concern                                             | Owner                                  |
| --------------------------------------------------- | -------------------------------------- |
| Graph links, branch settlement, retry, and recovery | Sley                                   |
| Payload schema validation                           | Application                            |
| Provider request timeout                            | Service client or application          |
| Rate limit shared across runs                       | Shared service client                  |
| Logging and tracing                                 | Application observability              |
| Persistence and resume                              | Application or durable workflow system |
| Native task cancellation                            | Host language and application          |

## Make dependencies visible

Close over a client or create the handler with a small factory. Both keep the
graph readable and let tests supply a deterministic fake.

{% tabs %}
{% tab title="Python" %}

```python
import asyncio

from sley import Flow, node


def require_query(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("query must be a nonempty string")
    return value.strip()


class FakeSearch:
    async def search(self, query, *, timeout):
        return [f"result for {query} (timeout {timeout}s)"]


def make_lookup(client):
    @node
    async def lookup(context):
        query = require_query(context.state["query"])
        context.state["results"] = await client.search(query, timeout=10)

    return lookup


state = asyncio.run(Flow(make_lookup(FakeSearch())).run({"query": "  sley  "}))
print(state["results"][0])
```

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { Flow, node } from '@jigging/sley'

interface State {
  query: string
  results?: string[]
}

interface SearchClient {
  search(query: string, options: { timeoutMs: number }): Promise<string[]>
}

function requireQuery(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('query must be a nonempty string')
  }
  return value.trim()
}

function makeLookup(client: SearchClient) {
  return node<State>(async (context) => {
    const query = requireQuery(context.state.query)
    context.state.results = await client.search(query, { timeoutMs: 10_000 })
  })
}

const fakeSearch: SearchClient = {
  async search(query, options) {
    return [`result for ${query} (timeout ${options.timeoutMs}ms)`]
  },
}

const state = await new Flow(makeLookup(fakeSearch)).run({ query: '  sley  ' })
console.log(state.results?.[0])
```

{% endtab %}
{% endtabs %}

The programs print the fake result and the timeout chosen by the application.
`SearchClient`, validation, and timeout policy remain ordinary application
code. No Sley-specific provider wrapper or dependency container is required.

## Order fallible work deliberately

A retry repeats the complete handler. Sley discards buffered `emit()` and
`end()` calls from a failed attempt, but it cannot undo state writes or external
effects.

Use this order when possible:

1. validate state and input;
2. perform the fallible external operation;
3. commit shared state;
4. emit the next route or terminal.

For non-idempotent effects such as charging a card, use the provider's
idempotency key or an application transaction. A workflow retry is not a
transaction manager.

## Put shared limits around the shared client

`Flow(..., concurrency=N)` limits direct work inside one Flow invocation. It
does not coordinate other runs. Put a semaphore or rate limiter around the
client when all runs share one quota.

Choose one retry owner for each failure mode. Provider retries are often right
for transport errors; Sley retry is right when the whole handler operation may
be repeated. Stacking both multiplies attempts.

## Keep blocking work out of the event loop

Async handlers only help when their work yields. Prefer an async client for
network calls. Deliberately offload blocking CPU or I/O through the host
language when needed; increasing Flow concurrency does not make synchronous work
nonblocking.

Sley has no persistence, resume, distributed lease, deadline, or cancellation
API. Use an application queue or a durable workflow engine when work must
survive process loss or coordinate across machines. That is a system boundary,
not a missing graph option.

Keeping that line clear lets you change a client, queue, or persistence strategy
without redesigning the graph. [Concurrency and cycles](concurrency-and-cycles.md)
covers the local execution limits Sley does own.
