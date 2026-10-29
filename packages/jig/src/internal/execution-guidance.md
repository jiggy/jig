# Private execution ownership and settlement

Apply these rules when the parent reading map selects this domain.
Read the [shared host contracts](AGENTS.md) before changing its implementation.

## Find a module

These links locate module rules. All selected domain requirements still apply.

- [private-profile](#private-profile)
- [root-run-timeout-policy](#root-run-timeout-policy)
- [invocation-context](#invocation-context)
- [execution-intent](#execution-intent)
- [execution-backend](#execution-backend)
- [linux-rootless-delegation](#linux-rootless-delegation)
- [execution-intent tests](#execution-intent-tests)
- [root-flow-call-controller tests](#root-flow-call-controller-tests)
- [native clocks](#native-clocks)
- [controlled evaluation](#controlled-evaluation)

## Ownership

### Native clocks

- `native-clock.ts` owns closed native deadline coordinates and watchdogs.
  `attempt-clock.ts` adds presentation/retention hints to that same source.
  Native time includes suspend: authenticated procfs uptime and boot UUID on Linux,
  or qualified Darwin `mach_continuous_time`, timebase and kernel boot-session UUID.
  Presentation and wall time never grant acceptance. Wall time remains public/advisory.

- The root controller independently checks protected cancellation and the once-persisted monotonic deadline, without client polling.
  Root plans and child/effect allocations retain `effectiveBootDeadline`.
  Evaluation phase plans retain fixed `bootDeadline`.
  Descendants join protected root and immediate-parent budgets before allocation.
  Native sealed plans/control require boot deadlines and recheck every 25 ms, independently of coordinator lifetime.

- Convert legitimate non-ticket private absolute constraints once at trusted sealing, before setup.
  Never accept sealed-plan or native-control deadline fallbacks.
  Evaluation phase ceilings remain separate 15/30/15-second bounds. Recovery never restarts them.

  Clock uncertainty stops work without disabling cleanup.
  Native receipts distinguish `clock` loss from proved `deadline` expiry.
  Guardian preparation retains the closed `NATIVE_CLOCK` cause.

- Clock loss means unavailable/failed execution, not proved elapsed expiry.
  RunHostSession receives a host-neutral remaining-budget callback, never native clock tokens on the FLOW wire.
  Native owners still fence on control loss.

### Controlled evaluation

- `project-evaluation-*` owns reviewed evaluation recipes, compiler policy and development-inclusive preparation.
  This differs from declaration evaluation in `project-evaluator-*`.
  Evaluation never selects FLOW production dependencies or establishes independent application acceptance.
  `project-evaluation-controller.ts` specializes common contained-effect dispatch/recovery.
  One logical effect row retains at most three ordered phase owners.
  Persist phase plans and native owners before admission.

- Capture phase output only after fencing. Release native/workspace ownership before the next phase.
  Recovery settles retained owners without advancing programs.
  `project-evaluation-input.ts` streams a borrowing immutable C/R/D/prior-output package view.
  C is the candidate, R the reviewed recipe, and D the locked development-inclusive dependencies.

  Normal settlement joins its original lease's complete allocation identity to the retained phase plan.
  After native release, it invokes that lease's memoized disposal.
  Disposal still revalidates inode identity, all bytes and modes.
  Recovery without a live lease reconstructs the retained allocation.

  Only native phase roots and fresh scratch are writable.
  `project-evaluation-workspace.ts` defines a closed native phase discriminator, never an arbitrary workspace interface.

- Project Evaluation failure evidence belongs to the existing operation-error
  `details.evaluation` channel, specified in
  [Project Evaluation](../../../../docs/jig/spec/project-evaluation.md#stopped-evaluation-evidence).
  Keep the successful descriptor and operational failure codes unchanged.
  Retain observed phase records before propagating deadline or cancellation.
  Track selected phase and host stage separately from native dispatch.
  Pre-phase setup has no selected phase. Preparation or admission is not proof
  that candidate code ran.

  Preserve collected process evidence before output capture and settlement can
  fail. Keep unavailable process or file evidence explicit as `null`. An empty
  manifest requires a completed capture. Do not invent later skipped phases.

  Derive limit attribution from protected monotonic minima. Tied or unproved
  winners remain unknown. Wall time cannot establish root or phase expiry.
  Recognize native preparation expiry only through its trusted deadline error.

  Failure projection retains at most 8 KiB of UTF-8 per stream, with truncation
  disclosed, after physical-to-logical path sanitization. Keep native collection
  and successful 64 KiB stream limits unchanged. Project only bounded public
  evidence, never private exceptions, owner identities, tickets or bearer rights.
  Preserve cancellation precedence and fatal fencing/retirement uncertainty.
  Emit `cleanup: complete` only after all owners and captured inputs retire.
  Retained evidence never authorizes replay or phase advancement.

- Evaluation custody stays on its original `root_child_owners` row: optional generate, then compile and test.
  Retain at most twelve append-only plan/sandbox/fence/cleanup checkpoints.
  Plans retain native allocation intent before launch. Cancellation may fence unsealed plans.
  Each next phase and aggregate fence/cleanup/close require preceding phase cleanup.

  Exact joins return inert authenticated history, never replay authority.
  Native owners independently authenticate allocations and receipts.

- Replacement coordinators append only recovery fence/cleanup, never plans or sandboxes.
  Phase-only owners need no fabricated aggregate native records.
  Close compares the complete final `phaseHistoryDigest`.
  New history transactionally consumes the ticket's preallocated control reservation.
  Preserve its final fencing/cleanup margin.

- Linux copies at most 192 MiB/8448 immutable regular files into private cgroup-charged work tmpfs after delegation/envelope admission.
  Authenticated empty-directory metadata restores at most 256 paths including implicit parents, without source edits.
  Trusted setup retains the original backing/public collector custody handshake.
  Freeze `/work` and public output by read-only bind remounts.
  Overlay only selected phase outputs and scratch.

- Move cwd onto frozen work, close setup descriptors, drop capabilities and reexec before the independent continuation gate.
  The collector traverses original public backing without bind overlays.
  Preserve no-XDEV checks and independent whole-owner fencing before capture.
  Evaluation grants no file-import authority.
  Mac projection belongs to [native guidance](native-guidance.md#macos-evaluation-workspace).

- `project-evaluation-retention.ts` strictly decodes effective policy, exact R/D package references and dependency alias layout.
  Reacquisition verifies both complete domain digests against retained bytes, never live source.
  Review uses existing preparation ownership and package storage.
  Granted slots preserve identical metadata through portable lock and native routes.
  Source checks qualify neither native projection.

- Activation planning, admission storage, project sessions, root controllers,
  and durable lifecycle state.

### private-profile

- `private-profile.ts` owns opt-in bounded phase diagnostics and closed host failure codes, written
  before shutdown. Partial spans are not completion or machine-crash durability
  evidence.
  `project-evaluation-review` covers evaluation operand capture, reacquisition, review, normalization and disposal.
  Its nested `dependency-preparation` span covers only the actual development dependency preparer.
  Failed phases preserve original exceptions and cleanup precedence. Timings do not establish causes.

  Installed plan/apply and root execution observers connect only while that sink is active.
  At most eight failure observations share its existing 1024-record, 192-byte and 512-span bounds.
  Retain fixed host phases and allowlisted codes, never error names, messages or private fields.
  Guardian codes reuse the owning finite step/cause parser. Unknown causes become `OTHER`.

  Preparation observations retain only fixed worker and budget codes, plus authenticated native stop reasons and missing-terminal or nonzero-exit facts.
  These facts share the same failure budget and never include exit values, native identities or worker output.
  Readers use the strict failure-record normalizer and never count failures as timing or success evidence.

- The configuration evaluator shares only finite review-envelope setup. Its
  trusted manager runs fresh declaration subprocesses sequentially. It enforces
  each host's declaration ceiling independently of guest code: three seconds on
  Linux and ten seconds on Mac. Resources remain aggregate-limited under that
  host's enforcement profile. The supervisor caps a multi-entry batch by the sum
  of entry ceilings plus fixed and per-entry bounded setup and settlement time.
  A single entry keeps its host's total ceiling.

  Each subprocess receives only the captured modules reachable from its entry.
  Worker and SDK bytes use the existing sealed file projection. Later children
  never reopen live installed support. Bootstrap consistency remains a separate
  evaluation. Collection requires whole-batch fencing and cleanup. No result
  cache or resident service.

  The child watchdog and independent supervisor own time enforcement. Guest VM
  execution has no shorter timer that can reject work within that entry ceiling.

### root-run-timeout-policy

- `root-run-timeout-policy.ts` owns the shared 30-second root Run default for
  Linux and Mac. Installed host acquisition and CLI parsing use that same value.
  Explicit operator timeouts remain separate from bounded cleanup settlement.
  Its private presentation constraint uses epoch-referenced milliseconds from
  `Math.floor(performance.timeOrigin + performance.now())`, advancing
  monotonically within one process and retaining normal scalar meaning across
  Bun reexecution. Do not use process-relative `hrtime` as an inherited absolute
  deadline. Host-clock adjustments between process startups can shift the epoch
  reference.

  Independent execution and command timers remain the enforcement authorities.
  Seed it before a finite enclosing file-command or Linux delegation timer,
  reserve 45 seconds for bounded restoration/reporting, and preserve the minimum
  inherited value through reexecution. Eligible interactive effective dashboard
  commands omit only the default command envelope. Finite explicit constraints
  and bounded setup, Run, cancellation and cleanup owners remain enforced. The
  scalar only constrains presentation. It never grants execution authority.

  Eligible web inspection also omits the default presentation envelope. Its
  outer file owner seeds one completion budget before joining pending work. The
  budget permits twenty seconds for authenticated retirement or uncapped
  inspector exit. It preserves the inbound inherited minimum captured before
  generating the child's presentation deadline. A local presentation deadline
  leaves its closing reserve available to owner cleanup. Legacy finite-envelope
  exit retains its existing sixty-second settlement allowance.

  Memoize task/publication joins and cleanup failure. No finally path may wait
  outside that allowance or reset it. A stalled publication fences fallback and
  still attempts independent endpoint/descriptor release. Confirm retirement
  before indefinite inspection.

### invocation-context

- `invocation-context.ts` owns shared admitted-parent identity and durable
  parent-owner checks, plus protected owner-root validation. Finite ACP, command
  and HTTP controllers use these checks. Resource ownership must not import
  Agent execution logic. Parent descriptors retain the exact bounded ancestry.

### execution-intent

- `preparationOutput` selects only production or evaluation package collection.
  It cannot share ordinary output or an evaluation workspace.

  Optional `preparationLimits` carries the snapshotted production collection bounds
  through both native plans. Validate and freeze that pair before sealing. Reject
  it for evaluation or ordinary execution. It selects no collection path and
  changes no execution resources, lifecycle or cleanup allowance.

  Linux pins original work custody before continuation through authenticated supervisor control.
  Its package promise captures after successful enforcement and closes that original loan.
  Native package promises retain rejection custody without replacing their original failures.

- `execution-intent.ts` owns inert execution requirements: exact command and
  explicit path arguments, read-only projections, captured input capabilities,
  network choice, resource limits, storage and output bounds. Literal arguments
  never undergo path relocation. Intent alone grants no execution authority.
  `execution-plan.ts` lowers these requirements to the two host mechanisms. It
  imports no recipe, admission, provider, Run protocol or controller policy.
  Selected native environment paths relocate once as absolute scalar paths or
  JSON string values.

  Preserve physical installation paths, component boundaries, JSON escaping and
  literal text. Replacement output must never be relocated again. Native Mac
  startup qualification consumes this lowering instead of a second translator.
  Read-only workers with captured inputs still allocate bounded Mac input
  storage without payload write grants. Workers using only retained projections
  need no volume. The stdin-only HTTP worker uses exact runtime/worker files and
  literal root cwd without readonly or writable trees, captured inputs or a
  volume.

  Scope sealing permits that fixed cwd only without storage or tree grants, and
  scope preparation requires both tree grant lists to be empty. Other cwd
  choices retain their exact directory-projection check. Backend sealing still
  validates identities, live capabilities and enforcement.
  `flow-execution-intent.ts` translates Jig recipes for both root and child
  Flows. Command, HTTP, ACP, preparation and evaluator callers select their own
  requirements without constructing host plans. Keep budgets and grants with
  those callers, and physical paths, resolver mounts and volume layout with host
  translation.

  Preserve platform-specific receipt evidence. `execution-process.ts` owns
  protocol-independent process streams, exit and fencing evidence and typed
  host-observed preparation expiry. Classify evaluator preparation deadlines
  from this trusted type, never a matching arbitrary code or elapsed cleanup
  time. Run/0 consumes that interface. Backends never depend on the Run session
  implementation. Agent launcher location bindings use private `JIG_AGENT_HOME`
  and `JIG_AGENT_WORK`.

  Their fallback locations remain unchanged.

### execution-backend

- `execution-backend.ts` is the closed private Linux/macOS selection boundary.
  Persist each backend's discriminated owner and receipt records without
  flattening their evidence. Dispatch sealing, admission, recovery, cancellation
  and exact release only when the backend and authenticated owner allocation
  agree. Lower an intent only for that selected backend. Execution locations and
  mechanism setup allowances are queried through this boundary. They confer no
  filesystem authority and never extend caller-owned parent deadlines.

  Logical recipe identity remains separate from the backend's physical launch
  paths. This is not a public backend or extension interface. Shared owner
  journals live under `.jig/private-root-owners`. Prerelease hosts must not
  recreate the former Linux-named directory as a compatibility path.

- Native backends observe rejections of eagerly created completion, evidence,
  and termination-reason projections even when a consumer uses only some of them.
  Return the original rejecting promises: observation must not replace failures
  with success or weaken enforcement uncertainty.

- Linux startup expiry before the prepared handshake retains
  `PrivateExecutionPreparationDeadlineError` only after the exact native owner
  has an authenticated deadline fence. Local custody must close and automatic
  owner state must be released first. A failed handshake or elapsed wall time alone does
  not prove expiry. Unconfirmed cleanup retains its fatal failure.

- Linux launch rejects an already-aborted signal before supervisor startup, using
  the existing authenticated cleanup path for its sealed owner.
  Recheck abort state after subscribing so cancellation requested during startup is not lost.
  A later signal state must not relabel authenticated deadline or cleanup evidence.

- Project commands use reviewed Binding policy, sealed candidate bytes,
  installed Bun, and a collector outside candidate execution. Command owner rows
  and independent supervision survive coordinator loss without replay.

- Command and HTTP effects share the contained-effect owner and recovery path.
  Deadline failures without a proved result identify the static effect type,
  observed phase, and effective limiting budget. They must not expose worker
  errors or assert remote non-delivery. They must preserve uncertainty and
  cleanup semantics. On a repeated operation ID, resolve and settle its retained
  owner before returning a pre-dispatch deadline claim. A prior owner remains
  uncertain even when the retry's effective deadline has elapsed.

  HTTP, command and finite ACP grants resolve at Binding slots and are pinned in
  review and recipe identity. Optional catalog files are captured project
  proposals. The apply boundary checks explicit authority approval for
  new/changed recipients or policies. It never infers consent from file access
  or normal --yes. The fixed HTTP worker receives only one request's credential
  over private stdin. It imports no authored code.

  The collector validates its bounded result after fencing. No redirect, proxy,
  automatic retry or raw credential projection is permitted. Remote effects
  remain possible after an unsuccessful local result.

## Local Contracts

### linux-rootless-delegation

- `linux-rootless-delegation.ts` forwards an outer installed-command interrupt
  through its authenticated transient-scope lifetime socket to the inner CLI.
  Keep that socket open for cooperative cancellation and confirmed cleanup. Its
  closure remains the independent emergency scope fence.

  Before readiness, an authenticated refusal handoff gives the outer coordinator
  sole diagnostic ownership. It never acknowledges acquisition or grants execution.
  Without that handoff the child retains its failure diagnostic. Preserve inherited
  terminal streams rather than filtering or buffering stderr to remove duplicates.
  Close every accepted startup connection before joining server shutdown, including
  refused and incomplete peers. A stopped peer must not hold cleanup open.

  The manager may collect an exited scope before its observed cgroup path is resolved.
  Cleanup retains the validated path on `ENOENT` and still requires both manager-unit collection and filesystem absence.
  Other lookup errors and noncanonical paths remain refusals.
  This observation grants no ownership and does not change collection deadlines.

- The optional installed-startup diagnostic accepts only a private local trace
  destination. It activates after rootless-host acquisition, or directly for
  non-executing `attempt result` observation without host acquisition. Before
  opening a project session, it removes its selector from operator configuration. It
  records fixed phase names, monotonic durations and bounded closed failure causes in an exclusive mode-0600
  file. It records no source, Flow input, arguments,
  environment values, provider output, or filesystem paths. Capture failure must
  not change the Run outcome.

  This is maintainer-only profiling, not telemetry, a runtime option, or a
  supported extension point. Its planning trace distinguishes support
  verification, envelope startup, execution/settlement and workspace capture.
  Nested spans must not be summed. Finite ACP phases separate revalidation,
  containment, launch, exchange, release and recovery. They neither record
  native content nor establish remote dispatch. Contained-effect phases record
  coordinator planning/revalidation, allocation, sealing, launch, collection and
  settlement, including failed allocation and recovery cleanup.

  A phase may contain several separately paired awaits. Launch includes backend
  storage/input preparation. Collection includes stream draining, enforcement
  and backend cleanup, not just payload CPU time. Owner settlement remains
  separate. Mac backend spans separate guardian preparation from admission at
  their existing coordinator awaits. They cover root and child Flow launches as
  well as contained effects.

  Aggregate counts identify no individual operation. No selector or trace is
  passed to a Flow, and the existing 512-span/192-byte record bounds remain
  unchanged.

  Controlled evaluation uses those contained-effect labels around its existing awaits.
  Planning measures merged workspace capture and allocation measures immutable materialization.
  Sealing and launch retain their existing native boundaries.

  Collection joins streams, execution completion and enforcement, including native cleanup.
  It is not payload-only time. Settlement measures phase cleanup, workspace disposal and final evaluation release.
  These spans preserve phase order, errors and the original enclosing deadlines.

  Result phases distinguish read-only opening, ticket authentication, retention,
  Run observation, checkpoint projection, finish and disposal. Synchronous reads
  remain synchronous. Failed spans preserve the original exception and cleanup
  precedence. Phase timing does not establish a failure's underlying cause.

- A current root Run may reacquire its exact pending fence for a bounded
  interval inside one ownership-settlement attempt. Exhaustion remains
  `PROJECT_BUSY`. Root status reports that failed attempt instead of silently
  treating polling as permission to retry. A stale pending-work snapshot may
  encounter `RUN_ALREADY_TERMINAL`. Accept that refusal only after loading the
  matching durable terminal under the current coordinator, without redispatch.
  Keep failed durable work for coordinator recovery.

  Polling or draining does not clear that failure or authorize another dispatch.

- A new coordinator may retry an older Run's unconfirmed fence for a bounded
  interval while reacquiring that same durable Run. It never creates another Run
  or treats pending fencing as a terminal. Exhaustion remains `PROJECT_BUSY`
  through the project-session boundary instead of becoming an internal error.

- Dedicated trusted launchers restrict inherited descriptors synchronously
  before each execution hop, including before Bubblewrap. Keep only stdio and
  exact setup/input handoffs. Refusal to enforce the restriction fails closed.
  Do not mutate the coordinator's descriptor table or leave host descriptors
  accessible through a sandbox-visible trusted parent.

- The independent Linux supervisor polls bounded owned kernel process state.
  Confirmed core dumping fences that exact cgroup without waiting for the Run
  deadline. Keep the private crash reason separate from the actual reaped
  signal. Neither payload stderr nor a reused foreign PID establishes an owned
  crash.

- Exact child slots may select a Flow or a bounded Binding. Each target has its
  own admitted settings, ordinary invocation routes and reviewed command, HTTP
  or finite ACP grants. An effect belongs to that child context, not the root's
  operation namespace. Fence and drain it before releasing the child owner.
  Every child Flow uses its own admitted slot maps. Private nested Flow
  identifiers include their parent identity.

- Roots admit two Flow branches or one exclusive effect. Reserve each whole
  branch's longest admitted Flow path plus one effect against the fixed
  aggregate root budget before dispatch. Retain its reservation until confirmed
  fencing and cleanup. Kernel envelope limits and the recipe-bound reservation
  policy must agree. Each child admits one Flow or effect. Derive maximum branch
  depth from the fixed aggregate envelope, reserving the root and an effect too.

  Never add resources merely to allow deeper calls. The envelope accommodates
  two two-level branches or one five-level branch with their effects. There is
  no queue, borrowing, recursive budget, or public scheduler. An ancestor fence
  prevents all further descendant dispatch. Recovery drains descendants before
  releasing each Flow owner and its branch reservation.

- A project command receives immutable text and runtime mounts only: no Flow
  package, network, credential, or arbitrary executable. Host observations are
  process evidence, not an independent test verdict. Copy candidate bytes from
  sealed descriptors into named files in a bounded private tmpfs. Make them
  read-only before payload execution so Bun can resolve modules safely.

- Resolve Jig's outer containment and system-management tools from fixed
  locations. Bubblewrap may instead use the operator's absolute
  `JIG_BWRAP_PATH`. Never use ambient `PATH` for these selections. An explicit
  selection receives the same validation and cannot fall back on failure. Run
  loader support mounts the real glibc files, not a shim or whole Nix store.
  File-capture FFI and executable runtime support use the same loader selection.

  The fixed trusted Bubblewrap feature probe uses only read-only system runtime
  roots, never the host root or sysfs tree. Its bootstrap mounts are not payload
  authority or proof of a Run's filesystem isolation.

## Work Guidance

- Hostile code includes fork storms, memory-pressure payloads, and similarly
  hostile workloads. Never start such code before preflight proves complete
  delegation. The launcher must also guarantee that the payload begins inside
  its finished owner envelope.

- Optimize startup from measured command-entry-to-Flow-execution traces. Count
  repeated file reads and separate Agent acquisition, project recovery, sealing,
  and launch. Combine redundant checks only at explicit verification boundaries.
  Preserve durable recovery and independent launch checks. Use disposable
  reviewed consumer projects for before/after measurements, never alter a user's
  approval or replay their work to benchmark startup.

## Verification

### execution-intent tests

- `execution-intent.test.ts` checks cross-host lowering, literal/path
  separation, empty input roots, output locations, network authority, and
  read-only workers. `execution-backend.test.ts` rejects mismatched owner
  allocations before dispatch. Native and installed-consumer qualification still
  establish actual enforcement.

- Basic HTTP and Agent lifecycle observation waits cover native setup and
  settlement. Mac uses 60 seconds for admission observations and 75 seconds for
  terminal settlement, including cleanup. Linux retains its existing waits.
  Aggregate scenario tests allow each independently bounded Run to settle. These
  test windows never expand workload enforcement limits.

### root-flow-call-controller tests

- Verify allocation failures through real subprocesses and actual bounded owner allocation.
  Unexpected lifecycle allocation failures report the `allocation`
  phase without changing the original exception. Capacity refusal stays an
  ordinary resource-exhausted result, and observer failures cannot affect it.
