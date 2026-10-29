# Native Mac enforcement and recovery

Apply these rules when the parent reading map selects this domain.
Read the [shared host contracts](AGENTS.md) before changing its implementation.

## Find a module

These links locate module rules. All selected domain requirements still apply.

| Work | Module rules |
| --- | --- |
| Capture and transfer immutable files | [Capture](#capture): descriptor operations, handoff, input projection, and command files |
| Launch, supervise, and fence payloads | [Execution](#execution): process ABI, backend, profiles, guardian control, and pre-exec boundary |
| Allocate and retire bounded writable roots | [Storage](#storage): volumes and guardian storage |
| Project controlled evaluation workspaces | [Evaluation workspace](#macos-evaluation-workspace) |
| Authenticate owners and recover allocations | [Recovery](#recovery): owner state and exclusive locks |
| Observe private host tests | [Diagnostics](#diagnostics): opt-in bounded observation |
| Inspect native Agent installations | [Agent runtime](#macos-agent-runtime) |
| Rebuild native assets or verify a change | [Verification](#verification) |

## Ownership

### Capture

#### macos-file-command

- `macos-file-command.ts` supplies private filesystem sockets for the
  independent command owner. Bind the control connection to its directly spawned
  coordinator and bind descriptor transfers to that connection's kernel PID
  version. The coordinator authenticates the parent's expected kernel identity
  too. Mac messages carry counts and inert manifests, never PID/FD claims as
  authority. Keep command cancellation, settlement grace and final escalation
  unchanged. Remove only exact private endpoints after the coordinator and
  publication settle.

  Memoize native endpoint close. Consume receiver references before cleanup.
  Racing paths join its actual completion and retain its failure. Before
  reconstructing transferred output, authenticate the live received bundle.
  Validate its complete bounded manifest, anonymous-file identity, offsets and
  hashes. Only then reconstruct transferred output into a fresh immutable
  backing.

  Include empty-directory evidence.

  Copied or closed bundle objects cannot supply descriptor authority.

#### macos-descriptor-files

- `macos-descriptor-files.ts` supplies qualified Darwin descriptor-relative file
  operations, raw directory enumeration and anonymous streaming backings.
  Capture syscall errno inside the packaged native bridge. Never read or clear
  thread-local errno in a later FFI call. Integer errors return negative errno.
  Directory pointers use explicit error buffers and native readdir resets.
  Bundled Markdown workers resolve the verified descriptor bridge beside their
  installed `libexec` entrypoint.

  Native Markdown launch grants read access to that exact bridge file, never its
  containing tree. Copied installation fixtures must preserve the complete
  support closure. Markdown's contained recapture allocates its anonymous
  backing inside the existing bounded work directory. This guest-only path
  grants no host capture authority. Trusted captures retain the separate host
  allocation outside payload file grants. Do not substitute F_GETPATH followed
  by a pathname reopen for a held descriptor.

  The pinned Bun FileHandle adoption seam and SDK stat/dirent layouts require
  native qualification. Use matching INODE64 entrypoints, independent
  enumeration offsets, and O_NOFOLLOW_ANY without the conflicting O_NOFOLLOW.
  Anonymous readers remain private until their only writer has closed. F_GETPATH
  may observe a cache directory's current location for project exclusion. File
  access must still use the held descriptor, never reopen the observed path.

#### macos-descriptor-handoff

- `macos-descriptor-handoff.ts` passes at most 64 read-only file/directory
  descriptors between kernel-authenticated trusted peers. Keep the socket owner
  outside payload grants. Bound waits and framing. Set close-on-exec
  immediately. On refusal, close every received right. Socket and received-file
  `fcntl` operations use the fixed-signature bridge too.

  Verify nonblocking and close-on-exec flags before accepting, so a flag failure
  cannot block the coordinator’s event loop. Receive storage must fit a complete
  qualified kernel control mbuf even when rejecting an oversized protocol
  bundle. Darwin externalizes rights before copying ancillary bytes. A receipt
  proves transfer from that peer, not immutable capture, exact file identity or
  writer fencing. Those remain the owning protocol's obligations. Sender
  originals stay held through transfer.

  The received bundle owns its duplicates until closed.

#### macos-input-projection

- `macos-input-projection.ts` validates the admitted input manifest and copies
  authenticated anonymous readers through the held volume descriptor before
  payload creation. Recheck original capture capabilities before admission,
  kernel-authenticate both transfer peers, and verify byte counts and hashes
  again in the guardian. Keep immutable inputs separate from writable roots.
  Close every writer and transferred descriptor before native execution. Root
  launch plans grant read-only access to the bounded `data/inputs` projection
  for declared input roots, including empty attachments. This tree never joins
  writable payload grants.

  Retain those exact root names in the sealed plan and guardian configuration.
  Create them before execution. Reject files outside them. Apply file-path depth
  and byte limits relative to each root. The separately bounded root names do
  not consume the captured-entry budget. Input names, aggregate bytes, directory
  entries and file count retain common bounds.

  Recovery receives only its own fixed configuration, never stale input handles
  or other payload launch fields from the failed attempt.

### Execution

#### macos-process-controls

- `macos-process-controls.ts` owns the qualified Darwin process ABI: acquire
  only the guardian's initially exclusive resource coalition, observe kernel
  accounting, and signal matching PID versions. Sampled footprint and process
  discovery are not hard quotas. Incomplete samples cannot prove a limit or
  cleanup. Only the kernel's remaining guardian count establishes emptiness. A
  CPU ledger regression across a kernel read marks the sample incomplete. Exec
  transitions can temporarily omit a task's ledger.

  Do not clamp or invent a monotonic reading. Unix control peer UID, PID and PID
  version come from `LOCAL_PEERTOKEN`, never claimed message fields. Unavailable
  native socket identity fails closed.

#### macos-native-backend

- `macos-native-backend.ts` binds the qualified Darwin mechanism, immutable path
  identities, bounded native storage and live input capabilities into one sealed
  owner. Keep its coordinator lock continuously from sealing through guardian
  admission, complete cleanup and the authenticated final receipt. Durable
  active state precedes the guardian's payload gate. Recovery must exclude a
  live coordinator. It must revalidate the cleanup runtime before launching
  recovery tools. It must handle both pre-admission and active coordinator loss.

  It must retire guardian journals before recording completion. Report
  supervised sampling and possible resource overshoot explicitly. Never project
  Linux cgroup or hard-quota claims. Installed support selects this backend only
  on exact qualified native Mac kernels.

#### macos-sandbox-profile

- `macos-sandbox-profile.ts` formats only sealed host-owned file projections.
  Reject overlap between host control, immutable inputs and writable trees.
  The sole exception is the closed evaluation workspace at `data/evaluation`. Keep
  the narrow sysctl/process-information rules. Only explicit network authority
  enables resolver access and the DNS Mach service. Formatting paths does not
  validate their live filesystem identity or authorize execution.

#### macos-scope-execution

- `macos-scope-execution.ts` owns guardian-local admission and supervised
  resources after durable ownership exists. Keep the native execution gate
  closed until explicit admission. Account for exited-task CPU and repeatedly
  fence the complete coalition before reporting settlement. Sampled memory, task
  limits and CPU throttling can overshoot. Record sampling evidence and fail
  closed on sustained accounting uncertainty. Native exit status and kernel
  emptiness are independent requirements, including after crashes.

  Incomplete samples and CPU regressions share the existing 500 ms uncertainty
  bound. Preserve the CPU high-water/time baseline across regressions. The next
  nonregressing reading charges accumulated CPU and elapsed refill. Continue
  charging observable CPU during incomplete membership samples. Final settlement
  requires complete accounting at or above that baseline. Recovery may confirm
  cleanup without establishing a payload result.

  After admission, a payload's unread stdin may close with EPIPE without
  invalidating its native exit evidence. Other stream errors still fail closed.
  Neither EPIPE nor pipe closure substitutes for the status frame or fencing.

  Retain the original launcher spawn error when setup fails before readiness.
  Expose it to the guardian only after complete fencing and existing settlement checks.
  Missing handoffs await the actual spawn outcome within the existing cleanup budget.
  Earlier stop causes and unconfirmed settlement retain precedence.
  The guardian transports only its closed cause after storage cleanup.

#### macos-native-supervisor

- `macos-native-supervisor.ts` and `macos-guardian-client.ts` own finite,
  unprivileged user-domain jobs. Keep control, stdin, stdout and stderr
  separate. Kernel UID/PID/version bind every connection to its peer. Journal
  before admission, apply the native profile before continuation, and retain
  cleanup ownership through cancellation, coordinator loss and blocked output.
  Bound aggregate output before forwarding it. The ten-second admission wait
  ends at admission.

  Storage and input preparation then use the original operation deadline,
  without extending it. Native readiness and image-tool bounds remain separate.
  Recovery removes the authenticated job and socket allocation only after kernel
  fencing. `macos-control-channel.ts` bounds private frames and queued messages.
  None of these modules is a public backend extension point or an
  installed-support claim. If job retirement needs recovery, preserve a
  validated authenticated terminal.

  Expose it only after recovery confirms fencing and storage cleanup. Lost
  streams remain lost. A missing terminal remains unknown. Native receipts
  retain the known stop reason and record cleanup recovery independently.
  Persistent job-removal uncertainty still rejects completion and retains owner
  journals.

#### System library grants

- `macos-sandbox-profile.ts` grants read-only system libraries and Unicode data
  under `/usr/share/icu` for JavaScriptCore's lazy locale operations. Writable
  projections cannot overlap these runtime roots. Host control remains excluded.
  Only the verified Codex profile may select exact preference-service lookup and
  read-only daemon/current-UID notification-counter pages. This grants no
  preference reads, writes, other IPC or networking. Preserve the flag through
  intent lowering, sealing and guardian message validation.

  On Intel build 23E224 the pages are qualified as 16 KiB invalidation counters,
  including cross-domain change activity. Other OS profiles need independent
  qualification. `macos-codex-preferences.ts` runs the authenticated installed
  observer in a fresh bounded process during provider selection and each
  launch/restoration, outside resource/installation caches. Forced policy or
  unavailable observation refuses execution with a closed actionable cause. This
  is an observation boundary, not continuous MDM enforcement. Codex HOME
  relocates to private tmp.

  Reject Rosetta and arm64 in the universal observer, and retain its native
  self-deadline after coordinator loss. Inherited sandbox uncertainty also
  refuses observation. Missing observer support is an installation failure.

- [`../../support/macos-exec.c`](../../support/macos-exec.c) is the native
  pre-exec boundary. Clear inherited Mach rights and descriptors, apply the
  selected profile, report private readiness, and wait for admission before
  execution. Close all child control handoffs before exec. The trusted parent
  reports actual waitpid evidence separately from payload output. It does not
  own admission storage, resource supervision, recovery, or installation
  authority. These private components do not enable the installed macOS host
  independently.

### Storage

#### macos-evaluation-workspace

- `macos-evaluation-workspace.ts` copies verified retained merged source through held no-link descriptors.
  Bound the copy to 8448 regular files and 192 MiB.
  Reject links and candidate current outputs. Freeze inputs and prior outputs.

  Bind at most 256 canonical relative empty-directory paths from authentic candidate/prior snapshots.
  Restore them through held target descriptors before freezing.
  Reject current outputs, scratch, links, file collisions and excessive depth/entries.

- This metadata selects no new roots and preserves regular-file-only Package/0 semantics.
  The guardian creates fixed empty current output and scratch roots.
  Only generate's generated/reports, compile's dist, or test's reports plus scratch are writable.
  Evaluation uses isolated network and 512 MiB bounded storage.
  Fence the whole scope before copying root-prefixed generated/dist/reports into the existing 16 MiB capture owner.
  Cleanup still gates publication.

#### macos-volume

- `macos-volume.ts` owns fixed, case-sensitive native filesystem images for
  bounded writable projections. Authenticate the allocation and backing inode
  before attachment. Keep control files outside payload grants. Use in-kernel
  images, fixed system tools and finite command/output bounds. Mount evidence
  comes from the held directory's qualified `fstatfs` ABI. Derive detach
  authority only after complete tool and payload fencing and collector closure.

  Use the live exact image mapping. Never use a saved disk number or observed
  mount location. Interrupted attachment may finish at an automatic mount.
  Recovery still authenticates the exact backing inode and allocation before
  detaching it. Launch requires the requested mount. Recheck the allocation,
  detach, then remove only its original empty mount directory and backing file.

  An observed alternate mount path never grants deletion authority. Retain
  authenticated journals until the enclosing owner is released. Storage
  ownership alone does not establish process fencing or installed Mac support.
  Publish the backing-image journal by exclusive rename of complete, synced
  authenticated staging bytes before attachment. Guardian loss during staging
  must leave fenced recovery usable. Retire only its fixed regular, private,
  single-link bounded staging leaf after exact image and mount cleanup.

  Backing staging never grants attachment or recovery authority.

#### macos-guardian-storage

- `macos-guardian-storage.ts` records bounded volume intent before job creation
  and attaches only after admission inside the guardian. Work, temporary and
  output roots share that fixed capacity. Their parent stays host-owned.
  Storage configuration selects only mount, capacity and collection root.
  Child artifacts use immutable capture and held read delegation, never folder reservations or mutation controls.

  A worker without write grants or collection may use its immutable input tree as
  its read-only working directory. After payload fencing, an authenticated
  descriptor handoff permits at most 20 seconds of collection. Close the
  borrowed collector and release it before awaiting full completion.

  Fencing alone is not storage-cleanup evidence. Final publication also requires
  successful completion. Cancellation, expiry and connection loss terminate
  collection and retain cleanup responsibility. Before the first guardian
  journal, coordinator loss may leave only the empty fixed storage directory
  allocated before volume intent. After removing the exact job and confirming
  absence, recheck for a late first journal. Fence any earlier recovery-slot
  owner before empty retirement, so missing storage never skips its independent
  coalition proof.

  A recorded owner retains authenticated coalition and volume recovery. Only an
  empty private child with no first owner, retirement marker or staging can
  retire through held parent/child descriptors. Retirement requires mount,
  owner, mode and immediate named-inode checks. `rmdir` refuses a new entry. Any
  partial journal, image, staging or unknown entry retains ordinary recovery and
  its strict refusal. This grants no image/detach authority, recursive cleanup
  or data-directory ownership.

  The backend still owns its data allocation. Fresh storage recovery runs fixed
  image tools in a separate finite guardian, with a derived token and
  authenticated journal in the owner's `recovery` slot. After the fixed tools
  return, drain and fence any remaining recovery-coalition members within a
  five-second bound before reporting successful cleanup. Recheck cancellation
  after this drain. Expiry or cancellation during fencing refuses the recovery
  receipt and preserves journals for a fresh attempt. Fence the preceding
  attempt, remove its exact job and sockets, then reset only the slot's known
  private records before reuse.

  Never erase a live attempt's journal or recursively delete a recovery path.
  Recovery tool admission has a separate 30-second deadline. Uncertain cleanup
  preserves the allocation. Retire volume and guardian journals only after
  authentic guardian completion or recovery proves fencing and storage cleanup.
  Use their authenticated fixed entry sets. Volume retirement stages and
  persists an authenticated marker in the guardian directory before deleting its
  last control journal.

  Recovery and release can resume after either deletion, and remove the marker
  only after the exact control directory is gone. Journal release is separate
  from recovery: detach/backing or job uncertainty must retain evidence. Remove
  each exact guardian directory only after its main and recovery jobs are
  absent. Never replace this with recursive deletion.

### Recovery

#### macos-owner-state

- `macos-owner-state.ts` writes the guardian's authenticated boot, coalition and
  PID-version journal before descendants exist. Its per-allocation token stays
  in protected coordinator state, never arguments, payloads or the journal.
  Recovery accepts only a capability minted from the bounded private journal.
  Open owner/socket records nonblocking before regular-file validation. Reject
  aliases, tampering and a still-live guardian. Same-boot coalition recovery
  rejects wrong boots.

  Authenticated prior-boot guardian recovery never observes or signals stale
  PIDs or coalitions: kernel reboot establishes task death. Exact job/socket
  retirement and fresh storage cleanup remain required. A fresh process fences
  that exact coalition and confirms zero remaining tasks or the kernel's
  reaped-coalition response. Keep evidence when settlement is uncertain.
  Authenticate the temporary socket directory's device/inode separately. After
  fencing, remove only its exact socket names and empty directory.

  Never perform recursive deletion using a decoded recovery path.

#### macos-owner-lock

- `macos-owner-lock.ts` holds an exclusive, nonblocking kernel file lock through
  native admission and settlement, or through recovery. Bind its original inode
  into durable state and revalidate the held directory and named lock. Process
  death releases the lock but does not prove payload fencing. A competing live
  coordinator must remain a refusal, never permission to cancel its ownership.
  `macos-backend-state.ts` authenticates bounded, atomically committed
  allocation, sealing, admission, cancellation and final-receipt records.
  Interrupted staging never authorizes dispatch.

  Retain the last authenticated commit. Reopening a cancelled or finished
  allocation cannot admit work. Planning creates and binds the exact allocation,
  control directory and lock inodes. Opening state must never recreate a missing
  allocation, because removal permanently revokes every stale copy of its
  capability. Cancellation and final receipts authorize release only for the
  same allocation. Rename a releasable allocation out of its executable name
  while still holding the lock.

  First publish its complete, synced release marker by exclusive rename. Partial
  staging cannot authorize retirement. Under the same lock and authenticated
  proof, discard only the fixed regular, private, single-link bounded staging
  leaf. State and release records share one bounded nonblocking reader. Reject
  substituted pipes before they can stall the coordinator. Authenticate the
  release marker and remove only the closed known entry set.

  Preserve unexpected or partially cleaned state. Block reuse of its owner name
  until exact release completes. The backend must validate sealed identities and
  cleanup receipts independently. Ledger JSON alone is neither execution nor
  fencing authority.

### Diagnostics

#### macos-guardian-diagnostics

- `macos-guardian-diagnostics.ts` supplies opt-in, asynchronous-scope host-test
  evidence when the guardian client enters recovery. Record its phase, failing
  step and a closed cause before discarding the original error. Never emit raw
  errors, paths, tokens, payloads or received frames. Observer failures cannot
  affect settlement. The evidence grants no authority and changes no public
  terminal, receipt or recovery rule. Guardian terminal frames also carry a
  closed failure step and cause, or null on ordinary completion.

  Validate both against fixed names before reporting a pre-readiness error code
  through the existing root host-test observer. Never forward native exception
  messages or arbitrary error codes across this channel.

  The installed opt-in profile parses guardian codes against this same finite vocabulary.
  Code spelling alone cannot admit an unknown step, cause or private suffix.

  Scope preparation distinguishes fixed configuration, accounting, handoff,
  fencing and readiness
  causes. Readiness reports only its closed stop reason, without raw exit evidence.
  Exact storage-recovery refusal messages have fixed labels for directory,
  journal, backing, allocation
  and recovery-tool fencing boundaries. Live image mapping refusals distinguish
  fixed count, owner, sector size/count, encryption and entity-shape labels
  without exposing rejected metadata. The exact predicates and subsequent
  authenticated backing requirement stay mandatory. Only the enumerated
  filesystem errno and Node/DOM abort shapes become fixed categories.

  Unknown or unreadable fields stay OTHER. These labels diagnose refusal and
  never authorize recovery or imply its cause was established by a successful
  rerun. Project Command qualification logs these events. Portable tests cover
  redaction and scope isolation. The native guardian-loss test verifies
  reporting and recovery with a throwing observer. Agent lifecycle fault
  qualification scopes the same closed recovery observer to each case and names
  the fixed scenario before dispatch.

  Failed cases retain their project and installed fixture. Recursive fixture
  removal requires the completed result and residue assertions, never swallowed
  settlement failure.
  Verify storage and scope-preparation failures through real invalid inputs, resource pressure and process loss.
  Then confirm actual fencing and storage cleanup.

  Before payload readiness, the guardian's own operation timer records expiry
  only when expiry was the first stop cause. This rule applies to both payload
  setup and the recovery-only guardian. Abort-shaped errors alone remain ABORTED
  and never establish operation expiry.

  Transport the recorded closed cause after fenced cleanup. Cancellation, lost
  control and tool failure do not become deadlines. Unconfirmed cleanup still
  overrides the preparation diagnostic.
  Never rewrite guardian source or replace native owners to manufacture failures.

## Local Contracts

### macos-agent-runtime

- `macos-agent-runtime.ts` supplies the qualified native Mac installation
  inspector: bounded baseline x86-64 or ARM64 Mach-O and universal slices,
  including the SDK's LIB64 library-width flag. The exact SIP-protected
  `/usr/bin/sandbox-exec` additionally admits Apple's native arm64e slice on
  qualified Apple Silicon. Operator-selected Agent binaries still require
  baseline slices. Metadata opens nonblocking and verifies the opened file is
  regular before parsing. Inspect exact third-party libraries,
  loader/executable-relative paths and inherited run paths. Consult the active
  OS dyld cache for system libraries.

  Never fabricate file identities for cache-only images or load selected
  libraries into the coordinator. Reject embedded loader variables, ambiguous
  identities, unsupported commands and project routes. Provider construction
  must compare the inspection interval, and launch must revalidate files and the
  qualified OS mechanism. This private inspector does not independently enable
  installed Mac providers. Native writable projections supply their own
  temporary directory. Claude's native launcher also sets `CLAUDE_CODE_TMPDIR`
  to that bounded private root.

  Neither general nor client-specific temporary files may fall back to host
  `/tmp`.

## Verification

- Mac preparation lowers its closed mode to the existing work collector.
  Capture the authenticated fenced descriptor before releasing the guardian collector.
  Complete volume and owner cleanup before exposing the immutable package.
  Missing collection, nonzero exit, recovered execution or uncertain cleanup grants no package.
  Ordinary Flow snapshots and native stream ceilings remain unchanged.

### .. .. scripts native-support

- `../../scripts/native-support.mjs` regenerates and checks both descriptor
  bridge digest pins (`macos-descriptor-files.ts` and
  `installed-bun-support.ts`) together with the checked-in native assets.
  `../../support/AGENTS.md` owns the canonical rebuild and exact-toolchain byte
  comparison. Never refresh only one pin.

- Native Mac profiles select Intel Darwin 23.4.0 build 23E224, Intel/Apple Silicon Darwin 24.6.0 build 24G830, and Apple Silicon Darwin 24.6.0 build 24H232.
  Each new profile requires complete native and installed qualification before release.
  Hosted qualification binds every shard to its architecture's exact selected build.
  A shared Darwin version or prerequisite structure sizes never establish qualification.
  Select architecture-native Bun and Mach-O slices. Never treat Rosetta execution as Apple Silicon qualification.

- The SDK-compiled descriptor bridge selects Intel and Apple Silicon's native
  stat and directory ABIs. Coalition CPU ledger values are Mach ticks: convert
  with the kernel's `mach_timebase_info` ratio before comparing nanosecond
  limits or recording evidence. Per-process rusage units stay unchanged.

- `openat` and `fcntl` use the packaged fixed-signature native bridge rather
  than calling variadic libc through FFI. Verify its exact digest before dlopen
  and bind it into installed-support identity. No consumer compiler is required.

- On the qualified Intel macOS kernel, `JIG_MACOS_PROCESS_TEST=1` enables
  `macos-process-controls.test.ts` and `macos-execution.test.ts` with the
  candidate native runtime outside an enclosing sandbox. They use finite
  user-domain launchd jobs, exact cleanup and an unrelated-process sentinel. The
  execution test compiles its native fixture with the local Apple toolchain.
  `macos-captured-bytes.test.ts` covers anonymous read-only capture on macOS.

  `macos-guardian.test.ts` qualifies the complete private guardian connection,
  gated native streams, cancellation, blocked output, and both coordinator and
  guardian loss. CPU evidence comes from actual kernel accounting.
  Accounting regression and sustained uncertainty claims require actual native
  observations, never rewritten controls or invented readings.

  They retain real kernel ownership and authenticated cleanup. Portable framing
  cases live in `macos-control-channel.test.ts`. Buffered unread stdin must
  preserve the payload's actual nonzero exit and output after confirmed fencing.
  These checks are primitive evidence, not installed-host conformance.

  `macos-descriptor-files.test.ts` compiles SDK layout assertions and checks
  identity across directory replacement, raw enumeration and exclusive
  publication. `package-capture.test.ts` runs shared source-capture cases on the
  qualified Mac when opted in.

  Linux retains filesystem-specific byte-name and case-sensitive collision
  fixtures. `activation-admission-store.test.ts` exercises real SQLite
  durability and recovery on both hosts. `package-materialization.test.ts`
  includes fresh-process reacquisition, interrupted cleanup and the Darwin
  chmod-before-rename window. `macos-volume.test.ts` covers bounded shared
  capacity with sandboxed native writers, backing-file denial, journal and inode
  forgery refusal, and case-sensitive names. It covers relocated image recovery
  without deleting the alternate host directory, fresh-process recovery, and
  repeated exact cleanup without administrator access. It preserves failed
  allocations when recovery cannot be confirmed. `macos-preparation.test.ts`

  runs the unchanged preparer and a retained ordinary TypeScript dependency
  consumer in native guardians with bounded storage. It checks ignored install
  scripts, production dependency selection, source-write and private-file
  denial, and complete cleanup. Project workspace preparation tests use the
  worker's real working-directory interface without source rewriting.
  `bun-native-preparation.test.ts` runs transitive locked/unlocked preparation
  and non-registry lock rejection on both hosts. Mac checks frozen version-1 and
  version-2 locks without changing authored bytes. Unsupported formats retain
  their own diagnostic.

  Its cgroup-observed coordinator loss cases remain Linux-specific.
  `macos-agent-runtime.test.ts` checks malformed and universal Mach-O metadata,
  project-excluded transitive lookup, cache membership and changed support
  bytes. `native-agent-metadata.test.ts` uses bounded fresh-process named-pipe
  regressions for both ELF and Mach-O readers, verifying prompt refusal without
  executing the selected files or removing them before inspection settles.
  Deployment targets must not exceed the already qualified host kernel’s
  `kern.osproductversion`. SDK defaults cannot inherit another candidate’s
  ceiling. Its opted-in SDK-linked fixture proves that inspection does not
  invoke library constructors.

  ELF metadata fixtures retain their separate Linux-format coverage.
  `macos-descriptor-handoff.test.ts` uses an independent SDK-native sender to
  assert socket/message layouts, split and malformed frames, rights cleanup and
  rejection of writable files. It also verifies anonymous capture, renamed
  directory identity, kernel peer versions, cancellation and endpoint
  collisions. `file-input.test.ts` and `bound-attachments.test.ts` exercise
  shared capture and retained resources on Linux and qualified Mac. Mac cases
  reject private-state case aliases and copied/closed capture handles. The
  volume test also rejects selected descendants crossing mounts.

  Linux filesystem and Nix loader cases remain Linux-only and require their own
  runner. `macos-guardian-storage.test.ts` qualifies journal-before-tool
  admission, descriptor collection after detached-descendant fencing, collection
  lifetime and actual guardian loss. Missing recovery executables preserve
  authenticated storage for an ordinary retry.
  Invalid mounts, closed descriptors and actual allocation collisions exercise
  refusal without replacing native operations.
  Empty authenticated allocation recovery does not prove every pre-journal crash window.

  Every cleanup attempt keeps its exact journals until fencing is confirmed.
  Whole-file native checks also preserve partial/foreign entries and refuse
  owner journals, retirement markers and public/link/replaced or mounted storage.

  Do not replace the allocator or rewrite source for pre-journal recovery evidence.

  `macos-guardian-input.test.ts` runs ordinary TypeScript relative
  imports and binary/empty reads from the immutable projection. It denies source
  writes and private data. It refuses changed/closed captures before execution.
  It recovers after source handles have already closed.
  `captured-output.test.ts` covers source removal, binary/empty bytes, immutable
  readers, purpose separation, aggregate bounds, invalid trees and cancellation.

  The native input/guardian test also verifies an output snapshot after its
  original filesystem image and collector have been released. Portable
  `file-delivery.test.ts` cases cover post-source-removal binary output,
  forged/closed snapshots, cancelled retention, collisions, parent replacement
  and complete staging cleanup. Independent command transport cases additionally
  require their platform's qualified process ownership and descriptor transfer.
  `delivery-inspection.test.ts` covers inherited deadline minima, actual elapsed
  completion bounds, real file reads and descriptor retirement.
  Authenticated capture, lost acknowledgements and transport retirement require
  actual subprocess transport, not private stream or clock replacements.

  These portable cases do not establish actual native peer authentication,
  endpoint release, parent recovery fencing or installed browser composition.
  Those remain platform/installed qualification gates.

  `execution-output.test.ts` uses actual output descriptors and captured snapshots.
  Native guardian ordering and failures require genuine native lifecycle cases.
  Directory and snapshot loans require one actual close, sticky typed uncertainty
  and retained original handles after caller references leave.
  Native guardian input evidence and
  terminal cleanup recovery cover retained bytes after storage removal. The
  latter requires actual bounded output collection and observable job-retirement races,
  preserving refusal until removal is confirmed.

  Session collectors validate captured empty directories too.
  Real oversized and multiply linked history files exercise profile refusal.
  Unexpected hardware I/O failures require separate evidence.

  The complete file-delivery suite also runs on qualified Mac. It
  covers the independent process, authenticated parent rejection, renamed input
  roots and immutable output transfer. It also covers cooperative interruption,
  forced escalation and coordinator loss during staging. Stopped fixtures
  explicitly ignore SIGTERM so both kernels exercise escalation.

  Use exact owned fixture PIDs only. `macos-owner-lock.test.ts` checks
  independent-process exclusion, release on coordinator death and lock
  replacement. `macos-backend-state.test.ts` checks real allocation, cancelled
  admission, authenticated records, and release refusal/repair.
  Exact release-marker interruption and active/finished recovery require genuine
  native lifecycle evidence, not rewritten code or invented final receipts.
  Independent subprocesses verify prompt refusal of unread named pipes in
  final/pending state and release records. They also check guardian owner
  journals and authenticated socket journals.

  `macos-native-backend.test.ts` qualifies sealing, immutable-path
  binding, prepared and active admission, bounded output after storage removal,
  and durable final receipts. It also checks unused-owner recovery, prepared/active
  coordinator-loss recovery and exact owner release. It is backend integration
  evidence, not installed-host conformance. The recovery fixture checks
  authenticated boot separation and keeps coalition fencing restricted to the
  current boot. Simulating a signed prior-boot journal does not qualify actual
  reboot, disk-image disappearance or post-boot reacquisition. Those require a
  controlled native reboot to claim actual reboot qualification.

  Package-level support promotion and exact-revision release gates are owned by
  `packages/jig/AGENTS.md` and `.github/AGENTS.md`. Simulated boot evidence must
  never be reported as a completed reboot test.

- Mac command and Agent composition fixtures explicitly select five-minute Runs
  and allow 75 seconds of settlement observation afterward. Their independent
  coordinator fixtures select the same budget. Deep branch admission observation
  allows three minutes before deliberate cancellation/loss. This covers nested
  native setup while production defaults and deliberate short-deadline checks
  stay unchanged. Aggregate test bounds account for their multiple independent
  Runs.

- Mac repair application qualification uses the public guide’s five-minute Run
  budget and allows setup and cleanup outside it. Linux keeps its existing
  two/three-minute fixture budgets. Production defaults remain unchanged.

- Mac host conformance enables shared workspace preparation reuse and public CLI
  workspace dependency cases. It also enables installed command, HTTP Agent,
  Markdown, continuation and interruption checks. Linux-only preparation cgroup
  recovery cases retain their Linux proof-host opt-in.
