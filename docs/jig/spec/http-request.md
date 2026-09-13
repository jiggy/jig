# HTTP Request: delegated endpoint access

*Status: prerelease implementation candidate.*

An ordinary Flow can retrieve a document, submit a notification, or implement
an API client using a narrowly authorized HTTP request. Jig holds the
credential and enforces the request policy outside the Flow. The Flow owns
request construction and response interpretation; it gains no socket, process,
or credential access.

HTTP Request uses the existing Run/1 `flow/call`. It adds no FLOW protocol or
SDK method. Other hosts may implement the same interface under their own
authority policy. Its [descriptor](https://jig.md/contracts/http-request/contract.json)
has ID `https://jig.md/contracts/http-request`, version `1.0.0`, and digest
`sha256:08a5f03724125edf863c4592c3558b7cda097e9cf7501f4d8c60dcbf6502bb0d`.

## Declaration, selection, permission

The Flow declares the HTTP Request interface at a local slot in metadata.
Its Binding supplies a [grant](grants.md), inline or by named reuse:

```ts
slots: {
  reference: { kind: 'http', url: 'https://docs.example.org/reference', method: 'GET' },
}
```

The operator reviews the destination, credential reference and limits before
admitting this exact connection. The Flow receives no policy-editing authority.
The closed HTTP grant contains `kind: 'http'` and these fields:

| Field | Meaning and limits |
| --- | --- |
| `url` | Required exact canonical URL, at most 2,048 characters. HTTPS, or HTTP to numeric loopback `127.0.0.1` / `[::1]`. No userinfo or fragment. Query and path are fixed. |
| `method` | Required `GET` or `POST`. |
| `bearerEnv` | Optional operator environment reference matching `[A-Z][A-Z0-9_]{0,127}`. Its value is 1–8,192 printable non-space ASCII bytes, sent as a Bearer credential only to the chosen endpoint. |
| `requestBytes` | Positive integer, default and maximum 262,144. UTF-8 bytes of the canonical JSON request body. |
| `responseBytes` | Positive integer, default and maximum 1,048,576. Complete response-body bytes before text decoding. |
| `timeoutMs` | Positive integer, default and maximum 60,000; shortened by enclosing deadlines. |
| `bodySchema` | Optional embedded Schema/1 declaration, at most 16 KiB canonical JSON, only for POST. Validates the request body before dispatch. No remote schema resolution. |

The resolved policy participates in the portable lock, authority and exact
execution recipe. [Grant admission](grants.md#review-and-admission) distinguishes
source proposals from active permissions. Each Binding may have up to eight
HTTP slots; multiple slots do not increase execution capacity.

## Invocation and response

```ts
const result = await run.call({
  operationId: 'fetch-reference',
  slot: 'reference',
  input: {},
})
```

Input is an object with only optional `body`. GET forbids a body; POST
requires a JSON/1 value, including `null` when its schema allows that. There
are no caller-selected URLs, methods, headers, credentials, redirects, retries,
cookies, proxies, streaming switches or channel endpoints. To request another
destination the operator must supply another exact grant.

A complete exchange returns:

```json
{"outcome":"done","output":{"status":200,"body":"the complete response text"}}
```

`status` is the collected final HTTP status (200–599); `body` is strict UTF-8
text. Redirects are returned, not followed. Non-2xx responses are HTTP evidence,
not transport failures or domain success. Compressed or malformed text responses
reject; the worker requests identity encoding. Parsed response-header fields
over 16 KiB are rejected; headers are not exposed. Parser allocation remains
subject to the worker's containment limits.
The application checks the status and validates provider data itself.

Invalid input fails before dispatch. Oversized responses fail with
`RESOURCE_EXHAUSTED`; malformed or rejected responses with `INVALID_RESULT`.
Socket loss or a worker-local timeout after possible dispatch is `UNCERTAIN`.
Host cancellation and deadline expiry remain `CANCELLED` and
`DEADLINE_EXCEEDED`. These failures do not establish that the remote operation
did nothing. Jig never retries them. Ordinary language recovery is available
after confirmed local cleanup; failed fencing or cleanup remains fatal.

## Enforcement and limits of the guarantee

A fixed trusted worker executes one request in its own contained envelope.
It has the installed runtime, resolver configuration, that request's policy and
credential, and no Flow source or project dependency imports. The enclosing
Flow remains network-isolated and keyless. Both host and worker validate the
request; the collector validates the bounded reply outside the worker scope.
Credentials are delivered over private stdin, never through FLOW input,
project records, command-line arguments or public diagnostics.

Ownership is recorded before dispatch. Root and leaf calls use the existing
exclusive effect capacity and aggregate resource reservations. A leaf receives
only its own Binding selections, never the parent's. Cancellation and
coordinator loss fence the worker and socket owner before resources are
released. A result becomes successful only after confirmed local cleanup.
Recovery settles recorded owners without starting another HTTP request.

HTTPS uses normal certificate and hostname verification. This is exact-URL
enforcement, **not an IP firewall**: the operator-selected hostname uses the
host resolver; explicitly selected private services are allowed. The remote
service must be trusted with its credential. Literal credential echoes are
rejected defensively, but transformed or encoded disclosure cannot generally
be detected. This is not an information-flow or remote-service honesty guarantee.

Byte and time limits do not impose a provider's account-wide spending quota.
Optional `bodySchema` can restrict fields such as a model, token cap or operation,
but does not prove that the remote service honors them. Repeated explicit calls
remain possible within Run limits. Use appropriately scoped service credentials.
Raw secrets, arbitrary processes, endpoint patterns, generic provider plugins,
native Agent session control and binary streaming are outside this profile.
