# Run a Markdown method

A Flow can be one `FLOW.md` file. Jig runs it through its installed interpreter:
no SDK import, package manifest or dependency installation is needed.

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

Then review and run it:

```sh
jig review
jig run flow:flows/hello
```

This blocks-only method executes its recipes in order without an Agent. Its
result has `outcome: "done"` and `output: "Hello!"`. `return @input` can instead
return a caller-supplied complete result; `return @previous` forwards the exact
result of an earlier `call`. Neither asks a model to reconstruct the value.

## Use prose and existing Skills

Prose makes execution interpreted: your [operator-configured Agent](agents.md)
chooses the next step, while the runtime enforces exact recipes and bounds.
Review shows the derived `markdown-agent` route before approval.

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
outcomes, channels and attachments belong only in optional `contract.json`.
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

The first Markdown profile is sequential. It can `call`, `send`, `receive`,
`close` and `return` using exact original recipes and granted channels. It
does not create channels, run arbitrary scripts or control a live Agent session.
Resource text and model output cannot add recipes. Cancellation and limits
still stop owned work; a model's plausible answer cannot override an operational
failure. See the [Markdown execution contract](https://flow.jig.md/spec/markdown-runtime)
for operands, CommonMark recognition and exact bounds.
