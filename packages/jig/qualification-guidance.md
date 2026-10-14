# Jig assembly and installed qualification

Apply these rules when the [package reading map](AGENTS.md) selects this domain.
The package entrypoint retains shared requirements and child ownership.

## Ownership

- `test/` owns unit, integration, fault-injection, packed-package, and
  proof-host evidence. `test/fixtures/agent-fixture-host.ts` keeps explicit
  native composition budgets shared with independent coordinator fixtures and
  the installed-package Agent composition smoke. The smoke passes the public
  `--timeout` option and leaves production defaults unchanged.
  `test/fixtures/channel-conversation/` owns the synthetic named-channel peers
  used by installed foreground tests, independently of public example selection.

- Project Command lifecycle proofs reuse the explicit native composition budget
  for success, cancellation and coordinator loss. Their deadline case uses its
  own 30-second budget. Fixture settlement/admission waits follow the selected
  test budget rather than the production default. Forced-loss coordinators stay
  alive until explicitly killed. They leave a Run deadline margin beyond owner
  observation: 60 seconds on Linux. Assert the actual SIGKILL exit before
  claiming coordinator-loss recovery.

- Repair CLI proofs use the installed entrypoint's command-scoped default
  verification policy, acquire support for the actual consumer project, and keep
  verification caches outside it. Result and cleanup assertions remain
  independent of this installed-support optimization. Contained repair scenarios
  retain invocation-scoped guardian recovery evidence and report native output
  capture rejection through the existing bounded error class/code classifier at
  the fixed `output-capture` phase. Observer exceptions cannot replace the
  original error. Work acceptance, captured output, delivery acknowledgement and
  cleanup remain independent assertions. These diagnostics establish no cause
  without an observed failure.

- `justfile`, `scripts/`, `support/`, the manifest, README, licenses, and
  notices own package assembly inputs. Bun generates the ignored root workspace
  lock. `dist/`, `bin/`, `libexec/`, and package-root copies of `LICENSE.md`,
  `PRICING.md`, `LICENSES.md`, and `LICENSES/` are generated. Jig builds web and
  TUI through their owning recipes. Each builds the model, which builds FLOW and
  Reporting. Do not repeat those prerequisite requests directly in Jig.

  Standalone package recipes keep their complete dependencies.

- `support/macos-exec.c` and the private Mac capture/process controls supply the
  qualified native host boundaries. Their ownership and qualification procedure
  live in `src/internal/AGENTS.md`. Installed Mac consumers require neither a
  compiler nor an administrator.

- Package assembly checks native source/binary provenance before cleaning or
  copying output. `support/AGENTS.md` owns the canonical Apple rebuild and exact
  byte-comparison procedure. Installed consumers still require no compiler.

- `patches/` owns version-pinned third-party dependency corrections, applied by
  the root Bun `patchedDependencies` before the ordinary package build. Codex
  ACP must not generate unrequested model-based titles outside the reviewed turn
  and model policy. Its adapter preserves native failure and clears shutdown
  timers on close. Forced native termination cannot become adapter success.
  Register pending Codex turns before asynchronous prompt setup so immediate
  interruption cannot disappear before the native turn ID exists. A turn-start
  reply allocates an ID.

  Only its matching native `turn/started` event makes that turn interruptible.
  Preserve early completion and either event/reply ordering without retries or
  synthetic settlement. Pi ACP invokes Jig’s private launcher through the
  verified Bun interpreter and preserves RPC rejection and authoritative
  assistant stop reasons. Never infer success or failure from answer length.
  Update the notice and adapter regression when changing its patch. Each patch
  has a same-basename `.md` note explaining the defect, verification, concrete
  removal conditions, and known upstream issue or pull-request links.

  Distinguish related reports from an exact fix.

- `scripts/pack.ts` stages the complete script-disabled npm compiler
  installation under private `libexec/authoring`. It removes unused npm
  executable links. Before packing the allowlisted tree, it rejects every
  non-regular archive entry. `support/authoring-install.json` and its generated
  npm lock pin the complete private compiler closure. Authoring-source changes
  require a matching lock update. Packaging uses `npm ci` and fails on stale
  integrity.

  The final tarball uses pinned build-only `tar` to normalize file order,
  timestamps and ownership on both Linux and Mac. The local authoring archive
  lock admits the exact Bun 1.3.3 and 1.4.2 gzip outputs of identical tar
  contents. Neither platform may refresh that integrity during packing.
  Consumers do not resolve the authoring workspace package from a registry.

## Local Contracts

- The installed launcher checks OS/CPU pairs before selecting the pinned
  runtime: Linux x86_64 and Darwin x86_64/arm64 only. npm's independent OS and
  CPU allowlists cannot exclude Linux arm64 while admitting both Mac
  architectures. The README exposes this installation limitation. Refuse
  unsupported pairs with supported-host guidance, not a missing-installation
  repair instruction.

## Verification

- `just jig::check` builds and runs Jig and display-package source tests, then
  runs all discovered Mac-specific regression files on an exact supported native
  Mac. Root `just preflight` also includes quick tooling and the other portable
  packages. The native pass needs ordinary local launchd/disk-image access. An
  enclosing execution sandbox may refuse it. It requires no native Agent clients
  or model calls and does not replace complete hosted qualification. Other hosts
  report the native coverage they leave to CI.

- Changes to Mac guardian admission, readiness, cancellation, resource
  accounting or diagnostic transport require the complete
  `test/macos/macos-guardian*.test.ts` group with `JIG_MACOS_PROCESS_TEST=1` on
  a qualified Mac. Ordinary source execution selects portable suites. Native
  suites fail missing prerequisites. `jig::check` adds the native regression
  pass. Run existing consumers alongside new injected cases. Verify typed
  preparation causes together with fenced completion and cleanup.

  Guardian storage modes register distinct sequential tests with fresh compiled
  fixtures, owners, tokens and mounts. Each mode retains its own 150-second test
  timer and unchanged compilation, operation and recovery limits. Do not combine
  independent modes under a shared timer or reuse successful execution evidence.
  Resource-accounting changes also require `test/macos/macos-execution.test.ts`
  and `test/macos/macos-process-controls.test.ts` to preserve native enforcement
  and ownership. The raw-launcher proof anchors its work deadline before
  compilation/setup and reserves time for exact launchd cleanup inside the outer
  test deadline. Bound each native exit/control-end join.

  Preserve failure and per-mode phase/stderr evidence rather than waiting beyond
  the helper's closing allowance. The unrelated sentinel must outlive fixture
  work and is killed/joined separately. After validating the raw launcher's
  actual crash exit/control receipt, the fixture's coalition owner fences
  remaining work before confirming emptiness.

- `just jig::test-package` checks the installed inventory, exact copied
  licensing and pricing files, and the published Bread 1.0 text's fixed digest.
  The check uses retained local text, without a Bread checkout or network
  lookup. Its `test/package-smoke.ts` shares registration-free installed display
  checks in `test/fixtures/installed-display.ts`. Hidden Core requires a nonzero
  `JIG_TUI_UNAVAILABLE` Run refusal before dispatch, the no-Flow explanation, no
  alternate-screen entry and unchanged terminal attributes on Mac or the
  provisioned `JIG_LINUX_ROOTLESS_HOSTILE=1` host. The retained PTY session
  owner measures restoration before exit. Ordinary Linux source CI proves only
  the applicable non-Run checks because delegation precedes renderer
  preparation.

  That omission grants no host proof. Full native consumers require the
  Run-proof profile. Help, public authoring and embedded saved browser
  inspection remain unconditional under hidden Core. After restoration, positive
  saved TUI navigation checks immutable preview, fresh Stay-default exit
  confirmation, rendered Leave selection before Enter, joined closure and exact
  screen/input restoration. Refusal alone cannot qualify these positive
  behaviors.

- Mac Codex preference qualification uses
  `test/macos-23E224/macos-preferences-observer.test.ts` and
  `test/macos/macos-preferences-boundary.test.ts` with
  `JIG_MACOS_PROCESS_TEST=1`. The actual-observer positive and injected-policy
  cases require native Intel 23E224 without configured Codex MDM. They prove
  closed decisions, inherited sandbox refusal and parent-loss expiry, not
  installed MDM consumption. The raw boundary test checks populated synthetic
  preferences, read-only counters, inherited rights and cleanup. Genuine startup
  is qualified separately by `test/startup/native-agent-startup.test.ts`. Other
  Mac profiles must explicitly refuse Codex selection while retaining their
  independent client checks.

- `test/host/markdown-worker.test.ts` checks installed Markdown's
  Agent-admission requirement and Agent-free code execution with the complete
  packed FLOW SDK in an ordinary declared workspace. It honors
  `JIG_PACKAGE_ARCHIVE` and `FLOW_SDK_PACKAGE_ARCHIVE`. Otherwise pack built
  candidates. Failed public commands retain their consumer and diagnostics under
  the selected temporary root for investigation.

- `test/host/installed-*.test.ts` and
  `test/host/package-provider-observation.test.ts`, under
  `JIG_LINUX_ROOTLESS_HOSTILE=1` or `JIG_MACOS_PROCESS_TEST=1`, exercises public
  installed review, inspection and direct/Binding/child invocation of an
  ordinary declared workspace dependency, including admitted-byte pinning. It
  selects a two-minute Run budget so the test measures these installed behaviors
  even when hosted startup exceeds the shorter production default. Its packed
  entrypoint consumer checks both string forms, noninteractive default
  selection, current input bytes, overrides, explicit-target bypass and output
  collision refusal. Its packed attachment consumer checks empty bound and
  per-invocation roots, read-only enforcement, and the full relative path
  limits. It accepts `JIG_PACKAGE_ARCHIVE` or packs the built candidate. It also
  verifies prompt failed settlement of a deliberately crashing Flow through the
  installed CLI, followed by ordinary use of the same project.

  Its software-factory consumer runs the unchanged application with packed
  public dependencies and a deterministic Flow Agent peer, then removes the
  editable repair package after approval. It verifies admitted dependency
  imports, relayed worker progress, both blocked job causes and checkpoint
  delivery without native clients or model calls. A second reviewed peer returns
  deterministic repairs through the public structured Agent result. Verify final
  Jobs, Checks and Patches snapshots whenever explicit reception ends cleanly.
  Loss retains only its observed prefix, with exact contiguous NDJSON and an
  exact failed/LAGGED ending. Both explicit runs independently verify their own
  result packets, complete job and acceptance evidence, and exact delivered file
  inventories, sizes and hashes.

  The heavy automatic plain run likewise verifies its own packet, both accepted
  repairs and all nine delivered files. Automatic plain display selects the
  first Jobs root purpose and prints only changed root meaning at settlement,
  with exact ended/provisional context. Declared LAGGED may retain no root or
  only its known observed Jobs meaning, with the exact incomplete/provisional
  explanation. Other failures, extra settlement claims and fabricated clean
  endings refuse qualification. Accepted Checks and Patches remain model
  evidence rather than additional plain summaries. Plain assertions separate
  exactly one quoted Output header bound to the physical packet directory after
  its inventory and hashes have been verified.

  Words in that path cannot establish observation loss. A separate small cold
  installed consumer requires complete clean reception through both automatic
  display and explicit NDJSON. It declares producer loss alongside successful
  work and verified delivery. Deterministic application tests independently
  require the real factory publisher's completed Jobs, Checks and Patches
  offers. Portable channel tests exercise actual receiver overflow, producer
  loss and retained-model settlement through the shared display settlement
  entrypoint without disabling independent application-channel delivery.
  Optional reception never guarantees clean closure for every heavy Run or
  changes its work outcome.

  The sequential host gate includes this consumer. It does not qualify model
  behavior.

- With `JIG_LINUX_ROOTLESS_HOSTILE=1`, `test/package-smoke.ts` qualifies
  inline/named command grants through the installed public CLI and complete
  packed SDK in a consumer workspace. It also qualifies the complete HTTP-backed
  Agent artifact without rewritten workers. This includes application →
  specialist → Agent composition, named-contract substitution, Markdown
  selection and independent decision rejection. It honors `JIG_PACKAGE_ARCHIVE`,
  `FLOW_SDK_PACKAGE_ARCHIVE` and `AGENT_METHOD_PACKAGE_ARCHIVE`. Failed smoke
  consumers and candidate archives remain available for diagnosis. Mac's fresh
  initialized greeting retains its cold registry preparation and scratch/child
  execution checks.

  When `JIG_MACOS_TEST_TIMINGS_DIRECTORY` is configured, only its first review
  writes the existing bounded private phase trace to
  `installed-greeting-review-profile.txt` for hosted artifact retention. The
  trace contains fixed phase names and timings, never registry text, credentials
  or source. Assertions and preparation/command limits stay unchanged. Its
  trusted npm installation has a 120-second fixture allowance and accepts
  `JIG_NPM`. When host PATH excludes runner tool-cache binaries, npm's
  interpreter uses the selected absolute `JIG_AUTHORING_NODE_PATH` directory.
  This does not change Run authority.

- The installed smoke also runs `test/installed-mapped-files.ts` with frozen Jig
  and FLOW SDK archives on the selected native test host. Its ordinary project
  invokes a file Flow directly, then maps concurrent siblings and a nested child
  through the public CLI and SDK. Check binary and empty-file delivery,
  immutable source preservation, and live complete imports before each call
  returns. Final packet rules remain independent.

- The same installed smoke runs `test/installed-conversation-adoption.ts` in a
  fresh ordinary project using the frozen Jig/SDK/method archives, public
  `new --use` and `import-contract`, and the unchanged public conversation
  caller. An ordinary deterministic Flow peer checks two-turn settlement,
  malformed input, blocked initial outcome, lost observation and acknowledged
  interruption followed by actual turn and invocation settlement. No private
  imports, native clients or model calls. This is adoption regression evidence,
  not independent usability or native Agent qualification. Test-owned command
  transcripts are bounded and retained beside the consumer. The existing bounded
  command helper interrupts, escalates and awaits exit on failure.

  Its settlement budget outlasts the fixture's explicit Run limit. The
  credential-free command environment retains `XDG_RUNTIME_DIR` and
  `DBUS_SESSION_BUS_ADDRESS` for the existing Linux user-service host.

- Agent lifecycle suites accept `FLOW_SDK_PACKAGE_ARCHIVE`,
  `REPORTING_PACKAGE_ARCHIVE`, `AGENT_METHOD_PACKAGE_ARCHIVE` and
  `AGENT_ACP_PACKAGE_ARCHIVE` for unchanged candidate artifacts. Otherwise they
  pack already-built packages without rebuilding during execution. The native
  Codex immediate-interruption qualification separately installs the frozen Jig
  candidate and published conversation dependencies in an ordinary consumer. It
  imports the published Agent contract through the public CLI, then checks the
  actual follow-up result and host cleanup. The test asserts and prints the
  resolved package versions. The CLI must come from `JIG_PACKAGE_ARCHIVE`, so
  fixes can qualify before publication.

  Published conversation dependencies remain separately identified. This is
  installed candidate evidence, not a registry publication proof.
  `finite-acp-lifecycle.test.ts` also runs the private incident-brief fixture
  with packed dependencies and a deterministic native peer. It checks two
  branches, predecessor settlement, one successor and residue, not model
  quality. Failed handoff fixtures retain bounded phase/dispatch timing with
  their results. Timing is diagnostic evidence, not permission to extend
  execution deadlines.

- `linux-rootless-run.test.ts` isolates real finite ACP exit, automatic crash
  fencing and shutdown-grace fencing with a synthetic authenticated peer. Its
  deliberate payload/launcher SIGSEGV probes retain bounded process-state and
  fencing evidence, not native-client qualification or crash-origin proof.
