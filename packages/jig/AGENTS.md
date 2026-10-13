# Jig package

## Purpose

Implements the `@jigging/jig` authoring API and installed Linux and qualified native macOS hosts for
admitted FLOW packages.

## Ownership

- `src/index.ts` and `src/project/author.ts` own the public authoring surface.
- `src/project/author.ts` also owns shipped static attachment-route data types.
  `attachment-routes.ts` validates their closed maps and distinct output folders
  during authoring and inert lock decoding, and exact caller/child ports during
  linking and Candidate/5 or Plan/2 decoding. Admission rechecks each target's
  declared interface against its verified retained package bytes; the portable
  lock does not duplicate package attachment declarations.
  Keep the authoring closure pure and import-free after bundling; declaration
  values use enumerable data descriptors like `author-value.ts`. Proxy
  reflection runs only under the existing authoring realm when evaluating
  project code; retained JSON is revalidated before file authority is supplied.
  Native execution qualification remains separate from this review data.
- The CLI, package/project capture, invocation contracts, Run host, and
  administration objects are package-owned implementation.
- `src/package/capture.ts` snapshots through held directory descriptors and
  rechecks source identity and contents. Linux uses unnamed temporary files;
  qualified Mac capture opens a private reader beside its sole writer, unlinks
  the only pathname, and closes the writer before exposing streamed bytes.
  Source renames cannot redirect opened-directory capture. This source adapter
  does not independently qualify the installed Mac execution host.
- Project source, declaration and static author-module capture use the same
  closed descriptor operations on Linux and qualified Darwin. Workspace capture
  preserves declared source/dependency selection and raw-name validation;
  filesystem capture does not independently qualify Bun installation or execution.
- `src/project/agent-source-location.ts` owns the private captured-source lexical
  recognizer for ACP diagnostics: at most 1 MiB of TypeScript or 32 KiB of JSON,
  32,768 tokens and nesting depth 64. Locations use one-based lines and
  Unicode-scalar columns. Only proven direct ordinary literals receive client
  locations. Selection context also requires the trusted ordinary import and a
  complete single-argument default call; unsupported, ambiguous or bounded-out
  input uses an unlocated file/slot fallback. Never evaluate or reread source, or add an
  AST, editor or compiler dependency to obtain these facts.
- `src/project/slot-graph.ts` supplies the same resource-bounded, acyclic graph
  validation to source linking, retained-lock decoding and dispatch. Dispatch
  caches longest paths per immutable candidate; repeated routes must not expand
  into repeated dependency-tree traversal.
- Package inspection validates `supports` and `uses.requires` against exact
  named single-form catalogs. Selected-graph qualification pins requirements
  in the lock and refuses incompatible targets before execution preparation,
  propagating only to their dependents. It never selects substitute providers.
- Explicit review `--generate-contracts` owns optional TypeSpec preparation and checked
  publication. Plain review checks local freshness; Run never compiles. The
  compiler is bundled, with Node 22+ selected only from fixed system locations
  or the operator's absolute `JIG_AUTHORING_NODE_PATH`.
- `src/markdown/` owns the sequential Markdown parser and interpreter, using
  the public FLOW SDK inside the ordinary contained runtime. Root `FLOW.contract.json`
  owns invocation declarations; code metadata uses `FLOW.meta.json` and Markdown
  uses optional frontmatter. Exactly one `FLOW.<ext>` is executable.
- `src/run/channels.ts` owns finite participant-scoped endpoint rights, atomic
  transfer, bounded direct delivery, isolated broadcast subscriptions and source
  lifetime. It is not an event bus or execution scheduler; package validation
  precedes implicit writer sealing.
  A writer may declare `LAGGED` on close; check its held rights before recording
  sticky source failure, settle pending sends and preserve earlier clean seals.
  Producer declarations are observation evidence, not execution authority.
- Execution requests and process evidence are private host-neutral contracts in
  `src/internal/execution-intent.ts` and `execution-process.ts`. Jig controllers
  retain policy and durable lifecycle; host translation owns physical launch
  layout. `src/run/session.ts` consumes process evidence without owning backend
  types. No package export, FLOW wire contract or host plugin interface is added.
- `test/` owns unit, integration, fault-injection, packed-package, and
  proof-host evidence. `test/fixtures/agent-fixture-host.ts` keeps explicit
  native composition budgets shared with independent coordinator fixtures and the
  installed-package Agent composition smoke. The smoke passes the public
  `--timeout` option and leaves production defaults unchanged. `test/fixtures/channel-conversation/` owns the synthetic
  named-channel peers used by installed foreground tests, independently of
  public example selection.
- `src/package/capture.ts` owns descriptor-confined immutable snapshots. Its
  serial copy traversal reuses one private bounded buffer per attempt; yielded
  snapshot chunks remain independently owned. Source rechecks and digest gates
  are unchanged by buffer reuse.
- Project Command lifecycle proofs reuse the explicit native composition budget
  for success, cancellation and coordinator loss. Their deadline case uses its
  own 30-second budget; fixture settlement/admission waits follow the selected
  test budget rather than the production default.
  Forced-loss coordinators stay alive until explicitly killed, leave a Run
  deadline margin beyond owner observation (60 seconds on Linux), and assert
  the actual SIGKILL exit before claiming coordinator-loss recovery.
- Repair CLI proofs use the installed entrypoint's command-scoped default
  verification policy, acquire support for the actual consumer project, and
  keep verification caches outside it. Result and cleanup assertions remain
  independent of this installed-support optimization.
  Contained repair scenarios retain invocation-scoped guardian recovery evidence
  and report native output capture rejection through the existing bounded
  error class/code classifier at the fixed `output-capture` phase. Observer
  exceptions cannot replace the original error. Work acceptance, captured
  output, delivery acknowledgement and cleanup remain independent assertions;
  these diagnostics establish no cause without an observed failure.
- Agent Run resolves to an ordinary Flow through defaults or exact slots.
  Jig retains source admission, resource grants and owned execution, not Agent
  preparation or answer interpretation. Skill content is explicit caller data;
  consumers independently check dynamic results.
- Optional Codex session retention stays below the ordinary Agent boundary:
  reviewed grants, exact recipient scope, single-use protected history, clean
  native exit, fencing and cleanup precede a new receipt. The opt-in
  `test/live/native-session-restoration.test.ts` uses installed archives and at most two
  subscription model calls with synthetic input; `JIG_NATIVE_AGENT_RESTORE=1`,
  `JIG_RESTORE_ARCHIVES`, `JIG_CODEX_STARTUP_PATH` and `JIG_RESTORE_MODEL` select
  that explicit test.
  It is separate from the deterministic protocol and protected-store tests.
  Its bounded command helper records output incrementally in exclusive evidence
  files, escalates ignored interruption and waits for process exit. Retained
  bytes are not proof of cleanup. Controller fault tests isolate module mocks in a
  subprocess; they prove ordering and scope construction, not kernel containment.
- `justfile`, `scripts/`, `support/`, the manifest, README, licenses, and notices own
  package assembly inputs. Bun generates the ignored root workspace lock;
  `dist/`, `bin/`, `libexec/`, and package-root copies of `LICENSE.md`,
  `PRICING.md`, `LICENSES.md`, and `LICENSES/` are generated.
  Jig builds web and TUI through their owning recipes; each builds the model,
  which builds FLOW and Reporting. Do not repeat those prerequisite requests
  directly in Jig. Standalone package recipes keep their complete dependencies.
- `support/macos-exec.c` and the private Mac capture/process controls supply
  the qualified native host boundaries; their ownership and qualification
  procedure live in `src/internal/AGENTS.md`. Installed Mac consumers require
  neither a compiler nor an administrator.
- Package assembly checks native source/binary provenance before cleaning or
  copying output. `support/AGENTS.md` owns the canonical Apple rebuild and exact
  byte-comparison procedure; installed consumers still require no compiler.
- Root licensing and pricing are canonical; the build copies their retained
  texts. Source delivery belongs to the matching GitHub release and its tagged
  repository archive. Never embed source archives or add source-assembly
  machinery to the npm package. `RELEASING.md` owns source-build instructions.
- The package README summarizes free eligibility, company coverage, lasting
  release rights, and distributed-source duties, linking to those retained terms.

- `patches/` owns version-pinned third-party dependency corrections, applied by
  the root Bun `patchedDependencies` before the ordinary package build. Codex ACP
  must not generate unrequested model-based titles outside the reviewed turn
  and model policy. Its adapter preserves native failure and clears shutdown
  timers on close; forced native termination cannot become adapter success.
  Register pending Codex turns before asynchronous prompt setup so immediate
  interruption cannot disappear before the native turn ID exists. A turn-start
  reply allocates an ID; only its matching native `turn/started` event makes
  that turn interruptible. Preserve early completion and either event/reply
  ordering without retries or synthetic settlement. Pi ACP invokes Jig’s private
  launcher through the verified Bun interpreter and
  preserves RPC rejection and authoritative assistant stop reasons; never infer
  success or failure from answer length. Update the notice and adapter regression
  when changing its patch. Each patch has a same-basename `.md` note explaining
  the defect, verification, concrete removal conditions, and known upstream
  issue or pull-request links. Distinguish related reports from an exact fix.
- `scripts/pack.ts` stages the complete script-disabled npm compiler installation
  under private `libexec/authoring`, removes unused npm executable links, and
  rejects any non-regular archive entry before packing the allowlisted tree.
  `support/authoring-install.json` and its generated npm lock pin the complete
  private compiler closure; authoring-source changes require a matching lock
  update. Packaging uses `npm ci` and fails on stale integrity. The final
  tarball uses pinned build-only `tar` to normalize file order, timestamps and
  ownership on both Linux and Mac. The local authoring archive lock admits the
  exact Bun 1.3.3 and 1.4.2 gzip outputs of identical tar contents; neither
  platform may refresh that integrity during packing.
  Consumers do not resolve the authoring workspace package from a registry.


## Local Contracts


- `src/cli-discovery.ts` owns invocation guidance and shell completion. Completion
  and the interactive target chooser read approval only, without environment
  probes or source evaluation. Approved project entrypoint selection precedes acquisition;
  Run still performs all ordinary authority checks. `jig new` writes ordinary
  Flow source without overwriting, evaluating, installing, or approving it.
  Optional `--use slot=source` snapshots selected offline contract closures and
  writes portable slot references; it does not infer providers, grants, library
  dependencies or workflow logic. Complete source is staged outside ordinary
  Flow discovery before non-replacing publication.


- `import-contract` copies a validated local invocation/channel bundle into a
  new directory, preserving bytes and relative paths. A direct descriptor path
  or exact `npm:` package name selects the source; `jig:` names select the installed
  standard library, listed by `--list`, with exact closures, digests and licenses.
  These names are authoring selectors, never runtime resolution or authority.
  Package lookup starts at the
  destination parent and uses the nearest installed `node_modules`. Closure
  descendants must be regular captured files. It neither acquires an execution
  host nor fetches, imports package code, replaces an existing destination, or
  grants Run authority.

- `src/index.ts` is the only JavaScript package export. Other exported symbols
  are private composition or test seams.
- Expose only the documented CLI and authoring surface; private host machinery
  is not a provider, runtime, or containment SPI.
- The installed launcher checks OS/CPU pairs before selecting the pinned runtime:
  Linux x86_64 and Darwin x86_64/arm64 only. npm's independent OS and CPU
  allowlists cannot exclude Linux arm64 while admitting both Mac architectures;
  the README exposes this installation limitation. Refuse unsupported pairs
  with supported-host guidance, not a missing-installation repair instruction.
- Default `init` writes a greeting Flow with a string input and a world fallback; `--bare` writes only the
  skeleton. Neither installs, networks, approves, or executes. Generated
  packages use the same dependency review as consumer-authored packages. The
  optional `--agent` selection writes a declared ACP package dependency, an
  inline native grant in its Binding and a contract-keyed default. It chooses no
  client implicitly and
  does not inspect installations or authentication. Generated package versions
  are checked against their manifests. The greeting names the exact tested SDK version; its regression checks the SDK
  manifest so a moving npm tag cannot silently select a different wire contract.
- Command help and syntax errors do not acquire execution authority. Review
  leads with complete changed policy; `--details` includes unchanged policy.
  Run stdout is readable on terminals; redirection or `--json` selects exact
  JSON/NDJSON. Elapsed status uses terminal stderr only;
  cancellation requested and cleanup confirmed are separate facts. Acquisition
  reports Jig runtime verification, operator resource configuration, and
  project-state recovery separately. Capturing configuration does not verify a
  native client; only targets selecting an ACP grant trigger that verification.
  SDK expected trusted setup refusals retain unavailable exact targets and their
  selected dependents; unrelated targets keep their own readiness. CLI review
  stops any observed typed selected ACP prerequisite before avoidable target
  execution preparation, unchanged success or apply. Its readiness callback throws one
  fixed private typed refusal; only that exact marker receives setup rendering.
  Arbitrary integrity, I/O, cancellation and cleanup faults retain their own
  failure, never classification from display codes or truncated issue rows.
  Inspection discloses retained availability separately from environment freshness;
  chooser selects ready routes only. Installing a client requires renewed review
  before an unavailable retained route can run.
  Review also separates source capture, per-package dependency capture,
  preparation/reuse and review retention, with stage-local timing. Prepared
  workspace artifact reuse stays within the approving Jig project.
  Configuration-evaluator memory, process and wall-clock refusals retain their
  distinct verified codes, including a host-observed deadline during envelope
  preparation. Generic limits do not imply host pressure; arbitrary launch codes
  cannot establish a deadline.
- `inspect` compares the last local approval with current local execution
  identities, including selected children. Report mismatches as review required
  and unverifiable comparisons as unchecked. It does not evaluate source,
  acquire execution authority, resolve dependencies, contact providers, recover
  or write state. Credential reads stay private; matching identities do not
  establish source freshness, launch readiness or remote availability.
  Approved effective ACP policy and optional retained `agentOverride` identify
  review-argument origin without live-source inference or a later review default.
  Schema type diagnostics retain only closed expected/received JSON types, not
  rejected values. Human Run output leads with host facts before arbitrary results.
- Manifest-policy diagnostics identify a closed cause and JSON field without
  rejected dependency values. Ancestor workspace manifest display paths are
  bounded project-relative locations, not executable or readable file routes.
- FLOW and Jig specifications and machine schemas are authoritative. Accept
  only bounded, canonical current formats.
- Capture mutable project source before evaluation, admission, preparation, or
  execution; Runs use retained admitted bytes.
- Project `entrypoint` is a target plus optional Run-argument string, retained
  in semantic identity, lock, review and inspection. `run-arguments.ts` owns shared
  CLI validation; `project/entrypoint.ts` owns bounded shell-free tokenization,
  project-relative defaults and explicit-option overrides. Omitted `--out` for
  an approved writable target selects one fresh OS-temporary packet destination
  before owner/delegation reexecution; result-only omission stays stdout-only.
  Use the read-only retained inventory and admission digest from the same snapshot,
  never source evaluation or example heuristics. A private preparation-complete
  marker preserves both output and no-output decisions through all installed
  owners and main; existing approval pins cannot be replaced. Ordinary anchored
  validation and no-replace delivery remain authoritative. Published temporary
  packets survive command/inspection exit, subject to OS cleanup. Report the exact destination on stderr for explicit
  and default invocations, including redirected stdout; keep operator paths
  out of browser observation snapshots. Explicit targets
  bypass defaults. Job files are captured per Run; Binding resources stay pinned.
  Resolve before delivery/delegation and carry the selected admission through
  reexecution to the submission compare-and-set. Operator verification and
  presentation options cannot be supplied by project defaults.
- Project `defaultProviders` maps contract IDs to exact Flow or Binding targets.
  Explicit slots win; otherwise review uses the map or the sole structurally
  provisioned exact match. Ambiguity requires a choice, never a client-availability
  heuristic. Retain effective routes in graph, lock, review and admission;
  execution never consults the authoring map.
- `npm:<package>` selects a declared project dependency's own Flow through
  ordinary contained Bun preparation. Capture source and execution closure;
  never import its entrypoint into the coordinator or traverse live installation
  links. Grants and settings still belong to its reviewed Binding.
- Binding `attachments` selects project-relative read trees captured at review,
  using the existing portable attachment interface. Retained resources participate
  in review, lock and exact configuration identity; per-run mappings cannot
  override them. Keep this root-only profile and its bounds synchronized with
  `docs/jig/spec/project-policy.md`.
- Binding slots select inline HTTP, command or finite ACP grants, or optional
  named JSON policies for meaningful reuse or independent management.
  `src/cli-review-agent-setup.ts` renders bounded read-only captured policy facts:
  verified client literals, selection context or honest file/slot fallback,
  known causes, passive executable alternatives and manual recovery. It never
  writes policy, recaptures after an edit or acquires publication authority.
  Put repair and one exact retry before detailed accounting. Default output
  discloses omissions and unchecked resources when present; complete report
  accounting belongs under `--details`. Executable recovery can suggest adding
  or replacing `--agent` for a detected client, with global scope and repeated
  review explained; never promise that other policies or authentication qualify.
  Explicit `review --agent codex|claude|pi` requires a value and changes only the
  client of every selected normalized ACP policy before qualification. Retain
  the operand in capture identity and ordinary lock `agentOverride`; the strict
  decoder requires nonzero selected ACP policies agreeing with it. Source stays
  unchanged; Run uses approved meaning and a later bare review uses source again.
  Cross-client model pins, incompatible retention and no selected ACP policy
  refuse the whole request; same-client selection still qualifies. Keep other
  fields, authority opt-ins and previous approved code/client together on failure.
  An ACP grant may pin a recipient-specific model; this changes approval and
  runtime identity without changing operator authentication or client selection.
  `docs/jig/spec/grants.md` owns capture, reuse and recipient-scoped approval.
  New or changed delegations require explicit authority approval in the same
  retained plan; source edits cannot mutate active generations. Secrets remain
  private operator environment snapshots. Use ordinary `run.call`.
- Authoring helpers stay inert and guest-realm-only. Full URL/schema checks
  belong to trusted linking, not imports or host constructors inside the evaluator.
- Public output must not disclose credentials, sandbox internals, private
  paths, or internal identity records. Review may show the resolved
  operator-selected native Agent executable path for informed selection.
- Make errors actionable: explain the failure, known cause, relevant location,
  and next safe step, alongside useful machine codes. Review must support
  informed consent; result displays must distinguish execution completion from
  achieving the application's objective. Follow the doctrine's
  [usable-control principle](../../.agents/doctrine/jig.md#understandable-feedback-and-actionable-errors).
- Build with the exact pinned Bun version and reconcile dependency changes
  with the lock, package inventory, licenses, and notices.
- `run`, `review`, and `inspect` expose `--verification cached|strict|fast`.
  Precedence is argument, then `JIG_VERIFICATION`, then cached. Validate with
  each command grammar before acquisition, and preserve the choice on reexecution. This is captured operator policy, never project-controlled.
  Keep help, the configuration reference, security statement and execution policy aligned;
  describe the weaker freshness guarantee of fast mode explicitly. Cache only
  installed support, never approval, retained package or invocation authority.

## Work Guidance

- Before any public CLI output change, read and apply
  [the CLI experience contract](../../docs/jig/spec/cli-experience.md).
  `src/cli-presentation.ts` and `src/cli-progress.ts` own shared human
  presentation; `src/cli-reporting.ts` owns scoped Flow activity state and
  untrusted attributed notices within that presenter. Stopping and terminal host
  states fence repaint callbacks; accepted complete notices retain order. The
  automatic profile uses one separate command-only broker allocation, preserving
  ordinary application channel quotas. Launcher failures follow the same structure. Never introduce
  a separate raw diagnostic style or route machine output through styling.
  Shell completion must work with macOS's system Bash 3.2 without installing
  another shell; collect replies with portable array/read operations.
  Major terminal sections need visible boundaries; secondary metadata uses
  gray while consent, policy values, and recovery actions remain prominent.
  Suggested actions use standalone `$ jig ...` commands. Help and host command
  references omit Markdown backticks; command names, flags, placeholders and
  argument literals use distinct syntax accents. Preserve quoting and never wrap
  commands. Application data bypasses recognition.
  Before any confirmation or answer prompt, pause progress and await its queued
  output, then check cancellation. The question and answer share one line without
  intervening stages or notices.
  Readiness status words carry green/amber emphasis without claiming execution.
  Noninteractive auto inline uses a compact root-summary/actual-branches/current-activity
  projection with attention first and visible overflow. Plain selects root landing
  or first retained root summary once and prints a changed summary at settlement,
  preserving ended/incomplete context rather than replaying every view.
  In auto/plain, activity phase changes append separate attributed indented lines; only host
  waiting owns a transient line. Clear events silently retire their slots;
  printed phases remain history, and application notices own job outcomes.
  Complete notices have one Flow-attributed first line and indented continuation
  lines; escape every payload line without recognizing it as host prose.
  Effective TUI owns one alternate screen after trusted root execution
  admission, keeping initial input/review/runtime refusals in ordinary output,
  retaining typed host/Flow/diagnostic entries inside bounded Activity. Fixed shell,
  responsive meaningful context, dense aligned collection rows, expanded evidence,
  newest-first Activity with expandable setup, actual collapsible Execution and contextual
  keys serve progressive disclosure without terminal author callbacks. Attention
  remains attributed and reachable from every view. Diagnostic reports have a
  separate literal panel; unknown severity stays unknown. Freeze execution elapsed
  at settlement, select the root landing or first root view only when the operator has not navigated,
  and never project settled host facts as current work.
  Authored detail prose wraps at complete grapheme/word boundaries; file preview
  wrapping keeps its existing literal path. Style each pane independently so list
  focus or headings cannot color unrelated detail text. Charge composed SGR to the
  same encoded frame ceiling.
  Restore the original screen and commit complete retained essential causes before
  final stdout. No ordinary
  notice or repeated view-summary spill while that workspace is open.
  Explicit notice severity is Flow-reported
  importance, never host outcome or guaranteed delivery.
  A heading must never have less emphasis than its subordinate details. Expanded
  unavailable-client labels use bold amber above normal-contrast setup instructions;
  the compact names-only unavailable summary remains secondary.
  Unchanged source, prepared-file and dependency-layout reassurance belongs only
  in `--details`. Keep the changed fact, environment uncertainty and approval
  consequence visible in compact reviews. Omit repeated ACP selections only
  after proving unchanged runtime identity under identical recipient routes;
  unknown comparisons remain visible, and details always show selections. An
  explicit review client operand retains its authored/effective selection summary
  even for same-client or unchanged review.
  Dim executable paths and unchanged context; omit review categories with no
  changes from the ordinary summary. Changed-record labels and their identifiers
  use bold amber: they identify work requiring attention, not secondary metadata.
  `src/cli-value-presentation.ts` uses the existing YAML serializer for human
  values in reviews, inspection, Run results, and structured channel messages.
  Do not rebuild a custom type-labelled tree. Preserve exact types, safe quoted
  keys, controls and block-string whitespace through syntax highlighting and
  `JIG_THEME` palettes; never style or reserialize machine records.
  Review uses contextual field diffs; identity-only target changes need a
  concrete explanation of the changed execution environment or prepared files,
  unchanged policy, and approval consequence, never identical previous/proposed
  blocks or an unexplained "retained identity" label.
  `--details` adds unchanged context to the same sectioned diff, never a YAML
  dump of change bookkeeping or current/proposed snapshots. Ignore object
  insertion order when comparing review records; preserve array order.
  `cli-run-presentation.ts` owns human Run results and channel streaming. Join
  text fragments exactly, label channel switches and endings, escape controls,
  and preserve separate execution, application, delivery, and cleanup outcomes.
  Count invocation paths whose diagnostics were already shown live; do not replay
  them or create a result section for the count alone. Preserve path-specific
  unseen suffixes and truncation; machine records retain the full bounded capture.
  A generic failure without diagnostics must state the missing evidence; do not
  imply that the Flow never started or repeat an identical raw error block.
  Generic human failure summaries must retain specific terminal failure messages;
  hiding the structured result's message must never discard its cause. Quote and
  escape reported text as data, and do not infer missing evidence from empty
  stderr when the terminal already carries a specific explanation.
  Schema authoring failures identify the required root dialect when known and
  route unsupported keywords, references and limits to FLOW Schema/0; never
  display rejected schema values or compiler exception text.
  Render host-only REVIEW_REQUIRED with `jig review` as the next action.
  Flow-supplied error details cannot establish that execution never started.
  Emphasize host failure/uncertainty in summary status lines and end failed Runs
  with the cause and next action after evidence. Omit packet provenance manifests
  from human results; retain full machine and packet records. A confirmed written
  packet permits compact success output: show small application answers, but
  retain at most eight complete top-level scalar fields within 2048 JSON characters
  alongside large nested evidence, without assigning meaning to field names.
  Identify that brief view and point to `result.json` for full output and checkpoint evidence, and show the
  nonzero delivered file count. Omit null checkpoints from human results.
  Uncertain delivery keeps evidence visible. Input errors name
  the approved schema without guessing source freshness. Emit the dependency
  network notice once per review before preparation, retaining package progress.

- Agent selection belongs to ordinary dependencies, Bindings and resource grants,
  or an explicitly retained review client operand, never inferred from credentials
  or a preferred vendor. Selection remains
  distinct from authority approval; the optional init picker only authors files.
  Client prerequisite errors explain both repairing the selected installation
  and editing the slot's inline or named ACP grant to use another supported client,
  followed by renewed review. Unresolved child Flow errors explain its provider
  or Binding configuration instead of reporting only a machine code.

- Change implementation, normative specification, schema, README, and tests
  together when a public contract changes.
- Keep fault-injection seams private.
- Attach expected rejection handlers before cancellation or asynchronous teardown
  can settle pending test operations; still await both rejection and cleanup.
- Test fixtures use canonical dependency paths, including through Bun workspace
  symlinks. Source-tree proof commands reuse `test/fixtures/installed-bun-location.ts`
  rather than defining their own runtime locations. Source-rewriting hostile
  fixtures must also construct successfully in ordinary tests, so source
  formatting cannot silently break the host gate.
- Consult `src/internal/AGENTS.md` for containment, durability, or Agent host
  work.

## Verification

Run presentation retains one admitted observation accumulator and one bounded
stderr writer. `src/cli-display-projection.ts` adapts accepted host facts into
readonly snapshots from `@jigging/display-model`; `src/cli-recorded-role.ts`
assigns reserved recorded roles only at the host adapter. Publisher/call
correspondence, opaque display identities, transcript receipt accounting and
immutable captured excerpt access stay private to Jig. Authored names never
choose host status or roles.

`@jigging/display-web` owns browser rendering, client generations, navigation
and fixed self-contained assets. `src/cli-web.ts` retains loopback HTTP, bearer
capabilities, CSP, transport bounds and presentation lifetime. Read the current
`docs/jig/spec/web-display.md` before changing this boundary. Prepare without
advertising before admission, join trusted-dispatch activation and keep capability
publication outside journals/diagnostics. Machine precedence decides before
listener preparation. Import fixed asset bytes through the package's declared
asset export and bundle them into installed CLI identity; web must not initialize
native TUI support or read checkout-relative assets. Browser fetches keep
memory-only authorization, exact authority/origin checks and inert text.
Failed projection retains its independent reserve; stale bodies disable
references while current causes and Close remain available.

After a known terminal and confirmed project closure, every display mode retires
delivery authority under one finite completion end, preserving the presentation
minimum. Dashboards transfer receipt-selected excerpts first; plain/JSON retires
directly. Close local captures before command success or indefinite inspection.
Unknown execution or failed project closure retains original source-exit recovery;
local closure uses only the existing presentation end. Preserve the first
finalization promise, its deadline and failure, known execution/delivery and the
primary error. `cli-delivery-retirement.test.ts` checks these choices with controlled
host and transport faults; it does not qualify native retirement.
Initiate forced native connection cancellation
before discarding response queues and join it after disposing subscriptions and
buffers. Blocked-stream expiry retains admission until abort/cancel acknowledgement.
Closing inspection releases preview waiters; late bytes cannot restore it.

`@jigging/display-tui` owns private viewer state, key/escape decoding, responsive
panes, inline rendering and bounded terminal frames. Jig imports its public
`prepareTui`/`createTui`/`createInlineDisplay` surface and keeps real input,
signals, screen restoration, the single output writer, command constraints and
phase-aware interruption decisions in `src/cli-tui-input.ts` and
`src/cli-progress.ts`. Core and Tree-sitter remain required exact external
runtime dependencies. Only eligible TUI preparation loads native support before execution. Automatic
selection falls back on unavailable support; explicit TUI maps it to
`JIG_TUI_UNAVAILABLE`.
Frames and escaped attention representations remain charged to existing byte
ceilings. Package DTOs never carry the admitted host model or execution powers.

`--display` is operator-only. Auto selects TUI only with suitable terminal input,
stdout and stderr; ordinary fallback borrows no input. Effective TUI owns and
restores raw/flowing stdin. Inspection has no local idle or absolute expiry.
q, keyboard Ctrl-D and settled keyboard Ctrl-C request exit confirmation with
Stay selected; contextual Escape returns within the TUI and stays at the top level. Input/output loss and
external interruption still close and restore it. Explicit inherited presentation
constraints remain a minimum across enclosing owners, with a 45-second closing
reserve for finite command timers. Only eligible effective `tui` or `web` omits
the default file/delegation command envelope. Machine modes and setup/cleanup
owners retain their bounds; Run timeouts and explicit enforcement timers stay
unchanged. Trusted root admission starts screen entry and the CLI joins it before
settlement. Early host stages, call observations and diagnostics remain visible.
Post-settlement inspection owns no execution/channel lifetime.

Select immutable delivery capture before publication. Preview suppliers receive
only artifact identity and capture generation, never mutable destinations or
arbitrary paths. Navigation is renderer-local and cannot mutate host observations.
`image-preview-policy.ts` owns bounded raster preview data. The bundled image
worker and pinned renderer/font bytes participate in installed support identity.
Production file-image decoding remains unavailable until independent fencing
can interrupt Wasm on the qualified Bun profiles; text and saved-file access remain usable.
Auto/plain commit complete essential causes outside redraw. Entered TUI restores
the screen, then commits retained causes in awaited bounded batches before final
stdout, without replaying view summaries. Output disconnection retains the Run's
existing cancellation owner.

Renderer/model navigation, hierarchy, preview fencing and maximum-view checks
belong to their package suites; see their owning `AGENTS.md` files. Jig's
`test/portable/dashboard.test.ts`, `test/portable/cli-tui-input.test.ts`,
`test/portable/workspace-progress.test.ts`, `test/portable/cli-display-observations.test.ts`,
`test/portable/cli-web*.test.ts` and installed tests retain host admission, attribution,
receipt, transport, lifetime, terminal restoration, JSON and immutable-capture
proof. Frozen standalone package consumers and frozen
installed Jig runs are distinct gates; source mocks and design approval qualify
neither installed behavior nor newcomer usability.
`test/portable/cli-review-agent-setup.test.ts` and `test/portable/project-resource-qualification.test.ts`
check bounded read-only setup facts, shared recipients, preserved policy, honest
captured locations and authoritative refusal despite report omission. CLI checks
refusal before avoidable target execution preparation, unchanged success and apply,
with prior approval/source preserved. Linking/capture and lock tests cover the explicit
review operand, all-selected-ACP rules, exact identity and retained origin;
ordinary authority, generation and cleanup checks remain independent.
`inspect --result` bypasses project/environment acquisition and reads only the
selected descriptor-confined packet. Its fixed views label all evidence recorded,
never reconstruct live views or authority, and preserve exact decoded JSON.
Qualify partial file capture, framing/byte/path limits, link refusal, interruption,
buffer release and output failure independently of recorded execution status.

- `just jig::check` builds and runs Jig and display-package source tests, then runs all
  discovered Mac-specific regression files on an exact supported native Mac.
  Root `just preflight` also includes quick tooling and the other portable
  packages. The native pass needs ordinary local launchd/disk-image access;
  an enclosing execution sandbox may refuse it. It requires no native Agent
  clients or model calls and does not replace complete hosted qualification.
  Other hosts report the native coverage they leave to CI.

- Package/project path NFC uses pinned Unicode 15.1 canonical decomposition,
  combining classes and composition data, independently of host ICU. Keep
  case folding and normalization at the same contract version. The official
  normalization conformance vectors in `test/portable/normalization-15.1.test.ts` and
  path/workspace-preparation tests verify this boundary. Regenerate tables and
  vectors with `scripts/generate-unicode-normalization.py` and its exact hashed
  Unicode 15.1 inputs; the generator refuses changed data before writing.

- `just jig::test`
- `just jig::check`
- Changes to Mac guardian admission, readiness, cancellation, resource accounting
  or diagnostic transport require the complete `test/macos/macos-guardian*.test.ts`
  group with `JIG_MACOS_PROCESS_TEST=1` on a qualified Mac. Ordinary source
  execution selects portable suites; native suites fail missing
  prerequisites. `jig::check` adds the native regression pass. Run existing
  consumers alongside new injected cases; verify
  typed preparation causes together with fenced completion and cleanup.
  Guardian storage modes register distinct sequential tests with fresh compiled
  fixtures, owners, tokens and mounts. Each mode retains its own 150-second test
  timer and unchanged compilation, operation and recovery limits; do not combine
  independent modes under a shared timer or reuse successful execution evidence.
  Resource-accounting changes also require `test/macos/macos-execution.test.ts`
  and `test/macos/macos-process-controls.test.ts` to preserve native enforcement
  and ownership.
  The raw-launcher proof anchors its work deadline before compilation/setup and
  reserves time for exact launchd cleanup inside the outer test deadline. Bound
  each native exit/control-end join; preserve failure and per-mode phase/stderr
  evidence rather than waiting beyond the helper's closing allowance. The
  unrelated sentinel must outlive fixture work and is killed/joined separately.
  After validating the raw launcher's actual crash exit/control receipt, the
  fixture's coalition owner fences remaining work before confirming emptiness.
- Use `scripts/test-release.sh` for packed or cross-protocol changes.
- `just jig::test-package` checks the installed inventory, exact copied licensing
  and pricing files, and the published Bread 1.0 text's fixed digest. The check
  uses retained local text, without a Bread checkout or network lookup.
  Its `test/package-smoke.ts` shares registration-free installed display checks
  in `test/fixtures/installed-display.ts`. Hidden Core requires a nonzero
  `JIG_TUI_UNAVAILABLE` Run refusal before dispatch, the no-Flow explanation,
  no alternate-screen entry and unchanged terminal attributes on Mac or the
  provisioned `JIG_LINUX_ROOTLESS_HOSTILE=1` host. The retained PTY session owner
  measures restoration before exit. Ordinary Linux source CI proves only the
  applicable non-Run checks because delegation precedes renderer preparation;
  that omission grants no host proof. The compact installed-display witness
  keeps the helper's strict default and refuses a missing Run-proof profile.
  Help, public authoring and embedded saved browser inspection remain
  unconditional under hidden Core. After restoration, positive saved TUI
  navigation checks immutable preview, fresh Stay-default exit confirmation,
  rendered Leave selection before Enter, joined closure and exact screen/input
  restoration. Refusal alone cannot qualify these positive behaviors.
- Trust-boundary changes require the provisioned host-conformance workflow.
- Mac Codex preference qualification uses
  `test/macos-23E224/macos-preferences-observer.test.ts` and
  `test/macos/macos-preferences-boundary.test.ts` with `JIG_MACOS_PROCESS_TEST=1`.
  The actual-observer positive and injected-policy cases require native Intel
  23E224 without configured Codex MDM. They prove closed decisions, inherited
  sandbox refusal and parent-loss expiry, not installed MDM consumption. The
  raw boundary test checks populated synthetic preferences, read-only counters,
  inherited rights and cleanup. Genuine startup is qualified separately by
  `test/startup/native-agent-startup.test.ts`; other Mac profiles must explicitly refuse
  Codex selection while retaining their independent client checks.
- CLI acceptance: `bun test packages/jig/test/portable/cli.test.ts packages/jig/test/portable/cli-presentation.test.ts packages/jig/test/portable/cli-run-presentation.test.ts packages/jig/test/portable/cli-value-presentation.test.ts packages/jig/test/portable/cli-output.test.ts packages/jig/test/portable/project-plan-review.test.ts`.
  Check rendered success, failure, waits, cancellation, uncertain cleanup,
  plain/redirected output, narrow widths, and light/dark terminal palettes.
  Preserve byte-exact machine records and complete changed review policy.
- `test/host/markdown-worker.test.ts` checks installed Markdown's Agent-admission
  requirement and Agent-free code execution with the complete packed FLOW SDK
  in an ordinary declared workspace. It honors
  `JIG_PACKAGE_ARCHIVE` and `FLOW_SDK_PACKAGE_ARCHIVE`; otherwise pack built
  candidates. Failed public commands retain their consumer and diagnostics
  under the selected temporary root for investigation.
- `test/host/installed-*.test.ts` and `test/host/package-provider-observation.test.ts`, under `JIG_LINUX_ROOTLESS_HOSTILE=1` or
  `JIG_MACOS_PROCESS_TEST=1`,
  exercises public installed review, inspection and direct/Binding/child invocation
  of an ordinary declared workspace dependency, including admitted-byte pinning.
  It selects a two-minute Run budget so the test measures these installed
  behaviors even when hosted startup exceeds the shorter production default.
  Its packed entrypoint consumer checks both string forms, noninteractive default
  selection, current input bytes, overrides, explicit-target bypass and output
  collision refusal. Its packed attachment consumer checks empty bound and
  per-invocation roots, read-only enforcement, and the full relative path limits.
  It accepts `JIG_PACKAGE_ARCHIVE` or packs the built candidate.
  It also verifies prompt failed settlement of a deliberately crashing Flow
  through the installed CLI, followed by ordinary use of the same project.
  Its software-factory consumer runs the unchanged application with packed
  public dependencies and a deterministic Flow Agent peer, then removes the
  editable repair package after approval. It verifies admitted dependency
  imports, relayed worker progress, both blocked job causes and checkpoint
  delivery without native clients or model calls. A second reviewed peer returns
  deterministic repairs through the public structured Agent result. Verify final
  Jobs, Checks and Patches snapshots whenever explicit reception ends cleanly;
  loss retains only its observed prefix, with exact contiguous NDJSON and an
  exact failed/LAGGED ending. Both explicit runs independently verify their own
  result packets, complete job and acceptance evidence, and exact delivered
  file inventories, sizes and hashes. The heavy automatic plain run likewise
  verifies its own packet, both accepted repairs and all nine delivered files.
  Automatic plain display selects the first Jobs root purpose and prints only
  changed root meaning at settlement, with exact ended/provisional context.
  Declared LAGGED may retain no root or only its known observed Jobs meaning,
  with the exact incomplete/provisional explanation; other failures, extra
  settlement claims and fabricated clean endings refuse qualification.
  Accepted Checks and Patches remain model evidence rather than additional
  plain summaries. Plain assertions separate exactly one quoted Output
  header bound to the physical packet directory after its inventory and hashes
  have been verified; words in that path cannot establish observation loss.
  A separate small cold installed consumer requires complete clean reception
  through both automatic display and explicit NDJSON, and declares producer loss
  alongside successful work and verified delivery. Deterministic application tests
  independently require the real factory publisher's completed Jobs, Checks and
  Patches offers. Portable channel tests exercise actual receiver overflow,
  producer loss and retained-model settlement through the shared display
  settlement entrypoint without disabling independent
  application-channel delivery. Optional reception never guarantees clean closure
  for every heavy Run or changes its work outcome.
  The sequential host gate includes this consumer; it does not qualify model behavior.
- With `JIG_LINUX_ROOTLESS_HOSTILE=1`, `test/package-smoke.ts` also qualifies
  inline/named command grants through the installed public CLI and complete
  packed SDK in a consumer workspace, and the complete HTTP-backed Agent artifact
  without rewritten workers, including application → specialist → Agent
  composition, named-contract substitution, Markdown selection and independent
  decision rejection. It honors `JIG_PACKAGE_ARCHIVE`,
  `FLOW_SDK_PACKAGE_ARCHIVE` and `AGENT_METHOD_PACKAGE_ARCHIVE`.
  Failed smoke consumers and candidate archives remain available for diagnosis.
  Mac's fresh initialized greeting retains its cold registry preparation and
  scratch/child execution checks. When `JIG_MACOS_TEST_TIMINGS_DIRECTORY` is
  configured, only its first review writes the existing bounded private phase
  trace to `installed-greeting-review-profile.txt` for hosted artifact retention.
  The trace contains fixed phase names and timings, never registry text,
  credentials or source; assertions and preparation/command limits stay unchanged.
  Its trusted npm installation has a 120-second fixture allowance, accepts
  `JIG_NPM` and uses the selected absolute
  `JIG_AUTHORING_NODE_PATH` directory for npm's interpreter when the host PATH
  excludes runner tool-cache binaries. This does not change Run authority.
- The installed smoke also runs `test/installed-mapped-files.ts` with frozen
  Jig and FLOW SDK archives on the selected native test host. Its ordinary
  project invokes a file Flow directly, then maps concurrent siblings and a
  nested child through the public CLI and SDK. Check binary and empty-file
  delivery, immutable source preservation, and live complete imports before
  each call returns; final packet rules remain independent.
- The same installed smoke runs `test/installed-conversation-adoption.ts` in
  a fresh ordinary project using the frozen Jig/SDK/method archives, public
  `new --use` and `import-contract`, and the unchanged public conversation
  caller. An ordinary deterministic Flow peer checks two-turn settlement,
  malformed input, blocked initial outcome, lost observation and acknowledged
  interruption followed by actual turn and invocation settlement. No private
  imports, native clients or model calls; this is adoption regression evidence,
  not independent usability or native Agent qualification.
  Test-owned command transcripts are bounded and retained beside the consumer;
  the existing bounded command helper interrupts, escalates and awaits exit
  on failure. Its settlement budget outlasts the fixture's explicit Run limit.
  The credential-free command environment retains `XDG_RUNTIME_DIR` and
  `DBUS_SESSION_BUS_ADDRESS` for the existing Linux user-service host.
- Agent lifecycle suites accept `FLOW_SDK_PACKAGE_ARCHIVE`,
  `REPORTING_PACKAGE_ARCHIVE`, `AGENT_METHOD_PACKAGE_ARCHIVE` and
  `AGENT_ACP_PACKAGE_ARCHIVE` for unchanged
  candidate artifacts; otherwise they pack already-built packages without
  rebuilding during execution. The native Codex immediate-interruption
  qualification separately installs the frozen Jig candidate and published
  conversation dependencies in an ordinary consumer. It imports the published
  Agent contract through the public CLI, then checks the actual follow-up
  result and host cleanup. The test asserts and prints the resolved package
  versions; the CLI must come from `JIG_PACKAGE_ARCHIVE`, so fixes can qualify
  before publication. Published conversation dependencies remain separately
  identified; this is installed candidate evidence, not a registry publication proof.
  `finite-acp-lifecycle.test.ts` also runs the private incident-brief fixture
  with packed dependencies and a deterministic native peer. It checks two
  branches, predecessor settlement, one successor and residue, not model quality.
  Failed handoff fixtures retain bounded phase/dispatch timing with their results;
  timing is diagnostic evidence, not permission to extend execution deadlines.
- `linux-rootless-run.test.ts` isolates real finite ACP exit, automatic crash
  fencing and shutdown-grace fencing with a synthetic authenticated peer.
  Its deliberate payload/launcher SIGSEGV probes retain bounded process-state
  and fencing evidence, not native-client qualification or crash-origin proof.
- Test diagnostic usefulness as well as redaction, and human-facing output
  alongside its machine-readable contract.

## Child DOX Index

- [test/AGENTS.md](test/AGENTS.md) — Whole-file suite applicability, installed witnesses, live prerequisites and evidence.

- [support/AGENTS.md](support/AGENTS.md) — Native policy assets and the private
  Mac pre-exec boundary; installed-platform promotion remains package-owned.
- [src/internal/AGENTS.md](src/internal/AGENTS.md) — Private admission,
  containment, execution, durable state, and Agent-provider boundary.
- [test/fixtures/channel-conversation/AGENTS.md](test/fixtures/channel-conversation/AGENTS.md) —
  Internal request/reply peers for installed channel and cancellation proof.
- [test/fixtures/repair-batch/AGENTS.md](test/fixtures/repair-batch/AGENTS.md) —
  Batch/checkpoint host-proof additions assembled over the focused repair example.
- [src/markdown/AGENTS.md](src/markdown/AGENTS.md) — Frozen recipe parsing,
  finite interpretation, whole-value handles and bounded reasoning context.
