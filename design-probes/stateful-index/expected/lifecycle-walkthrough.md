# Expected lifecycle walkthrough

This is a nonnormative tabletop trace, not runtime output.

## Activation

1. The admitted `document-index` Binding pins one Bun Adapter recipe, one
   Sandbox Backend recipe, the `./index` read-write attachment, the fixed
   Journal dependency Binding, and the exact provided index contract.
2. Jig acquires the exclusive writer lease before spawning the Service.
3. `service/mount` installs the complete fixed dependency set. The provider
   scans its local pending outbox through Mount-owned effects before declaring
   ready.
4. Its one acknowledged readiness transition publishes the complete fixed
   export set; Jig assigns exact provider generations. Consumer Bindings
   acquire leases only afterward.

## Ingest and publication

1. Root Run `ingest-1` pins the admitted `ingest` Binding and its exact index
   provider lease.
2. Its operation `upsert-document` creates one `service/invoke` owner. The
   provider method receives an invocation context rather than a public Scope.
3. The provider atomically writes the document and outbox entry.
4. `publish-document-architecture-notes-1` is an invocation-owned child effect
   through the Mount's fixed Journal Binding. It cannot drift to a new Journal
   provider while pending.
5. Journal commit atomically creates the Event, append result, matching Hook
   selection, and derived audit-Run outbox entry.
6. A proven append result lets the provider remove its pending entry and return
   the document. The invocation quiesces before `ingest-1` receives success.

## Concurrent search

A search invocation admitted before index replacement retains the old provider
generation and may complete after that generation enters draining. Cancelling
it closes only its invocation subtree. It neither cancels an overlapping
upsert nor rewrites the provider's Mount status.

## Audit

The Hook-derived Run is unique for its Hook revision and Event ID. It retains
the Event as immutable input and its already-pinned audit Binding generation.
Its `get` and `stats` operations may observe the outbox before or after cleanup;
that provider detail does not alter whether the referenced document revision
is visible. Re-delivering the same Hook/Event pair returns the same Run.

## Quiescence

Closing a Run releases invocation and provider leases after its child effects
are terminal, cancelled, or uncertain. Closing the Service stops new Mount
background work, drains or cancels it under the Mount deadline, fences the
process tree, and releases the writable attachment only after cleanup is
proven.
