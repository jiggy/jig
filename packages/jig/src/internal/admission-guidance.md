# Private capture, review and admission

Apply these rules when the parent reading map selects this domain.
Read the [shared host contracts](AGENTS.md) before changing its implementation.

## Find a module

These links locate module rules. All selected domain requirements still apply.

- [contract-import](#contract-import)
- [dependency-flows](#dependency-flows)
- [project-plan-review](#project-plan-review)
- [project-resource-qualification](#project-resource-qualification)
- [installation-verification](#installation-verification)
- [prepared attempts and retention](#prepared-attempts-and-retention)

## Ownership

Project requirement failures preserve only validated exact Jig versions and trusted recovery text.
The two closed `PROJECT_JIG_*` diagnostics survive project planning without rendering authored exceptions or arbitrary dependency requests.
Version metadata is checked before evaluation and reverified before capture completes.

### Prepared attempts and retention

- `prepared-attempt-store.ts` owns protected ticket domain/key records, canonical
  request/input blobs, acceptance quotas, retained artifacts, retirement watermark and finite export pins in admission SQLite.
  `activation-admission-store.ts` retains descriptor custody and EXTRA-synced transactions.
  Acceptance shares the original root allocation transaction. Missing prepared state never allocates work.
  Retirement commits before deletion. Unresolved owners and unreleased copier pins block collection.

  The store and application client share pure request identity through `../attempt-request-identity.ts`.
  This comparison grants no authority and imports no host machinery into the client.

- Prepared input, retained output, consumed metadata, outstanding reservations and row/index headroom share one 4 GiB logical budget.
  Control consumption transactionally spends dedicated `attempt_reservations` rows of at most 1 MiB each.
  Metadata writes never rebuild untouched control/result chunks.
  Prepared rows retain only outstanding counters. Chunk row/index overhead counts toward the same budget.
  New work cannot spend the protected final/fencing margin.

- Terminal retention releases unused control/result allocations before inserting replacement bytes in the same transaction.
  DELETE rollback journals still require filesystem space for original pages.
  Reservation and page-capacity evidence do not establish durability through external filesystem exhaustion or hardware failure.
  Failed writes retain ownership uncertainty and never authorize redispatch.

- `submission-ticket.ts` authenticates opaque canonical claims only.
  It owns no clock, persistence, expiry or authorization policy.
  Possession grants no project access. Resetting state or keys must never revive an identity.
  Read-only retention projection reports expiry without collection.

  Across boots, use the protected new-boot anchor conservatively.
  Clock loss makes byte availability unknown without erasing terminal or cleanup evidence.

- `activation-admission-store.ts` supplies `readPrivateRootRun` through read-only/query-only SQLite.
  Reuse complete Run/admission cross-checks without coordinator acquisition, dispatch, recovery or state repair.
  Its private snapshot is neither a public lookup response nor proof of current execution ownership.
  Checkpoint and export storage contracts are in [file guidance](files-guidance.md#attempt-checkpoint-and-export).

  Failed state opening attempts database, directory and owned-root closure before
  releasing its local turn. Preserve primary and cleanup errors together.
  Cleanup uncertainty must not become a retriable contention refusal.

### contract-import

- `contract-import.ts` owns explicit, inert contract-bundle copying: capture an
  invocation descriptor and exact offline channel closure, or a standalone
  channel descriptor. `standard-contracts.ts` owns the closed `jig:` catalog of
  installed invocation and channel agreements. `--list` stays offline. Imports
  capture the exact descriptor closure and its license and verify the catalog
  digest. Names select agreements, never implementations or authority. Validate
  before writing, and publish a new directory without replacement.

  Source package code, unrelated files, network access and Run approval stay
  outside this operation. Native publication uses exclusive directory rename
  from a newly owned staging leaf. Cleanup walks held descriptors with finite
  entry/depth bounds. A failed allocation must never authorize removal of an
  existing name.

- Admission storage uses the closed native descriptor operations while SQLite
  retains DELETE rollback journaling, EXTRA synchronization and NOFOLLOW opens.
  Darwin resolves system ancestor aliases only for SQLite's visible filename.
  Verify that hierarchy against the held state/database and the original
  requested project root before and after opening. Do not use this pathname
  normalization to replace descriptor-relative file authority.

- Durable materialization preserves exact package identity through native
  creation, aliases, reacquisition and disposal. Darwin requires the package
  directory writable for the disposal rename, after fencing and digest checks. A
  crash in that window cannot readmit it: disposal rechecks the same lease,
  restores read-only mode and validates all bytes before resuming the rename.
  Changed bytes fail closed. Recorded allocation recovery may remove an
  incomplete projection without treating it as an executable lease.

  Creation freezes and synchronizes every created directory and alias parent from the bottom up.
  Transaction and protected-parent barriers follow before returning a verified lease.
  Intermediate creation needs no additional directory barrier. Projected files remain reconstructible from retained immutable bytes.

  Verification preserves complete capture, freshness fingerprints, content digest and both alias checks.
  Its mode walk holds one descriptor chain bounded by Package/0 path depth.
  Recheck each directory's owner, filesystem and read-only mode after its descendants, then its named inode before closing it.
  Regular files retain their no-link, identity, owner, filesystem, link-count and mode checks.

  Optional private timing separates copying, freezing and final verification.
  These observations retain no paths or identities and change no authority, recovery or deadline.

- Package artifact retention, materialization, and preparation.

### dependency-flows

- `dependency-preparation-limits.ts` snapshots supported operator environment
  settings before project evaluation, then resolves each prepared-output budget
  from environment, project choice or default. Keep value origins available for
  actionable diagnostics. These review operational budgets do not grant Run
  authority or alter admitted grants. Workers receive validated numeric values,
  never ambient environment configuration.

- `dependency-flows.ts` selects declared `npm:` dependencies after ordinary
  contained Bun preparation. It inspects a regular-file package view and retains
  the original dependency lookup layout with that package as the execution root.
  No provider imports, live installation traversal or new native authority.

- Contract generation owns captured TypeSpec requests, a bounded trusted Node
  subprocess with empty environment and stdin lifetime lease, and per-package
  publication journals beneath `.jig`. It requires separate
  `--generate-contracts` consent. Only exact before/after bytes may settle
  interrupted batches. Observed edits conflict. Completion recaptures visible
  files before review. Individual renames are not atomic multi-file publication
  or protection against every editor race.

  Borrowed channel agreements are captured inputs, not managed outputs. Validate
  the full offline closure. Retain input hashes for freshness. Recheck them
  before/after publication and interrupted-batch recovery. Do not rewrite them.

### project-plan-review

- `project-plan-review.ts` renders retained public policy and affected targets.
  Keep exact child attachment port/folder maps visible, and mark mapped parents
  affected when their selected child revision or availability changes.

- Installed Bun authentication, rootless acquisition, delegation, containment,
  supervision, and execution. Missing or invalid installed release files produce
  closed repair evidence. Supported-host failures remain distinct.

### project-resource-qualification

- `project-resource-qualification.ts` qualifies exact selected ACP grants before
  avoidable execution preparation, then propagates refusal through captured Flow
  routes. It never chooses a substitute. `resource-qualification-evidence.ts`
  binds closed client/slot causes to exact requests, policies and unavailable
  child dispositions. Admission checks the witness and refuses ready parents of
  unavailable children. A closed display diagnostic is not expected-refusal
  provenance: direct known predicates may mark it, wrappers default to fatal.
  Abort, corruption, arbitrary I/O, owner faults and unconfirmed cleanup cannot
  become per-target availability.

  The private `review-agent-setup.ts` report carries at most 1 MiB of read-only
  policy, captured location and recipient facts, with omitted counts and a
  reserved primary blocker. Authoritative typed refusal survives omission of
  every presentation row. Known rejected executable overrides survive native and
  Codex error wrapping only as a closed field-name fact. Private qualification
  uses a WeakSet on current failure objects so persisted readiness causes and
  evidence identities stay unchanged. Honest ready/default-target facts guide
  successful non-ACP feature-limited review. Never use them as the ACP gate.

  No source-edit bytes, root edit identity, publication owner or correction loop
  belongs in this report. `project-session-controller.ts` invokes
  `onAgentReadiness` after selected-resource qualification and before avoidable
  target execution preparation. The CLI throws its private
  `ProjectAdministrationError` with fixed `JIG_REVIEW_AGENT_UNAVAILABLE` marker
  here and catches only that typed marker with observed ACP refusal. SDK
  plan/apply semantics stay unchanged. Arbitrary failures and cleanup
  uncertainty keep their own diagnostics.

## Local Contracts

- Approved-snapshot inspection uses SQLite read-only/query-only access and a
  consistent read transaction, never schema initialization, recovery, or a
  coordinator. Reuse filesystem identity and retained-artifact verification.
  Reject unreadable state instead of repairing it. Only explicit public target
  fields leave the store. Private recipes and authority records remain private.
  Optional target descriptions come from verified retained package metadata, not
  visible source.

  Completion omits description capture and environment probes. The interactive
  chooser requests descriptions without acquiring authority. Environment
  inspection shares Run's recipe identity calculation but returns inert
  comparison evidence, never an authenticated executable recipe. Compare current
  support without cgroup acquisition or namespace execution. Run retains full
  launch revalidation. Include selected child identities, isolate unrelated
  targets, and report failed comparisons as unchecked without private causes.

  Compact reviews may suppress repeated ACP selections across source edits only
  under identical package paths and resolved slots. Suppression requires
  recomputing both retained recipe and observation digests with an authentic
  current environment. The shared identity calculation returns inert hashes,
  never an executable recipe. Unknown or changed environments retain the
  selection. This display proof changes no approval, persistence or launch
  revalidation. An explicit review client operand always retains
  authored/effective selection context, even when policy is unchanged.

- One resolved slot table pins exact Flow targets or qualified native
  invocations. Inert portable lock decoding checks attachment map shape and
  target references. Candidate/5 and Plan/2 decoding check complete maps against
  both target requests' declared ports and access. Artifact reacquisition
  independently binds every request's attachment interface to verified retained
  Package/0 metadata before admission or execution. Keep package declarations
  out of the portable lock. `project-feature-qualification.ts` qualifies the
  selected graph from captured support/requirement metadata, without preparing
  execution or choosing alternatives.

  Feature-refusal evidence pins the caller and selected provider requests,
  including their retained package bytes. Live source edits cannot alter that
  evidence. Admission independently checks each feature-refusal disposition and
  its evidence. Unrelated targets retain their own readiness. Empty recipe sets
  use inert host support identity. Explicit review `agentOverride` is captured
  before qualification and changes only `client` in every selected normalized
  ACP policy.

  Bind it into capture identity and the ordinary effective lock. Strict decoding
  requires a fixed supported client, nonzero selected ACP policies and agreement
  of all slots. Cross-client pinned models, incompatible retention and zero
  selections refuse. Preserve these three closed refusal codes through the
  candidate diagnostic boundary with their project-relative location.
  Same-client policy still qualifies. Inspection reports retained origin, Run
  never substitutes it, and later review never inherits it from lock or
  admission.

  An explicit typed route must match its provider's offered contract. It cannot
  fall back or turn a claimed native descriptor into package-held authority.
  Project defaults resolve ordinary routes before admission, including direct
  Flow routes. Lock projection and complete graph checks retain those choices.
  Markdown reasoning derives its reserved Agent requirement during inert
  inspection and executes through that same table. Installed interpreter bytes
  participate in runtime identity.

  Markdown resources never trigger installation.

- Stage only captured manifests, the supplied root lock, and root-declared
  bounded `.patch` files for Bun installation. Patch paths are
  descriptor-captured without links, match the locked declarations, and remain
  exact retained inputs. Bun applies them, not a Jig patch engine. Recheck bytes
  and preserve source identity. Materialize other authored files afterward. They
  must not trigger config loading, preloads, or foreign-lock migration.

  Supplied locks remain frozen. Missing-lock resolution requires explicit
  trusted per-review permission, separate from Run approval, before acquisition.
  Never persist that grant or infer it from project input, `--yes`, or an
  earlier review. Validate the generated graph before frozen installation.
  Retain its exact bytes privately. The worker derives scratch paths from its
  trusted launch working directory, never rewritten worker or consumer source.

  Select the native lock version for the pinned runtime (Linux Bun 1.3.3 or
  qualified Mac Bun 1.4.2). Linux reads text lock version 1. Mac reads versions
  1 and 2 and emits version 2. Keep the same source/provenance checks and exact
  supplied bytes without translating locks. Unsupported formats retain a
  distinct closed diagnostic. Missing-lock resolution uses `--omit=dev` so
  production-only installation does not suppress publication of the new lock.

  The subsequent install stays frozen and script-disabled.

- `bun-preparation-output.ts` owns descriptor-based native directory collection for both modes.
  Both Bun preparation modes return metadata only on stdout: layout, file count,
  logical bytes and canonical Package/0 digest.
  The worker moves selected regular files into fixed `work/prepared` without
  duplicating its closure. Workspace aliases remain separate layout metadata.
  Native collectors retain original work descriptors and capture only after fencing.
  Host-created immutable package bytes must match metadata, source and layout.

  Production defaults to 4,096 records/32 MiB. Resolve its operator-selected
  bounds once through `../project/limits.ts`. Pass the frozen complete pair to
  worker input, native collection, result decoding and retained-byte reassembly.

  Never reread environment selectors in workers or collectors. Evaluation retains
  its fixed 8,192 records/128 MiB. Source capture bounds remain unchanged.
  Layout bytes share each decoded allowance. Stream and storage limits stay separate.

  Worker overflow evidence contains only a closed dimension and safe integer
  observation/maximum. The controller checks the maximum against its own selected
  policy before retaining the diagnostic. The host alone identifies an evaluation
  diagnostic from its selected preparation mode. Observations may stop at the first overflow.

  Failed cleanup grants no prepared package. Recovery settles owners without recapture or replay.

- Workspace capture supports root applications and declared ancestor members,
  reading root metadata and selected dependency source, never installed links.
  Resolve a selected package's declared workspace above the Jig application
  before using workspace declarations inside it. The nearest qualifying outer
  root must directly declare the selected package. Owning only the application
  does not add undeclared Flows. Without a qualifying outer root, use the
  nearest declared enclosing workspace within the application, or the selected
  package's own workspace. Keep the same bounded ancestor discovery.

  Stop at directory aliases without invalidating a declared workspace below one.
  Preserve members' own `workspaces` declarations as inert metadata during an
  ancestor-root install. Only that root's patterns define captured membership.
  Member declarations neither expand it nor invalidate unrelated consumers.
  Discover an ancestor workspace for exact versions as well as `workspace:`
  declarations. Matching local members use Bun's normal substitution, while
  exact dependencies outside a declared workspace remain standalone.

  Recheck metadata, retain exact regular files, and recapture on review even
  when the Flow is unchanged. Preserve the pinned hoisted install's
  workspace-relative paths and dependency scopes. Retain only exact installer
  aliases to selected member roots. Bun preparation owns member and dependency
  semantics. Admission carries bytes and layout as one execution artifact.
  Recipes derive the launch command.

  Materialization receives only regular bytes and exact runtime-independent
  aliases. Verification and cleanup handle recorded aliases without following
  them. Package/0 stays regular-file-only. Runs receive no live workspace
  authority. Bun owns installation, not a parallel Jig resolver. A Bun lock may
  record `workspace:*` when an exact manifest version selects a same-name local
  member at that exact version.

  Treat that as fresh only when both conditions hold. The validated lock
  resolution names the captured member. Its version equals the exact request.
  Ranges and mismatches remain stale.

  Compare member name/version and all dependency maps with the lock. Exclude
  root name/version metadata because Bun does not maintain it as dependency
  selection. Retain the complete root manifest in source and preparation
  identity. This rule does not rewrite locks or omit review.

  Discover declared ancestor workspaces for exact public-version dependencies
  as well as explicit workspace requests. An ordinary registry dependency with
  no enclosing workspace remains standalone.

  Explicit workspace requests still require declared membership. Reuse workspace
  preparation only from this Jig project's active admission: match freshly
  captured installer inputs and current preparation support to retained
  dependency evidence. Assemble fresh source with verified installed bytes, then
  plan and review the new execution identity independently. Never share
  preparation between Jig projects under one workspace. Recapture source on
  every review. Manifest, lock, patch, membership or preparation-support changes
  invalidate reuse.

  Source-only edits reuse dependencies, never source or authority. Missing
  evidence requires preparation. Missing/corrupt admitted bytes fail closed.
  Reuse performs no network activity and does not retain a network grant.

- Keep known channel-declaration, Agent-configuration and dependency-preparation
  failures actionable through closed diagnostic codes and project-relative
  locations. Never expose raw provider or worker messages. SDK missing Agent
  support affects only selected targets and their dependents. CLI review refuses
  any observed typed selected ACP prerequisite before preparing target
  execution, unchanged success or admission.

  Initial npm dependency adoption applies the same preparation-error scoping as later target preparation.
  Known preparation failures without worker locations refer to the application's canonical `package.json`.
  Run Checkpoint must follow its exact declared native interface and protected attempt association.
  Do not infer checkpoint authority from a writable attachment or optional FLOW port.

  Unsupported Volta selections retain the existing wrapper diagnostic, including
  Claude/Pi and Codex installations outside the supported static npm profile.
  Preserve that cause through Codex opening without executing the dispatcher or
  choosing another installation. The operator may select the actual native
  binary. The private project-session acquisition and operation callbacks permit
  selected host tests to observe only a fixed phase or operation and bounded
  error class/code chain. Never include raw messages, paths, or rejected values
  in that evidence. Root, child Flow, and contained-effect failure observation
  follows the same rule.

  Before test output, classify the active private phase and error chain.
  Preserve terminal settlement, replay, and cleanup rules. Contained effects
  also report a confirmed fence's unexpected stop reason, even when no exception
  occurred. Payload output cannot replace missing native terminal evidence.
  Project Command lifecycle proofs enable this observer. Configuration evaluator
  failures preserve closed support, launch, envelope, settlement or protocol
  codes and the captured declaration location.

  Never project raw launcher exceptions or infer a timeout cause from
  unavailability. Evaluator launch errors retain their original cause privately
  so the existing operation observer can project the closed class/code chain.
  Lifecycle host tests observe plan/apply failures as well as execution
  failures. Public errors keep the evaluator code and declaration location
  without the private chain. Manifest policy errors retain closed causes and
  JSON pointers, never rejected source values or invalid names. Workspace
  manifest locations are relative to the project (including bounded ancestor
  paths), not the selected Flow.

  Do not rebase them twice. These display locations grant no file access.
  Stale-lock errors retain the authored lock location from verified capture.
  Include project-root dependency adoption.

  Keep this display context outside preparation identity and worker messages.
  Public projection retains it so the CLI can identify the workspace that
  needs repair. Unreadable retained state has a distinct closed diagnostic
  from unsafe filesystem ownership. Preserve it on failed acquisition.

  Never infer permission to reset admission or bypass cleanup from a decoding
  failure.

- A reproduced root recipe that differs from its approval is a known
  pre-execution refusal. Retain host-only REVIEW_REQUIRED with
  flowStarted=false. Direct the operator to review. Do not collapse it to
  EXECUTION_FAILED or infer this reason from arbitrary failures. Recovery and
  cancellation keep their existing precedence. Flow wire failures cannot emit
  this code.

  Never replay work or claim no execution after a sandbox began. Root execution
  compares the actual sealed owner's mechanism identity with the reviewed recipe
  before admission, using sealing's fresh observation instead of a duplicate
  pre-seal observation. Retain and settle the sealed owner on refusal. Final
  admission still verifies installation support under operator policy and
  freshly revalidates invocation authority.

- Review projects only explicit public policy and allowlisted non-secret Agent
  selections. Environment-only target changes name the execution environment,
  distinguish unchanged source/dependencies/policy, and explain the new
  approval. Combined fingerprints cannot identify individual historical
  components. Disclose that limit instead of inventing a component diff or
  displaying opaque identities. A change-first display omits empty categories
  and uses shared YAML field rendering, with complete signed additions/removals
  and contextual diffs. `--details` uses the same sectioned diff renderer with
  unchanged records and fields included as context.

  Never serialize change bookkeeping or wrap policy in current/proposed
  snapshots for human review. It must retain every changed record. Full policy
  remains available without revealing private recipes or consent tokens.
  Missing-target suggestions come from the retained admitted revision, never a
  live filesystem scan, and cannot grant authority or select a replacement.

## Work Guidance

### installation-verification

- `installation-verification.ts` owns command-scoped operator policy and the
  bounded installation cache. The installed CLI resolves `--verification` over
  `JIG_VERIFICATION`, falling back to cached, before opening the command scope.
  Pass prepared command arguments, the private preparation-complete marker and
  their optional selected admission through file-owner and delegation
  reexecution. The retained inspection callback exposes only owned canonical
  writable-target selectors with that same admission, without public DTOs or
  package recapture. Select omitted writable output once under the canonical
  OS-temporary parent before file-owner selection. Preserve no-output/unreviewed
  decisions too.

  Keep anchored exclusions, publication and packet retention with the delivery
  owner. Root submission rejects changed approval before allocation. The private
  admission marker can only constrain, never grant, execution. Entrypoint
  defaults and interactive target choices survive reexecution. Preserve the
  effective verification policy through delegation, file delivery and recovery.
  Strict freshly hashes at every boundary, and fast accepts cached path
  identities without freshness checks.

  Cached compares inode/device, ownership/mode/link count, size and nanosecond
  mtime/ctime on every lookup. Hash misses and check metadata before/after.
  Never reuse atime as freshness evidence. Private calls outside an explicit
  command scope remain strict. Register the actual project before opening
  support. Cache storage must be owner-private and outside project routes.

  Invalid or unsafe cache falls back to hashing. Inspection never writes it.
  Snapshot policy before project loading, isolate concurrent contexts, and
  preserve it through launch and recovery. Cache no credentials, packages,
  attachments, approval or containment authority. Mode alone must not alter
  recipe identity for unchanged installations.

## Verification

- Run the directly corresponding `packages/jig/test/` files, then
  `bun test packages/jig`. Resource qualification and CLI setup/approval tests
  verify fail-fast typed refusal independent of bounded diagnostics and
  unchanged SDK target readiness. Project linking/capture and lock tests verify
  all-selected client construction, preserved source/other policy, capture
  identity and strict retained `agentOverride` origin.
