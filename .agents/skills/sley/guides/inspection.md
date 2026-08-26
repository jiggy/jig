---
description: Inspect a compiled Sley graph and structured run result without mistaking either for a full execution trace.
---

# Inspect a Graph and Its Result

When a workflow takes a surprising route, you need to separate two questions:
what graph did we define, and how did this particular run settle?

Sley exposes one view for each question:

- `compile().describe()` describes the graph before it runs;
- `start().result()` describes how its branches settled.

Neither is a step-by-step trace. This complete example inspects both views of
one graph.

{% tabs %}
{% tab title="Python" %}

```python
import asyncio

from sley import Flow, node


@node
def greet(context):
    context.end("hello")


async def main():
    compiled = Flow(greet, name="greeting").compile()

    for element in compiled.describe()["elements"]:
        print(f"topology: {element['kind']} {element['name']}")

    result = await compiled.start({}).result()
    print(f"result: {result.status}")
    for terminal in result.terminals:
        print(f"terminal: {terminal.type}")


asyncio.run(main())
```

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { Flow, node } from '@jigging/sley'

const greet = node(
  (context) => {
    context.end('hello')
  },
  { name: 'greet' },
)

const compiled = new Flow(greet, { name: 'greeting' }).compile()

for (const element of compiled.describe().elements) {
  console.log(`topology: ${element.kind} ${element.name}`)
}

const result = await compiled.start({}).result()
console.log(`result: ${result.status}`)
for (const terminal of result.terminals) {
  console.log(`terminal: ${terminal.type}`)
}
```

{% endtab %}
{% endtabs %}

Both programs print:

```text
topology: flow greeting
topology: node greet
result: completed
terminal: end
```

## Inspect the topology that will run

Compilation validates and snapshots the reachable definition. `describe()`
returns detached plain data containing elements, scopes, links, entries,
declared exits, concurrency, and activation limits.

The compiled Flow keeps its snapshot even if the mutable `Node` or `Flow`
objects are linked differently later. Compile once when a stable definition is
important; compile again when graph edits should take effect.

## Inspect how branches settled

A completed result contains final state and terminal records. A failed result
also contains its controlling structured failure. Terminal sequence records
settlement order, which may differ from dispatch order under concurrency.

Source activation IDs identify the activation that settled a terminal. They do
not map directly to element names, so use the static description and your own
domain logs when that relationship matters.

## Log domain facts where they happen

Use the host language's logger inside handlers or injected services. State,
input, and terminal output move application data; logs only observe it and must
not decide graph control.

Sley intentionally does not ship an event bus, observer API, or distributed
trace. Add instrumentation at service boundaries, or wrap handler functions in
application code when uniform timing is required.

You can now inspect topology without mistaking it for history and inspect a
result without pretending it is a trace. See
[Runtime semantics](../reference/runtime-semantics.md) for every description
and terminal field.
