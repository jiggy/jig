# Authored applications

## Purpose

Teach recommended practices for composing useful portable methods under
operator-held authority through reviewed applications. These are deliberately
authored examples, not independent consumer evidence or promoted Starters.

## Ownership

- `README.md` routes readers through runnable examples by useful outcome.

- Each application owns its domain policy, fixtures, local tests, and exact Flow
  and Binding declarations.
- Public instructions belong in `docs/jig/`. Each code package's `README.md`
  explains its procedure, `FLOW.ts` implements it, `FLOW.meta.json` owns
  optional metadata and slot declarations, and `FLOW.contract.json` owns
  invocation constraints.
- Jig contracts remain owned by `docs/jig/` and `packages/`.
  FLOW owns its specifications, SDKs and conformance in its independent repository.

## Local Contracts

- High modularity is a required example standard. Compose focused, independently
  callable Flows for cohesive workflow capabilities, each with clear inputs,
  results, outcomes and required powers. Examples teach the general Flow
  creation rule in the
  [maintainer guide](../.agents/maintainer-guide.md#create-focused-composable-flows).
  Introductory scope is not an exemption.
- Extract stages with meaningful inputs and results into separate Flows. Do not
  wait for a second consumer or impose a Flow-count ceiling. Keep small
  mechanical helpers as ordinary modules. Splitting a monolith into files alone
  does not demonstrate Flow composition.
- Each example must be independently understandable and usable through public
  FLOW and Jig interfaces. Self-contained means a complete application, not a
  local implementation of every dependency. Do not import host internals.
- Foundational examples keep the demonstrated method local. Composition examples
  may reuse independently maintained FLOW packages through ordinary, explicitly
  versioned public dependencies. Choose by teaching purpose, not code size. Keep
  application wiring, acceptance policy, grants and outcome handling local, and
  explain the external methods' contracts and setup.
- Examples must not import or bind another `examples/<project>/` implementation
  or require a sibling checkout. A root workspace link does not make another
  example part of the project's source or grant its packages authority.
- Use `run.call()` for every declared slot and inspect the complete `RunResult`.
  Copy named native contract bundles with their descriptor-relative channel
  paths intact. Declarations never substitute for native host authority.
- Examples track the current Jig and FLOW source together. Build and test them
  against the current SDK without waiting for npm publication. Do not preserve
  superseded APIs, release-order warnings, or compatibility branches.
- Examples remain ordinary editable source projects with declared dependencies.
  Every example pins published Jig packages to exact current manifest versions.
  Application-local package links use `workspace:*`. `just test-tooling` checks
  the pins, and Bun may substitute matching local packages during repository
  development. Root installation and ordinary SDK builds prepare development.
  Jig captures runtime dependencies during review.

  Use the same dependency preparation as other consumers, not specially bundled
  application archives or per-Flow setup loops. Test unpublished SDK candidates
  separately from claims about registry availability.
- Every implemented Flow offers optional domain views through the public
  reporting package and a complete copied offline descriptor. Keep projections
  inside the owning package. No sibling Flow or host-private imports. The
  coordinator owns a cohesive root landing page showing the application's
  purpose, domain state, progress and stopped reasons.

  Publish accepted results only after domain checks. Child views remain useful
  for inspection and independent invocation. Sections compose the page,
  collections identify work, selection adds context, and typed references lead
  to evidence. Bound complete encoded items and disclose excerpts/totals.

  Use `previewCollection` for explicit whole-row previews. Keep complete selected values and report full counts.
  Stable targets identify captured source or domain requests independently of Run identity.
  Reading views leave the publisher’s one lifetime landing hint for the targeted application page.
  Use gallery roles for images, content blocks for captured files, and literal formats for code and diffs.

  Preserve full results. Reports remain provisional until application checks
  accept them, and blocking failures must be noticed while healthy work
  continues. TUI and web consume the same declarations.
- Agents, models, credentials, and execution policy remain operator choices.
  Agent-using applications choose an ordinary provider by contract or exact
  slot. The operator declares its dependency and configures its resource grants.
  Simple ACP policies live inline in the ordinary Agent Binding's `native` slot.
  Use a named JSON grant for intentionally shared or independently managed
  policy. Discover grants only when selected policies need them.

  Review never edits ACP source. `jig review --agent CLIENT` (`codex`, `claude`,
  or `pi`) proposes one client for every selected ACP policy through normal
  qualification and approval. It preserves turn allowances and refuses
  cross-client model pins or incompatible retention. Source stays unchanged:
  repeat the argument on each review or edit the Binding for a lasting choice. A
  later review without the argument proposes the source clients again. Failed
  review retains the earlier approved client and code.

  Normal Run uses approved choices. A selected unavailable ACP resource stops
  project review, including projects with a ready code entrypoint. Source edits
  never authorize execution. Every example supplies a complete reviewed
  entrypoint without output naming. Writable targets receive fresh temporary
  packets through ordinary host defaults. Result-only targets return stdout
  unless the operator chooses `--out`.

  First-run guidance explains that operating-system cleanup may remove temporary
  packets and `--out` selects a new retained location without overwriting
  results. `tested-patch` includes its `npm:` ACP dependency and editable Agent
  Binding. Do not add a source wrapper or repository-only route around that
  package.
- A small private Agent reply schema belongs beside its call, inline or as a
  local constant. Substantial or reused schemas may use ordinary descriptive
  adjacent files. There is no response-file convention. Preserve explicit
  dialect, the supported response-schema profile, validation and domain checks.
  Each Flow owns its reply schema without sibling-Flow imports. Managed
  projections stay owned by their declaration and explicit regeneration.
- Label synthetic evidence and keep it distinct from claims about real users.

## Work Guidance

- Cookbook code prioritises readability over compactness. Use descriptive names,
  explicit steps and focused validation errors. Avoid single-letter domain names,
  giant mixed validation conditions, nested ternaries and compressed markup.
  Explain why a schema or boundary exists where the reader encounters it.
- Keep Flows small enough to understand as a whole, with one orthogonal
  responsibility. Give each a self-explaining verb-and-object name, narrow inputs
  and an explicit result. Apply the same simplicity to dashboards: project a small
  typed application state through plain functions, with no generic page
  framework or hidden logic.

- Prefer experienced authors and reviewers with full project context. Examples
  should show users how to use the public interfaces well. They do not need the
  fresh-context restrictions that make independent design probes effective.
- The software factory is intended for an independent project, outside the
  cookbook. Preserve its existing source and host checks until extraction is
  complete. Do not expand it as an example.
- Prefer photo organisation as the first new everyday example: visual results
  should make its value immediately clear. Media display gaps belong to the
  shared product, not example-only viewers.
- Keep the portfolio selective. Every example must teach a useful task for
  developers putting intelligence inside software, or make the common code/Agent
  boundary immediately understandable. Delete weak or redundant examples.
  Expected future additions are not a reason to preserve filler.
- Introduce the user's outcome before mechanisms. Progress, channels, and
  multiple Agents do not independently justify a standalone example. Host proof
  fixtures belong with their tests, not in the public portfolio.
- Every example has a scope cap in its local contract: one primary lesson and a
  recognizable task. Include only the concepts and setup needed to teach that
  task honestly. Limit scenario breadth and setup burden, not modular
  decomposition or Flow count. Examples introduce capabilities. They are not
  complete production solutions.
- Keep validation and failure handling required by that lesson. Narrow the task
  if those safeguards exceed its teaching budget. Do not remove the safeguards.
- Before adding a capability, consider an independent example. Extend an
  existing example only when the interaction itself is the lesson. Optional
  modes still consume complexity. Hiding them later in a guide does not remove
  their cost.
- A separate example must earn its own learning payoff. Do not proliferate
  generic demos or preserve old examples just because a capability exists.
- Use a small useful application to expose missing boundaries. Do not add a
  framework, general scheduler, or provider configuration surface here.

## Verification

- Every example declares the current exact Jig version in `engines.jig`.
  Review checks it before evaluating project declarations.
  Keep these pins synchronized through ordinary release generation.

- Review every substantial workflow stage for its own callable responsibility.
  Check that Flow boundaries, contracts, powers and focused tests demonstrate
  high modularity, and verify the complete composed application separately.

- Run `just test-example-source` after workspace setup. It discovers every example,
  installs current frozen packages, evaluates original declarations, bundles
  Flow imports and executes complete application tests. Every example requires
  registered installed-host coverage in `scripts/example-inventory.mjs`.
  Private handoff checks live in
  `packages/jig/test/fixtures/incident-brief/test` and remain in the packed
  release gate. The release gate repeats these application checks against the
  freshly packed SDK.
- `just test-examples` runs one complete first-run case per discovered example
  on the qualified Linux proof host. CI supplies frozen archives, a genuine
  Codex executable and ordinary certificate trust for the controlled HTTPS model.
  Each case preserves original manifests, project declarations, Bindings and
  Flows. It installs dependencies, reviews, runs the authored default invocation,
  and verifies the expected result and delivered files. Missing cases fail.
- Exercise package boundaries through an admitted Jig Run before claiming host
  execution. Unit tests alone establish only application behavior.
- Keep live Agent evidence separate from deterministic substitutes and
  model-quality claims.

## Child DOX Index

- [kitchen-roster/AGENTS.md](kitchen-roster/AGENTS.md) — Volunteer preferences with independently checked scheduling constraints and a CSV export.

- [photo-organiser/AGENTS.md](photo-organiser/AGENTS.md) — Checked photo copies, event grouping and a before-and-after contact sheet.

- [support-case/AGENTS.md](support-case/AGENTS.md) — Agent interpretation of a
  disputed charge, checked by application-owned credit policy.
- [tested-patch/AGENTS.md](tested-patch/AGENTS.md) — A multi-file Bun project
  repair with contained commands and independently checked patch evidence.
- [software-factory/AGENTS.md](software-factory/AGENTS.md) — A bounded two-issue
  factory using exact reviewed method IDs by default or optional semantic
  routing, with checkpoints and a human merge gate.
- [contact-import/AGENTS.md](contact-import/AGENTS.md) — A CSV preview with
  interchangeable code, Agent, and mixed column-mapping methods.
