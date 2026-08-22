# Minimalist final freeze audit

## Verdict: BLOCK

The five requested cuts are correctly applied and introduce no lifecycle,
Binding, Hook, Journal, or security regression. One concrete Runtime/1 identity
contradiction remains. It can make two otherwise conforming hosts execute the
same immutable package under different normative launch semantics.

## BLOCK — `runtime.digest` has two possible referents

Package/1 exposes one field:

```yaml
runtime:
  contract: https://flow.dev/runtimes/deno
  version: 1.0.0
  digest: sha256:...
```

Runtime/1 then gives one revision both:

```text
canonical descriptor digest
root bundle-manifest digest which covers the descriptor, normative text,
schemas, fixtures, expected results, and referenced profiles
```

Activation again records only “Runtime Contract URI/version/digest.” The text
does not say which digest the package and activation pin.

This is not cosmetic. Host A may interpret `runtime.digest` as the descriptor
digest while Host B interprets it as the bundle root. An attacker or mistaken
publisher can retain the descriptor and replace normative preparation,
permission, cancellation, or launch text. Host A accepts the changed semantics;
Host B rejects them. The Deno-on-two-providers portability gate can therefore
pass or fail solely from the digest interpretation.

### Minimal patch

Make one digest the Runtime Contract identity:

> `FLOW.md runtime.digest`, provider claims, activation records, locks, and
> conformance fixtures always name the digest of the Runtime Contract bundle's
> canonical root manifest. That manifest commits every normative artifact.
> Digests of the descriptor and other member artifacts are internal Merkle
> entries and are never accepted as the contract revision identity.

In section 4.2, replace “canonical descriptor digest and authority evidence”
in the revision-identity list with “canonical root-manifest digest and authority
evidence.” Keep member digests only as manifest contents. The exact version is
metadata; the root digest is immutable identity.

No new field, profile, or registry is needed.

## Verification of the five final cuts

| Cut | Result |
|---|---|
| Generalized Binding | PASS. One Binding configures either a Run-capable or Service-capable package; mode comes from inert package metadata and cannot be reinterpreted. |
| Host-native canonical Journal | PASS. Append and the outer operation commit once in the kernel; mounted providers receive no exceptional replay authority. |
| Concrete Hook input validation | PASS. One derived Run is allocated per selected Event and actual input validation deterministically succeeds or records `INVALID_INPUT`. |
| Raw Grant Profiles deferred | PASS. Untrusted v1 code has attachments plus mediated effects; raw network/process authority is denied rather than described by an unproved portable profile. |
| One Journal/no Hook replay | PASS. One project position space and one `(Hook revision, event ID)` derived-Run identity remove the former partition and replay ambiguity. |

The Service Mount scenario is now representable without a second Binding type:
a Service-capable entry in normalized desired state supplies package, settings,
dependencies, attachments, and permission policy, while Run-only operations
reject it by mode. Pending Mount ownership, revision-0 dependencies, readiness,
leases, loss, and two-Mount draining remain internally consistent.

The 18 required scenarios expose no further architectural contradiction. Their
remaining exact wire schemas, numeric bounds, and fixture values belong to the
already-required conformance artifacts rather than another architecture noun.

## Freeze decision after the patch

After the one Runtime digest correction: **PASS**.

Do not reopen Bindings, Journal provider portability, Hook expressions,
Grant Profiles, telemetry, callbacks, or Mount handles during this fix. None is
needed to resolve the identity failure.

## Final patched verdict: PASS

The correction is exact and complete. Section 4.2 now makes the canonical
root-manifest digest the sole Runtime Contract revision identity used by
`FLOW.md`, Runtime Provider claims, activation records, locks, and conformance
fixtures. The manifest commits every normative artifact; descriptor and member
digests are explicitly non-identity Merkle entries.

This removes the only cross-host launch-semantics ambiguity without adding a
field, authority, resolution step, or compatibility rule. It does not alter
package identity, preparation provenance, activation contents, or Service
Contract identity. No concrete v1 regression or remaining freeze blocker was
found.
