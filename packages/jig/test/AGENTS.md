# Jig test suites

## Ownership

- `portable/` owns source checks without native host admission or model credentials.
- `linux/` owns Linux platform checks that can run in the ordinary source job.
- `filesystem/` owns descriptor capture on Linux and explicitly qualified native Macs.
- `host/` owns native lifecycle and installed public consumer scenarios shared by Linux and Mac.
- `linux-host/` owns delegated rootless Linux admission, enforcement and recovery.
- `macos/` owns native Mac enforcement and recovery; `macos-23E224/` owns the exact Intel preference observer profile.
- `startup/` owns real offline native client startup in the installed qualification step.
- `live/` owns separately authorized subscription, API and restoration qualifications.
- `fixtures/` and root `*.fixture.ts` modules own shared construction and assertions. They register no tests and acquire no native owners on import. Each case owns fresh project capture, admission, Run, durable state and cleanup.

## Execution contracts

`scripts/ci/affected-manifest.json` owns whole-file applicability. The shared suite inventory refuses unknown or ambiguous files. Select suites before execution; selected suites must execute positively with zero skipped or filtered cases. Missing native flags, exact host prerequisites or live inputs fail the selected suite. Parameterized cases have explicit unique registration names; do not add name-pattern partitions or frozen line/name skip exceptions.

`just jig::test` selects the ordinary source profile. `just jig::check` and root `just preflight` add the qualified Mac regression pass. Complete hosted qualification also runs shared lifecycle suites, fresh installed consumers and genuine offline clients. Partial display witnesses never replace that evidence.

`host/markdown-worker.test.ts` exercises only the installed CLI and its packed worker. Its fresh temporary root owns consumers and failure evidence; it does not build a second source worker. Source-worker compilation and direct protocol exchanges belong to `portable/markdown-worker.test.ts`.

`installed-display-smoke.ts` consumes the supplied canonical eight archives without rebuilding. It verifies installed Jig member bytes and actual qualified Bun/Core loading, runs the three standalone display consumers, and shares registration-free installed display checks with `package-smoke.ts`. Real PTYs prove missing-support refusal on Mac or provisioned Linux, saved TUI navigation/immutable preview, Stay-default confirmation followed by observed Leave selection and Enter, and exact terminal restoration. The shared helper requires the Run-refusal profile by default; only the ordinary full package smoke permits a source-Linux omission, with no host proof credit. Saved web checks embedded assets, authentication, immutable capture and explicit Close. Live observations, delivery and interruption belong to `host/package-provider-observation.test.ts`. Compact witnesses remain distinct from full qualification, operational/hostile baselines and cold registry installation.

Root Agent live suites select one exact client/input contract per file. Codex subscription requires its native executable and CODEX_HOME; Codex Responses requires the executable, model and OpenRouter key; Claude and Pi require their own executable, API model/provider and key. The protected native API workflow selects only its matching file. Restoration is an independent explicit opt-in.

## Verification

Preserve every existing test body, case input, timeout and cleanup assertion when moving a suite. Retain before/after migration evidence, then run complete source checks and native regression on the matching profile. CI must reconcile every planned file exactly once against successful reports. Platform-specific omissions are applicability decisions, never a passing qualification. Timing weights only place work; they cannot change inventory or evidence.

## Child DOX Index

- [fixtures/channel-conversation/AGENTS.md](fixtures/channel-conversation/AGENTS.md) — Installed synthetic request/reply and cancellation peers.
- [fixtures/repair-batch/AGENTS.md](fixtures/repair-batch/AGENTS.md) — Batch/checkpoint repair proof additions.
