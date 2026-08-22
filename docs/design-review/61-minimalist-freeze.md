# Minimalist freeze audit

## Verdict: BLOCK

The architecture is not blocked by a missing feature. It is blocked by six
small contradictions in the surface already claimed for v1. Four would make
independent implementations behave differently; two leave duplicate or dead
public concepts after the ballots explicitly removed them.

Apply only the patches below, then freeze. No additional abstraction is
needed.

## 1. BLOCK — an unbound operation cannot hash a binding it does not have

Section 5.6 says the operation digest includes exact binding identities when
`INTENT` commits. Section 10 allows the same operation to commit an unbound
`WAITING_BINDING` state and acquire a binding later through compare-and-set.
Both cannot be true.

This fails the missing-Flow scenario at its first durable retry. Either Jig
cannot record the waiting intent, or it must recompute the operation digest
after repair. Recomputing lets the same `(owner, operationId)` mean different
work and breaks deduplication.

### Minimal patch

Define two immutable records:

```text
caller request digest
    RFC 8785 over the caller-supplied method, slot, selector/operation,
    input, and caller-visible attachment identities

resolution
    one exact selected Binding/provider revision, initially absent when
    waiting and filled exactly once by compare-and-set
```

The operation key and caller request digest commit at `INTENT`. An exact
prebinding may commit the resolution in that transaction. A repaired or
semantic binding fills the resolution once. Dispatch requires a resolution and
atomically commits it with child/lease creation. Retrying the same request
joins the original operation and never reruns resolution after it has been
filled.

Remove “exact binding identities” from the caller digest sentence. Binding
identity remains part of the durable operation record and dispatch identity.

## 2. BLOCK — dynamic Service dependencies cannot be declared

Section 3.2 calls its frontmatter vocabulary complete. Its `uses` entry has
only contract identity/version/digest. Sections 6.2 and 6.4 nevertheless expose
`service/bindings` only for dependencies “explicitly declared dynamic.” No
field can make that declaration.

This fails the required Cordis scenario: a realm cannot distinguish a static
injection whose loss terminates the Mount from a dynamic injection eligible
for a replacement snapshot.

### Minimal patch

Add one closed member to a `uses` entry:

```yaml
uses:
  sessions:
    contract: https://example.org/contracts/sessions
    version: 1.0.0
    digest: sha256:...
    binding: dynamic       # optional; default is static
```

`binding: dynamic` is valid only for Service/1 packages. No other modes exist.
Finite Runs and omitted values are static. Keep the existing rule that only
declared dynamic slots accept `service/bindings`.

## 3. BLOCK — the package digest has a platform-relative mode rule

Section 3.5 hashes “one normalized executable bit where relevant.” “Where
relevant” has no cross-source or cross-platform meaning. Git, npm, OCI, local
Windows directories, and Unix directories can therefore hash the same admitted
package differently. Package/1's primary conformance claim is exactly that
they do not.

No v1 scenario needs source mode bits. Runtime/1 launches one known root entry
explicitly and already owns preparation.

### Minimal patch

Ignore all source permission bits in the canonical Package/1 digest. Hash only
normalized relative file path and exact bytes; directories are structural and
special files remain rejected. A Runtime Provider materializes any executable
mode required by its prepared layer under the exact Runtime Contract. Record
that prepared-layer mode in Runtime provenance, not package identity.

## 4. BLOCK — discovery intent and semantic policy have two authorities

Section 5.5 makes `flow/call` carry the consumer's optional discovery intent.
Section 8.1 gives the project Binding another `discover.intent`. The Binding
also names `semantic: semanticRouter` while section 10 says semantic ranking is
one optional project module behind the kernel Resolver. No precedence is
defined for either duplicate.

The smallest failure is a parent asking for “retrieve grounded evidence” while
its Binding says “generate a creative answer.” Two conforming hosts can rank
different candidates by choosing a different intent. Per-slot semantic module
selection also recreates router profiles without a named v1 scenario.

### Minimal patch

Change the example and normalized discovery policy to:

```ts
research: discover({
  onMissing: "fail",
})
```

The `flow/call` value is the only call intent. The project may exact-bind the
slot or configure missing/wait/repair policy; it does not rewrite meaning.
There is one optional SemanticRouter module in an activation. Remove per-slot
`semantic` selection from v1.

## 5. BLOCK — portable environment permission has no value source

The closed frontmatter advertises `permissions.env: [CI]`. The Flow Binding has
no environment-value mapping, settings explicitly reject environment fallback,
and section 11.2 says the environment starts empty. The field is therefore
either inert or causes Jig to copy ambient daemon state outside the activation
digest.

No named v1 scenario requires raw component environment. Settings carry
configuration and effect slots carry secrets. Runtime-private environment
needed to start Python, Deno, or a native executable belongs to the exact
Runtime Contract and is not component configuration.

### Minimal patch

Remove `permissions.env` from Package/1 and remove literal environment names
from the base permission vocabulary. Component-visible environment is empty
except fixed FLOW-reserved entries defined by its exact Runtime Contract.
Projects use settings or a bound secret/config capability for values. A future
environment Grant Profile needs its own value-source and provenance semantics;
v1 does not reserve them.

## 6. BLOCK — `Event/1` and v1 structured telemetry survived their removal

Section 9.2 introduces a “normative Event/1 envelope,” but the layer model and
conformance labels contain no Event/1 profile. The Journal is already an exact
Service Contract used through `effect/call`; a second event standard is a
duplicate schema authority.

Section 5.2 and section 16 defer Telemetry/1, while section 14.2 still lists
“optional structured telemetry and observability” among facilities Jig ships.
That is a v1 feature with no correctness scenario. It contradicts the final
telemetry ballot: bounded `stderr` is the only v1 diagnostic surface.

### Minimal patch

- Rename “normative Event/1 envelope” to “the official Journal contract's
  `Event` value schema.” It is versioned and digested as part of that exact
  Service Contract. Do not create another FLOW conformance label.
- Remove structured telemetry from the v1 official-module list.
- Change governing law 11 to: “Durable events and diagnostics are different;
  diagnostics never drive control flow.”
- Keep Telemetry/1 only in section 16's deferred list.

## 7. Required protocol wording corrections

These do not add concepts, but they must be made before independent
conformance because the current prose is self-contradictory.

### 7.1 Outbound call fields

Section 5.3 says every outbound call includes `slot` and
`operation/selector`. `service/status` and `request/cancel` do not.

Patch it to say every component-originated `flow/call` and `effect/call`
contains those fields. State separately that every `service/status` names the
live owning mount request and its status revision; `request/cancel` names the
still-pending request originated by its sender.

### 7.2 Status revision ordering

Section 6.3 says revisions are strictly increasing and that a repeated revision
can be idempotent. Patch it to:

> A new snapshot revision is greater than the last accepted revision. A
> retransmission of the last accepted revision succeeds only with the same
> canonical digest; a changed or older revision is a protocol error.

### 7.3 Dynamic binding pinning

“Mount-background work uses the latest acknowledged revision” is insufficient
when a snapshot changes during an operation. Patch it to:

> At operation-intent commit, each Mount-background call snapshots and stores
> the latest acknowledged binding revision. Later snapshots cannot alter that
> operation's provider. Each `service/invoke` likewise carries its admission
> snapshot for all child calls.

### 7.4 Feature negotiation residue

Section 5.4 supplies “protocol limits/features,” but base Run/1 has no optional
feature negotiation; Services are separately conforming and telemetry is
deferred. Change this field to `protocol limits`. Unknown future profiles must
not enter through an unspecified feature bag.

## Not blockers

The following apparent duplications are intentional and should not be edited:

- package permissions request authority while a Binding/project policy grants
  it;
- a wire request ID owns live work while an internal lifetime ID owns durable
  records;
- the kernel transaction/outbox guarantees atomic operation facts while the
  Journal module supplies public append/query/wait behavior;
- a Caskada Router chooses local graph successors while Jig's Resolver binds an
  external package;
- instruction fallback needs both package declaration and Binding permission;
- Service/1 is official and stable-gated while remaining optional for a
  Run-only host.

`Scope` is named only to explain Jig internals and is explicitly absent from
the wire and user API. That is documentation, not a leaked public primitive.

## Freeze decision after patches

After the six blocks and four wording corrections above, **PASS**. The audited
architecture then matches the ballots:

```text
one live request owns execution
one operation record separates caller intent from chosen binding
one effect gateway carries durable Journal operations
one exact contract describes JSON methods and errors
one deterministic Resolver owns eligibility and commit
one optional SemanticRouter only ranks
one Flow Binding owns complete immutable configuration
one runtime standard owns launch semantics
```

Do not add a callback, subscription, telemetry, environment, Hook-code, or
extra lifetime abstraction during freeze. None fixes a remaining v1 scenario.
