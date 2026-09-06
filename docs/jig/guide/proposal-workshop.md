---
title: A proposal workshop
---

# A proposal workshop

Turn supplied evidence into a proposal with source links, a separate review,
and a fixed opportunity to revise. The
[example source](https://github.com/jiggy/jig/tree/main/examples/proposal-workshop)
contains three Flow packages: a workshop, a drafter, and an evidence reviewer.

This authored example demonstrates composition, not a claim that multiple
Agents outperform one.

## How it works

The workshop gives the drafter an objective, identified requirements, and
identified evidence records. It checks that the draft covers every requirement
exactly once and cites only supplied evidence IDs. A draft that passes those
checks goes to the reviewer in a fresh Agent call. Mechanical or review
feedback can request one revision; a second unapproved draft ends with `limit`.

Review concerns material evidence defects and unmet requirements, not optional
presentation improvements. A useful conditional proposal can name approvals
that must be obtained before launch. Approving that draft does not authorize
launching, purchasing, or spending.

![The drafter uses supplied evidence, mechanical checks verify coverage and source IDs, and a separate reviewer checks the claims. Approval produces a proposal. Mechanical or review feedback can return to drafting for one revision.](./proposal-workshop.svg)

The revision loop is bounded: a second unapproved draft ends with `limit`.
A specialist may also stop with `blocked` or `limit`; execution failures are
not sent back through the drafting loop.

The workshop's Binding fixes its collaborators:

```ts
export default defineBinding({
  package: "flows/workshop",
  slots: {
    drafter: "flow:flows/drafter",
    reviewer: "binding:reviewer",
  },
});
```

The reviewer Binding supplies its own `reviewFocus` setting. Each specialist
selects its own package-local Skill for its Agent call. Neither receives the
parent's settings or acquires permission to choose a provider. Calls run
sequentially within the parent's deadline; cancellation covers the owned
specialist and Agent work. The [child-call policy](../spec/project-policy.md)
and [Agent Run contract](../spec/agent-run.md) define those host guarantees.

## Run the example

Follow the [Jig installation instructions](./index.md).
Configure an Agent in the operator environment using the
[Agent host instructions](../spec/agent-run.md#alpha-host-implementations).
Keep that configuration available for both review and execution. The example
does not select a model or supply credentials.

From the repository root, copy the example to a new directory, review its
packages and settings, and run the workshop:

```sh
cp -R examples/proposal-workshop ../my-proposal-workshop
cd ../my-proposal-workshop
jig review
jig run binding:workshop --input @fixtures/library-pilot.json --timeout 5m
```

Interactive review asks for approval. For noninteractive use, inspect the
review first and use `jig review --yes` only with explicit approval.

Each Flow already includes a `package.json` and a Bun 1.3.3-generated text
`bun.lock` for the published `@jigging/flow@0.1.0-alpha.3` SDK. No new FLOW SDK
API is needed. Jig prepares those exact dependencies during review; keep
`node_modules` out of the Flow trees. See the
[dependency guidance](./index.md) if you change the packages.

The fixture asks for an eight-week pilot of later library hours. Its demand,
staffing, and planning records are explicitly synthetic. Their source URLs
are display links; the Flows do not fetch them.

## Read and adapt the result

Inspect `outcome` even when the command reports a successfully completed Run:

- `done`: mechanical checks passed and the reviewer approved the proposal.
  `output.markdown` contains the proposal with links to the supplied sources.
- `blocked`: a specialist stopped or the reviewer identified an evidence gap
  that prevented approval.
- `limit`: a specialist reached its limit or the one revision was insufficient.

`output.proposal`, `output.review`, and `output.history` retain the available
draft, review, and feedback. An unapproved result has no final Markdown.
Execution errors, cancellation, and uncertain dispatch remain failures; the
workshop does not automatically replay them.

Replace the fixture's objective, requirements, and evidence to try another
proposal. Change `bindings/reviewer.ts` to configure a different review focus,
then review the changed project before running it. The reviewer is a separate
leaf Flow with an ordinary input and result, so another application can reuse
it without importing the workshop's code.

The deterministic checks establish completeness and reference integrity.
They do not establish that a cited source supports a claim, and an approving
Agent review can still be wrong. Evaluate the proposal before acting on it.
The application tests can be run without an Agent from the repository root:

```sh
bun test examples/proposal-workshop/test
```
