# CI host provisioning

## Purpose

Owns quick CI checks, disposable Linux proof-host provisioning and rootless Mac
host qualification. Host preparation never becomes a consumer requirement.

## Ownership

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
  and installed-consumer work. Reconcile slow-file and out-of-file estimates
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

- Mac qualification runs unprivileged without host provisioning. Require all
  three genuine native client paths for full qualification and the installed
  consumer shard; missing prerequisites fail explicitly. No model credentials
  or online model calls are part of this host check.
- Use `sudo` only while provisioning the disposable runner. Jig and package
  code run unprivileged.
- Keep fetched host tools version- and digest-pinned.
- Preserve the distinction between inherited and newly acquired cgroup
  authority, and require zero Jig residue at completion.
- Never expose privileged host controls to Flow or project code.

## Work Guidance

- Review the matching host-conformance workflow in the same change.

## Verification

- Exercise provision, the hostile suite, cleanup, and `assert-clean` on a
  disposable supported runner.
- `node --test scripts/ci/host-test-coverage.test.mjs` verifies exhaustive
  Mac file assignment, disjoint lifecycle and package name groups, balanced scheduling
  of a representative observed workload including out-of-file costs, and that every
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
