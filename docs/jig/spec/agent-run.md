# Jig Agent Run capability

**Status:** experimental alpha candidate.

Agent Run is one exact FLOW Capability Contract consumed through Run/1
`effect/call`. It does not add an Agent API to `@jigging/flow`, a provider
configuration field to Bindings, or a semantic router to Jig.

The canonical descriptor is
[`agent-run.capability.json`](https://jig.md/contracts/agent-run.capability.json):

```text
id       https://jig.md/contracts/agent-run
version  1.0.0
digest   sha256:5a0f06495323419d275eeff92617d9287647ece137dacc9c5c6d50466d65c0f0
method   run
```

An Agent-using Flow vendors those exact descriptor bytes inside its own
package and refers to the package-local copy from `FLOW.md`:

```yaml
---
name: ticket-router
description: Select and run one exact ticket handler.
uses:
  agent:
    contract: ./contracts/agent-run.capability.json
---
```

The slot name `agent` is local to this package. The alpha accepts at most one
capability use per package, and it must be this exact descriptor. Jig resolves
and admits its identity offline; the contract URI is not fetched at runtime.

## Calling the Agent

The contract has one method, `run`. Its input is:

```ts
{
  instructions: string;
  skills?: readonly string[];
  responseSchema?: JsonObject;
}
```

Its result is:

```ts
{
  outcome: "completed" | "blocked" | "limit";
  text: string;
  structured?: JsonValue;
}
```

On the Run/1 wire, a successful effect response is
`{ "value": <Agent result> }`. `@jigging/flow` unwraps that envelope, so
`run.callEffect()` resolves directly to the Agent result. A completed call
which requested `responseSchema` includes `structured`, and Jig validates that
value against the supplied FLOW Schema/1 schema before returning it.

The first provider accepts a deliberately small structured-output subset: one
closed object with 1–32 required properties, each a nonempty enum of strings.
Use an unstructured call for other result shapes. Unsupported schemas fail
before provider dispatch rather than being translated approximately.

`operationId` has the ordinary Run/1 meaning: use one stable identity for one
logical call. Reusing it with changed slot, method, or input conflicts. Work
which may have been dispatched is fenced and reported honestly; Jig does not
silently send it again. Cancellation fences Jig's local provider worker, but
cannot retract a request which the remote provider has already accepted.

## Package-local skills

Each selected skill is an immediate package-local directory:

```text
skills/<name>/SKILL.md
skills/<name>/...optional supporting files...
```

`skills` contains unique LocalNames in ascending byte order. Jig projects only
the selected subtrees as fresh read-only guidance for that one Agent call. All
projected files must be UTF-8 text. Selection is limited to 64 skills, 1,024
files, and 1 MiB of file content; the complete rendered provider input also
has a 1 MiB bound. Omitting `skills`, or passing `[]`, selects none. A skill
grants no Flow, filesystem, network, tool, or host authority, and unselected
package files are not projected.

`SKILL.md` and its supporting files are plain UTF-8 guidance. Jig does not
require frontmatter or define another skill metadata grammar.

## Exact ticket router

This Flow asks the Agent for one value from a closed enum, then calls the
matching exact Binding-local child slot:

```ts
import { handle, type JsonValue } from "@jigging/flow";

type AgentResult = {
  readonly outcome: "completed" | "blocked" | "limit";
  readonly text: string;
  readonly structured?: { readonly route: "billing" | "technical" };
};

const routeSchema = {
  $schema: "https://flow.jig.md/schemas/schema-1.json",
  type: "object",
  properties: {
    route: { enum: ["billing", "technical"] },
  },
  required: ["route"],
  additionalProperties: false,
} as const;

await handle(async (run) => {
  const agent = await run.callEffect({
    operationId: "choose-route",
    slot: "agent",
    method: "run",
    input: {
      instructions:
        `Choose billing or technical for this ticket: ${JSON.stringify(run.input)}`,
      skills: ["ticket-routing"],
      responseSchema: routeSchema,
    },
  }) as AgentResult;

  if (agent.outcome !== "completed" || agent.structured === undefined) {
    return {
      outcome: "done",
      output: { routed: false, agent } as JsonValue,
    };
  }

  const child = await run.callFlow({
    operationId: "dispatch-route",
    slot: agent.structured.route,
    input: run.input,
  });

  return {
    outcome: "done",
    output: { routed: true, agent, child } as JsonValue,
  };
});
```

The corresponding Binding fixes the only two children the Flow can call:

```ts
import { defineBinding } from "@jigging/jig";

export default defineBinding({
  package: "./flows/ticket-router",
  slots: {
    billing: "./flows/billing",
    technical: "./flows/technical",
  },
});
```

The model returns data, not authority. The response schema limits its answer
to `billing` or `technical`, and Jig resolves that name only through the
Binding's exact same-generation slots. The two children must be ordinary
capability-free direct Flow targets in this one-level alpha.

Exactly one child is a property of this example's completed path, not a new
host rule. A blocked or limited Agent result reaches no child, and another
Flow may make additional sequential calls within its admitted slots.

## The one alpha provider

The current Jig host supplies one concrete provider:

```text
API shape  OpenAI Responses API
endpoint   https://openrouter.ai/api/v1
model      google/gemini-3.5-flash-lite
secret     OPENROUTER_API_KEY
```

Export `OPENROUTER_API_KEY` in the environment which runs both `jig check` and
`jig run`. The key is host configuration: it does not enter `FLOW.md`, a
Binding, `jig.lock`, the Plan, retained Run state, or the Flow process.

The Flow remains inside its ordinary network-isolated, keyless sandbox. The
trusted host reads the key, then runs the fixed provider worker in a separate
bounded sandbox; among workload processes, only that worker receives network
and the key. Instructions and selected skill contents are sent to OpenRouter
and its selected Google model. The worker has ordinary inherited network
access rather than endpoint-filtered egress; its exact trusted bytes, not a
network-policy framework, limit what it does. It requests one response with
`store: false` and exposes no model tools, but that flag is not a promise about
every third-party retention or training policy. The provider and selected
model are not author choices in this alpha.

If the key or exact provider support is absent, checking a project containing
an Agent-bearing target reports it unavailable. A capability-free target in
an already admitted generation remains runnable because its recipe does not
depend on the Agent provider.

Root `jig run --timeout DURATION` bounds the complete sequence, including the
Agent call and any selected child. The default is 30 seconds and the maximum
is 24 hours; neither the provider nor a child can extend the root's absolute
deadline.

This is deliberately one contract and one provider. There is no provider
registry or SPI, provider profile, model selector, semantic catalogue,
`SemanticChoice`, Agent session, tool runner, Agent-authored Flow identity, or
general routing framework.
