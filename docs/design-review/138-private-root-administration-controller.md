# Private Root Administration/1 controller

**Status:** implemented release-gate checkpoint with execution ownership
corrected by [review 142](142-direct-root-closure-repair.md). One private
controller implements the closed Root Administration/1 candidate over the
fenced durable root-Run path. The public subpath remains a candidate, not a
publication claim.

## 1. Consumer boundary

The packed `@jigging/jig/administration` subpath exports only:

```text
RootAdministration.startRun
RootAdministration.runStatus
RootAdministrationError
closed request, receipt, status, terminal, and error types
```

The host hands an already-open project authority to a trusted host-side
frontend or control-plane integration outside every FLOW activation. The
consumer cannot choose or inspect the project path, coordinator, deadline,
admission, Runtime Adapter, Sandbox Backend, process, cgroup, environment, or
grants. Root Administration is not injected through Run/1. The machine schema
is packaged at
`@jigging/jig/schema/root-administration-1`.

## 2. Private ownership model

Opening the controller acquires the exclusive project coordinator, inventories
older work, and synchronously recovers it before returning authority. A start
request is normalized and immutably captured before the controller supplies
its host-owned deadline and performs durable submission. Current-epoch work is
pumped from durable state, including a Run whose submission committed before
the caller observed its receipt. An idempotent replay returns the prior Run ID
without redispatching package code.

The controller captures one trusted executor function when it opens. That
function closes over the admitted runtime and Backend mechanisms. It is not a
public extension interface and is never accepted from an administration
caller. Ordinary private database contention is retried inside the controller;
only persistent contention crosses the boundary as `PROJECT_BUSY`.

Status reopens the durable Run and projects only the closed public read model.
Successful internal terminals are flattened to `outcome`, `output`, and
diagnostics. Every projected value is an immutable JSON/1 snapshot.

## 3. Failure and shutdown

An executor failure becomes a durable failure only after the exact Backend
owner is fenced and backing is released. An unconfirmed fence remains pending.
Controller shutdown first revokes the public authority, signals active
launches, pumps durable work, drains confirmed terminal publication, and then
releases the coordinator. A launch interrupted before a committed root result
receives `CANCELLED` after fencing. Cleanup errors are retained and surfaced;
they are not discarded as detached Promise rejections.

Coordinator death remains a different case. The outside Backend owner retains
resource cleanup, and the next controller reconciles the unresolved old epoch
to `COORDINATOR_LOST` only after it confirms that fence and releases backing.

## 4. Proof

- A real activation-store test drives the public object through idempotent
  replay, conflicting reuse, pending-to-terminal projection, unknown Run,
  executor failure, shutdown cancellation, ownership exclusion, and disposal.
- The existing hostile retained-project test now starts and observes its real
  Python Run/1 component through the administration controller. It still uses
  the cgroup-v2/Bubblewrap envelope and leaves no Run cgroup or process residue.
- `conformance/root-administration-1/consumer.ts` imports only the public
  administration subpath and supplies host-side consumer-owned polling policy.
  The private host injects the real authority, and package smoke compiles the
  same source against the packed artifact.

The checked-in consumer is a clean public-surface gate, not an independently
authored implementation. A separate reviewer then packed and installed the
package and authored counter-probes without using private imports. Its initial
review found three contract ambiguities: the hidden `submissionId` alphabet,
undefined replay equality/concurrent linearization, and undefined authority
closure behavior. The candidate removed the hidden alphabet and closed both
lifecycle definitions. The same reviewer re-ran the original counterexamples
and passed the amended candidate. Review 139 records that gate.

## 5. Deliberate omissions

This checkpoint does not add project opening, IPC, authentication, list,
watch, cancel, retry, delete, public plan/apply, authority inspection, Hooks,
Services, Agents, semantic choice, or a public Runtime/Sandbox SPI. Those must
earn separate closed interfaces.
