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

Each independent native backend fixture Run plan receives a fresh absolute deadline for
its existing duration when constructed. A plan spread from a completed Run must
not carry that spent deadline into another fresh owner. Never reset a sealed or
active Run deadline.

`just jig::test` selects the ordinary source profile. `just jig::check` and root `just preflight` add the qualified Mac regression pass. Complete hosted qualification also runs shared lifecycle suites, fresh installed consumers and genuine offline clients. Partial display witnesses never replace that evidence.

`host/markdown-worker.test.ts` exercises only the installed CLI and its packed worker. Its fresh temporary root owns consumers and failure evidence; it does not build a second source worker. Source-worker compilation and direct protocol exchanges belong to `portable/markdown-worker.test.ts`.

Repair leaf proofs use separate successful and unsuccessful whole files. Each retains its original guardian observer, scenario body, fresh consumer and platform-specific timer; neither shares admission, execution or cleanup with the other.

Project Command coordinator-loss recovery keeps a fresh eight-failure batch for
each of its two bounded reopen attempts. The test spy retains closed causes and
at most one fixed internal source label with positive line/column from the
innermost bounded cause chain. Stack inspection is limited to 8 KiB and 32 frames;
raw messages, stacks, paths, tokens and owner data are never emitted. Diagnostic
failures cannot replace the original exception or change the sealed-owner crash
barrier, recovery, cleanup, assertions or limits.

The installed factory's blocked proof and coupled checked/automatic proof use separate fresh consumers through the registration-free `fixtures/installed-software-factory.ts`. Both initially review the blocked peer and remove the editable repair package. The blocked case executes and verifies admitted bytes, worker causes, checkpoint delivery and its complete packet. The checked case restores authored repair source, changes the peer and re-reviews before its explicit and automatic Runs; their complete job evidence and all nine delivered files must agree. Completed-Run/source-edit/re-review/new-generation execution remains independently required by the installed package dependency and full package-smoke consumers. Keep all three factory Runs and their existing limits, result, delivery, observation and cleanup assertions.

`installed-display-smoke.ts` consumes the supplied canonical eight archives without rebuilding. It verifies installed Jig member bytes and actual qualified Bun/Core loading, runs the three standalone display consumers, and shares registration-free installed display checks with `package-smoke.ts`. Real PTYs prove missing-support refusal on Mac or provisioned Linux, saved TUI navigation/immutable preview, Stay-default confirmation followed by observed Leave selection and Enter, and exact terminal restoration. The shared helper requires the Run-refusal profile by default; only the ordinary full package smoke permits a source-Linux omission, with no host proof credit. Saved web checks embedded assets, authentication, immutable capture and explicit Close. Live observations, delivery and interruption belong to `host/package-provider-observation.test.ts`. Compact witnesses remain distinct from full qualification, operational/hostile baselines and cold registry installation.

Root Agent live suites select one exact client/input contract per file. Codex subscription requires its native executable and CODEX_HOME; Codex Responses requires the executable, model and OpenRouter key; Claude and Pi require their own executable, API model/provider and key. The protected native API workflow selects only its matching file. Restoration is an independent explicit opt-in.

Installed package smoke commands use the shared bounded command owner. Preserve
each command's timeout, bounded interruption/escalation and pipe drain, and
exclusive mode-0600 private transcripts on failure. An unconfirmed exit after
escalation refuses within a separate bounded settlement wait. A timeout is failure even if the child
later exits successfully; command exit never establishes native cleanup.

## HTTP readonly qualification

The actual contained-effect fixture captures the generated HTTP intent, proves file-only Mac lowering and unchanged Linux lowering, and retains failure/cancellation cleanup and diagnostic privacy. Native scope tests require exact zero-tree root cwd, refuse near-matching and unrelated-tree alternatives, and prove denied writes/private-control reads through the real launcher. Held HTTP lifecycle cases bind the exact fresh Run/effect allocation and sealed owner before proving its Mac storage is absent, then retain cancellation/coordinator-loss fencing and final owner cleanup. The offline localhost TLS case uses the qualified real Node HTTPS peer to count actual TCP connections independently of Bun server shims, with fresh private readiness and bounded subprocess closure inside the existing case budget. It still requires name resolution, a positive connection count, ordinary client certificate refusal and zero HTTP requests; peer handshake events cannot establish client trust. It does not establish successful public HTTPS. Run the whole HTTP lifecycle and packed HTTP Agent composition suites on Linux and both qualified Macs before release acceptance.

## Verification

Preserve every existing test body, case input, timeout and cleanup assertion when moving a suite. Retain before/after migration evidence, then run complete source checks and native regression on the matching profile. CI must reconcile every planned file exactly once against successful reports. Platform-specific omissions are applicability decisions, never a passing qualification. Timing weights only place work; they cannot change inventory or evidence.

## Child DOX Index

- [fixtures/channel-conversation/AGENTS.md](fixtures/channel-conversation/AGENTS.md) — Installed synthetic request/reply and cancellation peers.
- [fixtures/repair-batch/AGENTS.md](fixtures/repair-batch/AGENTS.md) — Batch/checkpoint repair proof additions.
