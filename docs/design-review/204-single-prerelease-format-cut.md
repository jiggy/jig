# Single prerelease format cut

**Status:** completed on 2026-08-31 for Goal G4.

## Decision

The unreleased implementation accepts only its current private values:

```text
Candidate/5
Plan/2
Admission/2
Lock/3
the current exact SQLite schema identity
```

Candidate/5 is now constructed directly. Candidate/4 and Plan/1 no longer
exist as types, builders, codecs, normalizers, fixtures, or tests. The private
Run host compatibility alias is deleted and every caller uses the current
terminal type directly.

The store no longer scans for historical database filenames. It opens only
the one current database name and still rejects a malformed current database
through exact application ID, user version, and schema checks. There are no
migrations or alternate-format selectors.

## Evidence

- The TypeScript build passes.
- The Candidate/5 and Plan/2 corpus passes 8 tests and 59 assertions.
- Current admission, Run-session, lock, and resolution corpora pass 47 tests
  and 218 assertions.
- Fresh/current-corrupt store-schema tests pass 2 tests and 14 assertions.
- A repository scan finds no Candidate/4, Plan/1, compatibility alias,
  historical database-family matcher, or old-version fixture.

## Boundary

This cut removes compatibility archaeology only. It does not redesign the
current values or claim that the current broad private store is the alpha
schema. Goal G8 owns that separate narrowing decision and will replace the
current schema outright rather than migrate it.
