# Private single-target unavailable candidate

**Status:** implemented private record checkpoint. It proves one closed inert
candidate shape and does not publish an admission API, database, public lock,
approval protocol, or runnable generation.

The missing host-generation lifecycle root recorded in
[review 117](117-private-host-generation-boundary.md) keeps the current
Python/Linux implementation unavailable. This slice preserves that fact while
closing the record boundary needed to exercise lock-first admission without
manufacturing a recipe.

## 1. The only representable candidate

The canonical record is:

```text
private-unavailable-candidate/1
    exact project-root device and inode
    capture digest
    observed semantic digest
    resolution-input digest
    planning-observation digest
    proposed private-lock digest
    retained declaration-closure digest and Package/1 reference
    exactly one activation target
        exact target and request digest
        state: unavailable
        one exact unavailable code
        sorted unique non-empty evidence digests
```

The associated private package-project lock remains a separate canonical
record. Candidate identity commits its digest; the lock is not duplicated
inside the candidate. Package references for selected Flows are derived from
that lock, while the retained declaration closure is named separately because
the lock does not contain it.

No Boolean or union can turn this record into a runnable one. `READY`, planned
observations, recipes, commands, runtime paths, Backend data, host-generation
members, and execution handles are structurally absent. A later ready
generation needs a distinct record and all lifecycle gates from review 117.

## 2. Exact target closure

The factory accepts only:

```text
authentic retained package project
    +
authentic resolution observation for the same capture
    +
exactly one effective unavailable target
```

It creates the portable lock internally. Restart decoding derives the complete
activation-target set from that lock—every direct Run and every Binding—and
requires it to contain exactly the candidate target. Merely finding the named
target is insufficient; an extra direct Run or Binding rejects.

`DEPENDENCY_UNAVAILABLE` cannot occur in this single-target slice. A linked
capability dependency necessarily introduces another Binding activation
target, so accepting that code would admit a semantic state the factory cannot
produce.

The resolution-input digest is recomputed from the capture and planning
observation digests. The lock digest is recomputed from the strict lock bytes.
Root identities are bounded unsigned 64-bit decimal strings, and every path,
LocalName, Package/1 reference, digest, code, and evidence collection is
strictly normalized.

## 3. Canonical bytes are not provenance

Both candidate and lock use their one accepted spelling:

```text
RFC 8785 canonical JSON/1 bytes || LF
```

The decoder rejects alternate whitespace, missing LF, BOM, duplicate keys,
unknown fields, accessors, Proxies, extended byte arrays, and noncanonical
evidence order. It returns an immutable inert value.

Crucially, strict decoding does **not** mint the factory authenticity brand.
Only the invocation-local path from the retained aggregate and its authentic
resolution receives that brand. The future protected admission store must mint
its own separate stored-candidate provenance only after it has verified the
row-key digest, exact lock bytes, retained artifacts, and database ownership.
Treating arbitrary canonical bytes as admitted would collapse syntax and
authority.

The external candidate identity is:

```text
SHA-256(
  ASCII("JIG-Private-Unavailable-Candidate/1")
  || 0x00
  || RFC8785(candidate)
)
```

The focused golden vector has digest:

```text
sha256:e893ffacf24d02996c3ba99e66cf515e094e36c97aeb37ffdb45f2c1a50afd1e
```

## 4. Evidence

The ordinary corpus proves:

- canonical restart decoding, byte-identical re-encoding, and the fixed
  identity vector;
- inert decoding cannot mint retained-factory provenance;
- lock, resolution-input, declaration, and target mismatch rejection;
- extra direct Runs and extra Bindings reject;
- a valid single Binding target remains representable;
- READY, planned, recipe, Backend, and admission fields are unrepresentable;
- malformed root identities, codes, Package/1 references, evidence, JSON/1,
  accessors, and Proxies reject without invoking accessors; and
- decoded values and their nested collections are immutable.

The hostile Linux integration additionally runs the real path:

```text
captured and retained project
    -> exact trusted-host unavailable observation
    -> retained resolution
    -> created candidate
    -> canonical candidate and lock bytes
    -> fresh inert restart decode
```

The created value carries factory provenance; the restart-decoded value does
not. All focused and ordinary Jig tests pass, and the host-gated integration
passes in the cgroup-v2/Bubblewrap envelope.

## 5. Subsequent boundary

The protected candidate-head and review-plan checkpoint described below is now
closed by [review 119](119-private-unavailable-admission-store.md). It persisted
only candidates and inert plans; it did not implement the later lock or
generation steps.

The remaining apply slice is not a public storage framework:

```text
reload one persisted review plan and reacquire exact retained artifacts
    -> durably publish the inert visible lock
    -> commit one protected active-generation compare-and-set
    -> return one idempotent unavailable receipt
```

The measured implementation substrate is Bun's built-in SQLite with one fresh
connection per operation, rollback `DELETE` journaling, verified
`synchronous=EXTRA`, `foreign_keys=ON`, `trusted_schema=OFF`, and a bounded
busy timeout. Filesystem publication occurs inside a manual `BEGIN IMMEDIATE`
transaction. Bun's async transaction callback must not be used because it
commits when the callback returns its Promise rather than after awaited file
work.

That future proof coordinates cooperating Jig administrators. Ordinary
rename cannot provide a filesystem-wide compare-and-swap against an
uncooperative concurrent editor, and no checkpoint should claim otherwise.
