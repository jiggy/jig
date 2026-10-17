# Private file authority and delivery

Apply these rules when the parent reading map selects this domain.
Read the [shared host contracts](AGENTS.md) before changing its implementation.

## Find a module

These links locate module rules. All selected domain requirements still apply.

- [descriptor-files](#descriptor-files)
- [flow-file-context](#flow-file-context)
- [attempt checkpoint and export](#attempt-checkpoint-and-export)
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

- `flow-file-context.ts` owns participant-scoped immutable artifact rights and root-scoped snapshot retirement.
  Reference spelling, paths and digests never establish authority.
  Static reads borrow the immediate caller's whole original immutable view.
  Supplied reads require explicit held references at reviewed ports.
  Each accepted create operation gets its own native output.
  RunHost joins duplicates and retains their original result/reference.

- Child controllers validate domain results, fence descendants and capture output.
  Confirm native/package/row cleanup before issuing caller rights.
  Failed or uncertain cleanup grants nothing and never authorizes replay.
  Initial reads permit onward delegation.
  Release revokes future borrowing, not accepted readers. Ancestor closure revokes descendants.

- Per root, retain at most 256 live participant references and sixteen sealed snapshots.
  Snapshots plus read materializations share 256 MiB. Original operator inputs keep their separate bound.
  Final result selection forwards an existing snapshot without resealing.
  `root-run-files.ts` transfers selected snapshot retirement to command/ticket ownership before live rights close.
  Output identity is boolean native-output intent, never an export path.

  Delivery remains separately owned. Do not restore staged child imports or destination-folder mutation controls.
  Root packet selection includes native output only for declared writable ports.
  Without final output, accepted checkpoint bytes remain eligible for packet delivery.
  The root file owner still retires every retained native output handle.

### Attempt checkpoint and export

- `attempt-checkpoint-store.ts` owns the original attempt's sole latest checkpoint in admission SQLite.
  Commit authenticated held-artifact snapshot bytes before acknowledgement.
  Replacement is transactional and retains no history.
  Metadata consumes the existing control reservation.
  Bytes exchange existing result chunks and share final-artifact capacity, retirement and export pins.
  Both final-result admission and terminal commit count checkpoint payloads within the accepted artifact allowance.

- Root checkpoint associations are explicit native identity data resolved against current participant rights.
  They are neither optional FLOW ports nor new filesystem authority.
  The command owner reads accepted records for publication and independently fences recovery before fallback.

- `attempt-export-copier.ts` and `attempt-export-owner.ts` use the independent file-command owner.
  They own retained acquisition, immutable capture, no-replace publication, outcome commit and pin retirement.
  Persist canonical destination/source/selection intent before copying and outcome before acknowledgement.
  Matching written intent returns its original receipt.
  At most 64 delivery records per attempt share the protected 4 GiB budget.
  Count outcome reservations, intent/index overhead and pin metadata.

- Bind copy ownership to boot/PID generation.
  Mutating maintenance may retire proved-dead copy owners, never merely expired or uncertain owners.
  Lookup never repairs state. Settled checkpoint export never reacquires the original Run execution owner.
  Immutable file capabilities retain copied bytes until their own retirement, independently of store read pins.

  Join the original copier and retire destination authority before releasing its fixed, nonrenewable pin.
  Deadline expiry never proves copier retirement.

### read-input-projection

- `read-input-projection.ts` derives only whole-view aliases with identical
  paths and original captured-input capabilities. Keep at most eight logical
  roots, 64 canonical files and 8 MiB of unique projected bytes. Equal hashes
  never authenticate aliases. Native owners create immutable local aliases
  before payload execution and retain the exact closed recipe at seal/admission.
  Each Linux launch reopens its held sealed memfd read-only, rechecks backing
  identity and seals, and hands off an independent file position above stdio
  destination slots. Parent and sibling copies never seek the original reader.

- Attachment execution derives from the existing root reservation: at most six
  Flow envelopes, no independent execution pool or volume.
  Each operation uses its ordinary 16 MiB Linux output tmpfs or bounded Mac Flow image.
  Collection retains <=16 MiB /64-file snapshots and streams <=64 KiB chunks.
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

- `captured-output.ts` supplies common authenticated manifest identity, bounded complete-root selection and collision-rejecting prefixed composition.
  Stream original authenticated slices into new immutable backing.
  Backing offsets alone never identify artifacts.
  Evaluation artifact inputs stream original held snapshot members into immutable native captures.
  Operator inputs retain 8 MiB. Artifact inputs permit 16 MiB.

  Empty descendant directories join physical-view identity and native read-only projection under the same finite entry limit.

- `captured-output.ts` snapshots an already-fenced output directory into one
  anonymous immutable backing under the 16 MiB aggregate output bound. Preserve
  directory evidence, including empty directories, for native-session
  validation. Keep capture/profile failures distinct from execution and cleanup
  evidence. The snapshot may outlive a detached native volume. Its descriptors
  and bytes remain command-owned and cannot be recreated from serialized
  metadata.

- `capturePrivateRetainedOutput` is reserved for trusted ticket export after store verification under an accepted export pin.
  Recheck all hashes, tree paths and unchanged 16 MiB /64-file bounds while resealing.
  This creates no participant right or authority from a public packet.

### execution-output

- `execution-output.ts` owns original directory and snapshot retirement.
  Close each actual handle once and memoize its result.
  Retain the original strongly until close fulfills.
  `PrivateOutputRetirementUnconfirmedError` preserves the cause and makes failed retirement sticky.
  Controllers retain uncertainty even when subsequent native fencing succeeds.

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

  Checkpoint snapshot validation compares each ordered path, byte count and digest.
  Decoded JSON object key order never changes manifest identity.

  Linux snapshot transfer uses the existing token-authenticated command control.
  Import the held descriptor through the trusted coordinator's `/proc` reader.
  Require an anonymous regular file and all immutable memfd seals.

  Both platforms verify exact bounded manifest paths, byte counts and hashes
  before creating a new immutable snapshot.
  Keep original and imported handles alive through publication acknowledgement.
  Decoded metadata alone grants no output authority.
  Mac acquisition still requires its authenticated received-descriptor bundle.

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

  Text, empty, image, non-text, unavailable and clipped states remain
  distinct. `image-preview-policy.ts` owns the shared finite capture/transport
  limits. Complete image sources add bytes only within that same retention
  budget. `image-preview-child.ts` runs the decoder in a disposable process.

  Before returning images, reserve every file's text fallback and charge encoded
  replies as UTF-16 storage. Repeated previews reuse the same reservation.
  Images that exceed the aggregate reply budget retain their file fallback.

  A separate main-thread watchdog limits each image to five seconds. Stdin
  remains open as a lifetime lease. Input length frames the image without
  closing that pipe. EOF or pipe failure kills the process, including a busy
  decoder thread.

  `image-preview.ts` kills and joins it on cancellation or output overflow.
  Release the command reservation only after settlement. Carry earlier preview
  cutoffs through the private command to the decoder timer. Drain its reply
  under the separate total deadline before retirement.

  Pinned Wasm, copy and decoded-text limits bound content, not total Bun RSS.
  Saved-image preparation has a ten-second aggregate limit. Worker, renderer
  and font bytes remain pinned.

  Preserve text and saved-file fallback for malformed or stalled images. Late
  or failed previews stay unavailable. They do not retract a known publication.
  The map never reopens a destination or invokes file RPC. Capture/retirement
  errors are closed command-cleanup failures, separate from known execution and
  delivery facts. Callers must not fabricate unknown work.

  Authenticated `file-command.ts` retirement irreversibly fences every authority
  verb and checkpoint recovery/fallback, including no-publication. Join original
  operations, then discard the checkpoint mirror and close project read descriptor, delivery owner and
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
  changes exact JSON inspection. Plain/JSON saved inspection skips image decoding.
  Saved preview preparation closes file descriptors before asynchronous decoding.
  One ten-second capture deadline covers file verification and optional image
  decoding. Cancellation or close releases retained text and image buffers.

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

  Prepared-ticket acceptance uses the same root-administration error projection
  as ordinary root submission. Preserve attempt-specific errors separately.
  Only typed mapping and input-limit failures establish file-input refusal.
  Identification, integrity and cleanup failures must not acquire that label.

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

- Verify workspace progress through real subprocess streams and actual deadline constraints.
  Cover operator-controlled inspection, private deadline minima, trusted dispatch
  versus initial refusal, effective machine modes, and queued screen
  entry/restoration. It also covers phase-aware interruption, escaped cause
  batching and full final diagnostics. These portable cases include one owned
  Bun-to-Bun expired-constraint regression. They do not qualify host-clock
  adjustments, terminal restoration or actual command expiry on another
  supported host. The native file-delivery inspection cases separately verify
  immutable bytes, explicit command limits and terminal restoration after
  sustained inspection.
