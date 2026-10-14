# Private file authority and delivery

Apply these rules when the parent reading map selects this domain.
Read the [shared host contracts](AGENTS.md) before changing its implementation.

## Find a module

These links locate module rules. All selected domain requirements still apply.

- [descriptor-files](#descriptor-files)
- [flow-file-context](#flow-file-context)
- [execution-file-import](#execution-file-import)
- [read-input-projection](#read-input-projection)
- [file-input](#file-input)
- [captured-bytes](#captured-bytes)
- [captured-output](#captured-output)
- [execution-output](#execution-output)
- [file-delivery](#file-delivery)
- [delivery-inspection](#delivery-inspection)
- [saved-result](#saved-result)
- [raw-directory](#raw-directory)
- [workspace-progress tests](#workspace-progress-tests)

## Ownership

### descriptor-files

- `descriptor-files.ts` selects closed Linux or qualified Darwin operations for
  held-directory children. Its live references cannot be reconstructed from
  decoded data. Callers own descriptor lifetime and entry identity checks. Never
  convert these references to visible paths to regain file authority. Package
  publication serializes by store device/inode, publishes by exclusive hard
  link, and reacquires verified anonymous snapshots. Store enumeration retains
  and rechecks directory descriptors instead of following child paths.

  Project sessions retain their protected store parent through all planning and
  Run operations, then close it after root settlement and before the project
  owner. Acquisition failures and checkpoint recovery close that same owner.
  Retained-project and child-call plumbing pass live locations without
  serializing them.

- Invocation file capture, sealed input projection, bounded anonymous output,
  and separate command-owned publication after execution fencing.

### flow-file-context

- `flow-file-context.ts` retains immediate-caller immutable read views and binds
  only authentic admitted native import targets. Contexts own neither captured
  bytes nor native storage. Closing an ancestor revokes descendants.
  `child-file-import.ts` retains caller-lifetime busy/consumed/unavailable
  folder state independently of child-row and visible-directory deletion.
  Existing RunHost operation identity owns duplicates. Recovery fences the
  caller and never resumes its program, so no durable destination history is
  added.

  Child controllers admit the complete result and fence descendants before
  copying. Source readers and existing child package/native/row cleanup settle
  before native no-replace commit. Remaining importer closes precede a normal
  reply. Unknown setup, commit or close ends the caller without rollback/replay.
  Admitted roots retain the original importer across protocol/checkpoint faults.
  After confirmed parent fencing, attempt child settlement and join importer
  loans.

  Unresolved child or importer retirement keeps the root pending without
  release.

### execution-file-import

- `execution-file-import.ts` joins native stage preparation, one bounded copy
  and retirement without owning dispatch or durable Run state. Native issuers
  own source/destination authority and cancellation-versus-rename arbitration.
  Target closure preserves unknown setup cleanup, aborts/joins copies before raw
  stage closure, and still attempts native target cleanup after failures. Keep
  copied-file and directory FileHandles strongly retained until each actual
  close fulfills. Unknown closes never become a successful retirement. Retain
  the original target and its active leases strongly until complete target
  retirement is confirmed.

  A fatal caller does not release unknown native handles to garbage collection.

### read-input-projection

- `read-input-projection.ts` derives only whole-view aliases with identical
  paths and original captured-input capabilities. Keep at most eight logical
  roots, 64 canonical files and 8 MiB of unique projected bytes. Equal hashes
  never authenticate aliases. Native owners create immutable local aliases
  before payload execution and retain the exact closed recipe at seal/admission.
  Each Linux launch reopens its held sealed memfd read-only, rechecks backing
  identity and seals, and hands off an independent file position above stdio
  destination slots. Parent and sibling copies never seek the original reader.

- Writable child maps opt into the existing per-invocation output owner. Linux
  captures original backing/public descriptors before projecting the public
  subtree. Trusted setup uses fixed environment, drops all capabilities and
  reexecs before final continuation and package execution. Mac's existing
  guardian keeps denied import/public siblings on its ordinary volume. It loans
  original roots through authenticated transfer. It handles bounded tagged
  begin/commit/cancel/end messages on its existing control.

  At most two stages belong to one caller. Native membership, original deadlines
  and accepted cancellation arbitrate commit. A coordinator check is not the
  commit owner. Payload fencing joins outer copy leases and original root loans
  before Mac snapshot/storage retirement. Retain real FileHandles on uncertain
  close, never retry an ambiguous close or reconstruct authority from path
  metadata. Linux keeps at most two live and six total live/abandoned import
  reply IDs.

  One well-formed late ACK drains only its known failed request. Unknown or
  duplicate IDs fail closed and never revive a failed result. Exhaustion retires
  import control and cancels the native owner. Only its original confirmed fence
  can retire remaining native loans. Attempt every stage close, then backing
  close only after all actual readers have closed, preserving every uncertainty.

- Attachment coexistence derives from the existing root reservation: at most six
  Flow envelopes and five child stages, no new pool or independent volume. Linux
  stages share each 16 MiB output tmpfs. Trusted import writes may charge
  coordinator memory. Mac stages share each existing 512 MiB Flow image.
  Collection retains <=16 MiB snapshots per Flow and streams <=64 KiB chunks.
  Final publication and accepted checkpoint bytes keep their separate limits.

  Keep the full derived accounting in SECURITY.md synchronized with host policy.

### file-input

- `file-input.ts` owns common bounded selection, raw-name validation and regular
  reads. `file-input-policy.ts` owns limits and closed diagnostics. Linux uses
  openat2 and sealed memfds. Qualified Darwin walks held descriptors without
  links or mount crossings and excludes case variants of private Jig state.
  `input-capture.ts` returns live immutable-byte capabilities, not serializable
  descriptor authority. Retained attachments, command inputs and invocation
  projections keep these capabilities through launch and close them afterward.

  Directory ancestry may use only the closed `.`/`..` operation. Observed
  filesystem paths never authorize reopening. These adapters do not by
  themselves qualify native execution or output delivery. The logical Bun launch
  identity derives its file profile from this policy. Live stdout/stderr
  forwarding and physical filesystem capacity retain their separate budgets.
  Matching byte values do not make them file-capture authority.

### captured-bytes

- `captured-bytes.ts` binds anonymous byte capabilities to a closed input or
  output purpose and its separate byte limit. `input-capture.ts` owns the
  invocation-only interface. Output handles cannot substitute for input
  authority. `macos-captured-bytes.ts` owns private, capability-backed macOS
  byte captures. Mint a handle only after unlinking the only pathname and
  closing the only writable descriptor. Allocate its directory outside every
  payload file grant.

  Same-UID permissions alone are insufficient. Revalidation requires the
  original live capability and exact bytes. Serialized metadata cannot mint
  authority. Transfer descriptors only through an authenticated trusted handoff.
  This primitive does not by itself qualify or enable an installed macOS host.

### captured-output

- `captured-output.ts` snapshots an already-fenced output directory into one
  anonymous immutable backing under the 16 MiB aggregate output bound. Preserve
  directory evidence, including empty directories, for native-session
  validation. Keep capture/profile failures distinct from execution and cleanup
  evidence. The snapshot may outlive a detached native volume. Its descriptors
  and bytes remain command-owned and cannot be recreated from serialized
  metadata.

### execution-output

- `execution-output.ts` owns the closed Linux directory/native snapshot lifetime
  used by Run files and native-session collection. `macos-guardian-output.ts`
  captures only after fencing, releases an available collector, and waits for
  complete storage cleanup before exposing bytes. Missing collectors need no
  release. An immutable snapshot copied after fencing survives later confirmed
  terminal cleanup recovery only with the authenticated successful native exit.
  Missing collection, missing exit evidence and unconfirmed cleanup still refuse
  output. Recovery never recaptures a mutable source or replays execution.

  Content-profile rejection remains a delivery or optional-history outcome.
  Unexpected I/O and cleanup failure retain their separate consequences. Closing
  an unavailable snapshot cannot manufacture a storage-cleanup failure. Memoize
  each original directory or snapshot loan's actual close and retain it strongly
  until that close is confirmed. Typed close uncertainty blocks child commit and
  never permits another close attempt.

### file-delivery

- `file-delivery.ts` accepts local held input roots and bounded output snapshots
  or Linux anonymous directory descriptors. Remote descriptor acquisition
  belongs to the authenticated command transport, never a decoded pathname in
  publication. Staging writes and bounded cleanup use held directories on both
  platforms. Recheck the selected parent and exact staging identity before
  exclusive publication. A moved parent cannot redirect writes or cleanup.
  Invalid final files retain the known execution terminal and never authorize
  replay.

  Its memoized close joins original prepare/publication, consumes held
  references before cleanup and closes the destination parent even if staging
  cleanup fails. The same failure remains observable on racing or repeated
  close. Never retry a recycled descriptor. `RootRunFiles` similarly consumes
  output once and fences further projection, checkpoint and retention after
  close begins.

### delivery-inspection

- `delivery-inspection.ts` transfers only verified receipt-selected excerpts to
  a pure presentation map before indefinite live-result inspection. One total
  20-second completion bound includes serial previews, retirement ACK and spent
  channel completion, clamped by the inherited presentation deadline. At most
  the first ten seconds are for previews. Tighter constraints reserve half the
  remaining allowance for retirement. Keep at most 64 UTF-8 excerpts of 4 KiB
  each and 512 KiB aggregate retained content. Charge text as UTF-16 storage.

  Text, empty, image, non-text, unavailable and clipped states remain distinct.
  `image-preview-policy.ts` owns the shared finite capture/transport limits.
  Complete image sources add bytes only within that same retention budget.
  Production decoding remains unavailable: the private thread candidate cannot
  interrupt Wasm on qualified Bun. Its renderer tests establish bounded output,
  not independent fencing. Worker, renderer and font bytes are pinned and
  bundled.

  Preserve text and saved-file fallback while qualification is incomplete. Late
  or failed previews stay unavailable. They do not retract a known publication.
  The map never reopens a destination or invokes file RPC. Capture/retirement
  errors are closed command-cleanup failures, separate from known execution and
  delivery facts. Callers must not fabricate unknown work.

  Authenticated `file-command.ts` retirement irreversibly fences every authority
  verb and checkpoint recovery/fallback, including no-publication. Join original
  operations, then close checkpoint, project read descriptor, delivery owner and
  native endpoints through one failure-preserving close. Begin listener shutdown
  without awaiting the ACK socket's own close cycle. ACK follows authoritative
  release only. The client disarms disconnect cancellation only on that timely
  ACK, then joins spent-channel completion under the same bound. Silence, loss,
  late ACK and mere close never establish retirement.

  Completed bounded close promises remain completed during operator-controlled
  inspection. Later exit must not reapply their already elapsed transfer
  deadline.

### saved-result

- `saved-result.ts` captures operator-selected local result packets for
  `inspect --result`, without a project, approval, provider, verification
  setting or execution owner. Recorded facts and diagnostic paths are
  unauthenticated local claims. One JSON/0 document plus the publisher's single
  trailing LF and at most 64 manifest files /16 MiB are captured through held
  no-link directory descriptors. Validate the whole manifest before
  allocation/read. The separate held `files/` descriptor preserves each
  delivered path's full depth/byte budget. Matching size/digest establishes
  captured consistency, never publication authority.

  Partial verification retains the valid report and prior verified copies. Later
  previews use only those immutable buffers. The regular-file reader owns each
  allocation until post-read checks and descriptor closure succeed. Zero
  rejected allocations even when read, stat or close throws. Finish every owned
  directory close before transferring the inspection's buffer owner. A close
  failure disposes accepted copies too.

  Collective cleanup preserves the primary capture failure or interruption.
  Every exit closes descriptors and releases retained bytes. No recorded field
  can select execution, a current evidence destination, or mutable preview
  reads. Private saved views retain every captured file's full preview reference
  while disclosing clipped table names. Charge human report/diagnostic excerpts
  by serialized JSON bytes so all three views fit one publisher's retained
  budget. Keep distinct root diagnostics beside child reports.

  Only an exactly matching rendered root entry replaces the root envelope.
  Capture truncation disclosures precede excerpts, and human clipping never
  changes exact JSON inspection. Saved preview preparation closes file
  descriptors before asynchronous decoding and releases retained text/image
  buffers on cancellation or close.

- Read-only target inspection projects `boundReadAttachments` as retained names
  only. Invocation templates therefore omit captured reads without reopening
  live Binding paths or exposing private file projection handles.

## Local Contracts

- Explicit dashboard inspection has no local idle or absolute expiry. It remains
  read-only until q, contextual Escape or settled keyboard Ctrl-C. Literal
  filter keys retain their existing meanings. Any inherited finite presentation
  deadline still applies and cannot be refreshed by input, repaint or preview
  completion. Live presentation expiry returns to ordinary output without
  requesting cancellation. File publication and preview retention never waive an
  explicit command timer.

  Select immutable delivery inspection before capture/publication, even while
  screen entry waits for successful root admission. External interruption after
  settlement closes presentation with the existing interruption exit status.
  Keyboard Ctrl-C after settlement only closes inspection. Frozen result facts
  and all actual execution/cleanup deadlines remain unchanged. Standalone saved
  inspection owns no execution lifetime or local expiry on any supported host.
  Any earlier inherited constraint still applies.

  Its exit codes are:
  - 0 for a valid consistent report, even if recorded execution failed.
  - 1 for unavailable/invalid reports, incomplete files or output failure.
  - 2 for external interruption. JSON remains the unchanged recorded value.
    Current verification findings stay on stderr. Normal inspection closure
    never changes recorded Run facts or grants authority to repeat work.

- Root attachments use invocation-owned descriptors and canonical file identity.
  Hashes alone never grant file access. Per-run captured bytes are not retained
  artifacts. Before package code starts, the trusted inner launcher rechecks
  every projected file's byte count and digest against the admitted identity.
  Child contexts receive only complete reviewed maps from their immediate
  caller. Native Agent contexts receive no attachment or destination authority.

  The admitted-interface mapping check precedes root allocation. Its closed
  failure projects only bounded declared/supplied names for missing reads,
  invalid mappings, bound overrides and missing writable destinations. Combined
  retained/per-run file-limit evidence remains separately typed. Never infer
  paths, source freshness or no-dispatch evidence from arbitrary errors.

- Reviewed Binding read selections reuse the bounded file capture controls and
  retained artifact store. Bind source, manifest and tree identity to the exact
  configuration. Revalidate at admission and project retained bytes at
  execution, never live sources. Runtime mappings cannot override them. Combined
  retained and per-run input stays within the root file budget. No implicit
  inheritance, executable discovery, library resolver, network or credential
  authority.

- Keep execution settlement separate from delivery. Retain bounded output after
  writer fencing. Publish once without replacement through the independent
  command owner. Coordinator loss must remove unpublished staging. Late failure
  preserves a known terminal or publication and never authorizes replay.
  Cancellation allows at most 60 seconds of cooperative trusted-coordinator
  settlement.

  Absolute command expiry shortens that wait with a 250 ms kill grace. Never
  extend either bound on later signals or change payload deadlines. Confirmed
  interrupted settlement may publish its terminal and accepted checkpoint, not
  final Flow files. Unconfirmed cleanup cannot authorize delivery. Reap the
  exact trusted child after escalation. Independent cgroup fencing still owns
  payload cleanup.

- Run Checkpoint uses one separate bounded control operation, not a worker
  reservation. Only the root's independent output owner accepts immutable
  aggregate bytes before acknowledgement. Bind exact Run, admitted method,
  captured input, project identity and coordinator epoch before dispatch.
  Interrupted publication uses accepted bytes only after complete fencing.
  Recovery may settle that exact older Run but never submit or replay work. Keep
  rejected replacement, lost acknowledgement, owner lifetime, output collision
  and cleanup failure distinct.

  The owner retains no history.

## Work Guidance

### raw-directory

- `raw-directory.ts` preserves byte names for Linux descriptor enumeration.
  Pinned Bun can return byte arrays instead of Dirent objects for buffer
  encoding. Acquire missing type metadata with no-follow stat of the raw leaf
  beneath the held directory. Consumers retain strict UTF-8 validation and
  descriptor-relative admission. Never substitute lossy decoded names.

## Verification

### workspace-progress tests

- `workspace-progress.test.ts` uses injected streams and clocks. It covers
  operator-controlled inspection, private deadline minima, trusted dispatch
  versus initial refusal, effective machine modes, and queued screen
  entry/restoration. It also covers phase-aware interruption, escaped cause
  batching and full final diagnostics. These portable cases include one owned
  Bun-to-Bun expired-constraint regression. They do not qualify host-clock
  adjustments, terminal restoration or actual command expiry on another
  supported host. The native file-delivery inspection cases separately verify
  immutable bytes, explicit command limits and terminal restoration after
  sustained inspection.
