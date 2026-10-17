# Jig application execution

**Status:** prerelease contract.

This contract governs local application execution through the installed host.
The machine CLI and `@jigging/jig/client` use one acceptance and lifecycle model.
The project authoring entrypoint remains inert; application clients do not import
native host machinery or open private host state directly.

FLOW still governs finite method invocation. Tasks, Kanban, Git, scheduling,
cumulative application budgets, acceptance policy and merge authority remain
application responsibilities.

## Seven operations

| Verb | Request and result |
| --- | --- |
| `inspect` | Optional `target`; reads approved inventory or that target's retained interface and `approval`. It does not review source or establish launch readiness. |
| `prepare` | `expectedApproval`, `target`, `input`, `files`, `constraints`, `outputIntent`; captures inputs and returns `Prepared`, including the opaque `ticket`, `canonicalRequest`, `requestDigest`, `submitBefore` and `retainUntil`. No work dispatches. |
| `submit` | `ticket` plus the exact `canonicalRequest` as `request`; returns owner/observer acceptance and its receipt. Only the owner connection carries execution completion. |
| `lookup` | `ticket`; reads identity, dispatch, execution, terminal, cleanup and retention observations without advancing execution. |
| `cancel` | `ticket`; requests scoped revocation and returns `acknowledged` plus an observation. Acknowledgement is not confirmed cleanup. |
| `result` | `ticket`; reads the observation, retained `output` when available, `artifactResults` and optional latest `checkpoint`. |
| `export` | `ticket`, new `destination`, optional `source: 'final' \| 'checkpoint'` and optional final `artifactResult`; publishes retained bytes without execution and returns destination, manifest digest and actual source. |

`source` defaults to `final`. `artifactResult` selects one final name and
cannot be combined with `source: 'checkpoint'`. `outputIntent.receive` selects
retained artifact names, not live channel subscriptions; `packet` records packet
intent, not a destination path. Prepare file entries use `{ port, source,
selection }`; canonical file entries instead identify captured bytes with
`{ port, manifestDigest, bytes }`. Submit the returned request unchanged.

### A complete application call

This example assumes an already reviewed `binding:repair` with one unbound
`source` read port and a declared forwarded result named `final`. The caller
chooses the installed executable and project directory. Its application store
must atomically persist the whole `Prepared` value with the task before submit:
the injected transaction below is an application responsibility, not a Jig API.

```ts
import {
  createAttemptClient,
  type Prepared,
  type PrepareRequest,
} from '@jigging/jig/client'

export async function repair(
  executable: string,
  projectDirectory: string,
  persistTaskTransaction: (prepared: Prepared) => Promise<void>,
) {
  const client = createAttemptClient({ executable, cwd: projectDirectory })
  const target = 'binding:repair'
  const inspected = await client.inspect({ target })
  if (inspected === null || Array.isArray(inspected) ||
      typeof inspected !== 'object' ||
      typeof inspected.approval !== 'string') {
    throw new Error('Review the project and select an approved target first')
  }
  const request: PrepareRequest = {
    expectedApproval: inspected.approval,
    target,
    input: { issue: 'Handle an empty document' },
    files: [{ port: 'source', source: './src', selection: ['main.ts'] }],
    constraints: {
      durationMs: 120_000,
      resultBytes: 1_048_576,
      artifactBytes: 33_554_432,
    },
    outputIntent: { packet: true, receive: ['final'] },
  }
  const prepared = await client.prepare(request)
  await persistTaskTransaction(prepared) // Commit before any launch-capable call.
  const submission = await client.submit({
    ticket: prepared.ticket,
    request: prepared.canonicalRequest,
  })
  // Save receipt as evidence too; Prepared already supplies recovery identity.
  const { receipt } = submission
  const completion = await submission.completion
  // An observer gets undefined completion: lookup never takes over the owner.
  const observation = completion ??
    await client.lookup({ ticket: prepared.ticket })
  const retained = await client.result({ ticket: prepared.ticket })
  let exported
  if (retained.observation.terminal?.status === 'succeeded' &&
      retained.observation.cleanup === 'confirmed' &&
      retained.artifactResults.some(
        artifact => artifact.name === 'final' &&
          artifact.availability === 'available',
      )) {
    exported = await client.export({
      ticket: prepared.ticket,
      destination: './exports/repair-001', // Existing parent, absent leaf.
      source: 'final',
      artifactResult: 'final',
    })
  }
  return { prepared, receipt, observation, retained, exported }
}
```

The application creates `exports/` beforehand and chooses a new destination.
An observer may still find pending work; it must not treat the absence of a
terminal as permission to submit another ticket. For interruption, call
`client.cancel({ ticket: prepared.ticket })`, then read observations until the
original owner settles. `submission.close()` revokes an owner connection's Run;
closing an observer affects only that observer.

`client.run(request)` is the one-shot prepare/submit/join convenience. For the
same durability boundary use
`client.run(request, { persist: persistTaskTransaction })`: the helper awaits
that callback before submit. It returns `{ prepared, receipt, role,
observation }`, not domain success or exported bytes. A rejected transport or
aborted call can leave an incomplete observation; recover using the persisted
ticket, never an automatic new request. `AttemptClientError` exposes `code`,
`operation` and conservative `uncertain` rather than subprocess stderr.

## Preparation and exact acceptance

A host-issued opaque ticket identifies one prepared request. Preparation captures
and retains immutable input, target, selected approval, declared file identity,
requested execution constraints and output intent. It dispatches no package,
Agent, evaluation or command work.

A durable caller MUST persist the prepared ticket and canonical request in its
own durable task transaction before launch-capable submission. A one-shot joined
helper may coordinate preparation and submission, but cannot provide application
durability merely by returning a promise. Losing a preparation reply cannot have
started execution.

First acceptance atomically checks expected approval, binds the exact request to
one Run and reserves the required lifecycle and promised result capacity before
effects. Requested duration is frozen; its accepted absolute deadline is computed
once. Repeated contact cannot extend it.

An exact duplicate with retained acceptance history identifies the original Run,
independent of subsequent approval changes. Reusing the ticket with changed
canonical meaning conflicts; it neither resolves against current approval nor
allocates another Run.

The first accepted submit owns foreground execution. Duplicate callers are
observers. Closing an observer does not cancel the original owner, close its
project session or revoke unrelated work.

Tickets identify records; they are not bearer permissions. Every operation still
requires the caller's independently established local project authority. Tickets
and prepared input MUST NOT be placed in command arguments, diagnostics or
observation dashboards.

## Observation, cancellation and uncertainty

Lookup is genuinely observational. It cannot acquire a pumping execution
controller, dispatch pending work, recover by running a method, renew validity,
extend a deadline, or repair missing state.

Cancellation requests revocation of the original owned invocation. Request
acknowledgement, local fencing and complete cleanup are separate facts. Natural
completion may win the cancellation race; an accepted terminal remains immutable.

The original safety owner must enforce deadlines and settle ownership without
lookup polling. Losing the execution owner fences and settles work; it does not
resume its Flow. Ordinary client/coordinator loss and independent-owner loss have
separate enforcement and evidence obligations.

Possibly accepted remote effects may remain uncertain after successful local
cleanup. Missing or expired history is not proof that work never dispatched.
Neither lookup, a helper, a new ticket nor a changed output destination may
silently replay uncertain work.

## Validity, retention and safe forgetting

Submission validity, acceptance-history retention, result-byte retention and
unresolved ownership have distinct lifetimes.

The host MUST validate a ticket's protected project/domain binding and bounded
validity independently of whether its attempt record still exists. Retirement
becomes durable before acceptance records are deleted. A retired or expired
ticket can never allocate another Run.

Records needed by active or cleanup-unresolved work remain reserved until that
ownership is conclusively settled. Clock anomalies may refuse unsafe new
issuance/acceptance but cannot disable cancellation or cleanup. Missing, damaged
or replaced protection state fails closed rather than initializing acceptance
for an old ticket.

The guarantee covers the documented ordinary process-loss cases. It does not
promise execution continuation across machine restart or detection of arbitrary
trusted-operator rollback of protected state and its keys.

Capacity exhaustion refuses new work before effects; it cannot evict required
non-reuse evidence or recommend deleting state or changing a ticket to retry
uncertain work. Validity and minimum retention cutoffs are explicit in prepared
results. Quotas and current availability remain inspectable bounded facts.

## Results and export

Public observations preserve these distinctions:

- Original acceptance and selected approval.
- Known dispatch versus unavailable or uncertain execution evidence.
- Immutable execution terminal, including application outcome/output or failure.
- Cancellation requested versus confirmed fencing and cleanup.
- Retained final artifacts, checkpoint artifacts and unavailable bytes.
- Export publication, destination collision and lost acknowledgement.

The receipt binds `runId`, `requestDigest`, `acceptedAt`, `target` and
`approval`, with artifact availability separately reported. `approval` is the
selected admission digest, not the current visible source or a new approval.
`dispatch: 'not-dispatched'` is a positive observation about a retained
unaccepted preparation or a terminal refusal with no execution lifecycle.
`possible` means effects cannot be excluded, including missing history and
accepted work without a proved successful terminal. The current host reports
`confirmed` for a successful execution terminal, not for every live dispatch.
It does not establish that a particular package instruction or provider request
ran, a remote consequence occurred, or the application's task succeeded.
Terminal, cleanup and retained-byte observations must be interpreted independently.

The normal joined helper coordinates these facts without reducing them to an
application-success boolean. A method's `blocked` outcome remains a domain
answer, not a host decision that a task succeeded.

An explicit final artifact selection refers only to a held sealed snapshot
declared by the method contract. The host validates rights and pins selected
bytes with accepted root-result retention before retiring live invocation rights.
Domain JSON, a pathname or a supplied digest cannot manufacture that selection.

Export resolves retained host records and immutable bytes. An optional declared
artifact-result name selects that original final snapshot; it is not a raw host
path or a new execution target. Export acquires a bounded read pin and publishes
without replacement. Expiry cannot delete bytes under an accepted pin.

Export failure never changes execution outcome or re-executes the method.
Exported packets remain recorded local claims; their internal hashes establish
consistency, not newly authenticated host provenance. Protected lookup and saved
packet inspection are different operations.

Checkpoint export selects the latest accepted aggregate rather than unfinished
scratch or a previous final result. After confirmed cleanup it can preserve
useful progress from a failed or lost Run without rewriting that original status:

```ts
import { createAttemptClient, type Prepared } from '@jigging/jig/client'

export async function exportProgress(
  executable: string,
  projectDirectory: string,
  prepared: Prepared, // Loaded from the application's durable task record.
) {
  const client = createAttemptClient({ executable, cwd: projectDirectory })
  const result = await client.result({ ticket: prepared.ticket })
  if (result.observation.cleanup !== 'confirmed' ||
      result.checkpoint?.availability !== 'available') return result
  const publication = await client.export({
    ticket: prepared.ticket,
    destination: './exports/repair-001-checkpoint',
    source: 'checkpoint',
  })
  return { result, publication }
}
```

### Capacity and time limits

Request limits are 24 hours duration, 1 MiB result JSON and 256 MiB artifact
allowance. The artifact allowance bounds retained final and latest checkpoint
bytes together; checkpoint aggregates also retain their own 16 MiB ceiling.
These are distinct from the live invocation's 256-reference, 16-snapshot,
256-MiB aggregate artifact budget, which counts retained and materialized live
bytes. Aliases do not create more live snapshot bytes.

Prepared inputs, accepted control/result reservations, retained artifacts and
checkpoint bytes use the protected attempt store's shared 4 GiB quota.
Review's source/prepared Package/0 archive is separate: 192 MiB per canonical
artifact and 1 GiB per project. None of these increases per-invocation file
limits. Reservations account for logical capacity before effects; they are not
a physical filesystem allocation or a guarantee against filesystem `ENOSPC`,
I/O failure, machine loss or trusted-operator state damage.

Retention is bounded, not permanent archival storage. Cross-boot clock
uncertainty may conservatively extend custody rather than reclaim required
evidence early. Loss of reliable retention-clock evidence can make bytes
unavailable without rewriting an established terminal or cleanup fact. Missing
history never establishes non-execution or grants replay permission.

## Machine command boundary

`jig attempt <operation> --json` is the installed machine boundary. Operations
are `inspect`, `prepare`, `submit`, `lookup`, `cancel`, `result` and `export`.
Requests and replies are closed, versioned, bounded JSON records;
unsupported framing and unknown fields refuse without a fallback.

Each stdin line has the envelope
`{ "protocolVersion": 1, "operation": "<verb>", "request": { ... } }`.
Unary replies have `event: "result"` and `value`; errors have `event: "error"`,
`code` and a bounded `message`. Submit first emits `event: "accepted"` with
`role` and `receipt`, then only the owner receives `event: "terminal"` with
`observation`. Each frame also carries `protocolVersion` and `operation`.
Requests are bounded to 1 MiB, stdout frames to 16 MiB and captured transport
stderr to 64 KiB. An unknown field is not an extension point.

Requests arrive on stdin, not argv. Submission reads one complete initial
request while retaining the owning connection through settlement. Client loss
and malformed extra input revoke that connection; closing a duplicate observer
does not acquire cancellation authority over the original owner.

Machine stdout contains only bounded protocol records. Human diagnostics use
stderr, fixed safe causes and machine codes without echoing tickets, source
input or private exception text. EOF, truncation and missing terminal delivery
remain incomplete observations, not success or retry permission.

The TypeScript client uses the same installed executable and never introduces
another admission engine, persistent daemon, execution queue or public backend
framework. Importing it does not start a host.

## Verification obligations

Qualify identical and conflicting concurrent submissions, approval races,
process loss around acceptance/dispatch/terminal/retention/export, observational
lookup, retirement-before-GC, clock anomalies, storage exhaustion, cancellation
races and malformed framing.

Native descendant fencing, protected-state ordering, installed Node/Bun clients
and public-only unfamiliar consumers require separate evidence. Source mocks
alone do not qualify enforcement, durable result availability, portability,
method quality or a release.

See [project policy](project-policy.md), [CLI experience](cli-experience.md),
[Run Checkpoint](run-checkpoint.md), [file guidance](../guide/files.md) and
[results and recovery](../guide/results.md) for their respective boundaries.
