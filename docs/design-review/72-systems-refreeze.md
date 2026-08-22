# Systems re-freeze audit

## Verdict: BLOCK

The corrected architecture closes the six defects from the prior systems
audit at the architectural level:

| Prior seam | Result |
|---|---|
| Owner quiescence | Correct child closure and no implicit transfer are now specified. One EOF race remains below. |
| Service status/removal | The status commit and generation-loss boundary is now atomic. One initial dependency-revision gap remains. |
| Journal idempotency | `callKey`, request digest, and contract-authorized recovery are now present. Recovery across provider-generation loss still lacks a stable store identity. |
| Hook intervals | Half-open Journal-position intervals and unique derived-Run insertion are correct. Event-source authority and schema activation remain faulty. |
| Configuration/grants | PASS. Ambient environment/imports are gone, Grant Profiles are exact, preparation authority is separate, and enforcement is closed. |
| Admission/update publication | PASS. Admission generation, honest candidate effects, and recoverable source/database switching are now coherent. |

No layer or method-family change is needed. Five concrete faults still prevent a
freeze because they can produce incompatible results under ordinary exits,
initial Service startup, provider crash, or hostile Event publication.

---

## R1 — A normal response racing EOF has two possible terminal results

### Fault

Section 5.7 introduces a necessary closing interval:

```text
terminal response received
    -> admission closed
    -> owned operations quiesced
    -> owner terminal committed
```

Section 5.1 still says EOF fails every pending request and ends the process
lifetime. A normal one-Run component will commonly write its `flow/run`
response and immediately exit. The host may receive the complete response and
EOF before owner quiescence finishes.

One implementation can treat the root as no longer wire-pending and preserve
the buffered result. Another can treat the internally nonterminal owner as
pending and change it to `LOST`. Identical components then receive different
outcomes based only on read-loop scheduling.

### Minimal patch

Add an explicit owner phase:

```text
OPEN
  -> RESPONSE_RECEIVED
  -> QUIESCING
  -> SUCCEEDED | FAILED | LOST
```

Rules:

- EOF in `OPEN`, before a complete valid terminal frame, makes the owner
  `LOST`.
- A complete terminal frame atomically moves the owner out of `OPEN` before
  further channel input is handled.
- EOF in `RESPONSE_RECEIVED` or `QUIESCING` closes the channel and every other
  wire request, but does not overwrite the buffered owner result by itself.
- The buffered result commits only after output validation and owner
  quiescence. Cleanup failure or hard-deadline expiry may still make it
  `FAILED`/`LOST` according to the error registry.
- Trailing protocol frames which try to create new owner work after the
  terminal frame are rejected even if they were read in the same buffer.

### Falsifying test

In one OS write, emit a valid root result followed by EOF while zero, one
cancellable, and one uncertain child operation remain. Vary read chunking at
every byte boundary. Zero-child execution must always preserve the result;
child cases must always apply the same quiescence classification. Sending EOF
one byte before the complete result must always produce `LOST`.

---

## R2 — The initial dynamic Service binding revision does not exist

### Fault

Section 6.4 correctly requires every invocation and Mount-owned operation to
name an acknowledged dependency revision. It defines acknowledgement only for
`service/bindings` updates.

Static dependencies are resolved before Mount, while dynamic dependencies may
also have an initial provider. The document does not say whether that initial
complete snapshot is:

- part of `service/mount`;
- revision zero;
- installed by a separate `service/bindings` request before readiness; or
- unavailable until the first update.

Consequently a Service can receive `service/status`, become ready, and perform
Mount-background work before any dependency revision is legally nameable.

### Minimal patch

Choose one rule and freeze it. The smallest is:

> `service/mount` carries the complete initial dependency snapshot as revision
> 0, including fixed static bindings and the initial values or explicit absence
> of dynamic slots. It is installed before provider initialization begins and
> is therefore the first acknowledged revision. `service/status` and every
> Mount-owned operation before a later update name revision 0. Subsequent
> `service/bindings` revisions are positive, strictly newer full snapshots.

Static entries remain byte-identical in every later snapshot; only declared
dynamic entries may change. The first ready status must name the revision under
which initialization completed. Jig rejects readiness for an unknown or
partially installed revision.

### Falsifying test

Mount a provider with one static dependency, one initially present dynamic
dependency, and one initially absent dynamic dependency. During initialization
call each visible slot and publish ready. Every operation and readiness record
must name revision 0. Race revision 1 against the ready status; readiness must
refer wholly to 0 or wholly to 1 and never observe a mixed snapshot.

---

## R3 — Mounted-Journal recovery contradicts provider-generation loss

### Fault

The corrected Journal rules are sound while the same durable provider remains
reachable. The release gate additionally requires a separately mounted
Journal to survive kill injection.

Service/1 says provider crash loses every registration generation and an old
consumer never heals to a replacement. After this sequence:

```text
mounted Journal commits (callKey K, Event E, receipt Q)
provider or Jig crashes before outer effect result commit
old registration generation is lost
new Journal Mount starts
```

the outer operation is `UNCERTAIN`. The text authorizes recovery by `callKey`
but supplies no identity proving that the new Mount fronts the same durable
Journal store. Redispatching to an empty replacement can create a second Event;
refusing every new generation makes the mounted recovery release test
impossible.

Exact package, settings, and contract identity are insufficient: two instances
of the same provider may use different databases.

### Minimal patch

For v1 choose either of these; do not leave both implicit:

1. **Smallest:** only Jig's host-owned canonical Journal may back Events and
   Hooks. It shares or transactionally coordinates with the operation ledger.
   Remove separately mounted canonical-Journal recovery from the v1 gate. A
   mounted Journal is an ordinary Service effect and receives no canonical
   Event/Hook durability claim.

2. **If mounted canonical Journals are required:** activation must pin an
   opaque durable `journalStoreId` supplied and verified by the host's storage
   Binding, separate from Mount/registration generation. Recovery may query or
   idempotently redispatch only through a new generation proving the same exact
   Journal contract, Binding, durable attachment identity, and
   `journalStoreId`. This exception settles the already-dispatched operation;
   it does not heal the consumer's ordinary Service binding. If continuity
   cannot be proven, the operation remains `UNCERTAIN` forever and append is
   never redispatched.

The first option better matches v1 minimalism and the existing sentence which
already pins Hook-driving Events to Jig's kernel Journal.

### Falsifying test

Commit an Event, lose the response, and restart:

- the same package against the same durable store;
- the same package against an empty store;
- a different package claiming the same contract; and
- a forged `journalStoreId`.

Only the first may recover receipt Q. Every other case remains uncertain and
must append nothing. Normal consumer calls through the lost generation must
still return `PROVIDER_LOST`.

---

## R4 — Any Journal caller can currently forge a Hook-driving Event type

### Fault

The Journal authenticates `source`, but the caller supplies `type`. A v1 Hook
matches only exact type, not source. Therefore any untrusted Flow with a
Journal slot can submit:

```text
type = agent.completed
```

or an application type such as `deployment.approved`, and cause a privileged
Hook Flow to start. The conformance section says protected types cannot be
forged, but no rule identifies protected types, authorizes publishers, or
binds Hook matching to the authenticated producer.

This is a privilege-escalation path, not merely namespace hygiene. The forged
Event is durably valid and its Hook Run receives the Hook Binding's authority,
which may exceed the publisher's.

### Minimal patch

Make Hook selection depend on authenticated provenance:

```text
one exact (source selector, Event type) -> one exact Flow Binding
```

The `source` value remains host-stamped. A Hook source selector is one exact
project Binding/provider identity, or an explicit inert allowlist of such
identities. V1 has no `source: any` shorthand for authority-bearing Hooks.

Additionally:

- Jig-owned lifecycle type namespaces are nondelegable and can be appended
  only by their kernel outbox transaction.
- A Journal effect Binding may attenuate publication to an exact finite type
  set. The provider validates that attenuation before commit.
- Event type strings are bounded owner-qualified identifiers; text similarity
  never grants publication authority.
- The Hook uniqueness key remains `(Hook revision digest, Event ID)` because
  source/type are immutable fields inside that Event.

This preserves inert Hooks and adds no callback or expression language.

### Falsifying test

Give an untrusted Flow a Journal slot and attempt to append every Jig lifecycle
type and one application Hook type under another authorized producer's name.
It must be unable to choose the protected source and unable to trigger the
Hook. Then grant its exact Binding the application type and prove that only the
Hook whose source selector names that Binding fires. Updating the producer
package must follow the project Binding's declared stable identity rule rather
than accidentally widening to every provider.

---

## R5 — Hook input validation asks for prohibited schema implication

### Fault

Section 9.3 says, at Hook activation:

> its concrete input schema must validate the Journal contract's complete
> `Event` value; Jig does not infer schema subtyping.

No concrete Event exists at Hook activation. Determining that an arbitrary Flow
input schema accepts every valid Event/1 value is schema implication/subtyping,
which the same sentence rejects. Independent implementations can therefore
accept different Hook targets.

Validating only when each Event arrives preserves safety but defeats the claim
that an active Hook always creates a valid derived Run.

### Minimal patch

Use identity instead of inference:

- a Flow targeted directly by a v1 Hook either has no input schema, accepting
  implementation responsibility; or its `input.schema.json` is exactly the
  canonical Event/1 input schema digest required by the active Journal
  Contract;
- a Flow needing a narrower/custom input uses a wrapper Flow whose exact input
  is Event/1 and performs validation/transformation as ordinary Flow logic;
- the actual Event value is still validated against Event/1 before derived-Run
  insertion.

Do not attempt general JSON Schema containment.

### Falsifying test

Try Hook targets whose schemas are `{}`, the exact Event/1 schema, a schema
which accepts only one Event type, an `allOf` equivalent, a recursive schema,
and no schema. Independent hosts must make the same activation decision without
running a schema-implication algorithm. Every admitted concrete Event must
produce the same immutable Run input.

---

## Confirmed PASS areas

No remaining concrete contradiction was found in these corrected seams:

- caller digest versus one-time resolution assignment;
- owner-close cancellation direction and no implicit reparenting;
- Service status acknowledgement/removal atomicity after the initial revision;
- dynamic snapshot replacement after revision 0;
- exact Contract/Runtime identity and conformance dependency firewall;
- closed config import capture and absence of ambient environment fallback;
- exact Grant Profile bundles, transitive containment, preparation grants, and
  fail-closed enforcement reports;
- wait-graph/capacity accounting and bounded repair compare-and-set;
- honest candidate-Mount side effects;
- admission-generation publication and old-owner pinning;
- recoverable source/admission switching and rollback;
- inert Hook uniqueness and half-open activation intervals once source
  authorization/input identity are corrected.

## Re-freeze condition

Incorporate R1–R5 and add their tests to sections 5, 6, 9, and 15. At that
point this systems review is **PASS**: the remaining work is production of the
normative schemas, registry, and black-box implementations already required by
the release gates, not another architecture round.
