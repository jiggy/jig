# Use a service without handing over its credential

A Flow may need a private document, a notification endpoint, or a model API.
Give its invocation slot an HTTP grant: the method builds and interprets requests,
while Jig keeps the credential and limits where those requests can go.

This guide describes the HTTP-enabled source candidate, not a published release.
Use Jig and FLOW SDK artifacts from that same candidate.

## Fetch a reference document

Put an exact copy of the [HTTP Request descriptor](https://jig.md/contracts/http-request/contract.json)
in `flows/reference/http.json`. Declare it in `flows/reference/flow.meta.json`:

```json
{"uses":{"http":{"contract":"./http.json"}}}
```

`flows/reference/FLOW.ts` uses the ordinary FLOW SDK:

```ts
import { handle } from '@jigging/flow'

await handle(async (run) => {
  const result = await run.call({
    operationId: 'read', slot: 'http', input: {},
  })
  const response = result.output as { status: number; body: string }
  if (response.status !== 200) throw new Error(`Document request returned ${response.status}`)
  return { outcome: 'done', output: { document: response.body } }
})
```

Use [ordinary dependency preparation](dependencies.md) for `@jigging/flow`.
The Binding proposes an exact endpoint and references its credential:

```ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/reference',
  slots: {
    http: { kind: 'http', url: 'https://docs.example.org/reference', method: 'GET',
      bearerEnv: 'DOCUMENT_TOKEN', responseBytes: 65536 },
  },
})
```

Supply `DOCUMENT_TOKEN` through the operator environment, then review and run
from the Jig project with the Flow and Binding included in its membership:

```sh
jig review
jig run binding:reference
```

The result's `output.document` contains the fetched text. To use another
document, change the Binding grant's URL and review the changed permission.

Review shows the exact destination and permission. A missing resource or
credential is unavailable; the package cannot manufacture either by declaring
them. A child can call the same configured Binding through an exact slot.

## Write an independently replaceable API client

For a POST grant, the Flow supplies a JSON `body`. This also supports an Agent
transport implemented as ordinary Flow code: it constructs the provider's
request and interprets the provider's response. Jig need not know that API's
prompt or result format.

```ts
if (typeof run.input !== 'string') throw new TypeError('Expected a prompt string')
const result = await run.call({
  operationId: 'generate',
  slot: 'http',
  input: {
    body: {
      model: 'model-permitted-by-grant',
      max_tokens: 256,
      messages: [{ role: 'user', content: run.input }],
    },
  },
})
const response = result.output as { status: number; body: string }
if (response.status !== 200) throw new Error(`Model request returned ${response.status}`)
const data = JSON.parse(response.body)
const text = data?.choices?.[0]?.message?.content
if (typeof text !== 'string') throw new TypeError('Model response omitted its answer')
return { outcome: 'done', output: text }
```

Give this Flow's `http` slot a grant with `kind: "http"` and `method: "POST"`. The
operator grants one exact POST endpoint and can use `bodySchema` to require
a particular model, cap `max_tokens`, and reject extra fields. The method can
be edited or replaced without modifying Jig, but its input still has to fit
that independently enforced policy. Returning an HTTP response does not prove
the Agent's answer is correct. This is a finite JSON API client, not native
ACP continuation or the full Agent Run contract.

## Know what the permission permits

Only the trusted request worker receives the credential and network access.
Flow code cannot select another URL, change the method, follow a redirect,
read the secret or open its own network connection. The approved service must
itself be trusted with that credential; no host can reliably detect an encoded
secret returned by a hostile service.

Check the returned HTTP status and validate the body. A network failure may
occur after a remote action, so Jig does not retry it. Cancelling stops local
owned work, not effects the remote server already accepted. Admit a grant removal to prevent new Runs from receiving it. Cancel active
work to settle its existing authority snapshot.

For shared policy, use optional [named grants](../spec/grants.md#reuse-a-named-policy-when-useful).

See [HTTP Request](../spec/http-request.md) for exact bounds and error behavior.
