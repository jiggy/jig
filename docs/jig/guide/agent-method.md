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
| Native Agent Run | Authenticated selected Skills from the active caller's admitted package | Keep caller-context integration in Jig. |
| Ordinary Agent Flow | Its own package's explicitly selected Skills, plus plain caller guidance | Invoke or adapt the complete method through ordinary Run/1. |
| Pure method library | Explicit text and structured Skill data supplied by its caller | Reuse preparation and interpretation inside an existing method. |

Jig's native Agent Run imports the same pinned method implementation, while
retaining its caller authentication, dynamic result checks and host lifecycle.
The ordinary Flow is anonymous: it has no named Agent Run identity or inherited
caller source. Its settings choose a model and token cap; its HTTP slot receives
endpoint authority from the operator. Installing or invoking it does not establish
native caller-context equivalence.

## Invoke the ordinary Flow

Its input is:

```ts
{
  instructions: string;
  guidance?: readonly { label: string; text: string }[];
  responseSchema?: JsonObject;
  methodSkills?: readonly string[];
}
```

`methodSkills` selects immediate `skills/<name>/` directories in this method
package, each containing `SKILL.md`. Omission selects none. Add and review
package-owned Skills when adapting the method; do not copy a caller's selected
file paths into this field. Plain `guidance` preserves the supplied order and
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
adoption exception. No Binding is needed solely to select `methodSkills`.

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
The supplied ordinary entrypoint passes its own literal package URL.
This reader does not authenticate a Jig caller or acquire another package's
source. Its exact API and build instructions live in the package README.

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

A Jig root can call this Flow as an exact ordinary child, and the child can
use HTTP within its reserved effect capacity. Two such siblings fit the
existing two-worker topology. A leaf specialist that already occupies a child
position uses the library in-process; it cannot insert another ordinary Flow
level. Existing aggregate resources and the remaining root deadline apply.

This text-only HTTP method declares no channels. It does not expose streaming
or ACP updates and is not a replacement for native Agent callers that require
them. Native Agent Run remains available separately.

Other finite Run/1 hosts can supply the same exact HTTP Request interface under
their own authority. Library reuse, unchanged Flow consumption,
native caller-Skill support and Agent answer quality require separate evidence.
