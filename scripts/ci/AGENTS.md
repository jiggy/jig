# CI host provisioning

## Purpose

Owns conservative dependency selection, immutable candidate provenance, observed
CI evidence and release readiness, plus disposable Linux and native Mac proof.
Host preparation never becomes a consumer requirement.

## Ownership

- `affected-manifest.json` declares component edges, executable input ownership,
  complete target inventories, runtime profiles and the narrow PR exclusion policy.
  `affected-plan.mjs` records verified base, PR head and tested merge state, old/new
  graphs and inventories, change endpoints, decisions and omission reasons. Unknown
  inputs select full work. Newly discovered unassigned tests prevent qualification.
  Shadow mode executes every target while retaining proposed exclusions; only
  public site assets and isolated Python source/tests may omit unrelated PR work.
  Bundled Jig browser assets and executable guides remain full inputs.
  The reviewed audit policy selects active PR heads whose domain-separated
  SHA-256 hash falls in bucket zero modulo five for full fresh execution. Seed
  only from the verified PR head so all scopes and reruns agree; preserve
  proposed exclusions for comparison. No invocation may suppress that audit.
- `affected-gate.mjs` independently reconstructs that plan from Git and current
  policy, then requires selected execution or the exact authorized omission.
  Its CI entrypoint binds the checkout, event/base/PR identity and mode/full
  policy to trusted workflow inputs; retained plan fields cannot redefine them.
  `job-evidence.mjs` counts completed reports, built pages or verified distributions;
  it checks source/profile identity, complete profiles, nonempty execution and
  explicit archive/residue proof. Status alone cannot establish a pass. Retain
  skipped identities and authorize only the owning profile's reviewed expectations
  and exact command-specific partition filter; a new skip must not disappear into
  an aggregate count. Native prerequisites and installed startup must execute.
- `build-candidates.mjs` archives clean tracked source and freezes all five npm
  archives on qualified native Linux x64 Bun 1.3.3/Just 1.43.1 using normal workspace
  resolution and package-owned packing. Preserve generated resolution, actual
  tool identities, inventories and hashes. Build-only receipts carry pending
  qualification; expensive consumer tests run after artifact retention.
  `qualify-candidate.mjs` verifies the immutable bundle before and after fresh
  FLOW/Agent/Jig installed obligations, without rebuilding release archives.
- `candidate-provenance.mjs` validates exact source, producer, build profile,
  archive contents, resolution and hashes, and writes qualification receipts.
  `candidate-transfer.mjs` checks GitHub repository/workflow/event/head identity,
  current run attempt, immutable artifact ID/digest and expiry before safely
  extracting the bundle. PR head metadata differs from its tested merge source.
  Non-PR audits may acquire trusted main push/schedule/manual producers; release
  readiness and native Linux lineage require full main-push producers. Missing
  current-attempt artifacts never fall back to older candidates.
- `release-readiness.mjs` rechecks all current-attempt CI, Linux, hosted Mac and
  native obligations after completion events. Qualification receipts bind the
  original CI candidate; native receipts additionally bind the exact full Linux
  receipt. Early native input receipts route pending/failing descendants but
  cannot qualify them. FLOW readiness remains independent of host failures.
  Snapshots bind successful runs/jobs/attempts and artifact identities so the
  isolated trusted publisher can revalidate after queueing and before mutation.
- `provision-github-rootless-host.sh` owns provision, cleanup, and clean-state
  assertions for that runner.
- `qualify-macos-host.sh` owns the exact selected Intel 23E224 and hosted
  Intel/Apple Silicon 24G830 profiles and
  Bun 1.4.2 and real Node 22+ preflight, frozen same-revision archives with
  digest rechecks, an ordinary npm install on the native architecture,
  sequential native tests, installed-consumer checks, and
  comparison of owned host residue before and after qualification. Its full
  mode remains the self-hosted entrypoint; hosted `--shard` runs one isolated
  portion of the same complete suite: three Intel or two Apple Silicon shards.
  Shard zero runs native prerequisites and the final shard runs installed
  consumer and genuine-client checks on each architecture.
  Hosted qualification consumes `JIG_CI_CANDIDATE_DIRECTORY` after verifying
  provenance and copies its exact archives; ordinary platform source builds
  remain separate. Full self-hosted local mode uses the owning local packers.
- `macos-host-test-shards.mjs` discovers every Jig test file. Eight native
  prerequisite files run once in the dedicated containment step on shard zero;
  every other file enters hosted qualification. The root Agent lifecycle and
  package-provider host files use disjoint, exhaustive name partitions with
  catch-all coverage for future cases. All remaining files enter once. Schedule
  these groups together using advisory command timings; timing hints affect
  balance, never membership. Each group runs in a fresh Bun process, sequentially
  within its shard, to isolate test state. Hosted shards retain their exact
  architecture/count/group plan, per-test JUnit artifacts (including installed
  client startup) and per-group command wall times. Balance includes native prerequisites
  and installed-consumer work, with architecture-specific installed-work hints.
  Reconcile slow-file and out-of-file estimates
  against retained command wall times; runner queue order is not guaranteed.
  Run expensive lifecycle groups before portable
  checks to expose failures earlier without reducing membership.
  Bun exits each test process on its first failure so a failed case does not
  wait for the remaining expensive scenarios before the matrix can stop.
- `macos-host-summary.py` consumes only retained JSON/JUnit evidence. It
  requires all exact-revision shard markers, matching plans, complete successful
  reports and disjoint executed name groups. Nested JUnit cases determine
  executed coverage; filtered and platform/opt-in skips are reported separately.
  Packed CLI probes, archive identity and zero-residue proof remain required
  through the shard completion markers. Optional GitHub job timestamps separate
  runner wait from job execution; missing timing cannot establish or remove
  qualification. Summaries and per-shard evidence remain architecture-specific.
- The matching Linux and Mac host-conformance workflows own runner selection.
- `npm-candidate-preflight.mjs` checks a frozen candidate's source revision,
  digest and manifest, then compares any existing exact public npm version's
  whole archive bytes. Only an explicit registry E404 means unpublished.
  It executes no package code, publishes nothing, and cannot replace the
  protected publisher's later group and channel reconciliation.
- `probe-macos-host.ts` observes native process identity and coalition accounting
  prerequisites on hosted Intel and Apple Silicon candidates. It starts no
  package work and does not bypass the backend's qualified-platform checks.
- `install-macos-test-clients.ts` extracts digest-pinned native Codex, Claude
  and Pi archives into a fresh runner-owned directory for offline startup
  qualification. It neither executes clients nor provisions consumer machines.

## Local Contracts

- Keep selected tests fresh. Do not reuse passing results, cold consumer
  installations, native containment, cleanup or live client qualification.
  Main, manual and weekly audits select complete coverage. Keep default shadow
  mode until representative same-revision full audits and adversarial fixtures
  support each prospective omission. An unresolved reproducible missed failure
  disables the affected exclusion; the full override remains immediately available.
- Canonical artifacts use `candidates-SHA-rRUN-aATTEMPT`; host shard evidence and
  qualification artifacts also include run and attempt. Every host shard compares
  the canonical candidate metadata and unchanged archives after execution. Full
  aggregates require all current-attempt shards. Qualification artifacts contain
  root `QUALIFICATION.json`; early native lineage uses root `INPUTS.json`.
  Expired artifacts require a new candidate and fresh requalification. Never mix
  an old native or host receipt with a rebuilt candidate from the same source.
- Mac qualification runs unprivileged without host provisioning. Require all
  three genuine native client paths for full qualification and the installed
  consumer shard; missing prerequisites fail explicitly. Claude and Pi must
  complete offline startup. Codex must complete offline startup on Intel
  23E224 and return the explicit unsupported-preferences refusal on hosted
  24G830 profiles; the selected path remains genuine and the case never skips.
  Qualification passes that expected outcome through
  `JIG_CODEX_MACOS_STARTUP_EXPECTATION`; the test independently checks the
  actual kernel profile before accepting it. Include the trusted preference
  observer in host residue comparisons. No model credentials or online model
  calls are part of this host check.
- Use `sudo` only while provisioning the disposable runner. Jig and package
  code run unprivileged.
- Keep fetched host tools version- and digest-pinned.
- Preserve the distinction between inherited and newly acquired cgroup
  authority, and require zero Jig residue at completion.
- Never expose privileged host controls to Flow or project code.

## Work Guidance

- Review the matching host-conformance workflow in the same change.

## Verification

- `node --test scripts/ci/*.test.mjs` includes disposable Git fixtures for renames,
  deletions, discovery, shared inputs, merge state and forged omissions; archive/API
  fixtures cover source/run/attempt/profile/digest drift, forks, expiry, reruns,
  descendant SHA drift and failed host gates beside independent FLOW readiness.
- Inspect every workflow's permissions, executable modes, profile inventory,
  attempt-specific artifact flow and final gate when changing these interfaces.
- Exercise provision, the hostile suite, cleanup, and `assert-clean` on a
  disposable supported runner.
- `node --test scripts/ci/host-test-coverage.test.mjs` verifies exhaustive
  Mac file assignment, disjoint lifecycle and package name groups, balanced scheduling
  of a representative observed workload including out-of-file costs, exact
  Codex startup/refusal host selection without running native clients, and that every
  Linux hostile test file enters provisioned host conformance.
- `node --test scripts/ci/macos-host-summary.test.mjs` exercises both architecture
  aggregates, nested reports, installed-client evidence, duplicate execution,
  missing/cancelled/stale proof and optional timing failures.
- `node --test scripts/ci/npm-candidate-preflight.test.mjs` verifies unpublished
  and identical versions, immutable collisions, registry errors and changed
  candidate evidence without credentials or registry mutations.
- `node --test scripts/ci/promote-directory.test.mjs` verifies exact directory
  promotion and preservation of existing or racing outputs on Linux and Mac.

## Child DOX Index

- None.
