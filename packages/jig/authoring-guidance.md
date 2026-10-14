# Jig authoring and project interfaces

Apply these rules when the [package reading map](AGENTS.md) selects this domain.
The package entrypoint retains shared requirements and child ownership.

## Find a module

These links locate module rules. All selected domain requirements still apply.

- [src index](#src-index)
- [src project author](#src-project-author)
- [src package capture](#src-package-capture)
- [src project agent-source-location](#src-project-agent-source-location)
- [src project slot-graph](#src-project-slot-graph)
- [src run channels](#src-run-channels)
- [src package capture 2](#src-package-capture-2)

## Ownership

### src index

- `src/index.ts` and `src/project/author.ts` own the public authoring surface.

### src project author

- `src/project/author.ts` also owns shipped static attachment-route data types.
  `attachment-routes.ts` validates their closed maps and distinct output folders
  during authoring and inert lock decoding, and exact caller/child ports during
  linking and Candidate/5 or Plan/2 decoding. Admission rechecks each target's
  declared interface against its verified retained package bytes. The portable
  lock does not duplicate package attachment declarations. Keep the authoring
  closure pure and import-free after bundling. Declaration values use enumerable
  data descriptors like `author-value.ts`.

  Proxy reflection runs only under the existing authoring realm when evaluating
  project code. Revalidate retained JSON before supplying file authority. Native
  execution qualification remains separate from this review data.

### src package capture

- `src/package/capture.ts` snapshots through held directory descriptors and
  rechecks source identity and contents. Linux uses unnamed temporary files.
  Qualified Mac capture opens a private reader beside its sole writer, unlinks
  the only pathname, and closes the writer before exposing streamed bytes.
  Source renames cannot redirect opened-directory capture. This source adapter
  does not independently qualify the installed Mac execution host.

- Project source, declaration and static author-module capture use the same
  closed descriptor operations on Linux and qualified Darwin. Workspace capture
  preserves declared source/dependency selection and raw-name validation.
  Filesystem capture does not independently qualify Bun installation or
  execution.

### src project agent-source-location

- `src/project/agent-source-location.ts` owns the private captured-source
  lexical recognizer for ACP diagnostics. Its bounds are 1 MiB of TypeScript or
  32 KiB of JSON, 32,768 tokens and nesting depth 64. Locations use one-based
  lines and Unicode-scalar columns. Only proven direct ordinary literals receive
  client locations. Selection context also requires the trusted ordinary import
  and a complete single-argument default call. Unsupported, ambiguous or
  bounded-out input uses an unlocated file/slot fallback.

  Never evaluate or reread source, or add an AST, editor or compiler dependency
  to obtain these facts.

### src project slot-graph

- `src/project/slot-graph.ts` supplies the same resource-bounded, acyclic graph
  validation to source linking, retained-lock decoding and dispatch. Dispatch
  caches longest paths per immutable candidate. Repeated routes must not expand
  into repeated dependency-tree traversal.

- Package inspection validates `supports` and `uses.requires` against exact
  named single-form catalogs. Selected-graph qualification pins requirements in
  the lock and refuses incompatible targets before execution preparation,
  propagating only to their dependents. It never selects substitute providers.

- Explicit review `--generate-contracts` owns optional TypeSpec preparation and
  checked publication. Plain review checks local freshness. Run never compiles.
  The compiler is bundled, with Node 22+ selected only from fixed system
  locations or the operator's absolute `JIG_AUTHORING_NODE_PATH`.

### src run channels

- `src/run/channels.ts` owns finite participant-scoped endpoint rights, atomic
  transfer, bounded direct delivery, isolated broadcast subscriptions and source
  lifetime. It is not an event bus or execution scheduler. Package validation
  precedes implicit writer sealing. A writer may declare `LAGGED` on close.
  Check its held rights before recording sticky source failure, settle pending
  sends and preserve earlier clean seals. Producer declarations are observation
  evidence, not execution authority.

### src package capture 2

- `src/package/capture.ts` owns descriptor-confined immutable snapshots. Its
  serial copy traversal reuses one private bounded buffer per attempt. Yielded
  snapshot chunks remain independently owned. Source rechecks and digest gates
  are unchanged by buffer reuse.

- Agent Run resolves to an ordinary Flow through defaults or exact slots. Jig
  retains source admission, resource grants and owned execution, not Agent
  preparation or answer interpretation. Skill content is explicit caller data.
  Consumers independently check dynamic results.

- Optional Codex session retention stays below the ordinary Agent boundary. A
  new receipt requires reviewed grants, exact recipient scope, single-use
  protected history, clean native exit, fencing and cleanup. The opt-in
  `test/live/native-session-restoration.test.ts` uses installed archives and at
  most two subscription model calls with synthetic input.
  `JIG_NATIVE_AGENT_RESTORE=1`, `JIG_RESTORE_ARCHIVES`, `JIG_CODEX_STARTUP_PATH`
  and `JIG_RESTORE_MODEL` select that explicit test. It is separate from the
  deterministic protocol and protected-store tests. Its bounded command helper
  records output incrementally in exclusive evidence files, escalates ignored
  interruption and waits for process exit.

  Retained bytes are not proof of cleanup. Controller fault tests isolate module
  mocks in a subprocess. They prove ordering and scope construction, not kernel
  containment.

## Local Contracts

- `import-contract` copies a validated local invocation/channel bundle into a
  new directory, preserving bytes and relative paths. A direct descriptor path
  or exact `npm:` package name selects the source. `jig:` names select the
  installed standard library, listed by `--list`, with exact closures, digests
  and licenses. These names are authoring selectors, never runtime resolution or
  authority. Package lookup starts at the destination parent and uses the
  nearest installed `node_modules`. Closure descendants must be regular captured
  files.

  It neither acquires an execution host nor fetches, imports package code,
  replaces an existing destination, or grants Run authority.

- Default `init` writes a greeting Flow with a string input and a world
  fallback. `--bare` writes only the skeleton. Neither installs, networks,
  approves, or executes. Generated packages use the same dependency review as
  consumer-authored packages. The optional `--agent` selection writes a declared
  ACP package dependency, an inline native grant in its Binding and a
  contract-keyed default. It chooses no client implicitly and does not inspect
  installations or authentication.

  Check generated package versions against their manifests. The greeting names
  the exact tested SDK version. Its regression checks the SDK manifest so a
  moving npm tag cannot silently select a different wire contract.

- Manifest-policy diagnostics identify a closed cause and JSON field without
  rejected dependency values. Ancestor workspace manifest display paths are
  bounded project-relative locations, not executable or readable file routes.
  Stale-lock diagnostics identify the verified authored lock and working
  directory. They provide a shell-safe repair command.

  Resolution permission does not update supplied locks. Root name/version
  metadata does not select dependencies. Keep member name/version and all
  dependency checks.

- Project `entrypoint` is a target plus optional Run-argument string, retained
  in semantic identity, lock, review and inspection. `run-arguments.ts` owns
  shared CLI validation. `project/entrypoint.ts` owns bounded shell-free
  tokenization, project-relative defaults and explicit-option overrides. Omitted
  `--out` for an approved writable target selects one fresh OS-temporary packet
  destination before owner/delegation reexecution. Result-only omission stays
  stdout-only. Use the read-only retained inventory and admission digest from
  the same snapshot, never source evaluation or example heuristics.

  A private preparation-complete marker preserves both output and no-output
  decisions through all installed owners and main. Existing approval pins cannot
  be replaced. Ordinary anchored validation and no-replace delivery remain
  authoritative. Published temporary packets survive command/inspection exit,
  subject to OS cleanup. Report the exact destination on stderr for explicit and
  default invocations, including redirected stdout. Keep operator paths out of
  browser observation snapshots.

  Explicit targets bypass defaults. Capture job files per Run. Binding resources
  stay pinned. Resolve before delivery/delegation and carry the selected
  admission through reexecution to the submission compare-and-set. Operator
  verification and presentation options cannot be supplied by project defaults.

- Project `defaultProviders` maps contract IDs to exact Flow or Binding targets.
  Explicit slots win. Otherwise review uses the map or the sole structurally
  provisioned exact match. Ambiguity requires a choice, never a
  client-availability heuristic. Retain effective routes in graph, lock, review
  and admission. Execution never consults the authoring map.

- `npm:<package>` selects a declared project dependency's own Flow through
  ordinary contained Bun preparation. Capture source and execution closure.
  Never import its entrypoint into the coordinator or traverse live installation
  links. Grants and settings still belong to its reviewed Binding.

- Binding `attachments` selects project-relative read trees captured at review,
  using the existing portable attachment interface. Retained resources
  participate in review, lock and exact configuration identity. Per-run mappings
  cannot override them. Keep this root-only profile and its bounds synchronized
  with `docs/jig/spec/project-policy.md`.

- Binding slots select inline HTTP, command or finite ACP grants, or optional
  named JSON policies for meaningful reuse or independent management.
  `src/cli-review-agent-setup.ts` renders bounded read-only captured policy
  facts: verified client literals, selection context or honest file/slot
  fallback, known causes, passive executable alternatives and manual recovery.
  It never writes policy, recaptures after an edit or acquires publication
  authority. Put repair and one exact retry before detailed accounting. Default
  output discloses omissions and unchecked resources when present. Complete
  report accounting belongs under `--details`.

  Executable recovery can suggest adding or replacing `--agent` for a detected
  client, with global scope and repeated review explained. Never promise that
  other policies or authentication qualify. Explicit
  `review --agent codex|claude|pi` requires a value and changes only the client
  of every selected normalized ACP policy before qualification. Retain the
  operand in capture identity and ordinary lock `agentOverride`. The strict
  decoder requires nonzero selected ACP policies agreeing with it. Source stays
  unchanged.

  Run uses approved meaning and a later bare review uses source again.
  Cross-client model pins, incompatible retention and no selected ACP policy
  refuse the whole request. Same-client selection still qualifies. Keep other
  fields, authority opt-ins and previous approved code/client together on
  failure. An ACP grant may pin a recipient-specific model. This changes
  approval and runtime identity without changing operator authentication or
  client selection. `docs/jig/spec/grants.md`

  owns capture, reuse and recipient-scoped approval. New or changed delegations
  require explicit authority approval in the same retained plan. Source edits
  cannot mutate active generations. Secrets remain private operator environment
  snapshots. Use ordinary `run.call`.

- Authoring helpers stay inert and guest-realm-only. Full URL/schema checks
  belong to trusted linking, not imports or host constructors inside the
  evaluator.

## Work Guidance

- Agent selection belongs to ordinary dependencies, Bindings and resource
  grants, or an explicitly retained review client operand. Never infer selection
  from credentials or a preferred vendor. Selection remains distinct from
  authority approval. The optional init picker only authors files. Client
  prerequisite errors explain both recovery paths: repair the selected
  installation or edit the slot's inline or named ACP grant. The grant edit
  selects another supported client.

  Both paths require renewed review. Unresolved child Flow errors explain its
  provider or Binding configuration instead of reporting only a machine code.

## Verification

- Package/project path NFC uses pinned Unicode 15.1 canonical decomposition,
  combining classes and composition data, independently of host ICU. Keep case
  folding and normalization at the same contract version. The official
  normalization conformance vectors in
  `test/portable/normalization-15.1.test.ts` and path/workspace-preparation
  tests verify this boundary. Regenerate tables and vectors with
  `scripts/generate-unicode-normalization.py` and its exact hashed Unicode 15.1
  inputs. The generator refuses changed data before writing.
