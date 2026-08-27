# Independent Root Administration/1 consumer review

**Status:** passed on 2026-08-27. The closed Root Administration/1 candidate
clears its independent-consumer release gate. This is evidence about the
candidate surface, not an npm publication or stability claim.

## 1. Review boundary

The reviewer was not given the design history, private implementation model,
or prior probes. It consumed only the public specification, machine schema,
`@jigging/jig/administration` declarations, package manifest, checked-in clean
consumer, and package-smoke entrypoint. It made no repository edits and used a
fresh temporary pack/install project.

The review built and packed `@jigging/jig`, installed the tarball without
scripts, compiled the unchanged checked-in consumer under strict TypeScript,
and authored separate host-side Bun API probes for public exports, values,
replay, concurrency, and closure. These were not Bun-backed FLOW Runs. Bare
implementation deep imports remained blocked by the package export map.

## 2. Initial rejection

The first review failed the candidate for three contract defects:

1. the schema admitted bounded strings that a hidden SDK-only
   `submissionId` regular expression rejected;
2. “same target and input” did not define JSON equality or concurrent
   first-use linearization; and
3. the contract did not distinguish `PROJECT_CLOSED` calls on an expired
   authority from durable `CANCELLED` or Run/1 `OWNER_CLOSED` terminals.

These were accepted as genuine boundary defects rather than waived as
documentation observations.

## 3. Amended contract

The amended candidate:

- admits every FLOW JSON/1 string containing 1 to 1,024 Unicode scalar values
  as an opaque project-local `submissionId`;
- compares normalized targets and input under FLOW JSON/1 equality, with the
  first atomic durable allocation linearizing concurrent first uses; and
- makes both methods on a closed authority fail with `PROJECT_CLOSED`, while a
  normally closed project administration lifetime durably cancels pending
  launches and a later host-issued authority may observe `CANCELLED`.

No new public method, transport, controller, policy, or extension interface was
added.

## 4. Independent result

The reviewer repeated its original counterexamples from a newly packed and
installed artifact. It verified:

- spaces, newline, NUL, astral values, U+10FFFF, and exactly 1,024 Unicode
  scalars are accepted and preserved;
- empty, 1,025-scalar, and lone-surrogate IDs fail with `INVALID_REQUEST`;
- canonically distinct strings remain distinct;
- reordered JSON object members replay one allocation and one Run ID;
- conflicting concurrent first uses produce one winner and one
  `SUBMISSION_CONFLICT`;
- an expired authority rejects both methods with `PROJECT_CLOSED`; and
- a replacement authority over the same durable state observes the accepted
  pending Run as `CANCELLED`, never as an administration response or
  `OWNER_CLOSED` substitute.

The unchanged checked-in consumer compiled against the tarball. Public schema
resolution, deep immutable snapshots, and serializable closed errors also
passed. The environment supplied Bun but no `node` executable; Node execution
was therefore not part of this independent repetition. Repository package
smoke retains the ordinary packed-package check.

## 5. Disposition

Root Administration/1 has now survived both a hostile first independent read
and a repeated external-consumer proof after amendment. Further administration
features—project opening, authentication, transport, list/watch/cancel,
plan/apply, or authority inspection—remain separate release-gated interfaces.
