# Scenario: one stateful index under loss and replacement

## User story

Mira maintains a small local document index. An exact Python Run ingests one
document revision. A long-lived Bun Service stores indexed state in one
writable attachment and exposes `upsert`, `get`, `search`, and `stats`. A Bun
Run performs searches. Every accepted revision eventually publishes a durable
`document-indexed` Event, and one Hook starts a Python audit Run which verifies
that the referenced revision remains visible.

The index is intentionally a single JSON snapshot with a persistent outbox.
It is not a performance design. Its purpose is to make state/Event ordering,
operation ownership, provider loss, and replacement inspectable.

## Desired project tree

```text
stateful-index/
├── .gitignore
├── jig.ts
├── bindings/
│   ├── audit.ts
│   ├── document-index.ts
│   ├── ingest.ts
│   ├── journal.ts
│   └── search.ts
├── hooks/
│   └── on-document-indexed.ts
├── flows/
│   ├── document-index/       Bun Service
│   ├── ingest/               Python Run
│   ├── search/               Bun Run
│   └── audit/                Python Run
├── index/
└── examples/
```

The Markdown files, declarations, `tsconfig.json`, and `expected/` at the probe
root are review harness rather than Jig project conventions.

## Normal journey

1. `jig check` captures the three shallow project sources and validates all
   package metadata, Run schemas, exact Capability Contract copies, Binding
   references, Hook source, and the Journal event-type ceiling.
2. Planning selects exact Bun Service, Bun Run, and Python Run recipes through
   host policy. The project never names a Sandbox Backend or toolchain path.
3. Apply admits one generation and activates `document-index`. Its fixed
   Journal dependency is installed before startup. Jig grants it the only
   writable lease over `./index`.
4. The Service loads `index/state.json`, drains any pending outbox entries
   through Mount-owned effects, publishes its complete `index` availability
   snapshot, and becomes ready.
5. A root `ingest` Run calls `index.upsert` under one invocation-owned effect
   operation. The provider writes the document plus pending Event in one atomic
   state-file replacement.
6. The provider calls `journal.append` through that invocation's dependency
   context. Jig commits the Event, matching Hook selection, and derived audit
   Run atomically. After the append result is proven, the provider atomically
   removes the pending outbox entry and returns the indexed record.
7. The audit Run may start before or after outbox cleanup. It calls `index.get`
   and `index.stats` through the exact provider generation leased to its
   Binding. A visible revision equal to or newer than the Event is `done`.
8. Independent `search` Runs may overlap an `upsert`. Atomic state replacement
   means each read observes a complete old or new snapshot. Service/1 promises
   neither ordering nor transaction isolation beyond this provider behavior.

## State and Journal boundary

The filesystem mutation and Journal append are not one transaction. The
provider uses a local transactional-outbox pattern:

```text
atomic state write(document + pending Event)
    -> journal.append(stable local operation ID)
    -> atomic state write(remove pending Event)
```

Within one live owner, repeating the same operation ID and request returns the
recorded Event. After provider loss, another Mount has a different operation
namespace and authenticated source. Replaying a pending entry may therefore
produce another Event. Audit convergence uses `(documentId, revision)`; Jig
does not claim exactly-once application events across provider generations.

## Replacement journey

1. A source edit or update proposes a new exact `document-index` package and
   Binding revision.
2. The candidate cannot shadow-mount while the active generation holds the
   same writable `./index` lease. Treating read-write attachments like stateless
   providers would permit two uncoordinated writers.
3. Jig closes new leases to the old generation and lets existing leased
   consumers and admitted invocations drain under the recorded deadline.
4. Jig cancels and fences the old Mount and proves release of its complete
   process tree and writable lease before closing the old Hook interval.
5. Apply atomically publishes the new admission generation and replacement
   Hook interval. The replacement Service is desired but not yet callable.
6. Jig mounts the replacement. It validates and adopts the state format,
   drains pending entries through the now-open Hook interval, becomes ready,
   and receives new consumer leases. There is a visible service-unavailable
   interval; v1 does not promise zero-downtime replacement for an exclusive
   writable attachment.
7. If the replacement cannot become ready, the old fenced process is not
   resurrected. A later deliberate generation may roll back to old source, but
   it mounts as a new provider identity.

This is stop-then-start replacement, not the shadow-first sequence available
to stateless or independently isolated providers.

## Cases to falsify

- Two consumers call the same provider concurrently and responses arrive out
  of order.
- Cancellation of `search` does not cancel `upsert` or Mount-owned recovery.
- Cancellation of `upsert` after its state write leaves a pending entry and an
  uncertain invocation rather than rolling the state back by assumption.
- A crash after Journal commit but before outbox cleanup converges within the
  same provable operation, or becomes visibly at-least-once after owner loss.
- Removing the Service export immediately loses its consumers; graceful
  package replacement instead drains the whole old generation.
- A contract URI/version match with different descriptor bytes is incompatible.
- Fencing prevents the old provider from publishing after its Hook interval;
  replacement outbox publication begins only after the new interval opens.
- A new provider cannot access `./index` until old-writer fencing is proven.

## Success criterion

The probe succeeds only if these cases can be explained with existing Run,
Service, Binding, Event, Hook, operation-ledger, attachment-lease, and admission
generation concepts. A missing SDK projection may be added; a new portable
lifecycle primitive requires stronger evidence than this scenario.
