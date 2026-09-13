---
title: Reuse the Agent method
---

# Reuse the Agent method

The `@jigging/agent-method` source candidate packages one bounded Agent method
for reuse as a pure TypeScript library or an ordinary Flow. It renders
instructions and selected guidance, prepares a bounded structured schema,
decodes the returned JSON presentation, checks its shape and assembles the
complete `done`, `blocked` or `limit` result.

Use the complete archive built from the source revision you reviewed; the
[package source and build instructions](https://github.com/jiggy/jig/tree/main/packages/agent-method)
describe that artifact. This source guide does not establish registry
publication. The packed Flow includes its runtime, library and FLOW SDK,
descriptors, source, declarations and licenses. Running that Flow needs no
consumer build hook or unpublished runtime dependency.

## Choose the entrypoint

| Entry | Guidance source | Use |
| --- | --- | --- |
| Native Agent Run | Explicit caller Skill contents and guidance | Use the installed native clients. |
| Ordinary Agent Flow | The same explicit contents and guidance | Select or adapt a method through ordinary Run/1. |
| Pure method library | Explicit text and structured Skill data supplied by its caller | Reuse preparation and interpretation inside an existing method. |

Both implementations offer the exact Agent Run contract. An explicit Binding
route chooses the ordinary Flow; its settings choose a model and token cap,
and its HTTP slot receives endpoint authority from the operator. Skill names
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

For Jig, extract the complete archive as a real project directory such as
`flows/agent-method`, then select it with ordinary project membership:

```ts
import { defineJig } from '@jigging/jig'

export default defineJig({ flows: ['./flows/agent-method'] })
```

An already installed real package directory can also be named explicitly if
it satisfies Jig's normal capture rules. Package-manager links are still links:
shallow discovery does not follow them, and an explicit symlink is not an
adoption exception.

Add `bindings: discover('./bindings')` to the project (import `discover` from
`@jigging/jig`) and create `bindings/agent.ts`:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/agent-method',
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

The Flow builds one non-streaming Chat Completions request and calls its exact
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

HTTP narrows the library bounds above: the complete canonical request must fit
256 KiB, the response 1 MiB, and execution the grant's timeout (at most 60 seconds)
and remaining Run deadline. Requests are rejected, not truncated. Structured
output is requested in the prompt and checked by the method; this does not claim
provider-enforced schemas or semantic correctness.

## Reuse the library

The pure library exposes preparation and finishing as separate functions:

```ts
import { prepareAgent, finishAgent } from '@jigging/agent-method'

const prepared = prepareAgent({
  instructions: 'Summarize the supplied observation.',
  guidance: [{ label: 'observation', text: 'The second measurement was lower.' }],
})
const exchange = await run.call({
  operationId: 'summarize',
  slot: 'exchange',
  input: { ...prepared.request },
})
const result = finishAgent(prepared, exchange)
```

This excerpt belongs inside an existing Run handler whose package declares
the exact Exchange dependency. `prepared.request` is ordinary data, with
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

When using Exchange with a native ACP client, a prepared prompt beginning with
`/` after leading whitespace is rejected as `INVALID_INPUT` before allocation
or dispatch: these clients interpret it as a control command. This host safeguard leaves accepted prompts
unchanged. See the [Exchange authority boundary](../spec/agent-exchange.md#host-authority-and-composition).

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
slot. Each Flow uses its own Binding; the Agent's HTTP grant remains separate
from the specialist's authority. Two direct Agent siblings fit the root budget.
A specialist → Agent branch uses both child levels and reserves enough capacity
to exclude a concurrent second branch. Existing aggregate resources and the
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

Configure its Binding with `slots: { agent: 'binding:agent' }`, where the
`agent` Binding selects the ordinary method and its HTTP grant as shown above.
An application's Binding can then select that specialist with
`slots: { specialist: 'binding:specialist' }`. Each call returns the method's
ordinary outcome and output; a failed descendant call throws through `run.call`
and may be handled with normal `try/catch` after cleanup.

The shared contract declares optional Agent updates, but this text-only HTTP
implementation does not support them. A requested channel fails before HTTP
dispatch. Native clients remain available for callers requiring ACP updates.

Markdown uses the same contract: its Binding can select
`slots: { 'markdown-agent': 'binding:agent' }`. The interpreter checks each
structured decision before activating an exact authored recipe.

Other finite Run/1 hosts can supply the same exact HTTP Request interface under
their own authority. Library reuse, unchanged Flow consumption,
and Agent answer quality require separate evidence.
