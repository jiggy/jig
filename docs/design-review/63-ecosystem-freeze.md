# Ecosystem freeze audit

## Verdict: BLOCK

The architecture should not freeze until the three patches below are applied.
They are boundary defects, not requests for more features. Callback,
subscription, telemetry, graph, Task, GUI, registry, and SemVer-range work must
remain deferred.

## 1. Runtime identity does not yet bind the complete normative contract

### Block

Section 4 says the Runtime descriptor identifies the standard while external
normative text and fixtures define its behavior. Package metadata pins only the
descriptor digest. Unless that digest commits to every normative artifact, an
owner can change launch, preparation, permission, or cancellation semantics
without changing the identity pinned by the package and activation.

Two providers can then implement different revisions of the prose/fixtures and
both claim the same exact Runtime Contract. This defeats the purpose of
replacing package argv with a portable Runtime identity.

Grant Profiles have the same problem wherever their exact digest identifies a
descriptor while mutable external prose defines enforcement.

### Required patch

Define every Runtime Contract revision as one immutable contract bundle. Its
root manifest must commit by digest to:

```text
contract URI and exact version
machine descriptor
normative schemas
normative behavioral text
conformance fixtures and expected results
referenced grant/runtime profiles which are part of its semantics
```

`runtime.digest` must be the canonical root-bundle digest, not merely the JSON
descriptor digest. A Runtime Provider advertises and is tested against that
exact root. No normative HTTP resource may be followed without a digest. The
activation lock records the root and every resolved artifact.

A Grant Profile must either be self-contained or use the same immutable-bundle
rule. Informative documentation may remain outside the digest and must be
labelled non-normative.

### Release test

Keep the machine descriptor unchanged while modifying one normative launch
rule and one fixture. The bundle identity must change and a package pinning the
old root must reject the new material. Two independently written providers for
one root must consume identical normative bytes before behavioral conformance
is evaluated.

## 2. Run-only conformance still has an implicit Contract/Service dependency

### Block

The architecture correctly gives Package/1, Run/1, Service Contract/1, and
Service/1 separate labels. However, Run/1 includes `effect/call`, Package/1
places exact Service Contract references in `uses`, and section 5 requires the
host to validate contract, method, and schemas. It never states whether a
Run/1 Host must therefore implement the Service Contract/1 Consumer profile.

Reasonable implementers can make opposite decisions:

```text
Host A
    claims Run/1 only and supports project-local opaque effects

Host B
    concludes every Run/1 Host must parse and validate Service Contract/1
```

That ambiguity undermines both the “small Run host” adoption claim and the
separate conformance labels. The same issue exists for a Service/1 Host's reuse
of `flow/call` and `effect/call`: “shared with Run/1” is not an exact
conformance dependency.

### Required patch

Publish a normative profile-dependency matrix:

1. Package/1 parsers recognize `uses`, `service`, and `provides` as inert
   closed metadata but acquire no execution capability from parsing them.
2. Run/1 Host conformance requires the ownership, ledger, cancellation, and
   dispatch semantics of `effect/call`; it does **not** require Service/1 or
   Service Contract/1 Consumer conformance.
3. A Run-only host may bind explicitly configured opaque local effects. A
   package requiring an exact public contract is rejected before launch with a
   stable `UNSUPPORTED_PROFILE` or `BINDING_UNSUPPORTED` result unless the host
   also implements the Contract Consumer profile.
4. A host claiming portable typed-effect support must additionally claim
   Service Contract/1 Consumer conformance.
5. Service/1 normatively imports a named subset of Run/1 host-call schemas and
   semantics. Its own suite tests that subset; a Service/1 Host need not claim
   complete Run/1 Host conformance unless it implements `flow/run` too.
6. A package carrying Service metadata never makes a Package/1 or Run/1 host
   nonconformant merely because that host cannot mount it; incompatibility is
   discovered during inert preflight.

This patch changes no wire method and does not move Service into the base.

### Release test

An independent minimal host must pass Package/1 + Run/1 using one opaque local
effect and no Service or Contract implementation. It must deterministically
reject, before process launch, a package requiring an unsupported public
contract. A second host claiming Contract Consumer must accept the same package
and make the same schema/method decisions. A Service-only host must pass its
imported host-call fixtures without accepting `flow/run`.

## 3. `init --from` leaves first-run code execution outside the trust model

### Block

Section 14 permits a selected Starter to run a “reviewed initializer,” but does
not define when the source is snapshotted, what the user approves, which grants
it receives, whether it is a Flow, or how partial project creation is rolled
back. This is the default adoption path for new users and therefore cannot be
left as trusted installer convention.

Without a rule, a remote Starter can execute code before the exact-digest trust
and sandbox rules used everywhere else in the architecture apply. Different
Jig implementations can also produce materially different projects from the
same Starter.

### Required patch

`jig init --from <starter>` must be a two-phase transaction:

1. Resolve and capture the Starter as an inert canonical snapshot. Record its
   source provenance, revision, digest, and trust evidence. Do not evaluate
   `jig.ts` or any initializer while resolving or previewing it.
2. Show or export the exact snapshot and proposed destination. Copy it into a
   staging project with no source hooks or package install scripts.
3. Atomically materialize the user-owned project after explicit acceptance.
4. If the Starter has an initializer, expose it as an ordinary named Flow
   invoked only after materialization and a second explicit approval of its
   exact Binding, Runtime, Agent use, attachments, and grants. It receives no
   installer-only authority.
5. Initializer failure leaves a diagnosable staged transaction or restores the
   pre-init destination; it never publishes a half-initialized active project.
6. The result has no continuing dependency on the Starter. Future updates are
   ordinary source-update transactions only when the user explicitly retains
   provenance for an imported component.

The recommended Starter used in the v1 adoption test must support an exact,
non-Agent first Run after the user configures only the explicitly required
provider. Semantic discovery, generated repair, and Agent-assisted update stay
opt-in.

### Release test

Use a hostile Starter containing source-install hooks, a `jig.ts` import which
reads secrets, and an initializer requesting raw process/network authority.
`inspect` and preview must execute none of it. Rejecting the initializer must
still leave a valid copied project. Kill the process at every staging,
materialization, initializer, and first-apply boundary; the destination must be
absent, pre-existing, or one coherent reviewable project—never an untracked
mixture.

## Freeze condition

After these patches, no ecosystem-level blocker remains in the reviewed
architecture:

- package content, source provenance, Runtime identity, and public contract
  identity remain separate and exact;
- Service stays official but optional and independently conforming;
- Cordis/DSH interoperability is claimed only for the bounded serializable
  Service seam, not arbitrary browser plugins or callbacks;
- discovery and semantic repair remain powerless, explicit policy; and
- Starters provide usable application opinion without becoming a hidden Jig
  framework layer.

The existing section 15 conformance gates must still pass before any `1.0`
label. Passing this architecture audit is not a substitute for those gates.
