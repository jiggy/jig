# Jig documentation

## Purpose

Owns Jig's current host documentation and its non-normative catalogue of
use-case and orchestration hypotheses.

## Ownership

- `spec/cli-experience.md` owns the mandatory experience contract for all public
  CLI output.

- `spec/` owns current Jig host requirements and machine companions.
- `contracts/` owns explanatory pages served at invocation identity URLs. They
  route readers to specifications, canonical JSON downloads, and usage. They do
  not define interfaces or act as provider endpoints.
- `pricing.md` owns the independent public pricing landing page. It highlights
  free personal use and evaluation, qualifying small businesses under $1M
  revenue, and company prices under a collapsible.
- `index.md` and `guide/` teach implemented behavior and recommended practice,
  with installation prerequisites centralized in `guide/index.md`. Describe
  current behavior, not comparisons with superseded alpha releases.
- `guide/agents.md` owns API and native setup, operator selection, resource
  configuration, installation recovery, review checks, and current adapter
  limits. Setup instructions belong here. Other guides link to the relevant
  setup section. Review readiness and installed-client session qualification
  remain distinct. Neither proves model execution. Exact native selection limits
  belong in `spec/finite-acp.md`.
- `guide/conversations.md` owns the complete two-turn tutorial, expected
  results, and basic recovery. Show all required source before review and
  execution.
- `guide/conversation-control.md` owns interruption, direct channel composition,
  helper errors, and observation loss.
- `guide/conversation-handoff.md` owns application-authorized context transfer
  after predecessor settlement. It does not claim that summaries improve
  answers.
- `guide/conversation-restoration.md` owns native retention, restoration, final
  receipts, one-use references, and lifetime bounds. Published interfaces do not
  establish installed-client qualification. Turn answers are not retention
  receipts.
- `guide/dependencies.md` starts with a complete library example and owns
  dependency preparation guidance. Its workspace
  examples follow `spec/project-policy.md`'s root selection, direct membership,
  and supported lock formats. Stale-lock recovery identifies the authored lock
  and workspace. Resolution permission does not update a supplied lock.
- `guide/configuration.md` owns settings, entrypoint selection, terminal
  appearance, review change notation, and cached, strict, and fast installation
  verification. Keep verification defaults and limits aligned with execution
  policy and `SECURITY.md`. Fast mode does not skip Flow approval or sandbox
  enforcement.
- `guide/limits.md` owns the central task-based limits reference and supported
  override guidance. `scripts/limit-reference.ts` derives its numeric tables from
  implementation policy owners. Keep fixed and derived constraints explicit.
- `guide/files.md` starts with a complete file-copy example and explains
  per-run files, review-pinned Binding resources, and
  their shared read attachment interface. It covers temporary packets for writable
  or declared-artifact-result targets, stdout-only non-file targets, and retained
  destinations. Child composition covers fixed reads, fresh outputs, held
  immutable artifacts, forwarding, and final/checkpoint export.
- `guide/agent-method.md` starts with direct invocation and a complete caller.
  It explains the reusable method's pure library and
  published ordinary Agent Run artifact. It covers reviewed-source adoption,
  explicit caller context, local private response-schema placement and
  independent consumer result validation. Small one-call schemas stay beside
  their calls. Larger or reused schemas use ordinary descriptive files. Managed
  TypeSpec projection ownership remains explicit.
- `guide/contracts.md` teaches optional managed TypeSpec authoring and generated
  file ownership, including named optional feature catalogs.
  `spec/contract-authoring.md` owns its exact host boundaries.
- `guide/markdown.md` teaches one-file methods, supported Skill authoring, exact
  recipes and the installed sequential interpreter's limits.
- `guide/channels.md` teaches application-owned live progress, semantic views,
  captured media, final display bundles and subprocess consumption. `contracts/` also explains named channel agreements. Root and
  package READMEs introduce the product and link to these owners.
- `guide/*.diagram.json` and matching SVGs own explanatory diagrams alongside
  their guides. The shared diagram workflow is in `docs/AGENTS.md`.
- `acknowledgements.md` owns public acknowledgements, separate from the short
  root README. Credit documented work rather than promises or unanswered
  invitations; distinguish completed handovers from unsuccessful recovery
  efforts. Keep thanks concise; use recorded handles and profile links without
  adding preference-confirmation commentary.
- `use-cases.md` records outcome-oriented product hypotheses.
- `orchestration-patterns.md` records candidate reusable methods.

- `guide/results.md` owns execution, application outcome, delivery, cleanup,
  failure diagnosis, and retained-state recovery. It distinguishes saved packets
  from explicitly retained application views. Neither inspection starts execution. Agent setup recovery belongs in `guide/agents.md`. Settings and
  appearance belong in `guide/configuration.md`. The quickstart links to results
  after the first outcome.
- `index.md` and `guide/understand.md` introduce Agent work inside applications
  through the common Flow boundary and Jig's microkernel-inspired
  responsibilities. The landing page follows a suggestion into application
  checks, reveals Jig's execution boundary, and ends at a first run with visible
  prerequisites.
- `guide/contact-import.md` owns the introductory CSV preview walkthrough: code,
  Agent and mixed mappers share one contract, and code validates the rows.
  Its declared preview artifact receives a fresh temporary packet. `--out` retains it.

- `guide/support-case.md` follows contact import with a useful policy decision.
  An Agent proposes a disputed charge. Code checks supplied account records. The
  caller receives eligibility rather than payment authorization. Its result-only
  target returns stdout unless the operator chooses `--out`.
- `guide/tested-patch.md` teaches reproduced failure, proposal, independent
  checks, and final patch evidence for one issue and one specialist.
- `guide/software-factory.md` teaches exact selection between reviewed repair
  configurations by default, optional semantic routing, retained healthy-peer
  evidence, and the human merge gate.

- `guide/overview.md` owns task-based discovery. `guide/for-agents.md` owns
  machine-readable entry paths. `guide/concepts.md` owns introductory vocabulary
  and common questions. These guides defer to the linked exact contracts.
- `guide/teams.md` explains collaboration through shared methods and explicit
  responsibility, without implying a hosted team product.

## Local Contracts

- Feature claims in guides describe only implemented behavior and defer to Jig
  specifications. General design advice must not imply that a future host
  surface is currently available.
- Contract landing pages explain offline identity/version/digest matching and
  keep downloadable descriptors separate from human guidance. Do not turn an
  identity URL into runtime fetching or change descriptor bytes to edit a page.
- Use cases and patterns are research, not commands, APIs, primitives, product
  availability, or roadmap promises.
- Jig should be able to host workflow methods without having to own each one.
  Keep method-specific semantics inside Flows, prompts, skills, graph libraries,
  or specialist packages unless the host must enforce authority or lifecycle.
- Put each concern in its smallest honest layer. These are overlapping design
  dimensions, not mutually exclusive method categories:
  - prompt technique: an Agent instruction, skill, or Flow recipe.
  - graph shape: ordinary Flow or graph-library composition.
  - feedback source: evidence supplied to a check, gate, or loop.
  - specialized optimizer: a reusable Flow or library.
  - recipe: concise runnable guidance using a current public surface.
  - host responsibility: admission, authority, containment, durable lifecycle,
    binding, or approval that Jig must enforce.
  - named pattern: a reusable structure whose boundary prevents a distinct
    failure.
- Add a candidate pattern only when it satisfies every condition below:
  - It addresses a recurring named failure.
  - It has a minimum structure whose removal changes the claim.
  - It is more than an ordinary graph shape.
  - It plausibly transfers to materially different jobs.
  - It states its collapse condition.
  - It defines a falsifiable comparison against the strongest credible simpler
    baseline, including cost and latency.
- Call a pattern supported only when comparative evidence isolates its
  irreducible structure's value from extra calls, tokens, tools, or authority.
  The result must also transfer beyond its originating example.
- Merge or remove a candidate when it collapses into a primitive, established
  method, domain recipe, or implementation brand. Preserve useful negative
  evidence with the relevant use case rather than keeping a dead pattern.
- Use an established name when its semantics fit. Do not rebrand a known
  technique merely because Jig can host it.
- Lesser or adjacent techniques may appear as short primary-source links grouped
  by family when they clarify provenance, mechanism, or selection. Do not write
  local surveys or full briefs merely for completeness.
- Organize probes around workflow families and their distinguishing property,
  not every branded technique. Compare one representative with the strongest
  simpler baseline. A passing probe supports only the tested variant.
- Multi-Agent structure is neither required nor sufficient for pattern status.
- Prefer executable, environmental, independent, or human feedback when it is
  available. Do not call self-critique verification.
- Preserve the current uniform record shape within each catalogue.

## Work Guidance

- Start task guides with prerequisites, one complete example, expected results,
  and recovery. Put optional configuration and exact reference details afterward.
  Name the author or operator when their responsibilities differ.
  Keep authority conditions and failure limits beside the actions they constrain.
  Use ordinary language for consequences and link to exact contract owners.

- The software-factory guide awaits replacement. Exclude it from structural style
  checks until recreation. Restore the check when recreating the guide.
  Link, metadata, and publication checks still apply.

- Keep `pricing.md` persuasive and easy to scan. Place qualifications beside
  claims that determine who pays or what rights persist. Lead with unconditional
  free personal use and evaluation. Introduce small-business eligibility,
  financial thresholds, and purchase terms in the business section. Link to the
  license for edge cases instead of turning the page into legal commentary.
- Keep introductory guides focused on the first useful result. Put optional
  tuning, environment variables, cache internals, and configuration tradeoffs in
  `guide/configuration.md`, reachable through Reference navigation and links.
- First-run file guidance explains that operating-system cleanup may remove
  automatic temporary packets. `--out` chooses a new retained location without
  overwriting an earlier result. Result-only examples do not promise a packet
  when output is omitted.

- Use `sh` fences for shell commands. Reserve `console` for transcripts with
  prompts and output, so command examples receive syntax highlighting.
- Present supported Agent clients as operator choices, not a product ranking. A
  preferred client in the development environment is not a user default.
- Keep the first greeting input simple: a JSON string with one type check and a
  fallback. Keep the generated starter, commands, and before/after results
  aligned throughout the tutorial.
- Start with the user's visible result and the simplest credible alternative.
- Explain an unfamiliar name in one short paragraph before presenting tests,
  topology, prerequisites, or metrics.
- Add structure only when it removes a demonstrated failure or enforces a
  boundary the simpler design cannot.

## Verification

- Check every local anchor and relative link after changing either catalogue.
- Build the Jig site into a fresh directory with `scripts/build-site.sh`.

## Child DOX Index

- [spec/AGENTS.md](spec/AGENTS.md) — Current Jig specifications, machine
  schemas, and exact native invocation contracts.
