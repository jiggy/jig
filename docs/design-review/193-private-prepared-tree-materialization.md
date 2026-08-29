# Private prepared-tree materialization checkpoint

**Status:** accepted on 2026-08-29 after focused recovery and cleanup tests
and an independent adversarial review. This checkpoint makes one retained Bun
prepared tree usable as a detached, read-only, per-Run materialization. It does
not make the target READY, join preparation to root execution, or publish an
artifact, Runtime Adapter, or Sandbox Backend interface.

## Boundary

The prepared-tree reference remains the private execution-artifact identity;
it is not Package/1. Reacquisition opens the separately retained source
Package/1 and the protected installed-SDK record, verifies their exact
correlation, and creates one authenticated invocation-local capture.

The existing descriptor-confined durable materializer consumes only this
narrow view:

```text
files
bounded streams
canonical materialization checksum
```

The checksum reuses Package/1's bounded canonical byte-tree encoding only for
materialization integrity and restart verification. It is not stored in the
prepared reference, does not become a package artifact, and grants no source,
admission, or execution meaning. The prepared record/reference format is
unchanged.

## Exact limits and recovery

Publication and reacquisition now prove that the complete source-plus-SDK tree
fits every verifier limit before it can be used: file count, total bytes, and
root-plus-implied-directory count. The directory ceiling is exported by the
descriptor capture implementation so publication cannot accept a tree which
durable recapture will always reject.

A project-owned allocation records only the invocation-local materialization
checksum. Creation copies exact streams into owner-only staging, makes the
finished tree read-only, recaptures it through descriptors, and compares the
checksum before returning a lease. Serialized lease identity can be reopened
after the prepared capture is disposed. A source which claims the right
checksum but yields changed bytes reaches final verification, fails, and
removes the complete transaction.

No prepared store, source store, mutable cache, or writable output directory is
mounted into the eventual Run. The later root owner will mount only the
detached lease read-only and will dispose it through the existing exact lease
lifecycle.

## Evidence and non-claims

Focused evidence passes:

```text
prepared-tree store/materialization       8 tests, 36 expectations
TypeScript build                           passed
independent adversarial review             GO
```

The tests cover fresh-capture checksum stability, copied-capture rejection,
post-disposal refusal, serialized lease reacquisition, successful disposal,
pre-effect digest mismatch, post-construction content mismatch, and zero
materialization residue.

This is a private compatibility seam between two existing mechanisms, not a
generic content-store or artifact SPI. The next boundary remains exact native
recipe pinning followed by the root-owned preparation/final-Run join.
