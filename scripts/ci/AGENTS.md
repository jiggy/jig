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
  mode remains the self-hosted entrypoint; hosted `--shard 0..4` runs one
  isolated portion of the same complete suite.
- `macos-host-test-shards.mjs` discovers every Jig test file. Eight native
  prerequisite files run once in the dedicated containment step on shard zero;
  every other file enters exactly one hosted shard. The root Agent lifecycle
  file is partitioned by exhaustive name patterns; timing hints affect balance,
  never membership. Each file runs in a fresh Bun process, sequentially within
  its shard, to isolate test state. Hosted shards retain per-test JUnit timing
  artifacts and per-file command wall times. Balance includes native prerequisites
  and installed-consumer work; run expensive lifecycle groups before portable
  checks to expose failures earlier without reducing membership.
  Bun exits each test process on its first failure so a failed case does not
  wait for the remaining expensive scenarios before the matrix can stop.
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
  Mac file assignment, disjoint root lifecycle name groups, and that every
  Linux hostile test file enters provisioned host conformance.
- `node --test scripts/ci/npm-candidate-preflight.test.mjs` verifies unpublished
  and identical versions, immutable collisions, registry errors and changed
  candidate evidence without credentials or registry mutations.

## Child DOX Index

- None.
