---
title: Markdown recipes
description: Look up FLOW.md recipe syntax, exact operands, result handling, and the current sequential execution profile.
---

# Markdown recipes

Use recipes to expose exact actions inside a `FLOW.md` procedure.
The Agent chooses whether and when to activate each available recipe.
Fence order expresses no enforced execution sequence.

For a complete method, follow [Write a Markdown method](../build/markdown.md).
[Markdown/0](../spec/markdown-runtime.md) defines exact parsing, interpretation, lifecycle, and limits.

## Recipe syntax

Each root-level lowercase `flow` fence contains one instruction:

| Instruction | Effect |
| --- | --- |
| `call <slot> <operand>` | Call a declared, host-bound dependency and receive its complete result. |
| `send <channel> <operand>` | Send a value through a declared send endpoint. |
| `receive <channel>` | Await the next iterator result from a declared receive endpoint. |
| `close <channel>` | Close or dispose the endpoint according to its direction. |
| `return <operand>` | Return a complete method result and stop. |

For example, this recipe offers an exact call using the invocation input:

```flow
call reviewer @input
```

The package must declare `reviewer` under `uses`.
The receiving host selects and authorizes its implementation.
An illustrative slot name supplies neither a provider nor permission to use one.

Only entrypoint fences directly under the document root become candidates.
Quoted, list-nested, and displayed inner fences remain ordinary examples.
An executable fence has an explicit matching close and the exact lowercase info string `flow`.
Trailing comments, extra instructions, and malformed operands make a recipe unavailable.

## Operands

| Operand | Value supplied when the recipe activates |
| --- | --- |
| Literal JSON/0 | The exact value authored in the recipe. |
| `@input` | The original invocation input. |
| `@previous` | The latest successful call's complete result, or a non-EOF receive's iterator result. |
| `@value` | An existing immutable whole value selected by the Agent. |
| `?` | Fresh JSON authored by the Agent. |

`@value` can select an exact call output or received message without reconstructing it.
`@previous` includes the surrounding result or iterator envelope.
The profile has no field selector such as `@previous.output`.

A failed call or receive clears `@previous`.
End-of-channel also clears it. Older retained values remain selectable through `@value`.
Sending and closing leave the cursor unchanged.

Strings such as `"@input"` and objects such as `{"$ref":"@previous"}` remain literal JSON.
The profile supplies no templates, assignments, conditions, loops, or expressions.
Use code when the procedure needs deterministic sequencing or value transformation.

## Results and outcomes

The return operand contains both `outcome` and `output`.
For example:

```flow
return {"outcome":"done","output":{"accepted":true}}
```

An optional `FLOW.contract.json` can declare custom outcomes and validate complete results.
A forwarding method must declare any custom outcome it can itself return.
Operational failure, cancellation, or uncertainty remains separate from domain outcomes.

## Calls and channels

A call result contains the child's `outcome` and `output`.
Receiving a message supplies an iterator result whose value is the message.
Message arrival and channel completion do not establish that the producer succeeded.

The host wires required endpoints before invocation.
Markdown/0 advances sequentially: it cannot allocate endpoints, start concurrent calls, or observe a child while awaiting that child.
Host deadlines and interpreter budgets bound waiting and reasoning.

Check [tool restrictions](skill-compatibility.md#tool-restrictions) before relying on reads or effects.
The [support reference](support.md) identifies available execution paths.
