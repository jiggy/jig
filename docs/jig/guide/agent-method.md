---
title: Reuse the Agent method
---

# Reuse the Agent method

The `@jigging/agent-method` source candidate packages one bounded Agent method
for reuse as a pure TypeScript library or an ordinary Flow. It renders
instructions and selected guidance, prepares a bounded structured schema,
decodes the returned JSON presentation, checks its shape and assembles the
complete `done`, `blocked` or `limit` result.

Use the complete package built from the source revision you reviewed; the
[package source and build instructions](https://github.com/jiggy/jig/tree/main/packages/agent-method)
describe that artifact. This source guide does not establish registry
publication. The packed Flow includes its runtime, library and FLOW SDK,
descriptors, source, declarations and licenses. Running that Flow needs no
consumer build hook or unpublished runtime dependency.

## Choose the entrypoint

| Entry | Guidance source | Use |
| --- | --- | --- |
| HTTP Agent Flow | Explicit caller Skill contents and guidance | Call a reviewed Chat Completions or Responses endpoint. |
| ACP Agent Flow | The same explicit contents and guidance | Drive a reviewed native client through the finite resource. |
| Pure method library | Explicit text and structured Skill data supplied by its caller | Reuse preparation and interpretation inside an existing method. |

Both implementations offer the exact Agent Run contract. A project default or
explicit Binding route chooses the ordinary Flow. The HTTP method's settings
choose a model and token cap; its HTTP slot receives endpoint authority from
the operator. The ACP method follows the configuration of its native grant. Skill names
and paths describe supplied data, not host-attested provenance. Consumers check
structured results independently of the selected implementation.

## Invoke the ordinary Flow

Its input is:

```ts
{
  instructions: string;
  guidance?: readonly { label: string; text: string }[];
  responseSchema?: JsonObject;
  skills?: readonly { name: string; files: readonly { path: string; text: string }[] }[];
}
```

`skills` carries complete selected UTF-8 contents, including `SKILL.md` for
each Skill. Omission supplies none. The public `readPackageSkills` reader can
load explicit trees from the caller's own captured package. Plain `guidance` preserves the supplied order and
requires unique nonempty labels. A label describes text, not provenance,
permission or a Skill manifest. Selected Skills and guidance labels occupy
separate namespaces.

Together, Skills and guidance are bounded to 64 groups and 1,024 files/text items;
their UTF-8 content plus instructions is bounded to 1 MiB. Selected Skills and files are sorted canonically;
duplicates and invalid UTF-8 reject. The final rendered prompt, including
instructions and schema guidance, has its own 1 MiB bound.
Structured schemas use the [bounded profile](../spec/agent-run.md#structured-output-profile)
and at most 256 KiB of canonical JSON/1.

For Jig, declare `@jigging/agent-method` in the project's `package.json`
dependencies. Use `workspace:*` for source in your Bun workspace or a selected
published version with its Bun lock. Configure its ordinary Binding:

```ts
import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  flows: discover('./flows'),
  bindings: discover('./bindings'),
  defaultProviders: { 'https://jig.md/contracts/agent-run': 'binding:agent' },
})
```

The `npm:` selector uses declared dependency preparation, not traversal of the
live installation tree. With one eligible configured provider the project
mapping is optional. It remains useful for an explicit choice among providers.

Create `bindings/agent.ts`:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'npm:@jigging/agent-method',
  settings: { model: 'your-model', maxCompletionTokens: 4096 },
  slots: {
    http: {
      kind: 'http', method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      bearerEnv: 'OPENAI_API_KEY',
    },
  },
})
```

Choose a model supported by the endpoint and supply the named credential in the
operator environment. No native Agent configuration is needed. Review the exact
[grant](../spec/grants.md), then invoke the Binding:

```sh
jig review
jig run binding:agent --input '{"instructions":"Explain a useful way to check an assumption."}'
```

The Flow builds one non-streaming Chat Completions request by default and calls its exact
`http` slot. Jig holds the credential and network access; the package interprets
the HTTP status, response text and stop reason. The method returns the complete
`{ outcome: 'done' | 'blocked' | 'limit', output: { text, structured? } }`.
A successful structured method result contains the validated `structured`
value. Operational errors remain execution errors. The installed Jig command
wraps this invocation result in its ordinary Run terminal, which also reports
host execution status. Tool requests, malformed data and non-200 HTTP statuses
remain failures. Nothing is retried automatically. A refused answer is `blocked`;
token exhaustion is `limit`.

`maxCompletionTokens` defaults to 4096, within 1–65536. Model and token settings
guide the admitted method. To enforce them against malicious method code, add
matching constraints in the HTTP grant's `bodySchema`. The endpoint still owns
its billing and data policy. See [HTTP Request](../spec/http-request.md).

Set `api: 'responses'` in the Binding settings and grant the exact `/v1/responses`
endpoint to use Responses instead. `structuredOutput: 'json-schema'` requests
the selected API's strict schema format; the default `'prompt'` requests the
shape in instructions. Both modes validate returned data locally and fail on
unsupported responses. Neither establishes semantic correctness.

HTTP grants default to a 256 KiB request and 1 MiB response. For larger explicit
context or answers, set `requestBytes` up to 8 MiB and `responseBytes` up to 12 MiB
in the reviewed HTTP slot. The method requests `response: 'json'`, so a structured
API response is passed as data rather than wrapped in another JSON string.
The shared 1 MiB rendered-prompt and 8 MiB text limits still apply, as do JSON/1's
complete-value bounds, the grant's timeout (at most 60 seconds), and the Run
deadline. Requests are rejected, not truncated.

## Reuse the library

The pure library exposes preparation and finishing as separate functions:

```ts
import { prepareAgent, finishAgent } from '@jigging/agent-method'

const prepared = prepareAgent({
  instructions: 'Summarize the supplied observation.',
  guidance: [{ label: 'observation', text: 'The second measurement was lower.' }],
})
// Your transport supplies bounded text and an interpreted stop reason.
const response = await yourTransport(prepared.request)
const result = finishAgent(prepared, response)
```

`yourTransport` stands for the implementation's own transport code, not a Jig
API or an implicit service. The HTTP and ACP packages provide concrete examples
using ordinary granted slots. `prepared.request` is ordinary data, with
`prompt` and optional `responseSchema`; it grants no execution rights.
Neither pure function performs a provider call or reads files. The optional
second preparation argument uses `SkillText` values shaped as
`{ name, files: [{ path, text }] }`.

The separate `@jigging/agent-method/skills` export provides
`readPackageSkills(packageRoot: URL, names)` for explicit bounded reads.
The caller supplies its own literal package URL.
This reader does not authenticate a Jig caller or acquire another package's
source. Its exact API and build instructions live in the package README.

Consumers of an Agent implementation can validate its result independently:

```ts
import { checkAgentResult } from '@jigging/agent-method'

const result = checkAgentResult(await run.call({
  operationId: 'answer', slot: 'agent',
  input: { instructions: 'Answer the question.', responseSchema },
}), responseSchema)
```

This pure check requires matching `structured` data for `done`, permits an
honest blocked or limited answer, and throws on malformed results. Application
checks still decide whether a schema-valid answer is useful or true.

The finite ACP resource rejects prompts beginning with `/` after whitespace
before native dispatch: these clients interpret them as control commands.
See the [finite authority profile](../spec/finite-acp.md#finite-acp-authority-profile).

Use [ordinary workspace dependencies](dependencies.md#local-workspace-packages)
for development in the source workspace. To adapt the shared method, edit its
source, build and test it, then pack the complete artifact using its documented
package recipe. Extract that archive into a fresh Flow directory for Jig review
and adoption. The package excludes development `node_modules` and `bun.lock`;
the development lock's local `file:` SDK dependency is not a supported Jig
runtime-preparation input. The packed runtime needs no such preparation.
Keep source and rebuilt runtime together; do not hand-edit generated files.

## Composition and observations

A Jig root can call this Flow directly or through a specialist's ordinary
slot. Each Flow uses its own admitted routes; the Agent's HTTP grant remains separate
from the specialist's authority. Two direct Agent siblings fit the root budget.
A specialist → Agent branch uses two child levels. Two such branches fit the
fixed aggregate reservation; a third sibling is rejected rather than queued.
Deeper methods are allowed when their complete branch fits the same budget;
they do not receive additional resources. Aggregate resources and the
remaining root deadline apply. See [project policy](../spec/project-policy.md).

For a specialist accepting a text input, the existing SDK call is sufficient:

```ts
import { handle } from '@jigging/flow'

await handle(run => run.call({
  operationId: 'answer',
  slot: 'agent',
  input: { instructions: `Classify this request: ${run.input}` },
}))
```

Declare the exact Agent Run requirement in its metadata. The project default
above resolves it without a specialist Binding. An application's Binding can
select `slots: { specialist: 'flow:flows/specialist' }`. An explicit specialist
Binding may instead set `slots: { agent: 'binding:another-agent' }`.
Each call returns the method's
ordinary outcome and output; a failed descendant call throws through `run.call`
and may be handled with normal `try/catch` after cleanup.

The shared contract declares optional Agent updates, but this text-only HTTP
implementation does not support them. A requested channel fails before HTTP
dispatch. Select the ordinary ACP package for callers requiring ACP updates.

Markdown uses the same project default, or an explicit Binding can select
`slots: { 'markdown-agent': 'binding:agent' }`. The interpreter checks each
structured decision before activating an exact authored recipe.

Other finite Run/1 hosts can supply the same exact HTTP Request interface under
their own authority. Library reuse, unchanged Flow consumption,
and Agent answer quality require separate evidence.
