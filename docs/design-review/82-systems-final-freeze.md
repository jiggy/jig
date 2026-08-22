# Final systems freeze audit

## Verdict: PASS

No concrete v1 lifecycle, crash, race, atomicity, or authority contradiction
remains in the current `60-reviewed-architecture.md`.

This is a pass for **architecture freeze**, not a waiver of the public `1.0`
gates. The machine schemas, error registry, black-box state fixtures, Runtime
Providers, independent host, plain Service, Cordis adapter, Sandbox Backend,
and kill-injection suites in section 15 must still exist before their respective
stable conformance labels are published.

The previous five blockers are closed as follows.

---

## 1. Owner response, EOF, and quiescence: PASS

The owner now has one unambiguous terminal path:

```text
OPEN
  -> RESPONSE_RECEIVED
  -> QUIESCING
  -> SUCCEEDED | FAILED | LOST
```

Trace:

```text
component writes complete terminal frame
    -> host atomically leaves OPEN and closes admission
    -> a following EOF closes other wire requests only
    -> host returns OWNER_CLOSED on pending component-originated calls
    -> downstream work cancels or becomes terminal/UNCERTAIN
    -> output validates
    -> owner commits exactly once
```

EOF before a complete terminal frame produces `LOST`; EOF after the frame
cannot overwrite the buffered result merely because read-loop scheduling
varies. Frames after the terminal frame cannot acquire authority. Normal
completion, cancellation, hard kill, and uncertain external work therefore no
longer compete for an unspecified owner state.

No implicit detachment or reparenting remains. Mount-owned background work and
invocation-owned work have separate live request owners, and returning an
invocation cannot accidentally transfer its children to the Mount.

Required conformance trace already present: vary read chunking around the final
frame/EOF and owner-child states, including a child which ignores cancellation.

---

## 2. Service startup, status, dynamic revisions, and drain leases: PASS

Revision 0 now supplies a complete installed dependency snapshot before
provider initialization:

```text
service/mount(revision 0)
    -> provider initializes against exactly 0
    -> optional complete positive service/bindings revision
    -> ready status names exactly one acknowledged revision
```

Every later snapshot repeats static entries byte-for-byte and replaces only
declared dynamic entries. An invocation pins one acknowledged revision for all
of its child calls; every Mount-owned operation stores one acknowledged
revision at intent commit. No request can observe a partial old/new dependency
mixture.

Availability publication also has one commit point:

```text
accept status revision
    = record digest
    + allocate fresh availability generations
    + close removed-generation admission
    + mark consumer bindings lost
    + record cancellation of admitted invocations
```

Acknowledgement happens afterward. An invocation racing removal is therefore
admitted-before-and-cancelled or rejected-after; there is no third state.

The generalized Binding lease closes the prior drain ambiguity:

- a consumer owner holds one lease on the exact provider generation;
- entering drain prevents new consumer leases;
- an existing live lease may continue to create invocations;
- every admitted invocation holds its narrower operation lease;
- owner loss and dynamic snapshot replacement release their leases under
  fencing;
- final lease release or the recorded drain deadline closes admission and
  cancels the Mount;
- status removal is immediate withdrawal and deliberately bypasses graceful
  drain.

Lease acquisition/child creation already shares the operation dispatch
transaction, while owner close shuts admission before lease release. The
release-versus-new-invocation race consequently has one winner rather than a
use-after-drain window.

Status and binding revisions remain control-plane idempotency keys, not effect
operation IDs. Their exact schemas and single-Mount state fixtures remain a
release artifact, not an architecture decision.

---

## 3. Operation ledger and canonical Event Journal: PASS

The earlier cross-provider atomicity claim has been removed. Jig v1's canonical
Journal is host-native and participates in the kernel transaction:

```text
effect operation intent/resolution
    -> canonical append
    -> Event + receipt
    -> outer effect terminal result
    -> Hook-selection outbox
```

These commit together. Crash before commit produces none; crash after commit
recovers the same outer operation result and Event without redispatch. The
generic `UNCERTAIN` rule remains intact for every external provider operation.

A mounted Service cannot impersonate the canonical Journal, acknowledge Hook-
driving Events, or gain a special recovery exception across provider-generation
loss. External stores may mirror or expose ordinary methods only. This removes
the missing durable-store identity and the conflict with Service/1's no-healing
rule.

The operation record separately freezes caller content and fills resolution
once. Same operation key/content joins; changed content fails; resolution never
reruns after its compare-and-set. Child allocation and lease creation remain in
the dispatch-admission transaction. There is no silent replay path.

---

## 4. Event authority, Hook intervals, and derived Runs: PASS

An untrusted caller can no longer trigger a privileged Hook merely by copying
an Event type string.

Authority is now conjunctive:

```text
Journal publisher attenuation permits exact owner-qualified type
AND
Journal stamps authenticated source from exact Binding/kernel identity
AND
Hook matches exact source selector/allowlist plus exact type
AND
Event position lies within Hook revision's half-open interval
```

Kernel lifecycle namespaces are nondelegable. Text similarity and caller-
supplied producer fields confer no authority.

The admission transaction orders Hook intervals against the one project
Journal. For every selected `(Hook revision digest, Event ID)`, the unique
derived Run row is inserted or returned. Crash/redelivery may repeat outbox
work but cannot allocate a second Run.

Input handling no longer asks hosts to prove JSON Schema containment. Jig
creates the one derived Run from the actual immutable Event, applies ordinary
concrete-value validation, and records that same Run as terminal
`INVALID_INPUT` if validation fails. No retry, mapping, alternate Binding, or
second Run is introduced. This is deterministic across independent schema
implementations using the fixed JSON Schema profile.

Candidate Service Events are also fenced correctly: their authenticated source
is the exact candidate Binding identity, and pre-publication Hook intervals do
not silently reinterpret that identity as an active producer.

---

## 5. Binding/configuration and security closure: PASS

The generalized Binding now configures either a Run-capable or Service-capable
package without parallel configuration systems. Package mode is exact and
immutable; Service packages cannot fall back to Markdown or be invoked as
Runs.

The config capture contains its static import closure, lock-selected artifacts,
and evaluator/loader Runtime identity. Evaluation cannot consult ambient
modules, environment, network, processes, or secrets. The candidate copy—not
an impossible claim of a simultaneous multi-file filesystem snapshot—is the
sole normalized input.

Portable raw authority is now intentionally narrower:

```text
read-only package bytes
private scratch
protocol stdio
named attachment read/write modes
empty environment except fixed Runtime FLOW_* entries
raw network denied
raw child process denied
```

Agent, Git, HTTP, database, secret, and tool authority crosses explicit
mediated effects. Grant Profiles have been removed from v1 rather than left as
precise-looking but unproved promises. A trusted exact-digest override is
explicitly nonportable and not described as sandboxed.

For untrusted execution the Runtime/Sandbox plan expands into a closed
predicate set, and every applicable predicate must be enforced or mediated.
Preparation has its own plan and cannot inherit trusted Runtime Provider
authority. Old coordinator epochs, forged owner IDs, inherited descriptors,
descendant processes, and unavailable confinement all fail closed.

---

## 6. Admission generation, candidate effects, and source publication: PASS

The architecture now makes exactly the atomic claim it can implement:

> one durable admission-generation pointer selects the complete Jig generation
> for each new admission.

Root Runs, Resolver policy/catalogue, Hook boundaries, Bindings, and new
Service consumer leases select that generation. Existing owners retain their
old immutable generation. A repaired unresolved call may extend only its own
binding table with one recorded provider revision; it does not switch project
generation.

Candidate Services are honestly nontransactional with the external world.
They receive no consumer leases before publication, but their startup effects
are real, attributed, journaled, and potentially irreversible. Failure cancels
the candidate and reports committed/uncertain effects rather than claiming
rollback.

Filesystem source replacement and database admission publication use a durable
recovery protocol:

```text
PREPARED
  -> SOURCE_SWITCHED
  -> ADMISSION_SWITCHED
  -> COMMITTED
```

New admission remains blocked throughout an incomplete switch. Same-filesystem
rename gives each source transition an atomic local step; the transaction
record and digests determine roll-forward/rollback after a crash. The Hook
interval boundary and admission pointer share the Jig database transaction.
Thus observers may diagnose an interrupted intermediate state, but no new work
can run against a mixed generation.

Rollback uses the same protocol in reverse, while runtime-only pinning remains
an explicitly divergent operation. No external effect is claimed reversible.

---

## Final freeze ruling

The current architecture has one owner model, one operation uncertainty model,
one Service generation/lease model, one canonical Event transaction, one Hook
authority rule, one Binding model, and one admission-generation boundary.

The remaining implementation work is already correctly expressed as
conformance gates. A failed framing, race, crash, sandbox, independent-host, or
Cordis fixture blocks a public conformance label; it no longer reveals an
unresolved choice in the architecture itself.

**PASS: freeze the architecture and move to normative schemas, state-machine
fixtures, reference implementations, and adversarial conformance testing.**
