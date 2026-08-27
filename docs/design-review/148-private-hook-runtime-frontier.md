# Private Hook runtime frontier

**Status:** selected on 2026-08-27 for one private vertical proof. This record
does not publish Hook authoring, a Journal query API, a scheduler SPI, or a
general Event-source model.

## 1. Exact milestone

Prove one canonical Journal append can atomically select admitted Hook
revisions and allocate their derived root Runs, then a recoverable project
controller can execute those Runs through the already proved root lifecycle.

The first end-to-end witness is deliberately narrow:

```text
contained Bun publisher Run
    -> canonical Journal append
    -> one exact admitted Hook revision
    -> one Python derived Run receiving the immutable Event
    -> durable terminal and complete cleanup
```

The implementation may support several matching Hooks where that falls out of
the same transaction, but it must not add filters, transformations, replay,
subscriptions, callbacks, or an open scheduler interface.

## 2. Identity layers

Three identities remain separate:

```text
relationDigest
    inert authored producer/type/target relation

meaningDigest
    relation + exact selected Journal authority slice
             + exact target activation request and disposition

hookRevisionDigest
    meaning + opening admission + half-open start position
```

An unrelated project change, or additional publisher authority for another
Event type, preserves the active revision. A selected package, transitive
Binding request, target disposition, source, type, or target change closes the
old interval and opens a new revision at the next Journal position.

The revision stores enough canonical evidence to reproduce the exact target
without resolving a later LocalName. Strict reads recompute every digest and
cross-check the pinned candidate/admission.

## 3. Admission boundary

Applying one project generation reconciles Hook revisions in the same SQLite
`BEGIN IMMEDIATE` transaction which commits the admission head:

```text
B = current Journal position + 1

removed or changed Hook   close old endPosition at B
new or changed Hook       open new startPosition at B
unchanged Hook            preserve its original revision and opening pin
```

Every admission roots one canonical Hook-boundary fact. The fact records the
Journal head position observed inside that transaction and, except at genesis,
the digest of the exact canonical Event already stored at that position. A
meaning change must use `boundaryPosition = observedJournalPosition + 1`; an
unchanged meaning set records no boundary position. Strict reload checks the
named predecessor Event and reconstructs the complete revision set from every
admission.

The transaction establishes that the observation was the temporal Journal
head. The durable fact authenticates that exact observation and existing
Event; it does not claim a total cross-table chronology that SQLite does not
independently preserve.

There is exactly one open revision per Hook ID. Both positions use the
half-open interval `[startPosition, endPosition)`. Admission cannot publish a
new head without its complete interval update, and an append cannot allocate a
position against a partially changed Hook set.

## 4. Append transaction and prepared work

Package reacquisition and Schema/1 compilation happen before the write
transaction against one authenticated snapshot of the active matching
revisions and Journal head. The transaction rechecks that snapshot. Drift
causes bounded repreparation, never use of stale compiled policy.

One accepted append transaction commits all of:

```text
Event and Journal position
effect operation terminal
ordered matching Hook selection
unique (Hook revision, Event) derivation
one derived root Run per selection
append closure
```

The Event is the derived Run's exact input. Input-schema failure allocates that
same deterministic Run and terminates it with `INVALID_INPUT`. A target whose
pinned disposition is unavailable likewise allocates one terminal Run. A
`READY` target receives spawn intent and the ordinary root execution lifecycle
records. The Journal caller does not wait for those Runs.

Replay of the same append returns the same Event and selection without new
Runs. Changed parameters under the same operation ID remain
`OPERATION_CONFLICT`. A lost post-commit scheduler wake is recovered by
enumerating pending derived roots.

## 5. Root origin and public boundary

Internal root ownership becomes one closed union:

```text
submission origin
    external RootAdministration idempotency key and request digest

Hook origin
    hookRevisionDigest + eventId
```

The two branches use separate domain-separated Run identities. No synthetic
external `submissionId` is created for Hook work. RootAdministration continues
to accept and project only submission-origin Runs; Hook origin remains private
until a later control-plane inspection design earns it.

## 6. Recovery and refusal

The project controller pumps durable pending Hook roots after append and after
any lost wake while the same coordinator still owns the epoch. On coordinator
restart it preserves the existing conservative rule: unresolved older-epoch
work becomes the already defined honest `COORDINATOR_LOST` terminal because
the store cannot prove whether dispatch began. Dispatch ownership still uses
the coordinator epoch, spawn intent is durable before package execution,
success is never inferred from process disappearance, and Hook work receives
no special replay loophole.

This slice fails closed on:

- a Hook target absent from its pinned candidate;
- an active revision whose canonical evidence or interval is corrupt;
- prepared Hook work whose head/revision snapshot changed;
- a Service target, candidate set, semantic selection, or live LocalName
  re-resolution;
- revoked dispatch authority unless the same derived Run is durably terminated
  with the recorded reason;
- any attempt to use an external Journal implementation to drive Hooks; or
- any request for history/replay or arbitrary Hook callbacks.

## 7. Proof gates

The focused corpus must prove:

1. no-Hook, add, unchanged, replace, and remove admission boundaries;
2. exact source/type selection and deterministic fan-out order;
3. atomic append/selection/derived allocation under replay and kill injection;
4. stable revisions across unrelated admissions and changed revisions across
   selected target/package/dependency changes;
5. identical Event bytes as target input;
6. terminal invalid-input and unavailable derived Runs without reselection;
7. same-coordinator lost-wake dispatch with no duplicate Run or operation,
   plus conservative `COORDINATOR_LOST` reconciliation after coordinator
   restart;
8. coordinator-loss fencing and zero process/cgroup/device/materialization
   residue; and
9. preservation of the frozen Project Authoring SDK/1 boundary.

The slice stops after this witness. Hook revocation commands, public Hook
inspection, Event reads, producer construction, Service providers, Agents,
Semantic Choice, and Sley remain later verticals.
