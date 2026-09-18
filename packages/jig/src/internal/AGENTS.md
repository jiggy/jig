# Private Jig host

## Purpose

Owns Jig's trusted private machinery for admission, retained artifacts,
project and Run lifecycles, rootless Linux containment, dependency preparation,
child calls, project commands, delegated HTTP, and Agent providers.

## Ownership

- Activation planning, admission storage, project sessions, root controllers,
  and durable lifecycle state.
- Admission storage retains private native-session snapshots under exact
  recipient scopes: at most sixteen 8 MiB UTF-8 rollouts, with 24-hour logical
  expiry and atomic single-use claims that delete the payload. Access requires
  the current coordinator and an active prepared root Run. Run-scoped snapshots
  additionally bind to that root; successors inherit their lifetime. Terminal
  commit atomically removes temporary state, including through recovery; storage
  failure prevents terminal completion. Cross-Run snapshots retain their separate
  expiry policy. Native collectors
  own clean-close, content and current-grant validation; a reference grants no
  authority. Storage or ownership uncertainty must not become successful retention.
  Expected retention loss reports a closed reason. Only recognized content-profile
  rejection is optional; unexpected collector/I/O errors remain execution failures.
- `invocation-context.ts` owns shared admitted-parent identity and durable
  parent-owner checks, plus protected owner-root validation. Finite ACP, command
  and HTTP controllers use these checks; resource ownership must not import Agent
  execution logic. Parent descriptors retain the exact bounded ancestry.
- Package artifact retention, materialization, and preparation.
- `dependency-flows.ts` selects declared `npm:` dependencies after ordinary
  contained Bun preparation. It inspects a regular-file package view and retains
  the original dependency lookup layout with that package as the execution root.
  No provider imports, live installation traversal or new native authority.
- Contract generation owns captured TypeSpec requests, a bounded trusted Node
  subprocess with empty environment and stdin lifetime lease, and per-package
  publication journals beneath `.jig`. It requires separate `--generate-contracts` consent.
  Only exact before/after bytes may settle interrupted batches; observed edits
  conflict. Completion recaptures visible files before review. Individual renames
  are not atomic multi-file publication or protection against every editor race.
- Invocation file capture, sealed input projection, bounded anonymous output,
  and separate command-owned publication after execution fencing.
- Installed Bun authentication, rootless acquisition, delegation,
  containment, supervision, and execution.
- Native client launchers, reviewed runtime policy, private authentication and
  bounded process ownership. Ordinary Agent packages own method preparation,
  response interpretation and optional updates; no Agent method runs inside
  the coordinator.
- `private-acp-resources.ts` captures operator configuration before project
  loading and resolves only each target's exact granted clients. Selected
  runtime identities enter the recipe and review; launch revalidates their
  bytes and authentication. Unavailable clients do not block unrelated targets.
  Reject native destinations under sandbox-reserved paths during selection with
  the closed location diagnostic; share sealing's path predicate. Preflight
  neither mounts files nor replaces launch-time validation.
  Cache selected configurations by client and granted model together; a grant
  model does not change authentication mode or mutate the operator snapshot.
- `acp-setup-diagnostics.ts` owns closed client/stage setup diagnostics and
  corrective hints. Preserve known failures through planning and CLI rendering;
  raw exceptions, private paths and credentials never become recovery text.
- `finite-acp-policy.ts` authorizes each native write for one finite ACP
  conversation. `finite-acp-resource.ts` owns bounded framing, private startup
  and authentication, and essential channel delivery. Ordinary Agent Flows own
  protocol dialogue and answer interpretation. The resource reports actual
  termination only; `root-finite-acp-controller.ts` owns its durable lifetime,
  cancellation, fencing and recovery.
  Negotiate typed native diagnostics without adding client authority. Project
  warnings as closed notices, never answer chunks or raw private metadata;
  authoritative errors remain failures even before session creation or after a turn.
  Preserve closed native-session/protocol failure explanations after possible
  dispatch without exposing exception text or weakening uncertainty and cleanup.
- Channel integration resolves admitted package contracts and binds root
  output, exact child endpoints, or finite ACP resource endpoints. Unused incoming
  rights may move onward; each child and effect retains its own participant identity.
  Child input, recipe, capacity and sealed-owner checks precede atomic transfer.
  Receiver disposal preserves an unused writer's transfer rights, not delivery;
  a disposed direct receiver makes later sends fail disconnected. Root and child
  contracts share one bounded cache.
  Broadcast subscription authority remains with the source creator; subscribers
  have isolated buffers and failures under unchanged aggregate lifetime bounds.
  Agent updates accept direct or broadcast writers through the same admitted
  named contract. ACP ingress is separately bounded and never
  blocks its protocol reader; failed progress does not manufacture failed work.
  The installed writer bounds live stdout/stderr and cancels on delivery loss.
  Command reports retain aggregate-bounded diagnostics with host-assigned call
  paths, independently of root-process stderr. Settled root notifications let
  interrupted commands report known terminals without reopening closed authority.
- Project commands use reviewed Binding policy, sealed candidate bytes,
  installed Bun, and a collector outside candidate execution. Command owner
  rows and independent supervision survive coordinator loss without replay.
- Command and HTTP effects share the contained-effect owner and recovery path.
  HTTP, command and finite ACP grants resolve at Binding slots and are pinned in
  review and recipe identity. Optional catalog files are captured project proposals. The
  apply boundary checks explicit authority approval for new/changed recipients
  or policies; it never infers consent from file access or normal --yes. The fixed
  HTTP worker receives only one request's credential over private stdin; it imports
  no authored code. The collector validates its bounded result after fencing. No redirect, proxy,
  automatic retry or raw credential projection is permitted. Remote effects
  remain possible after an unsuccessful local result.

## Local Contracts

- Every `Private*` export remains package-private and is not an extension SPI.
- Approved-snapshot inspection uses SQLite read-only/query-only access and a
  consistent read transaction, never schema initialization, recovery, or a
  coordinator. Reuse filesystem identity and retained-artifact verification;
  reject unreadable state instead of repairing it. Only explicit public target
  fields leave the store; private recipes and authority records remain private.
  Environment inspection shares Run's recipe identity calculation but returns
  inert comparison evidence, never an authenticated executable recipe. Compare
  current support without cgroup acquisition or namespace execution; Run retains
  full launch revalidation. Include selected child identities, isolate unrelated
  targets, and report failed comparisons as unchecked without private causes.
- One resolved slot table pins exact Flow targets or qualified native invocations.
  An explicit typed route must match its provider's offered contract; it cannot
  fall back or turn a claimed native descriptor into package-held authority.
  Project defaults resolve ordinary routes before admission, including direct
  Flow routes. Lock projection and complete graph checks retain those choices.
  Markdown reasoning derives its reserved Agent requirement during inert
  inspection and executes through that same table. Installed interpreter bytes
  participate in runtime identity; Markdown resources never trigger installation.
- Unconfirmed cleanup or fencing is fatal to the owning invocation even if code
  catches its operation error. A conclusively cleaned child failure remains
  recoverable with ordinary language handling; no result-acknowledgement ledger.
- Root status reports a failed ownership-settlement attempt instead of silently
  scheduling it again. Keep its durable work for coordinator recovery; polling
  or draining does not clear that failure or authorize another dispatch.
- Strictly parse, bound, snapshot, and authenticate values crossing a trust
  boundary. Decoding inert bytes must not mint authority.
- Preserve the sequence observe, identify, plan, seal, admit, revalidate,
  execute. Never execute mutable project source or stale host evidence.
- Flow code receives no ambient host authority. Minimize environment, mounts,
  executables, network, credentials, and capabilities explicitly.
- Dedicated trusted launchers restrict inherited descriptors synchronously
  before each execution hop, including before Bubblewrap. Keep only stdio
  and exact setup/input handoffs; refusal to enforce the restriction fails
  closed. Do not mutate the coordinator's descriptor table or leave host
  descriptors accessible through a sandbox-visible trusted parent.
- Stage only captured manifests, the supplied root lock, and root-declared
  bounded `.patch` files for Bun installation. Patch paths are descriptor-captured
  without links, match the locked declarations, and remain exact retained inputs;
  Bun applies them, not a Jig patch engine. Recheck bytes and preserve source identity;
  materialize other authored files afterward. They must not trigger config
  loading, preloads, or foreign-lock migration. Supplied locks remain frozen.
  Missing-lock resolution requires explicit trusted per-review permission,
  separate from Run approval, before acquisition. Never persist that grant or
  infer it from project input, `--yes`, or an earlier review. Validate the
  generated graph before frozen installation; retain its exact bytes privately.
- Workspace capture supports root applications and declared ancestor members,
  reading root metadata and selected dependency
  source, never installed links. Recheck metadata, retain exact regular files,
  and recapture on review even when the Flow is unchanged. Preserve the pinned
  hoisted install's workspace-relative paths and dependency scopes. Retain only
  exact installer aliases to selected member roots. Bun preparation owns member
  and dependency semantics; admission carries bytes and layout as one execution
  artifact. Recipes derive the launch command. Materialization receives only
  regular bytes and exact runtime-independent aliases; verification and cleanup
  handle recorded aliases without following them. Package/1 stays
  regular-file-only. Runs receive no live workspace authority. Bun owns
  installation, not a parallel Jig resolver.
- Provider credentials are host configuration and must not enter Flow input,
  project state, artifacts, diagnostics, or unrelated provider processes.
- The finite resource enforces native protocol and prompt bounds before writes.
  ACP grants default to one turn; maxTurns explicitly permits up to eight serial
  turns without resetting aggregate limits. Consume cancellation racing idle
  settlement without native dispatch. Missing interruption settlement fences the
  resource after five seconds; a notification alone cannot authorize another turn.
  Leading-slash prompts are rejected because clients interpret them as control
  commands; a method's prefix is not the authority safeguard.
- The finite ACP peer refuses permission requests with the protocol's cancelled
  outcome, never a peer-supplied option ID. Permission refusal does not issue
  session control against an identity supplied by the request; Run cancellation
  remains tied to the owned session and host fencing.
- Native Codex subscription access comes from the current operator's
  file-backed Codex login. Project only its short-lived bearer; never embed a
  development login, retain its refresh token, mount `CODEX_HOME`, or expose a
  host keyring to Agent execution.
  Its constrained profile disables Code Mode and its helper host; unsupported
  optional tool startup must not inject private-path warnings into Agent answers.
- Codex's nested sandbox uses an unprivileged Bubblewrap selected from its
  declarative binary wrapper's PATH prefix and operator PATH, excluding project
  routes, or the matching bundled helper when no eligible PATH helper exists.
  `JIG_BWRAP_PATH` selects only outer containment. Never substitute a system
  helper at the vendor bundle path; keep bundled fallback off PATH to preserve
  Codex's vendor digest check.
- Codex, Claude Code, and Pi inspect supported ELF metadata without executing
  it. Codex and Claude also support the bounded declarative binary wrapper;
  Pi retains its unwrapped standalone layout and project-excluded sibling assets.
  Resolve loader-owned libraries through the interpreter's canonical location;
  retain individual executable, loader, and
  library files at installation paths, hash their bytes, and revalidate before
  launch. Hash each native file before reading its metadata; inspection remains
  provisional until provider construction's fresh hashes close that interval.
  Every native factory must verify the complete inspection against its authentic
  provider before returning it. Do not add an intermediate full-file hash pass
  or treat path, size, or timestamps as byte evidence. This comparison never
  replaces launch-time filesystem and byte revalidation or establishes a
  persistent verification cache. Reject unsupported or project-selected dependencies; never mount a
  whole installation/store or import ambient loader variables. Each native
  launcher removes Bun's private loader override before starting its client.
- Keep known channel-declaration, Agent-configuration and dependency-preparation failures actionable
  through closed diagnostic codes and project-relative locations, never raw
  provider or worker messages. Missing Agent support affects only targets
  which require it.
  Unreadable retained state has a distinct closed diagnostic from unsafe
  filesystem ownership. Preserve it on failed acquisition; never infer permission
  to reset admission or bypass cleanup from a decoding failure.
- A reproduced root recipe that differs from its approval is a known pre-execution
  refusal: retain host-only REVIEW_REQUIRED with flowStarted=false,
  and direct the operator to review. Do not collapse it to EXECUTION_FAILED or
  infer this reason from arbitrary failures. Recovery and cancellation keep their
  existing precedence. Flow wire failures cannot emit this code; never replay work or claim no execution after a sandbox began.
  Root execution compares the actual sealed owner's mechanism identity with the
  reviewed recipe before admission, using sealing's fresh observation instead of
  a duplicate pre-seal observation. Retain and settle the sealed owner on refusal;
  final admission still revalidates support bytes and invocation authority.
- Review projects only explicit public policy and allowlisted non-secret Agent
  selections. Environment-only target changes name the execution environment,
  distinguish unchanged source/dependencies/policy, and explain the new approval.
  Combined fingerprints cannot identify individual historical components; disclose
  that limit instead of inventing a component diff or displaying opaque identities.
  A change-first display omits empty categories and uses shared YAML field
  rendering, with complete signed additions/removals and contextual diffs.
  It must retain every changed record; full
  policy remains available without revealing private recipes or consent tokens.
  Missing-target suggestions come from the retained admitted revision, never a
  live filesystem scan, and cannot grant authority or select a replacement.
- Deadlines and cancellation fence descendants, settle each terminal once,
  and complete bounded cleanup. Do not replay uncertain operations.
- Durable transitions use exact identities and conflict-safe commits;
  recovery must not create duplicate owners or official Runs.
- Root attachments use invocation-owned descriptors and canonical file identity;
  hashes alone never grant file access. Per-run captured bytes are not retained
  artifacts. Child and Agent contexts receive no attachment or destination authority.
- Reviewed Binding read selections reuse the bounded file capture controls and
  retained artifact store. Bind source, manifest and tree identity to the exact
  configuration; revalidate at admission and project retained bytes at execution,
  never live sources. Runtime mappings cannot override them. Combined retained
  and per-run input stays within the root file budget; no child inheritance,
  executable discovery, library resolver, network or credential authority.
- Keep execution settlement separate from delivery. Retain bounded output after
  writer fencing; publish once without replacement through the independent
  command owner. Coordinator loss must remove unpublished staging. Late failure
  preserves a known terminal or publication and never authorizes replay.
  Cancellation and expiry escalate against the exact trusted child after a
  bounded grace period and reap it; independent cgroup fencing still owns payload cleanup.
- Exact child slots may select a Flow or a bounded Binding with its own admitted
  settings, ordinary invocation routes and reviewed command, HTTP or finite ACP
  grants. An effect belongs to that child
  context, not the root's operation namespace; fence and drain it before
  releasing the child owner. Two child Flow levels use their own admitted slot
  maps; private nested Flow identifiers include their parent identity.
- Roots admit two Flow branches or one exclusive effect. Reserve each whole
  branch's longest admitted Flow path plus one effect against the fixed aggregate
  root budget before dispatch; retain its
  reservation until confirmed fencing and cleanup. Kernel envelope limits and
  the recipe-bound reservation policy must agree. Each child admits one Flow or
  effect; the second child level admits only an effect. The aggregate envelope
  accommodates two complete two-level branches and their effects. There is no
  queue, borrowing, recursive budget, or public scheduler. An ancestor fence
  prevents all further descendant dispatch; recovery drains descendants before
  releasing each Flow owner and its branch reservation.
- Channel operations have separate finite transport capacity, not worker slots.
  Unsupported delivery or invocation wiring rejects before dispatch. Observation
  grants no session control; FLOW endpoint rights and source-owner lifetime
  remain authoritative. Keep channel state command-local, not durable replay state.
- Run Checkpoint uses one separate bounded control operation, not a worker
  reservation. Only the root's independent output owner accepts immutable
  aggregate bytes before acknowledgement. Bind exact Run, admitted method,
  captured input, project identity and coordinator epoch before dispatch.
  Interrupted publication uses accepted bytes only after complete fencing;
  recovery may settle that exact older Run but never submit or replay work.
  Keep rejected replacement, lost acknowledgement, owner lifetime, output
  collision and cleanup failure distinct. The owner retains no history.
- A project command receives immutable text and runtime mounts only: no Flow
  package, network, credential, or arbitrary executable. Host observations are
  process evidence, not an independent test verdict. Candidate bytes are copied
  from sealed descriptors into named files in a bounded private tmpfs, made
  read-only before payload execution so Bun can resolve modules safely.
- Fail closed on unsupported hosts, changed bytes, missing enforcement,
  malformed protocol, cleanup failure, or unverifiable provenance.
  Hold the trusted entry until the coordinator validates cgroup membership and
  any output handoff; short-lived commands must not race that check. Close the
  private continuation gate before candidate execution.
  Drain buffered supervisor control after process exit within a fixed bound;
  exit alone neither disproves a pending receipt nor establishes fencing.
- Resolve Jig's outer containment and system-management tools from fixed locations, or
  Bubblewrap from the operator's absolute `JIG_BWRAP_PATH`, never ambient `PATH`. An explicit
  selection receives the same validation and cannot fall back on failure.
  Run loader support mounts the real glibc files, not a shim or whole Nix store.
  File-capture FFI and executable runtime support use the same loader selection.
  The fixed trusted Bubblewrap feature probe uses only read-only system runtime
  roots, never the host root or sysfs tree; its bootstrap mounts are not payload
  authority or proof of a Run's filesystem isolation.

## Work Guidance

- Under the prerelease rule, replace old formats completely; do not retain
  readers, migrations, or aliases.
- Add negative, hostile, race, restart, and cleanup evidence for
  trust-boundary changes.
- Never start a fork storm, memory-pressure payload, or similarly hostile code
  until preflight proves complete delegation and the launcher guarantees that
  the payload begins inside its finished owner envelope.
- Do not weaken production checks for an unprovisioned unit test. Use private
  injection seams for units and the proof host for kernel behavior.
- A provider adapter may narrow common Agent authority, never widen it.
- API-backed Agent behavior belongs to the ordinary Agent package and its
  exact HTTP grant. Native Codex, Claude Code, and Pi retain constrained ACP
  launch and authentication support. An endpoint, credential, provider, or
  model used in development must not become a product default.
- Native Codex, Claude Code, and Pi use a snapshot of the operator
  environment captured before project loading. Absolute client overrides are
  authoritative; otherwise search absolute PATH entries in order, excluding the
  actual project tree and ancestor dependency directories through every symlink
  hop. Review may show the resolved operator executable path, never credentials
  or private retained paths. Launch revalidates the selected executable and
  support bytes against reviewed identity; it never repeats PATH discovery.
- Keep each native client a thin profile over the common ACP lifecycle. A new
  client must not require FLOW changes, and a public provider/customization SPI
  requires independent installed consumers to earn its shape.
- Close missing evidence with focused tests; do not remove a selected client
  solely because prerelease live coverage lags.
- Optimize startup from measured command-entry-to-Flow-execution traces. Count
  repeated file reads and separate Agent acquisition, project recovery, sealing,
  and launch. Combine redundant checks only at explicit verification boundaries;
  preserve durable recovery and independent launch checks. Use disposable reviewed
  consumer projects for before/after measurements, never alter a user's approval
  or replay their work to benchmark startup.

## Verification

- Run the directly corresponding `packages/jig/test/` files, then
  `bun test packages/jig`.
- Containment, delegation, preparation, process-lifecycle, or Agent authority
  changes require the provisioned hostile-host suite and residue check.
- Native installation regressions cover discovery, environment snapshots,
  missing/project-selected support, byte replacement, and credential expiry.
  `JIG_NATIVE_AGENT_STARTUP=1` with absolute `JIG_CODEX_STARTUP_PATH`,
  `JIG_CLAUDE_STARTUP_PATH`, and `JIG_PI_STARTUP_PATH` enables
  `test/native-agent-startup.test.ts` after building. It tests genuine native
  versions and ACP sessions with networking disabled and dummy credentials;
  missing selections fail instead of silently skipping. This is startup evidence,
  separate from live model calls and the hostile-host gate.
- Run real-host suites sequentially within one delegated cgroup. Their strict
  acquisition and residue checks intentionally reject other concurrent Runs;
  the ordinary suite also includes host tests when delegation is present.

## Child DOX Index

- None.
