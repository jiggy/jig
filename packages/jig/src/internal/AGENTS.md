# Private Jig host

## Purpose

Keep host authority and owned execution intact through admission, failure,
cancellation and recovery. This directory owns Jig's trusted private machinery.

## Ownership

The guides below own detailed module contracts and their verification rules.
Their module indexes locate details. All selected domain requirements still apply.
Read every row that matches the files or responsibilities affected by a change.
Cross-domain work must satisfy every affected guide. If ownership is unclear,
read the execution guide before selecting a narrower scope.

| Files or responsibility | Required guide |
| --- | --- |
| `activation-*`, `project-*`, `package-*`, `dependency-*`, prepared attempts, tickets, retirement, reservations, Bun preparation, contract import/generation, installation verification | [Capture, review and admission](admission-guidance.md) |
| `root-*`, `execution-*`, `invocation-*`, evaluator, native clocks/deadlines, Linux launch/delegation, effects, dispatch or recovery | [Execution ownership](execution-guidance.md) |
| File/descriptor capture, attachments, immutable artifact rights, checkpoints, retained export, delivery, saved inspection or preview retirement | [File authority and delivery](files-guidance.md) |
| ACP, native clients, Agent installation/authentication, session retention/restoration or client diagnostics | [Native Agent resources](agents-guidance.md) |
| `macos-*`, Darwin ABI, guardian, native storage, native support assets or Mac enforcement/recovery | [Native Mac enforcement](native-guidance.md) |
| Channel rights, transfer, broker integration, reporting provenance or optional updates | [Channel integration](channels-guidance.md) |

File names do not limit these responsibilities. For example, native file work
requires both the file and native guides. Agent retention also requires
admission and execution rules. Ticket checkpoints and export require admission
and file rules. Controlled evaluation requires execution, admission and file rules,
plus native rules on Mac.

## Local Contracts

- Every `Private*` export remains package-private and is not an extension SPI.

- Unconfirmed cleanup or fencing is fatal to the owning invocation even if code
  catches its operation error. A conclusively cleaned child failure remains
  recoverable with ordinary language handling. No result-acknowledgement ledger.

- Strictly parse, bound, snapshot, and authenticate values crossing a trust
  boundary. Decoding inert bytes must not mint authority.

- Preserve the sequence observe, identify, plan, seal, admit, revalidate,
  execute. Never execute mutable project source. Installed-support evidence
  follows the operator's verification policy in the admission guide. Execution
  authority and lifecycle observations remain fresh.

- Flow code receives no ambient host authority. Minimize environment, mounts,
  executables, network, credentials, and capabilities explicitly.

- Provider credentials are host configuration and must not enter Flow input,
  project state, artifacts, diagnostics, or unrelated provider processes.

- Deadlines and cancellation fence descendants, settle each terminal once, and
  complete bounded cleanup. Do not replay uncertain operations.

- Durable transitions use exact identities and conflict-safe commits. Recovery
  must not create duplicate owners or official Runs.

- Fail closed on unsupported hosts, detected identity changes, missing
  enforcement, malformed protocol, cleanup failure, or unverifiable provenance.
  Hold the trusted entry until the coordinator validates cgroup membership and
  any output handoff. Short-lived commands must not race that check. Close the
  private continuation gate before candidate execution. Drain buffered
  supervisor control after process exit within a fixed bound. Exit alone neither
  disproves a pending receipt nor establishes fencing.

## Work Guidance

- Under the prerelease rule, replace old formats completely. Do not retain
  readers, migrations, or aliases.

- Add negative, hostile, race, restart, and cleanup evidence for trust-boundary
  changes.

- Never use mocks or private replacement evidence. Exercise real protected stores,
  real subprocesses, installed public boundaries and qualified native enforcement.
  Do not weaken production checks for an unprovisioned test.
  Report missing prerequisites and existing replacement-based test debt explicitly.

## Verification

- Containment, delegation, preparation, process-lifecycle, or Agent authority
  changes require the provisioned hostile-host suite and residue check.

- Run real-host suites sequentially within one delegated cgroup. Their strict
  acquisition and residue checks intentionally reject other concurrent Runs. The
  ordinary suite also includes host tests when delegation is present.

Use the selected domain guide for concrete checks. The package and test owners
retain installed qualification and whole-suite applicability. Use
[the suite inventory](../../../../scripts/ci/test-suites.json) for current file
membership. Configuration alone does not prove execution.

## Child DOX Index

- [admission-guidance.md](admission-guidance.md) — Capture, preparation, review,
  retained authority, tickets, quotas, retirement and installation verification.
- [execution-guidance.md](execution-guidance.md) — Dispatch, finite effects,
  controlled evaluation, boot deadlines, reservations, settlement and recovery.
- [files-guidance.md](files-guidance.md) — Descriptor authority, immutable artifact
  rights, checkpoints, retained export, publication and inspection.
- [agents-guidance.md](agents-guidance.md) — Native clients, credentials, ACP
  policy and retained sessions.
- [native-guidance.md](native-guidance.md) — Qualified Darwin enforcement, ABI,
  native storage, evaluation projection and recovery.
- [channels-guidance.md](channels-guidance.md) — Endpoint integration, bounded
  observation and publisher attribution.
