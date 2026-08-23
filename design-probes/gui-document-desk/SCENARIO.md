# Scenario: Document Desk

## User story

Mira runs a small local browser application. She submits a document, observes
the ingestion Run, searches indexed documents, cancels a slow Run, and watches
committed `document-indexed` Events appear without refreshing the page.

The UI is application code, not a portable Flow. It uses one project-scoped
Jig client held by the Bun server. Every mutation still enters Jig through an
already-admitted root Run Binding.

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
│   ├── journal.ts
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
2. The server opens a host-local Jig client for this exact project. The client
   is allowed to start, inspect, and cancel Runs and inspect application Events;
   it cannot edit/apply policy, inspect secrets, or call capability providers.
3. The browser posts a document. The server generates one application
   submission key and calls `startRun("ingest", input, key)`.
4. Jig returns a durable Run identity before or after dispatch. Retrying the
   same HTTP request with the same key returns that Run; changed input conflicts.
5. The browser polls the Run. Terminal success includes the exact Flow result;
   cancellation, invalid input, provider loss, and uncertainty remain distinct.
6. The index Service publishes `document-indexed` through its admitted Journal
   slot. The browser polls the server with its last observed Journal position.
   The server returns a bounded ordered page and the next cursor.
7. A search request starts the exact `search` Run. The browser renders its
   terminal result without gaining the index Service capability itself.
8. Cancelling calls `cancelRun` with a stable cancellation key. It requests
   cancellation; later `getRun` establishes the resulting terminal state.

## Reconnection

Browser state is disposable. After reload it:

1. resumes Event reads from its last locally retained Journal position, or from
   zero when no cursor exists;
2. requests each Run identity it retained; and
3. submits no new work merely because it reconnected.

Compaction may make an old cursor unavailable. The server returns an explicit
minimum retained position, and the browser refreshes current application state
through new Runs rather than pretending it replayed missing history.

## Security boundary

The Bun server is trusted application code started by the user. Its raw
localhost listener is outside FLOW containment. The project-scoped Jig client
credential never enters browser assets, logs, Run input, package attachments,
or FLOW protocol frames.

The client surface is narrower than administrator access:

```text
allowed: startRun, getRun, cancelRun, readEvents
denied:  apply, revoke, install, bind, raw Journal writes, provider invoke,
         attachment reads, `.jig/` reads, host-policy mutation
```

Deploying this app remotely would require application authentication, TLS,
CSRF policy, rate limits, and a deliberate exposure model. This local probe
does not turn localhost into a universal security boundary.

