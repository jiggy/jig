# Jig package

## Purpose

Implements the `@jigging/jig` authoring API, installed Linux host and native macOS candidate for
admitted FLOW packages.

## Ownership

- `src/index.ts` and `src/project/author.ts` own the public authoring surface.
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
- `test/` owns unit, integration, fault-injection, packed-package, and
  proof-host evidence. `test/fixtures/channel-conversation/` owns the synthetic
  named-channel peers used by installed foreground tests, independently of
  public example selection.
- Agent Run resolves to an ordinary Flow through defaults or exact slots.
  Jig retains source admission, resource grants and owned execution, not Agent
  preparation or answer interpretation. Skill content is explicit caller data;
  consumers independently check dynamic results.
- Optional Codex session retention stays below the ordinary Agent boundary:
  reviewed grants, exact recipient scope, single-use protected history, clean
  native exit, fencing and cleanup precede a new receipt. The opt-in
  `native-session-restoration.test.ts` uses installed archives and at most two
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
- `support/macos-exec.c` and the private Mac capture/process controls supply
  native-host development boundaries; their ownership and native qualification
  procedure live in `src/internal/AGENTS.md`. They do not change the installed
  package's supported platforms or require a consumer compiler or administrator.
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
  timers on close; forced native termination cannot become adapter success. Pi ACP
  invokes Jig's private launcher through the verified Bun interpreter and
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
  probes or source evaluation. Selection is explicit and precedes acquisition;
  Run still performs all ordinary authority checks. `jig new` writes ordinary
  Flow source without overwriting, evaluating, installing, or approving it.


- `import-contract` copies a validated local invocation/channel bundle into a
  new directory, preserving bytes and relative paths. It follows only the
  operator-selected source root; closure descendants must be regular captured
  files. It neither acquires an execution host nor fetches, imports package
  code, replaces an existing destination, or grants Run authority.

- `src/index.ts` is the only JavaScript package export. Other exported symbols
  are private composition or test seams.
- Expose only the documented CLI and authoring surface; private host machinery
  is not a provider, runtime, or containment SPI.
- Default `init` writes a greeting Flow with a string input and a world fallback; `--bare` writes only the
  skeleton. Neither installs, networks, approves, or executes. Generated
  packages use the same dependency review as consumer-authored packages. The
  Optional `--agent` selection writes a declared ACP package dependency, visible
  Binding grant and contract-keyed default. It chooses no client implicitly and
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
  Review also separates source capture, per-package dependency capture,
  preparation/reuse and review retention, with stage-local timing. Prepared
  workspace artifact reuse stays within the approving Jig project.
- `inspect` compares the last local approval with current local execution
  identities, including selected children. Report mismatches as review required
  and unverifiable comparisons as unchecked. It does not evaluate source,
  acquire execution authority, resolve dependencies, contact providers, recover
  or write state. Credential reads stay private; matching identities do not
  establish source freshness, launch readiness or remote availability.
  Schema type diagnostics retain only closed expected/received JSON types, not
  rejected values. Human Run output leads with host facts before arbitrary results.
- Manifest-policy diagnostics identify a closed cause and JSON field without
  rejected dependency values. Ancestor workspace manifest display paths are
  bounded project-relative locations, not executable or readable file routes.
- FLOW and Jig specifications and machine schemas are authoritative. Accept
  only bounded, canonical current formats.
- Capture mutable project source before evaluation, admission, preparation, or
  execution; Runs use retained admitted bytes.
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
  named JSON policies.
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
  presentation; launcher failures follow the same structure. Never introduce
  a separate raw diagnostic style or route machine output through styling.
  Shell completion must work with macOS's system Bash 3.2 without installing
  another shell; collect replies with portable array/read operations.
  Major terminal sections need visible boundaries; secondary metadata uses
  gray while consent, policy values, and recovery actions remain prominent.
  A heading must never have less emphasis than its subordinate details. Expanded
  unavailable-client labels use bold amber above normal-contrast setup instructions;
  the compact names-only unavailable summary remains secondary.
  Separate unchanged prepared-file and dependency-layout explanations onto a
  secondary gray line beneath the prominent explanation of what changed.
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
  Summarize diagnostics already delivered by host invocation path, preserving
  unseen suffixes and truncation; machine records retain the full bounded capture.
  A generic failure without diagnostics must state the missing evidence; do not
  imply that the Flow never started or repeat an identical raw error block.
  Generic human failure summaries must retain specific terminal failure messages;
  hiding the structured result's message must never discard its cause. Quote and
  escape reported text as data, and do not infer missing evidence from empty
  stderr when the terminal already carries a specific explanation.
  Render host-only REVIEW_REQUIRED with `jig review` as the next action.
  Flow-supplied error details cannot establish that execution never started.

- Agent selection belongs to ordinary dependencies, Bindings and resource grants,
  never inferred from credentials or a preferred vendor. Selection remains
  distinct from authority approval; the optional init picker only authors files.

- Change implementation, normative specification, schema, README, and tests
  together when a public contract changes.
- Keep fault-injection seams private.
- Test fixtures use canonical dependency paths, including through Bun workspace
  symlinks. Source-tree proof commands reuse `test/fixtures/installed-bun-location.ts`
  rather than defining their own runtime locations. Source-rewriting hostile
  fixtures must also construct successfully in ordinary tests, so source
  formatting cannot silently break the host gate.
- Consult `src/internal/AGENTS.md` for containment, durability, or Agent host
  work.

## Verification

- `bun test packages/jig`
- `just jig::check`
- Use `scripts/test-release.sh` for packed or cross-protocol changes.
- `just jig::test-package` checks the installed inventory, exact copied licensing
  and pricing files, and the published Bread 1.0 text's fixed digest. The check
  uses retained local text, without a Bread checkout or network lookup.
- Trust-boundary changes require the provisioned host-conformance workflow.
- CLI acceptance: `bun test packages/jig/test/cli.test.ts packages/jig/test/cli-presentation.test.ts packages/jig/test/cli-run-presentation.test.ts packages/jig/test/cli-value-presentation.test.ts packages/jig/test/cli-output.test.ts packages/jig/test/project-plan-review.test.ts`.
  Check rendered success, failure, waits, cancellation, uncertain cleanup,
  plain/redirected output, narrow widths, and light/dark terminal palettes.
  Preserve byte-exact machine records and complete changed review policy.
- `test/markdown-worker.test.ts` checks installed Markdown's Agent-admission
  requirement and Agent-free code execution with the complete packed FLOW SDK
  in an ordinary declared workspace. It honors
  `JIG_PACKAGE_ARCHIVE` and `FLOW_SDK_PACKAGE_ARCHIVE`; otherwise pack built
  candidates. Failed public commands retain their consumer and diagnostics
  under the selected temporary root for investigation.
- `test/package-provider-host.test.ts`, under `JIG_LINUX_ROOTLESS_HOSTILE=1`,
  exercises public installed review, inspection and direct/Binding/child invocation
  of an ordinary declared workspace dependency, including admitted-byte pinning.
  The sequential host gate includes this consumer; it does not qualify model behavior.
- With `JIG_LINUX_ROOTLESS_HOSTILE=1`, `test/package-smoke.ts` also qualifies
  inline/named command grants through the installed public CLI and complete
  packed SDK in a consumer workspace, and the complete HTTP-backed Agent artifact
  without rewritten workers, including application → specialist → Agent
  composition, named-contract substitution, Markdown selection and independent
  decision rejection. It honors `JIG_PACKAGE_ARCHIVE`,
  `FLOW_SDK_PACKAGE_ARCHIVE` and `AGENT_METHOD_PACKAGE_ARCHIVE`.
  Failed smoke consumers and candidate archives remain available for diagnosis.
- Agent lifecycle suites accept `FLOW_SDK_PACKAGE_ARCHIVE`,
  `AGENT_METHOD_PACKAGE_ARCHIVE` and `AGENT_ACP_PACKAGE_ARCHIVE` for unchanged
  candidate artifacts; otherwise they pack already-built packages without
  rebuilding during execution. The native Codex immediate-interruption
  qualification separately installs the published Jig CLI and its published
  conversation dependencies in an ordinary consumer. It imports the published
  Agent contract through the public CLI, then checks the actual follow-up
  result and host cleanup. The test asserts and prints the resolved package
  versions; this is published-artifact evidence, not a source-candidate
  package test.
  `finite-acp-lifecycle.test.ts` also runs the unchanged incident-brief application
  with packed dependencies and a deterministic native peer. It checks two
  branches, predecessor settlement, one successor and residue, not model quality.
  Failed handoff fixtures retain bounded phase/dispatch timing with their results;
  timing is diagnostic evidence, not permission to extend execution deadlines.
- Test diagnostic usefulness as well as redaction, and human-facing output
  alongside its machine-readable contract.

## Child DOX Index

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
