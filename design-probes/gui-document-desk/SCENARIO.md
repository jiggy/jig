# Scenario: Document Desk

## User story

Mira runs a small local browser application. She submits a document, observes
the ingestion Run, searches indexed documents, and cancels a slow Run.

The UI is application code, not a portable Flow. It uses a candidate local Jig
embedding API held by the Bun server. Every mutation still enters Jig through
an already-admitted root Run Binding.

## Desired tree

```text
gui-document-desk/
├── jig.ts
├── package.json
├── app/
│   ├── server.ts
│   └── public/
├── bindings/
│   ├── document-index.ts
│   ├── ingest.ts
│   └── search.ts
├── flows/
│   ├── document-index/
│   ├── ingest/
│   └── search/
└── index/
```

Probe documents, type stubs, fixtures, and `expected/` are review harness.

## Normal journey

1. The user applies the Jig project, then deliberately starts the Bun app.
2. The server opens this exact local Jig project through a candidate embedding
   API. Host policy decides whether the process is trusted; the caller does not
   grant itself authority by passing an object.
3. The browser posts a document. The server generates one application
   submission key and calls `startRun("ingest", input, key)`.
4. Jig returns a durable Run identity before or after dispatch. Retrying the
   same HTTP request with the same key returns that Run; changed input conflicts.
5. The browser polls the Run. Terminal success includes the exact Flow result;
   cancellation, invalid input, provider loss, and uncertainty remain distinct.
6. A search request starts the exact `search` Run. The browser renders its
   terminal result without gaining the index Service capability itself.
7. Cancelling calls `cancelRun` with a stable cancellation key. It requests
   cancellation; later `getRun` establishes the resulting terminal state.

## Reconnection

Browser state is disposable. After reload it requests each retained Run ID and
submits no new work merely because it reconnected. Durable application history
is a separate need this probe intentionally does not solve.

## Security boundary

The Bun server is trusted same-user application code. Its raw localhost
listener is outside FLOW containment. The browser receives no Jig object or
host credential.

The client surface is narrower than administrator access:

```text
needed by this app: startRun, getRun, cancelRun
denied:  apply, revoke, install, bind, raw Journal writes, provider invoke,
         attachment reads, `.jig/` reads, host-policy mutation
```

Deploying this app remotely would require application authentication, TLS,
CSRF policy, rate limits, and a deliberate exposure model. This local probe
does not turn localhost into a universal security boundary.
