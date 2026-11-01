---
title: Reuse the Agent method
---

<!-- Generated from docs/jig/guide/agent-method.md. Edit the source, then run just sync-skills. -->


# Reuse the Agent method

Ask your project's Agent for one answer.
Call the same method from a Flow.
The operator chooses the Agent, credentials, and permissions. Your caller
supplies the task.

## Before you start

Use a project with an approved `binding:agent`. Follow [Agent setup](agents.md)
if you need to configure it.

## Invoke the ordinary Flow

From the project root:

```sh
jig run binding:agent --input '{"instructions":"Explain a useful way to check an assumption."}'
```

Read execution status first, then the method's outcome:

| Outcome | Meaning |
| --- | --- |
| `done` | An answer is available in `output.text`. Check whether it is useful and correct. |
| `blocked` | The Agent could not provide the requested answer. Read its explanation. |
| `limit` | The method reached its limit. Inspect the returned text before choosing further work. |

A successful command does not prove a correct answer. Operational failures
remain execution errors. Nothing is retried automatically.
[Results and recovery](results.md) explains host status, delivery, and cleanup.

## Call the Agent from your own Flow

Create a caller using the installed Agent Run agreement:

```sh
jig new specialist --use agent=jig:agent-run
```

This copies the contract and declares the caller's `agent` slot. It does not
select an Agent or grant permissions. If `jig.ts` uses explicit membership, add
`flows/specialist` to its `flows` list.

Replace `flows/specialist/FLOW.ts`:

```ts
import { handle } from '@jigging/flow'

await handle(run => {
  if (typeof run.input !== 'string') throw new TypeError('Supply a string.')
  return run.call({
    operationId: 'answer',
    slot: 'agent',
    input: { instructions: run.input },
  })
})
```

The project's configured Agent route supplies the implementation for this slot.
The caller receives the method's ordinary outcome and output. Review the caller
before running it:

```sh
jig review --allow-resolution-network
jig run flow:flows/specialist --input '"Explain a useful way to check an assumption."'
```

The starter's SDK dependency may need fresh resolution when its lock is missing.
That permission can contact dependency-selected destinations before approval.
Read
[dependency preparation](dependencies.md#fresh-resolution-and-network-access)
before granting it. Inspect the source and proposed authority before approving
execution.

Expect the same outcome and output shape as the direct invocation. The answer's
wording can differ. Try another question without changing the source. Review
again if you change the caller or its Agent selection.

Your application owns factual checks and decisions based on the answer.

## Diagnose a failed request

| Observation | Action |
| --- | --- |
| Selected native client fails review | Follow [client-check recovery](agents.md#repair-a-client-check). |
| HTTP 401 or 403 | Check the operator credential and account permissions for the reviewed grant. Keep credentials in the operator environment. |
| HTTP 422 | Check the Binding's model, API format, output mode, and token settings. |
| HTTP 404 | Check endpoint and model availability. Either may explain the status. The exact cause can remain unknown. |
| HTTP 5xx | Check provider availability. The response does not prove whether remote work occurred. No automatic retry occurs. |
| `blocked` or `limit` | Read the method's output before choosing another action. |
| Transport, execution, or cleanup is uncertain | Preserve evidence. Follow [Results and recovery](results.md). Do not automatically replay work. |

Use the operation path to identify the selected method and Binding. HTTP errors
retain `phase`, `api`, `status`, `category`, and `retry: "not-attempted"` in
`details`. An optional `parameter` names only a recognized API field reported by
the provider. Errors do not print provider bodies or invent a cause.

An HTTP response proves the endpoint responded, not that remote effects were
undone or safe to repeat. Review changed settings or grants before new work. The
method never switches providers automatically.

## Input reference

Supply instructions, with optional context or a result schema:

```ts
{
  instructions: string;
  guidance?: readonly { label: string; text: string }[];
  responseSchema?: JsonObject;
  skills?: readonly { name: string; files: readonly { path: string; text: string }[] }[];
}
```

`guidance` preserves order and needs unique nonempty labels. Each selected Skill
includes its complete UTF-8 files and exact-case `SKILL.md`. Omission supplies
no Skills. Skill names and guidance labels use separate namespaces.

The public `readPackageSkills` helper reads explicit trees from the caller's own
captured package. Supplied labels, paths, and text describe context. They do not
authenticate its origin or grant powers. Selected Skills and files use canonical
sorting.

Duplicates and invalid UTF-8 reject.

### Request a structured answer

Set `responseSchema` when the application needs a checked shape. Keep a small
one-call schema inline or beside its call. Use an ordinary adjacent descriptive
file for a substantial or reused schema, such as
`charge-assessment.schema.json`. The Agent reply schema and the Flow's complete
result contract serve different purposes.

No schemas directory or `FLOW.response.json` declaration is required. Dynamic
values, such as an enum of eligible routes, remain ordinary code. A schema
import does not authorize a cross-Flow dependency.

Retain the explicit dialect and
[supported schema profile](../spec/agent-run.md#structured-output-profile). A
`done` structured answer includes locally validated `output.structured`.
Application code still checks its truth and meaning. For a replacement Agent
implementation, use `checkAgentResult(result, responseSchema)` to check the
complete result independently.

It permits honest `blocked` and `limit` results and throws on malformed results.

Optional [managed response generation](contracts.md#one-model-related-outputs)
helps interfaces that actually share constraints. Keep distinct shapes separate
when their constraints differ. Change generated files through their source
declaration and explicit regeneration. Placement advice does not permit removing
or moving tool-owned outputs.

## Choose the entrypoint

The ordinary HTTP and native ACP packages provide the same Agent Run interface.

| Implementation | Use |
| --- | --- |
| Ordinary HTTP Flow | Call a reviewed Chat Completions or Responses endpoint. |
| Ordinary ACP Flow | Use a reviewed native client. |
| Pure TypeScript library | Prepare requests and check responses with your own transport. |

The operator approves which endpoint or native client the method can use. Each
caller uses its own reviewed route. Parent settings and permissions are not
inherited. Optional events, conversations, and sessions need corresponding
`requires` declarations when the complete caller needs them.

The HTTP package supports none of those optional features. ACP declares all
three. Package claims, host support, reviewed grants, and actual completion
remain distinct. See
[required Agent behavior](../spec/agent-run.md#declare-required-agent-behavior).

### HTTP outcomes

The HTTP Flow sends one non-streaming Chat Completions request by default
through its exact `http` slot. Jig holds credentials and network access. The
method interprets status, answer text, and stop reason. A refusal returns
`blocked`.

Token exhaustion returns `limit`. Tool requests, malformed responses, and
non-200 statuses fail execution. The CLI reports host execution status
separately from the method's outcome.

### Use an OpenAI-compatible gateway

The same Flow can call an OpenAI-compatible gateway by changing its model,
endpoint URL, and operator credential. For example, OpenRouter documents a Chat
Completions endpoint and a dynamic free-model route:

```ts
settings: { model: 'openrouter/free', maxCompletionTokens: 4096 },
slots: {
  http: {
    kind: 'http', method: 'POST',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    bearerEnv: 'OPENROUTER_API_KEY',
  },
},
```

See [OpenRouter's API instructions](https://openrouter.ai/openrouter/free/apps)
and [route details](https://openrouter.ai/openrouter/free). The route selects
from the provider's currently available free models. Availability, data policy,
and model quality are provider-controlled and may change. This is a development
configuration, not a stable model choice or a quality guarantee.

`maxCompletionTokens` defaults to 4096, within 1–65536. Model and token settings
guide the admitted method. To enforce them against malicious method code, add
matching constraints in the HTTP grant's `bodySchema`. The endpoint still owns
its billing and data policy.

See [HTTP Request](../spec/http-request.md).

Set `api: 'responses'` in the Binding settings and grant the exact
`/v1/responses` endpoint to use Responses instead.
`structuredOutput: 'json-schema'` requests the selected API's strict schema
format. The default `'prompt'` requests the shape in instructions. Both modes
validate returned data locally and fail on unsupported responses.

Neither establishes semantic correctness.

HTTP grants default to a 256 KiB request and 1 MiB response. For larger explicit
context or answers, change the reviewed HTTP slot. Set `requestBytes` up to 8
MiB. Set `responseBytes` up to 12 MiB.

The method requests `response: 'json'`, so a structured API response is passed
as data rather than wrapped in another JSON string. The shared 1 MiB
rendered-prompt and 8 MiB text limits still apply.

JSON/0's complete-value bounds, the grant's timeout (at most 60 seconds), and
the Run deadline also apply. Requests are rejected, not truncated.

## Reuse the library

Import the pure functions from `@jigging/agent-method`:

| Function | Responsibility |
| --- | --- |
| `prepareAgent` | Render instructions and explicit guidance into bounded request data. |
| `finishAgent` | Decode an interpreted response and assemble `done`, `blocked`, or `limit`. |
| `checkAgentResult` | Check an implementation's complete result, including structured output when requested. |

`prepareAgent` and `finishAgent` perform no provider call or file read. Your
transport supplies bounded text and an interpreted stop reason.
`prepared.request` contains ordinary `prompt` data and an optional
`responseSchema`. It grants no execution rights.

The optional second preparation argument accepts `SkillText` values shaped as
`{ name, files: [{ path, text }] }`. The separate `@jigging/agent-method/skills`
export provides `readPackageSkills(packageRoot: URL, names)`. It reads explicit
local Skill trees without acquiring other packages or authenticating caller
identity. Use the
[package README](https://github.com/jiggy/jig/tree/main/packages/agent-method)
for exact APIs, argument types, and source build/pack instructions.

The published Flow contains its runtime and needs no consumer build hook or
unpublished runtime dependency. For source development, use
[ordinary workspaces](dependencies.md#local-workspace-packages). Keep source and
rebuilt runtime together. Do not edit generated files.

## Composition and observations

A project's default Agent route can serve code and Markdown callers. A Binding
can explicitly select another matching implementation. Child calls share the
root deadline and aggregate budget. A failed descendant call throws through
`run.call`.

Ordinary `try/catch` can handle conclusively cleaned failures. See
[composition policy](../spec/project-policy.md#8-direct-run) for exact branch
limits and cleanup requirements.

HTTP does not support optional update channels. A requested channel fails before
dispatch. Use ACP when the caller requires public native updates. Markdown may
select `slots: { 'markdown-agent': 'binding:agent' }` and validates structured
decisions before activating authored recipes.

Finite ACP rejects instructions beginning with `/` after whitespace before
native dispatch because clients interpret them as controls. See the
[finite authority profile](../spec/finite-acp.md#finite-acp-authority-profile).

Other Run/0 hosts can supply the same exact HTTP Request interface under their
own authority. Library reuse, Flow consumption, and answer quality need separate
evidence. [Agent Run](../spec/agent-run.md) owns the exact interface and all
input limits.
