# Private Jig host

## Purpose

Owns Jig's trusted private machinery for admission, retained artifacts,
project and Run lifecycles, rootless Linux containment, dependency preparation,
child calls, project commands, delegated HTTP, and Agent providers.

## Ownership

- `contract-import.ts` owns explicit, inert contract-bundle copying: capture
  the descriptor and exact offline channel closure, validate before writing,
  and publish a new directory without replacement. Source package code,
  unrelated files, network access and Run approval stay outside this operation.
  Native publication uses exclusive directory rename from a newly owned staging
  leaf. Cleanup walks held descriptors with finite entry/depth bounds; a failed
  allocation must never authorize removal of an existing name.

- Activation planning, admission storage, project sessions, root controllers,
  and durable lifecycle state.
- Admission storage uses the closed native descriptor operations while SQLite
  retains DELETE rollback journaling, EXTRA synchronization and NOFOLLOW opens.
  Darwin resolves system ancestor aliases only for SQLite's visible filename;
  verify that hierarchy against the held state/database and the original
  requested project root before and after opening. Do not use this pathname
  normalization to replace descriptor-relative file authority.
- Durable materialization preserves exact package identity through native
  creation, aliases, reacquisition and disposal. Darwin requires the package
  directory writable for the disposal rename, after fencing and digest checks.
  A crash in that window cannot readmit it: disposal rechecks the same lease,
  restores read-only mode and validates all bytes before resuming the rename.
  Changed bytes fail closed; recorded allocation recovery may remove an
  incomplete projection without treating it as an executable lease.
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
- `descriptor-files.ts` selects closed Linux or qualified Darwin operations for
  held-directory children. Its live references cannot be reconstructed from
  decoded data; callers own descriptor lifetime and entry identity checks.
  Never convert these references to visible paths to regain file authority.
  Package publication serializes by store device/inode, publishes by exclusive
  hard link, and reacquires verified anonymous snapshots. Store enumeration
  retains and rechecks directory descriptors instead of following child paths.
  Project sessions retain their protected store parent through all planning and
  Run operations, then close it after root settlement and before the project
  owner. Acquisition failures and checkpoint recovery close that same owner;
  retained-project and child-call plumbing pass live locations without serializing them.
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
  Borrowed channel agreements are captured inputs, not managed outputs. Validate
  the full offline closure, retain input hashes for freshness, and recheck them
  before/after publication and interrupted-batch recovery without rewriting them.
- Invocation file capture, sealed input projection, bounded anonymous output,
  and separate command-owned publication after execution fencing.
- `file-input.ts` owns common bounded selection, raw-name validation and regular
  reads; `file-input-policy.ts` owns limits and closed diagnostics. Linux uses
  openat2 and sealed memfds; qualified Darwin walks held descriptors without
  links or mount crossings and excludes case variants of private Jig state.
  `input-capture.ts` returns live immutable-byte capabilities, not serializable
  descriptor authority. Retained attachments, command inputs and invocation
  projections keep these capabilities through launch and close them afterward.
  Directory ancestry may use only the closed `.`/`..` operation; observed
  filesystem paths never authorize reopening. These adapters do not by themselves
  qualify native execution or output delivery.
- `captured-bytes.ts` binds anonymous byte capabilities to a closed input or
  output purpose and its separate byte limit. `input-capture.ts` owns the
  invocation-only interface; output handles cannot substitute for input authority.
  `macos-captured-bytes.ts` owns private, capability-backed macOS byte captures.
  Mint a handle only after unlinking the only pathname and closing the only
  writable descriptor. Allocate its directory outside every payload file grant;
  same-UID permissions alone are insufficient. Revalidation requires the original
  live capability and exact bytes; serialized metadata cannot mint authority.
  Transfer descriptors only through an authenticated trusted handoff. This
  primitive does not by itself qualify or enable an installed macOS host.
- `captured-output.ts` snapshots an already-fenced output directory into one
  anonymous immutable backing under the 16 MiB aggregate output bound. Preserve
  directory evidence, including empty directories, for native-session validation.
  Keep capture/profile failures distinct from execution and cleanup evidence.
  The snapshot may outlive a detached native volume; its descriptors and bytes
  remain command-owned and cannot be recreated from serialized metadata.
- `execution-output.ts` owns the closed Linux directory/native snapshot lifetime
  used by Run files and native-session collection. `macos-guardian-output.ts`
  captures only after fencing, releases an available collector, and waits for
  complete storage cleanup before exposing bytes. Missing collectors need no
  release. Content-profile rejection remains a delivery or optional-history
  outcome; unexpected I/O and cleanup failure retain their separate consequences.
  Closing an unavailable snapshot cannot manufacture a storage-cleanup failure.
- `file-delivery.ts` accepts local held input roots and bounded output snapshots
  or Linux anonymous directory descriptors. Remote descriptor acquisition belongs
  to the authenticated command transport, never a decoded pathname in publication.
  Staging writes and bounded cleanup use held directories on both platforms.
  Recheck the selected parent and exact staging identity before exclusive
  publication; a moved parent cannot redirect writes or cleanup. Invalid final
  files retain the known execution terminal and never authorize replay.
- `macos-file-command.ts` supplies private filesystem sockets for the independent
  command owner. Bind the control connection to its directly spawned coordinator
  and bind descriptor transfers to that connection's kernel PID version; the
  coordinator authenticates the parent's expected kernel identity too. Mac
  messages carry counts and inert manifests, never PID/FD claims as authority.
  Keep command cancellation, settlement grace and final escalation unchanged.
  Remove only exact private endpoints after the coordinator and publication settle.
  Reconstruct transferred output into a fresh immutable backing only after
  authenticating the live received bundle and validating its complete bounded
  manifest, anonymous-file identity, offsets and hashes. Include empty-directory
  evidence. Copied or closed bundle objects cannot supply descriptor authority.
- `macos-descriptor-files.ts` supplies qualified Darwin descriptor-relative
  file operations, raw directory enumeration and anonymous streaming backings.
  Do not substitute F_GETPATH followed by a pathname reopen for a held
  descriptor. The pinned Bun FileHandle adoption seam and SDK stat/dirent layouts
  require native qualification. Use matching INODE64 entrypoints, independent
  enumeration offsets, and O_NOFOLLOW_ANY without the conflicting O_NOFOLLOW.
  Anonymous readers remain private until their only writer has closed. F_GETPATH
  may observe a cache directory's current location for project exclusion; file
  access must still use the held descriptor, never reopen the observed path.
- `macos-process-controls.ts` owns the qualified Darwin process ABI: acquire
  only the guardian's initially exclusive resource coalition, observe kernel
  accounting, and signal matching PID versions. Sampled footprint and process
  discovery are not hard quotas; incomplete samples cannot prove a limit or
  cleanup. Only the kernel's remaining guardian count establishes emptiness.
  Unix control peer UID, PID and PID version come from `LOCAL_PEERTOKEN`, never
  claimed message fields; unavailable native socket identity fails closed.
- `macos-descriptor-handoff.ts` passes at most 64 read-only file/directory
  descriptors between kernel-authenticated trusted peers. Keep the socket owner
  outside payload grants, bound waits and framing, set close-on-exec immediately,
  and close every received right on refusal. Receive storage must fit a complete
  qualified kernel control mbuf even when rejecting an oversized protocol bundle;
  Darwin externalizes rights before copying ancillary bytes. A receipt proves
  transfer from that peer, not immutable capture, exact file identity or writer
  fencing. Those remain the owning protocol's obligations. Sender originals stay
  held through transfer; the received bundle owns its duplicates until closed.
- `macos-volume.ts` owns fixed, case-sensitive native filesystem images for
  bounded writable projections. Authenticate the allocation and backing inode
  before attachment; keep control files outside payload grants. Use in-kernel
  images, fixed system tools and finite command/output bounds. Mount evidence
  comes from the held directory's qualified `fstatfs` ABI. After complete tool
  and payload fencing and collector closure, derive detach authority from the
  live exact image mapping, never a saved disk number. Recheck the allocation,
  detach, then remove only its original empty mount directory and backing file.
  Retain authenticated journals until the enclosing owner is released. Storage
  ownership alone does not establish process fencing or installed Mac support.
- `macos-guardian-storage.ts` records bounded volume intent before job creation
  and attaches only after admission inside the guardian. Work, temporary and
  output roots share that fixed capacity; their parent stays host-owned. After
  payload fencing, an authenticated descriptor handoff permits at most 20 seconds
  of collection. Close the borrowed collector and release it before awaiting
  full completion. Fencing alone is not storage-cleanup evidence; final publication
  also requires successful completion. Cancellation, expiry and connection loss
  terminate collection and retain cleanup responsibility.
  Fresh storage recovery runs fixed image tools in a separate finite guardian,
  with a derived token and authenticated journal in the owner's `recovery` slot.
  Fence the preceding attempt, remove its exact job and sockets, then reset only
  the slot's known private records before reuse. Never erase a live attempt's
  journal or recursively delete a recovery path. Recovery tool admission has a
  separate 30-second deadline; uncertain cleanup preserves the allocation.
  After authentic guardian completion or recovery proves fencing and storage
  cleanup, retire the volume and guardian journals through their authenticated
  fixed entry sets. Journal release is separate from recovery: detach/backing or
  job uncertainty must retain evidence. Remove each exact guardian directory only
  after its main and recovery jobs are absent; never replace this with recursive
  deletion.
- `macos-input-projection.ts` validates the admitted input manifest and copies
  authenticated anonymous readers through the held volume descriptor before
  payload creation. Recheck original capture capabilities before admission,
  kernel-authenticate both transfer peers, and verify byte counts and hashes
  again in the guardian. Keep immutable inputs separate from writable roots;
  close every writer and transferred descriptor before native execution. Root
  launch plans grant read-only access to the bounded `data/inputs` projection
  when captured inputs exist; this tree never joins writable payload grants. Input
  names, aggregate bytes, directory entries and file count retain common bounds.
  Recovery receives only its own fixed configuration, never stale input handles
  or other payload launch fields from the failed attempt.
- `macos-owner-state.ts` writes the guardian's authenticated boot, coalition and
  PID-version journal before descendants exist. Its per-allocation token stays
  in protected coordinator state, never arguments, payloads or the journal.
  Recovery accepts only a capability minted from the bounded private journal;
  reject aliases, tampering and a still-live guardian. Same-boot coalition recovery
  rejects wrong boots. Authenticated prior-boot guardian recovery never observes
  or signals stale PIDs or coalitions: kernel reboot establishes task death;
  exact job/socket retirement and fresh storage cleanup remain required. A fresh
  process fences that exact coalition and confirms zero remaining tasks or the
  kernel's reaped-coalition response. Keep evidence when settlement is uncertain.
  Authenticate the temporary socket directory's device/inode separately; after
  fencing, remove only its exact socket names and empty directory. Never perform
  recursive deletion using a decoded recovery path.
- `macos-owner-lock.ts` holds an exclusive, nonblocking kernel file lock through
  native admission and settlement, or through recovery. Bind its original inode
  into durable state and revalidate the held directory and named lock; process
  death releases the lock but does not prove payload fencing. A competing live
  coordinator must remain a refusal, never permission to cancel its ownership.
  `macos-backend-state.ts` authenticates bounded, atomically committed allocation,
  sealing, admission, cancellation and final-receipt records. Interrupted staging
  never authorizes dispatch; retain the last authenticated commit. Reopening a
  cancelled or finished allocation cannot admit work. Planning creates and binds
  the exact allocation, control directory and lock inodes; opening state must never
  recreate a missing allocation, because removal permanently revokes every stale
  copy of its capability. Cancellation and final receipts authorize release only
  for the same allocation. Rename a releasable allocation out of its executable
  name while still holding the lock, authenticate its release marker, and remove
  only the closed known entry set. Preserve unexpected or partially cleaned state;
  block reuse of its owner name until exact release completes. The backend must validate
  sealed identities and cleanup receipts independently; ledger JSON alone is
  neither execution nor fencing authority.
- `macos-native-backend.ts` binds the qualified Darwin mechanism, immutable path
  identities, bounded native storage and live input capabilities into one sealed
  owner. Keep its coordinator lock through guardian admission, complete cleanup
  and the authenticated final receipt. Durable active state precedes the guardian's
  payload gate. Recovery must exclude a live coordinator, revalidate the cleanup
  runtime before launching recovery tools, handle both pre-admission and active
  coordinator loss, and retire guardian journals before recording completion.
  Report supervised sampling and possible resource overshoot explicitly; never
  project Linux cgroup or hard-quota claims. Candidate assembly selects this
  backend on the qualified Intel Mac; public support remains unpromoted until
  complete installed-consumer and reboot-recovery qualification.
- `execution-backend.ts` is the closed private Linux/macOS selection boundary.
  Persist each backend's discriminated owner and receipt records without flattening
  their evidence. Dispatch sealing, admission, recovery, cancellation and exact
  release only when the backend, launch plan and owner allocation agree. Logical
  recipe identity remains separate from the backend's physical launch paths;
  this is not a public backend or extension interface. Shared owner journals live
  under `.jig/private-root-owners`; prerelease hosts must not recreate the former
  Linux-named directory as a compatibility path.
- `macos-sandbox-profile.ts` formats only sealed host-owned file projections.
  Reject overlap between host control, immutable inputs and writable trees;
  keep the narrow sysctl/process-information rules. Only explicit network
  authority enables resolver access and the DNS Mach service. Formatting paths
  does not validate their live filesystem identity or authorize execution.
- `macos-scope-execution.ts` owns guardian-local admission and supervised
  resources after durable ownership exists. Keep the native execution gate
  closed until explicit admission; account for exited-task CPU and repeatedly
  fence the complete coalition before reporting settlement. Sampled memory,
  task limits and CPU throttling can overshoot; record sampling evidence and
  fail closed on sustained accounting uncertainty. Native exit status and
  kernel emptiness are independent requirements, including after crashes.
- `macos-native-supervisor.ts` and `macos-guardian-client.ts` own finite,
  unprivileged user-domain jobs. Keep control, stdin, stdout and stderr separate;
  kernel UID/PID/version bind every connection to its peer. Journal before
  admission, apply the native profile before continuation, and retain cleanup
  ownership through cancellation, coordinator loss and blocked output. Bound
  aggregate output before forwarding it. Recovery removes the authenticated
  job and socket allocation only after kernel fencing. `macos-control-channel.ts`
  bounds private frames and queued messages; none of these modules is a public
  backend extension point or an installed-support claim.
- `macos-sandbox-profile.ts` grants read-only system libraries and Unicode data
  under `/usr/share/icu` for JavaScriptCore's lazy locale operations. Writable
  projections cannot overlap these runtime roots. Host control remains excluded.
- [`../../support/macos-exec.c`](../../support/macos-exec.c) is the native pre-exec boundary. Clear inherited Mach
  rights and descriptors, apply the selected profile, report private readiness,
  and wait for admission before execution. Close all child control handoffs
  before exec; the trusted parent reports actual waitpid evidence separately
  from payload output. It does not own admission storage, resource supervision,
  recovery, or installation authority. These private components do not enable
  the installed macOS host independently.
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
  Slot/channel creation references resolve the invoking package's declared
  dependency agreement, never provider files; resolution creates no call or
  additional rights and shares the same cache as direct package-local paths.
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
  Deadline failures that lack a proved result identify the static effect type,
  observed phase, and effective limiting budget without exposing worker errors,
  asserting remote non-delivery, or changing uncertainty and cleanup semantics.
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
  Optional target descriptions come from verified retained package metadata,
  not visible source. Completion omits description capture and environment probes;
  the interactive chooser requests descriptions without acquiring authority.
  Environment inspection shares Run's recipe identity calculation but returns
  inert comparison evidence, never an authenticated executable recipe. Compare
  current support without cgroup acquisition or namespace execution; Run retains
  full launch revalidation. Include selected child identities, isolate unrelated
  targets, and report failed comparisons as unchecked without private causes.
- One resolved slot table pins exact Flow targets or qualified native invocations.
  `project-feature-qualification.ts` qualifies the selected graph from captured
  support/requirement metadata, without preparing execution or choosing alternatives.
  Feature-refusal evidence pins the caller and selected provider requests, including
  their retained package bytes; live source edits cannot alter that evidence.
  Admission independently checks each feature-refusal disposition and its evidence;
  unrelated targets remain usable. Empty recipe sets use inert host support identity.
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
  execute. Never execute mutable project source. Installed-support evidence
  follows the operator's verification policy below; execution authority and
  lifecycle observations remain fresh.
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
  The worker derives scratch paths from its trusted launch working directory,
  never rewritten worker or consumer source. Select the native lock version for
  the pinned runtime (Linux Bun 1.3.3 or candidate Mac Bun 1.4.2), retaining exact
  source/provenance checks without translating locks. Missing-lock resolution
  uses `--omit=dev` so production-only installation does not suppress publication
  of the new lock; the subsequent install stays frozen and script-disabled.
- Workspace capture supports root applications and declared ancestor members,
  reading root metadata and selected dependency source, never installed links.
  Discover an ancestor workspace for exact versions as well as `workspace:`
  declarations; matching local members use Bun's normal substitution, while
  exact dependencies outside a declared workspace remain standalone. Recheck
  metadata, retain exact regular files, and recapture on review even when the
  Flow is unchanged. Preserve the pinned hoisted install's workspace-relative
  paths and dependency scopes. Retain only
  exact installer aliases to selected member roots. Bun preparation owns member
  and dependency semantics; admission carries bytes and layout as one execution
  artifact. Recipes derive the launch command. Materialization receives only
  regular bytes and exact runtime-independent aliases; verification and cleanup
  handle recorded aliases without following them. Package/0 stays
  regular-file-only. Runs receive no live workspace authority. Bun owns
  installation, not a parallel Jig resolver.
  A Bun lock may record `workspace:*` when an exact manifest version selects a
  same-name local member at that exact version. Treat that as fresh only when
  the validated lock resolution names the captured member and its version equals
  the exact request; ranges and mismatches remain stale.
  Discover declared ancestor workspaces for exact public-version dependencies
  as well as explicit workspace requests. An ordinary registry dependency with
  no enclosing workspace remains standalone; explicit workspace requests still
  require declared membership.
  Reuse workspace preparation only from this Jig project's active admission:
  match freshly captured complete workspace inputs to the artifact's retained
  preparation fingerprint and reproduce its recipe/observation. Never share
  preparation between Jig projects under one workspace. Recapture source on
  every review; source, manifest, lock or membership changes invalidate reuse.
  Missing evidence requires preparation; missing/corrupt admitted bytes fail
  closed. Reuse performs no network activity and does not retain a network grant.
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
  The private native launcher passes subscription bearer/account state through
  a one-use in-memory bootstrap to the pinned adapter. Its app-server login uses
  `chatgptAuthTokens` and ephemeral credential storage; never write `auth.json`
  inside the execution volume. Qualify this unstable native operation against
  the selected client. Offline synthetic tokens prove the login handshake only;
  they do not qualify online subscription routing or model execution.
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
  library files at installation paths, identify them under the selected
  verification policy, and revalidate before launch. Identify each native file
  before reading its metadata; inspection remains provisional until provider
  construction checks that interval under the same policy.
  Every native factory must verify the complete inspection against its authentic
  provider before returning it. Do not add an intermediate full-file hash pass
  or claim metadata reuse establishes fresh byte evidence. This comparison never
  replaces launch-time filesystem eligibility and installation verification.
  Reject unsupported or project-selected dependencies; never mount a
  whole installation/store or import ambient loader variables. Each native
  launcher removes Bun's private loader override before starting its client.
- `macos-agent-runtime.ts` supplies the candidate native Mac installation
  inspector: bounded baseline x86-64 Mach-O and universal slices, including the
  SDK's LIB64 library-width flag but no additional ISA subtypes, exact third-party
  libraries, loader/executable-relative paths and inherited run paths. Consult
  the active OS dyld cache for system libraries; never fabricate file identities
  for cache-only images or load selected libraries into the coordinator. Reject
  embedded loader variables, ambiguous identities, unsupported commands and
  project routes. Provider construction must compare the inspection interval,
  and launch must revalidate files and the qualified OS mechanism. This private
  inspector does not independently enable installed Mac providers.
  Native writable projections supply their own temporary directory. Claude's
  native launcher also sets `CLAUDE_CODE_TMPDIR` to that bounded private root;
  neither general nor client-specific temporary files may fall back to host `/tmp`.
- Keep known channel-declaration, Agent-configuration and dependency-preparation failures actionable
  through closed diagnostic codes and project-relative locations, never raw
  provider or worker messages. Missing Agent support affects only targets
  which require it.
  Configuration evaluator failures preserve closed support, launch, envelope,
  settlement or protocol codes and the captured declaration location. Never
  project raw launcher exceptions or infer a timeout cause from unavailability.
  Manifest policy errors retain closed causes and JSON pointers, never rejected
  source values or invalid names. Workspace manifest locations are relative to
  the project (including bounded ancestor paths), not the selected Flow; do not
  rebase them twice. These display locations grant no file access.
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
  final admission still verifies installation support under operator policy
  and freshly revalidates invocation authority.
- Review projects only explicit public policy and allowlisted non-secret Agent
  selections. Environment-only target changes name the execution environment,
  distinguish unchanged source/dependencies/policy, and explain the new approval.
  Combined fingerprints cannot identify individual historical components; disclose
  that limit instead of inventing a component diff or displaying opaque identities.
  A change-first display omits empty categories and uses shared YAML field
  rendering, with complete signed additions/removals and contextual diffs.
  `--details` uses the same sectioned diff renderer with unchanged records and
  fields included as context. Never serialize change bookkeeping or wrap policy
  in current/proposed snapshots for human review.
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
  artifacts. Before package code starts, the trusted inner launcher rechecks
  every projected file's byte count and digest against the admitted identity.
  Child and Agent contexts receive no attachment or destination authority.
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
  Cancellation allows at most 60 seconds of cooperative trusted-coordinator
  settlement; absolute command expiry shortens that wait with a 250 ms kill
  grace. Never extend either bound on later signals or change payload deadlines.
  Confirmed interrupted settlement may publish its terminal and accepted
  checkpoint, not final Flow files; unconfirmed cleanup cannot authorize delivery.
  Reap the exact trusted child after escalation; independent cgroup fencing
  still owns payload cleanup.
- Exact child slots may select a Flow or a bounded Binding with its own admitted
  settings, ordinary invocation routes and reviewed command, HTTP or finite ACP
  grants. An effect belongs to that child
  context, not the root's operation namespace; fence and drain it before
  releasing the child owner. Every child Flow uses its own admitted slot
  maps; private nested Flow identifiers include their parent identity.
- Roots admit two Flow branches or one exclusive effect. Reserve each whole
  branch's longest admitted Flow path plus one effect against the fixed aggregate
  root budget before dispatch; retain its
  reservation until confirmed fencing and cleanup. Kernel envelope limits and
  the recipe-bound reservation policy must agree. Each child admits one Flow or
  effect. Derive maximum branch depth from the fixed aggregate envelope, reserving
  the root and an effect too; never add resources merely to allow deeper calls.
  The envelope accommodates two two-level branches or one five-level branch
  with their effects. There is no
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
- Fail closed on unsupported hosts, detected identity changes, missing enforcement,
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
  support against reviewed identity under installation verification policy;
  it never repeats PATH discovery.
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
- `installation-verification.ts` owns command-scoped operator policy and the
  bounded installation cache. The installed CLI resolves `--verification` over
  `JIG_VERIFICATION`, falling back to cached, before opening the command scope.
  Original arguments preserve the selection through delegation and recovery. Strict
  freshly hashes at every boundary, and fast accepts cached path identities
  without freshness checks. Cached compares inode/device, ownership/mode/link
  count, size and nanosecond mtime/ctime on every lookup. Hash misses and check
  metadata before/after; never reuse atime as freshness evidence. Private calls
  outside an explicit command scope remain strict.
  Register the actual project before opening support. Cache storage must be
  owner-private and outside project routes; invalid or unsafe cache falls back
  to hashing. Inspection never writes it. Snapshot policy before project loading,
  isolate concurrent contexts, and preserve it through launch and recovery.
  Cache no credentials, packages, attachments, approval or containment authority.
  Mode alone must not alter recipe identity for unchanged installations.

- `raw-directory.ts` preserves byte names for Linux descriptor enumeration.
  Pinned Bun can return byte arrays instead of Dirent objects for buffer
  encoding; acquire missing type metadata with no-follow stat of the raw leaf
  beneath the held directory. Consumers retain strict UTF-8 validation and
  descriptor-relative admission; never substitute lossy decoded names.

## Verification

- Run the directly corresponding `packages/jig/test/` files, then
  `bun test packages/jig`.
- On the qualified Intel macOS kernel, `JIG_MACOS_PROCESS_TEST=1` enables
  `macos-process-controls.test.ts` and `macos-execution.test.ts` with the
  candidate native runtime outside an enclosing sandbox. They use finite
  user-domain launchd jobs, exact cleanup and an unrelated-process sentinel;
  the execution test compiles its native fixture with the local Apple toolchain.
  `macos-captured-bytes.test.ts` covers anonymous read-only capture on macOS.
  `macos-guardian.test.ts` qualifies the complete private guardian connection,
  gated native streams, cancellation, blocked output, and both coordinator and
  guardian loss. Portable framing cases live in `macos-control-channel.test.ts`.
  These checks are primitive evidence, not installed-host conformance.
  `macos-descriptor-files.test.ts` compiles SDK layout assertions and checks
  identity across directory replacement, raw enumeration and exclusive
  publication. `package-capture.test.ts` runs shared source-capture cases on the
  qualified Mac when opted in; Linux retains filesystem-specific byte-name and
  case-sensitive collision fixtures.
  `activation-admission-store.test.ts` exercises real SQLite durability and
  recovery on both hosts. `package-materialization.test.ts` includes fresh-process
  reacquisition, interrupted cleanup and the Darwin chmod-before-rename window.
  `macos-volume.test.ts` covers bounded shared capacity with sandboxed native
  writers, backing-file denial, journal and inode forgery refusal, case-sensitive
  names, fresh-process recovery, and repeated exact cleanup without administrator
  access. It preserves failed allocations when recovery cannot be confirmed.
  `macos-preparation.test.ts` runs the unchanged preparer and a retained ordinary
  TypeScript dependency consumer in native guardians with bounded storage. It
  checks ignored install scripts, production dependency selection, source-write
  and private-file denial, and complete cleanup. Project workspace preparation
  tests use the worker's real working-directory interface without source rewriting.
  `macos-agent-runtime.test.ts` checks malformed and universal Mach-O metadata,
  project-excluded transitive lookup, cache membership and changed support bytes.
  Its opted-in SDK-linked fixture proves that inspection does not invoke library
  constructors. ELF metadata fixtures retain their separate Linux-format coverage.
  `macos-descriptor-handoff.test.ts` uses an independent SDK-native sender to
  assert socket/message layouts, split and malformed frames, rights cleanup and
  rejection of writable files. It also verifies anonymous capture, renamed
  directory identity, kernel peer versions, cancellation and endpoint collisions.
  `file-input.test.ts` and `bound-attachments.test.ts` exercise shared capture and
  retained resources on Linux and qualified Mac. Mac cases reject private-state
  case aliases and copied/closed capture handles; the volume test also rejects
  selected descendants crossing mounts. Linux filesystem and Nix loader cases
  remain Linux-only and require their own runner.
  `macos-guardian-storage.test.ts` qualifies journal-before-tool admission,
  descriptor collection after detached-descendant fencing, collection lifetime,
  interrupted creation, coordinator/guardian loss and a failed recovery guardian.
  Every cleanup attempt keeps its exact journals until fencing is confirmed.
  `macos-guardian-input.test.ts` runs ordinary TypeScript relative imports and
  binary/empty reads from the immutable projection, denies source writes and
  private data, refuses changed/closed captures before execution, and recovers
  after source handles have already closed.
  `captured-output.test.ts` covers source removal, binary/empty bytes, immutable
  readers, purpose separation, aggregate bounds, invalid trees and cancellation.
  The native input/guardian test also verifies an output snapshot after its
  original filesystem image and collector have been released.
  Portable `file-delivery.test.ts` cases cover post-source-removal binary output,
  forged/closed snapshots, cancelled retention, collisions, parent replacement
  and complete staging cleanup. Independent command transport cases additionally
  require their platform's qualified process ownership and descriptor transfer.
  `execution-output.test.ts` verifies fencing/release/cleanup order, capture
  refusal, missing collectors and cleanup failure. Native guardian input evidence
  exercises that same retention path after image removal. Session collectors
  validate captured empty directories too; controller faults distinguish expected
  snapshot-profile refusal from unexpected snapshot I/O failure.
  The complete file-delivery suite also runs on qualified Mac: it covers the
  independent process, authenticated parent rejection, renamed input roots,
  immutable output transfer, cooperative interruption, forced escalation and
  coordinator loss during staging. Stopped fixtures explicitly ignore SIGTERM
  so both kernels exercise escalation; use exact owned fixture PIDs only.
  `macos-owner-lock.test.ts` checks independent-process exclusion, release on
  coordinator death and lock replacement. `macos-backend-state.test.ts` checks
  fresh-process recovery of committed state, cancelled admission, exact final
  receipt retention, interrupted writes, atomic release recovery and authentication
  failures. Synthetic ledger receipts do not qualify backend cleanup or installed
  execution. `macos-native-backend.test.ts` qualifies sealing, immutable-path
  binding, prepared and active admission, bounded output after storage removal,
  durable final receipts, unused-owner recovery, prepared/active coordinator-loss
  recovery and exact owner release. It is backend integration evidence, not
  installed-host conformance.
  The recovery fixture checks authenticated boot separation and keeps coalition
  fencing restricted to the current boot. Simulating a signed prior-boot journal
  does not qualify actual reboot, disk-image disappearance or post-boot reacquisition;
  those require a controlled native reboot before public support promotion.
- Containment, delegation, preparation, process-lifecycle, or Agent authority
  changes require the provisioned hostile-host suite and residue check.
- Native installation regressions cover discovery, environment snapshots,
  missing/project-selected support, byte replacement, and credential expiry.
  `JIG_NATIVE_AGENT_STARTUP=1` with absolute `JIG_CODEX_STARTUP_PATH`,
  `JIG_CLAUDE_STARTUP_PATH`, and `JIG_PI_STARTUP_PATH` enables
  `test/native-agent-startup.test.ts` after building. It tests genuine native
  ACP startup and API sessions with networking disabled and dummy credentials;
  Codex subscription startup separately checks the in-memory login handshake.
  missing selections fail instead of silently skipping. This is startup evidence,
  separate from live model calls and the hostile-host gate.
- Run real-host suites sequentially within one delegated cgroup. Their strict
  acquisition and residue checks intentionally reject other concurrent Runs;
  the ordinary suite also includes host tests when delegation is present.

- Command and HTTP ownership observation waits cover the host root budget:
  Mac uses 60 seconds for admission observations and 75 seconds for HTTP
  settlement, including cleanup. Linux retains its 30/40-second waits. These
  test windows never expand workload enforcement limits.
- Mac host conformance also enables the shared workspace preparation reuse and
  public CLI workspace dependency cases, plus installed command, HTTP Agent,
  Markdown, continuation and interruption checks. Linux-only preparation
  cgroup recovery cases retain their Linux proof-host opt-in.

## Child DOX Index

- None.
