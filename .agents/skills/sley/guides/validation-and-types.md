---
description: Validate untrusted state and branch input before effects, then use local types to make handler expectations visible.
---

# Validation and types

Sooner or later, your graph receives data it did not create: JSON from an API,
model output, a queue message, or user input. Types can describe what you hope
arrived. They cannot make that value trustworthy at runtime.

Sley validates graph control, not application data. Your reliable boundary is:

1. accept dynamic data as `object` or `unknown`;
2. parse it before state writes or external effects;
3. emit the validated value as branch input;
4. type the consuming handler with that validated shape.

This validation node turns an untrusted dictionary into a `Job`. The worker can
then state exactly what it expects. The TypeScript version keeps the untrusted
value `unknown` until the parser establishes its shape.

{% tabs %}
{% tab title="Python" %}

```python
import asyncio
from dataclasses import dataclass
from typing import NotRequired, TypedDict

from sley import Context, Flow, node


@dataclass(frozen=True)
class Job:
    text: str


class State(TypedDict):
    raw_job: object
    result: NotRequired[str]


def parse_job(value: object) -> Job:
    if not isinstance(value, dict):
        raise ValueError("job must be an object")

    text = value.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("job.text must be a nonempty string")

    return Job(text.strip())


@node
def validate(context: Context[State]) -> None:
    job = parse_job(context.state["raw_job"])
    context.emit("work", job)


@node
def work(context: Context[State, Job]) -> None:
    context.state["result"] = context.input.text.upper()


validate.link(work, "work")
flow = Flow(validate)


async def main() -> None:
    state = await flow.run({"raw_job": {"text": "  weave  "}})
    print(state["result"])


asyncio.run(main())
```

`Context[State, Job]` helps a type checker verify the worker body. It does not
prove that every predecessor emits a `Job`; `parse_job` creates that runtime
guarantee.

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { Flow, node } from '@jigging/sley'

interface Job {
  readonly text: string
}

interface State {
  rawJob: unknown
  result?: string
}

function parseJob(value: unknown): Job {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('job must be an object')
  }

  const text = (value as Record<string, unknown>).text
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('job.text must be a nonempty string')
  }

  return { text: text.trim() }
}

const validate = node<State>((context) => {
  const job = parseJob(context.state.rawJob)
  context.emit('work', job)
})

const work = node<State, Job>((context) => {
  context.state.result = context.input.text.toUpperCase()
})

validate.link(work, 'work')
const flow = new Flow(validate)

const state = await flow.run({ rawJob: { text: '  weave  ' } })
console.log(state.result)
```

An interface disappears at runtime. Without `parseJob`, a missing property
would normally become `undefined` and could travel until a later operation
fails.

{% endtab %}
{% endtabs %}

Both programs print:

```text
WEAVE
```

## Choose the validation boundary

Validate inline when one handler alone owns the input:

```python
def work(context):
    job = parse_job(context.input)
    result = call_service(job)
    context.state["result"] = result
```

Use a dedicated node when validated data feeds several routes, the boundary is
important in the graph, or the parser is independently reusable. In both
cases, finish validation before:

- mutating shared state;
- calling a service with side effects;
- emitting graph control.

This order matters because a failed callback discards buffered control but does
not roll back state or external effects.

## Missing values and validation failure

Python indexed access to a missing key raises `KeyError`. TypeScript property
access normally returns `undefined`. Sley preserves those language conventions
rather than wrapping application data in a proxy.

An uncaught parser error becomes a `handler` Failure. `run()` raises or rejects
with `RunError`; `start().result()` exposes the structured `Failed` value.
Deterministic schema errors usually should not be retried. Recover them only
when the graph has an intentional route for invalid user data.

You now have a boundary where invalid data fails before it can leak into state,
effects, or routing. When the validated operation itself can fail transiently,
[Retry and recovery](retry-and-recovery.md) helps you decide what is safe to
repeat.
