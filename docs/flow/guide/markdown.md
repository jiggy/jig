---
title: Write a Flow in Markdown
description: Receive input, call another method, return outcomes, and exchange messages from FLOW.md.
---

# Write a Flow in Markdown

A `FLOW.md` method receives input and returns an outcome with data, just like a
code Flow. An Agent interprets your instructions; exact `flow` recipes let it
call configured methods and exchange values without rewriting them. The host
supplies the Markdown interpreter, Agent, and permitted dependencies.

No SDK import is needed in the Markdown package. The current
[Markdown/0 profile](../spec/markdown-runtime.md) is sequential and always uses
Agent reasoning. Choose [TypeScript](./typescript.md) or [Python](./python.md)
when your procedure needs deterministic sequencing or concurrent work.

## Receive input and return a result

Save this as `summary/FLOW.md`:

```markdown
---
name: concise-summary
description: Summarize supplied text without adding claims.
allowed-tools: ""
---
Summarize the invocation input in one sentence. Preserve uncertainty.
Return outcome done with the summary string as output.
```

For input `"The shipment may arrive Friday. Its delivery date is unconfirmed."`,
an appropriate result is:

```json
{"outcome":"done","output":"The shipment may arrive Friday, but the date is unconfirmed."}
```

The wording is Agent-generated. The interpreter validates the result envelope;
your application still judges whether the summary preserves the source.
Without an invocation contract, input and output accept bounded JSON values and
`done` is the only normal outcome. `allowed-tools: ""` prevents resource reads
and effect recipes, while still permitting reasoning and returning a result.

For execution, choose a host with Markdown/0 support and configure its Agent.
The [Jig Markdown tutorial](https://jig.md/guide/markdown) gives one host's
setup and run commands. Other hosts supply their own invocation interface.
Copying the file into an arbitrary coding agent does not install a FLOW runtime.

## Call another Flow and forward its result

Suppose a configured `greeter` method accepts a name and returns
`{"outcome":"done","output":{"message":"Hello, Ada!"}}` for `"Ada"`.
Create `delegate/FLOW.md`:

````markdown
---
name: delegate-greeting
description: Ask the configured greeter to greet the supplied name.
uses:
  greeter: {}
---
Call the greeter with the invocation input. After it completes successfully,
return its complete result unchanged using the return recipe.

```flow
call greeter @input
```

```flow
return @previous
```
````

`uses` declares a dependency slot. The host binds that slot to an authorized
implementation before invocation; it is not a package search or an install
command. The selected implementation may use code, Markdown, or Agent judgment.

`@input` passes the original input value. After the call, `@previous` holds the
**complete result**, including both `outcome` and `output`. Selecting the return
recipe forwards those values exactly. With input `"Ada"`, the expected result
from this example is the greeter's result shown above.

### Run the composition on Jig

On a [supported Jig host](https://jig.md/guide/#supported-host), with an
authenticated supported native Agent installed, create a project:

```sh
jig init markdown-demo --agent
cd markdown-demo
mkdir -p flows/delegate
```

Choose your client when prompted and follow the generated README's prerequisites.
Initialization writes a code greeting at `flows/hello/FLOW.ts` and an Agent
configuration. To use an API directly instead of a native client, configure the
[HTTP Agent method](https://jig.md/guide/agent-method#invoke-the-ordinary-flow)
as the project's Agent; the delegate below is unchanged.

Save the `delegate/FLOW.md` example above as `flows/delegate/FLOW.md`. Create `bindings/delegate.ts`:

```ts
import { defineBinding } from "@jigging/jig";

export default defineBinding({
  package: "./flows/delegate",
  slots: { greeter: "flow:flows/hello" },
});
```

Review the project, approve the intended source and grants, then invoke it:

```sh
jig review --allow-resolution-network
jig run binding:delegate --input '"Ada"' --timeout 4m
```

The network option permits dependency resolution during review; it does not give
the Markdown method network access. A successful run contains `outcome: "done"`
and `output: { "message": "Hello, Ada!" }`. The Markdown interpreter also uses
the project's configured Agent, so this example makes model calls.
The four-minute limit gives those sequential calls room to finish; the CLI's
default is 30 seconds. Actual time depends on the selected Agent and host. The
limit bounds the whole invocation, including child calls and cleanup; it is
not a latency guarantee.

Change the greeting in `flows/hello/FLOW.ts` from `Hello,` to `Welcome,`, review
again, and repeat the run. The caller's Markdown stays unchanged; the expected
message becomes `Welcome, Ada!`.

### What the recipes guarantee

One root-level, lowercase `flow` fence contains one instruction. The interpreter
fixes the target and operand meaning before reasoning. However, the Agent chooses
whether and when to activate each recipe: fence order does not force execution,
and the Agent can finish without selecting a recipe. The prose above requests
the sequence; it is not a deterministic program or proof that the child ran.
Use a code Flow when the sequence itself must be enforced.

| Operand | Value supplied to an activated recipe |
| --- | --- |
| `@input` | Original invocation input |
| `@previous` | Last successful call's complete result, or a receive's iterator result |
| `@value` | An existing whole value selected by the Agent, including a call's exact output or a received message |
| `?` | Fresh JSON authored by the Agent |
| Literal JSON | The exact value written in the recipe |

`call reviewer @value` can pass a prior call's output without reconstructing it.
`call reviewer @previous` instead passes the whole `{outcome, output}` envelope.
There is no `@previous.output` expression. A failed call clears `@previous`;
older retained values remain available through `@value`.

## Declare a domain outcome

A method can deliberately decline work. For a package that may return `blocked`,
add `FLOW.contract.json` beside `FLOW.md`:

```json
{
  "$schema": "https://flow.jig.md/schemas/invocation-contract-0.schema.json",
  "outcomes": { "blocked": "Required source material is missing." }
}
```

Its Markdown can offer this exact response:

````markdown
When the required source material is missing, return this result:

```flow
return {"outcome":"blocked","output":{"reason":"Source material is required."}}
```
````

Add input or complete-result schemas to that same contract when needed. A
forwarding caller must also declare any custom outcomes it can return. Timeout,
cancellation, uncertain execution, or failed cleanup remains an operational
failure; it cannot be converted into a successful domain response.

## Receive and send messages

For a separate relay package, declare its incoming channel endpoints in
`FLOW.contract.json`:

```json
{
  "$schema": "https://flow.jig.md/schemas/invocation-contract-0.schema.json",
  "channels": {
    "updates": { "direction": "receive" },
    "published": { "direction": "send" }
  }
}
```

Its `FLOW.md` can contain:

````markdown
Receive updates until the source ends. Forward each useful message unchanged;
select its exact message value, not the receive operation's iterator wrapper.
When finished, close both endpoints and return outcome done with null output.

```flow
receive updates
```

```flow
send published @value
```

```flow
close updates
```

```flow
close published
```

```flow
return {"outcome":"done","output":null}
```
````

This is a package example requiring a host to wire both endpoints to independently
running participants before invoking it. It is not a standalone CLI command.
Markdown/0 cannot allocate or pass endpoints, start concurrent calls, or observe
a child while awaiting that same child. A received value is data; its arrival
or the channel's end does not prove the producer succeeded. Host deadlines and
the interpreter's finite budgets bound waiting and repeated interpretation.

## Bring an existing Skill

Readable instructions and package-local text resources often transfer directly.
The current runtime does not reproduce every Skill's tools or environment.
Use the [Skill compatibility guide](./skills.md) to check declarations,
resources, and execution requirements before renaming an entrypoint.

The [Markdown specification](../spec/markdown-runtime.md) defines exact recipe
recognition, operands, lifecycle, and bounds. The host chooses providers,
permissions, and execution support; those choices are not Markdown metadata.
