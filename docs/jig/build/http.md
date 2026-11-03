# Use a service without handing over its credential

A Flow may need a private document, a notification endpoint, or a model API.
Give its invocation slot an HTTP grant: the method builds and interprets requests,
while Jig keeps the credential and limits where those requests can go.

## Before you start

Use the project from [your first Flow](../start/index.md) on a supported host.
Choose a document endpoint you may access and its scoped bearer credential.
Replace the example URL below with that endpoint.
The example expects a UTF-8 response with HTTP status 200.

Your Flow receives the document text, while Jig retains the credential and network authority.
It does not receive general network access.

## Fetch a reference document

From the project root, create a method with the installed HTTP Request agreement:

```sh
jig new reference --use http=jig:http-request
```

The command copies the exact agreement and declares the `http` slot.
It does not grant permission to contact an endpoint.
If `jig.ts` uses explicit membership, include `flows/reference` and its Binding.

`flows/reference/FLOW.ts` uses the ordinary FLOW SDK:

```ts
import { handle } from '@jigging/flow'

await handle(async (run) => {
  const result = await run.call({
    operationId: 'read', slot: 'http', input: {},
  })
  if (result.outcome !== 'done') return result
  const response = result.output
  if (!response || typeof response !== 'object' || Array.isArray(response) ||
      !('status' in response) || !('body' in response) ||
      typeof response.status !== 'number' || typeof response.body !== 'string') {
    throw new TypeError('The HTTP request returned an unexpected response.')
  }
  if (response.status !== 200) throw new Error(`Document request returned ${response.status}`)
  return { outcome: 'done', output: { document: response.body } }
})
```

The generated package already declares `@jigging/flow`.
Create `bindings/reference.ts` to propose the endpoint and credential reference:

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

Supply `DOCUMENT_TOKEN` through the operator environment.
Include the Flow and Binding in project membership.
Then review and run from the project directory:

```sh
jig review --allow-resolution-network
jig run binding:reference
```

The generated SDK dependency may need fresh resolution when its lock is absent.
The network flag permits dependency-selected requests before approval, separate from the Flow's HTTP grant.
Read [dependency preparation](./dependencies.md#fresh-resolution-and-network-access) before granting that permission.

Expect execution status `succeeded`, outcome `done`, and fetched text in `output.document`.
To fetch another document, change the Binding's URL and review the changed permission.

Review shows the exact destination and permission.
A missing resource or credential remains unavailable.
Declaring one cannot manufacture it.
A child can call the same configured Binding through an exact slot.

## If the request fails

| Observation | Next step |
| --- | --- |
| The named credential is unavailable | Supply it through the operator environment for review and execution. |
| The response status is not 200 | Check the reviewed URL, credential, and remote service. The handler rejects that response. |
| The response exceeds its grant | Inspect the expected document size before changing and reviewing `responseBytes`. |
| A timeout or network failure follows possible dispatch | Inspect retained evidence before repeating work. The remote operation may have occurred. |
| Cleanup is uncertain | Follow [Results and recovery](./results.md). Do not automatically replay the request. |

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
if (result.outcome !== 'done') return result
const response = result.output
if (!response || typeof response !== 'object' || Array.isArray(response) ||
    !('status' in response) || !('body' in response) ||
    typeof response.status !== 'number' || typeof response.body !== 'string') {
  throw new TypeError('The HTTP request returned an unexpected response.')
}
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
read the secret or open its own network connection. The approved service must itself be trusted with that credential.
No host can reliably detect an encoded secret returned by a hostile service.

Check the returned HTTP status and validate the body. A network failure may
occur after a remote action, so Jig does not retry it. Cancelling stops local
owned work, not effects the remote server already accepted. Admit a grant removal to prevent new Runs from receiving it. Cancel active
work to settle its existing authority snapshot.

For shared policy, use optional [named grants](../spec/grants.md#reuse-a-named-policy-when-useful).

See [HTTP Request](../spec/http-request.md) for exact bounds and error behavior.
