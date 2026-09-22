# Run a Markdown method

A Flow can be one `FLOW.md` file. Jig runs it through its installed interpreter:
an operator-configured [Agent](agents.md) interprets its body, while the runtime
enforces exact recipes, permissions and limits. No SDK import, package manifest
or dependency installation is needed for the method.

Create a project with [Jig installed](index.md):

```sh
jig init --bare notes
cd notes
mkdir -p flows/hello
```

Save this as `flows/hello/FLOW.md`:

````md
```flow
return {"outcome":"done","output":"Hello!"}
```
````

Configure an [Agent](agents.md), then review and run it:

```sh
jig review
jig run flow:flows/hello
```

The Agent decides when to activate the recipe. Selecting it returns
`outcome: "done"` and `output: "Hello!"` exactly. Recipe-only bodies and prose
use the same interpreter; fence order does not enforce execution order.
Use `FLOW.ts` for deterministic sequencing or execution without an Agent.

## Use prose and existing Skills

Review shows the derived `markdown-agent` route before approval.
To select an ordinary [Agent Flow](agent-method.md), configure the Markdown
Binding with `slots: { 'markdown-agent': 'binding:agent' }`. Its Agent contract
must match exactly; the interpreter independently validates each decision.

For example, `flows/summary/FLOW.md` can contain:

```md
---
name: concise-summary
description: Summarize the supplied text without adding claims.
allowed-tools: ""
---
Summarize the invocation input in one sentence.
Return outcome done with the summary as output.
```

A supported `SKILL.md` can be renamed to `FLOW.md` without rewriting its body.
That is authoring compatibility, not a promise to reproduce another harness's
tools or model behavior. Unknown execution metadata and unsupported tool
restrictions fail qualification visibly. `allowed-tools: ""` disables resource
reads and effect recipes; it does not disable the interpreter's reasoning call
or its duty to settle execution.

Optional name and description stay in Markdown frontmatter. Invocation schemas,
outcomes, channels and attachments belong only in optional `FLOW.contract.json`.
A package has exactly one `FLOW.<ext>`: use `README.md` for commentary beside a
code implementation, not a second Markdown entrypoint.

## Combine it with another method

Declare a dependency in frontmatter and embed a single exact recipe:

````md
---
uses:
  review: {}
---
Ask the review specialist to examine the invocation input, then explain its result.

```flow
call review @input
```
````

A [Binding](../spec/project-sdk.md#binding-declaration) supplies the exact
`review` Flow or Binding. The interpreter chooses when to activate the authored
recipe; it cannot change its target or static input. A named contract can make
that dependency substitutable without changing the consumer. Native Agent,
command and checkpoint invocations use the same calling boundary but retain
their separate host permissions.

`return @previous` forwards an earlier successful call's complete result;
`@value` lets the Agent select a retained whole value without reconstructing it.
Those guarantees preserve data, not the quality of the Agent's choice or its
adherence to a multi-step procedure. An unsuccessful interpretation remains
an unsuccessful Run.

The first Markdown profile is sequential. It can `call`, `send`, `receive`,
`close` and `return` using exact original recipes and granted channels. It
does not create channels, run arbitrary scripts or control a live Agent session.
Resource text and model output cannot add recipes. Cancellation and limits
still stop owned work; a model's plausible answer cannot override an operational
failure. See the [Markdown execution contract](https://flow.jig.md/spec/markdown-runtime)
for operands, CommonMark recognition and exact bounds.
