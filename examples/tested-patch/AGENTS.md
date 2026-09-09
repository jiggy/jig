# Tested project patch

## Purpose

Turn a small Bun project and a supplied defect into a bounded multi-file patch
with collected command evidence and independent acceptance. This authored
application is not an unrestricted repository worker or independent probe.

## Ownership

- `README.md` introduces the application; its public guide owns user instructions.
- Root `package.json` owns development dependencies; Flow-local manifests
  declare runtime dependencies prepared by Jig during review. This directory
  is the editable application; no custom distribution build is required.
- `flows/project/` owns root file capture, fixed CLI cases, one- or two-job
  invocation, single-job broadcast wiring/presentation and bounded recording, evidence checks,
  applicable patch construction, and deliverables.
- `flows/repair/` owns the reusable JSON-input leaf, proposal validation,
  at most two Agent calls, selected phase publication, command effects, and
  acceptance of observations.
- `flows/monitor/` owns capability-free filtering and formatting of repair
  phases. Its settings select the presentation, not the repair policy.
- `bindings/` owns exact specialist/monitor slots and reviewed Bun commands.
- `fixtures/log-report/` and `fixtures/timesheet/` own intentionally defective
  CLIs and repository tests; never run variants outside completed containment.
- `issue.json` selects one project issue; `batch.json` selects two independent
  jobs with their source directories, permitted edits, and fixed check sets.
- `test/` owns deterministic application checks. Host evidence belongs to Jig.

## Local Contracts

- The root alone receives `source: read` and `deliverables: read-write`.
  Per project, accept 16 regular Unicode text files totaling 64 KiB and at most eight
  selected existing TypeScript/JavaScript paths below `src/`.
- The leaf accepts JSON `issue`, `files`, `editPaths`, and `cases`.
  It has Agent and Project Command capability uses, no attachments or slots.
- A single job uses two siblings: repair publishes once through an optional
  `progress` sender; the root allocates separate broadcast subscriptions for
  the replaceable monitor and its own recorder before dispatch. The monitor
  receives `phases` and sends `display` to the root. Phase records carry only phase/attempt, never source,
  Agent messages, or acceptance evidence. The root prints text or forwards its
  optional `progress` output without a Log capability. Normal one-shot Agent
  clients need no event support.
- The root retains at most six records in `output.recording` and final
  `files/progress.json`, with separate completeness from `output.monitoring`.
  Subscriber failures remain local. The trace is not acceptance evidence;
  early patch checkpointing does not wait for it or promise its retention.
- Monitoring is separate from execution and checkpoints. Dispose rejected
  observation paths; account for moved rights through host operations, not a
  guessed call outcome. Recover settled monitor/display failures as incomplete
  progress while independently awaiting and retaining repair. Root cancellation,
  uncertain ownership, and fatal errors abort and join owned branches.
- The operator names `tests` and `cli` commands in the specialist Binding.
  Jig supplies installed Bun and keyless containment; source is immutable.
- Host output and termination establish process evidence. Repository tests
  can be interfered with by candidate code. Independent assertions compare
  collected CLI behavior without importing source or accepting a pass flag.
- Reproduce an independent baseline mismatch before an Agent call. Use the
  same unchanged cases for every candidate. One invalid proposal or failed
  evaluation permits one correction, with every proposal against the original.
- Cancellation, deadline, uncertainty, unavailable support, and cleanup failure
  propagate without correction or replay. Available operation details retain
  prior evidence; missing terminal evidence must not be invented.
- Root evidence checks validate captured/candidate identities and acceptance.
  Construct complete-file patches from validated replacements, not model diff
  text. Write `review.patch` only for a verified passing result; preserve valid
  failed proposals and invalid-proposal reasons. No automatic application.
- The root declares Run Checkpoint and saves complete validated aggregates;
  only accepted checkpoint files survive interruption after confirmed cleanup.
  Saving does not certify the application verdict. A passed finite case set
  establishes tested behavior only, not correctness or marketing superiority.
- Validate all batch jobs before dispatch. Use distinct operation identities
  through the same exact slot, with at most two siblings. Optional per-job
  cancellation preserves settled sibling results. Checkpoint after each settled
  job, serialize saves, identify pending jobs, and retain separate base/candidate
  and acceptance identities. Root failure preserves only acknowledged/accepted
  progress while the independent command owner lives, never arbitrary scratch.
  Batch uses both child positions for repair and does not start a monitor.
- Report overlapping patch paths, never merge automatically or claim that
  separately checked candidates were tested together. `done` requires all jobs
  review-ready without conflicting edits; otherwise return honest `blocked`.

## Work Guidance

- Keep project-specific acceptance and patch policy here, not in Jig.
- Provider choices and credentials remain operator authority. Reuse the
  documented effects; no sibling source imports or outer command helper.

## Verification

- Install development dependencies at this root with
  `bun install --ignore-scripts`, then run `bun test test`.
  From the repository root use `bun test examples/tested-patch/test`.
- `scripts/test-release.sh` tests a disposable application copy with the
  freshly packed SDK from this checkout. Source-level host
  fixtures explicitly vendor the built SDK into their disposable Flows;
  neither check claims registry availability or modifies the authored source.
- Deterministic checks cover bounds, multi-file proposals, honest failures,
  immutable expectations, evidence contradictions, output collisions, batch
  validation, selected cancellation, patch conflicts, replaceable monitor
  presentation, recorder bounds and independent failure, rejected admission,
  independent retention, and branch cleanup.
- The provisioned Jig host tests run actual candidate tests and CLI commands
  through admitted root and leaf Flows. Recorded Agent responses prove the
  execution path, not live model quality. Real Agent outcomes need a bounded
  authorized budget and separately retained evidence.

## Child DOX Index

- None.
