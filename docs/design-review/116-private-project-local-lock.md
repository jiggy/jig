# Private package-project lock projection

**Status:** implemented private exclusion and canonicalization checkpoint. It
is not the public `jig.lock` schema, does not publish a project API, and cannot
admit or execute anything.

The retained package-only project can now produce one strict portable
projection of the resolution facts it actually owns. This closes the canonical
byte and host-state-exclusion boundary needed before host-local admission work
without inventing the parts the current project model cannot yet express.

## 1. Why this is not public Lock/1

The reviewed public lock must eventually cover portable upstream source
locator/revision evidence, Hooks, Semantic Choice, the host-capability
Binding branch's portable consumer requirement and inert-reference vocabulary,
and the complete portable authority model. The resolved trusted-host
registration identity remains host-local. The current implementation has
authenticated local Package/1 trees and package Bindings, but no authenticated
Git/npm/OCI source revision, Hook definition model, semantic-choice project
field, or host-capability Binding branch and inert-reference model.

Pretending those values existed would produce a schema shaped by guesses.
Instead the private discriminator is deliberately explicit:

```json
{"kind":"private-package-project-lock/1"}
```

No code treats this document as `jig.lock`, a plan, consent, an admission
generation, or an executable recipe. A public schema remains release-gated.

## 2. Included evidence

The projection copies only normalized package-project meaning:

```text
packages
    project-local package path
    exact Package/1 digest
    Run/Service mode and direct-Run eligibility
    declared attachment names and access ceilings
    local or exact URI/version/descriptor-digest capability requirements
    exact URI/version/descriptor-digest capability exports

bindings
    Binding ID and selected package path
    exact attachment source/access projections
    exact Flow-call target sets
    exact capability provider Binding/export choices
```

The package table transitively fixes every selected target/provider package,
so edges do not repeat package digests. Contract triples live on the package
requirements/exports from which compatibility was proved; capability edges
record only the selected provider. The decoder rechecks those relations.

Settings are deliberately absent. They remain normalized desired state,
participate in semantic identity and aggregate review, and are recovered from
the retained project artifact. Duplicating them in the lock would create a
second editable-looking copy without resolving anything.

Portable requested authority is present as attachment declarations,
attachment mappings, and capability dependencies. This resolves the older
ambiguous phrase “authority evidence.” Host `wouldGrant`, enforcement plans,
and realized receipts are not portable authority.

## 3. Excluded host state

The closed root and records make all of these unrepresentable:

```text
capture, semantic, plan, request, candidate, or lock digests
active generation, approval, revocation, or consent
Runtime Adapter, launch planner, Backend, or helper artifacts/revisions
host-capability provider registration, artifact, export, or generation
Python/Nix executables, versions, store paths, or GC roots
Bubblewrap, sudo, shell, cgroup, UID, PID, or coordinator facts
host policy, environment, limits, runtime predicates, or launch plans
materializations, deadlines, Run IDs, receipts, or live handles
```

The lock identity is computed externally. Embedding its own digest would be
self-referential; embedding host semantic/plan identities would make portable
evidence host-specific.

## 4. Canonical encoding and strict decoding

There is exactly one accepted byte spelling:

```text
RFC 8785 canonical JSON/1 bytes || LF
```

The decoder first applies bounded JSON/1 parsing, then validates closed fields,
canonical project paths, LocalNames, Package/1 and contract digests, stable
SemVer core, modes, sorted unique target arrays, and every reference. It rejects
dangling/non-Run targets, non-Service capability providers, incompatible
exports, attachment mismatch, undeclared capability mappings, and Service
dependency cycles. It re-encodes the normalized value and requires byte
identity, so BOMs, alternate whitespace, missing or repeated LF, and different
array order are invalid rather than silently normalized.

Strict decoding validates only canonical bytes and the lock's internal
relations. A decoded value remains untrusted desired-state evidence: it cannot
authenticate duplicated package facts such as mode, contracts, or direct-Run
eligibility, and no candidate may consume them without reacquiring and
re-resolving the exact Package/1 artifacts.

The external private digest is:

```text
SHA-256(
  ASCII("JIG-Private-Package-Project-Lock/1")
  || 0x00
  || RFC8785(value)
)
```

The empty golden document is:

```json
{"bindings":{},"kind":"private-package-project-lock/1","packages":{}}
```

with digest:

```text
sha256:db900dd30f1c77b3919b023cb6370478d10fb74d34c3f2fd190deb468e7376ba
```

## 5. Executable evidence

The focused corpus proves:

- canonical empty bytes, digest, strict decode, and immutable output;
- exact package, contract, candidate, provider, and attachment projection;
- settings changes leave portable resolution bytes unchanged;
- package or contract changes alter those bytes;
- BOM, duplicate keys, alternate formatting, missing LF, unknown fields, and
  forged host policy/Backend fields reject;
- malformed identities, dangling providers, attachment drift, unsorted or
  duplicate targets, case-fold-colliding or protected paths, capability
  equivocation, and Service cycles reject;
- Metadata/1 maps stop at 256 members while larger root package collections
  and a 10,000-Service acyclic dependency chain remain valid;
- the inclusive JSON/1 file ceiling accounts for its required terminal LF; and
- encode/decode/encode is byte-identical and nested output is immutable.

## 6. Next boundary

The next slice remains host-local and private:

```text
complete retained Adapter/planner implementation closure
complete retained Backend/helper implementation closure
stable registration identity separated from volatile preflight receipts
canonical authenticated host-policy/eligible-registration snapshot
durable Python/Nix runtime-root ownership
durable visible-lock publication followed by exact byte/digest reverification
persisted candidate/recipe identity and one lock-first admission CAS
```

Only after those artifacts can be reacquired after restart may a candidate be
persisted for lock-first admission. Publication additionally requires confined
visible-file replacement with durability appropriate to the host and a
post-publication comparison against the persisted candidate; this pure module
does neither. A runnable `READY` generation additionally needs
coordinator-chosen, persisted spawn/materialization identities and restart
fencing; Phase 3's random launch nonce and unrecorded temporary materialization
are intentionally insufficient.
