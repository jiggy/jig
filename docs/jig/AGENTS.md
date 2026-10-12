# Jig documentation

## Purpose

Owns Jig's current host documentation and its non-normative catalogue of
use-case and orchestration hypotheses.

## Ownership

- `spec/cli-experience.md` owns the mandatory experience contract for all public CLI output.

- `spec/` owns current Jig host requirements and machine companions.
- `contracts/` owns explanatory pages served at invocation identity URLs.
  They route readers to specifications, canonical JSON downloads, and usage;
  they do not define interfaces or act as provider endpoints.
- `pricing.md` owns the independent public pricing landing page, highlighting the
  free personal-use and evaluation grants, qualifying small businesses under
  $1M revenue, and company prices under a collapsible.
- `index.md` and `guide/` teach implemented behavior and recommended practice,
  with installation prerequisites centralized in `guide/index.md`. Describe
  current behavior, not comparisons with superseded alpha releases.
- `guide/agents.md` owns ordinary Agent Flow selection, explicit operator
  resource configuration, host-specific installation/helper recovery, and
  current adapter limitations. Setup guidance distinguishes review-only
  prerequisite checks, CLI refusal of any observed selected ACP prerequisite,
  SDK per-target readiness, manual recovery and explicit review-only client
  selection from uncertain native Run failures. Simple native policies are
  inline; named policies earn their separate file through reuse or management.
  Codex installation guidance covers static npm/Volta native selection and
  defers its exact metadata bounds and exclusions to `spec/finite-acp.md`.
  Keep installed-client session qualification limits distinct from successful
  launcher discovery and review; neither proves model execution.
  `guide/conversations.md` owns bounded same-session follow-up and interruption,
  including the distinction between control replies and final settlement, and
  explicit native retention and restoration under a separately reviewed grant.
  It distinguishes final retention receipts from turn answers and published
  interface availability from installed-client qualification, and explains application-owned
  summary handoff.
  `guide/dependencies.md` owns package dependency preparation guidance.
  Keep its workspace examples aligned with `spec/project-policy.md`'s root
  selection, direct membership and supported lock-format rules.
- `guide/configuration.md` owns the settings reference, including terminal
  appearance, operator configuration, and links to authored project settings.
  Its startup verification section teaches operator-selected cached,
  strict and fast installation verification. Keep defaults and tradeoffs aligned
  with execution policy and `SECURITY.md`; never imply fast skips Flow approval
  or sandbox enforcement.
- `guide/files.md` explains per-run files and review-pinned Binding resources,
  their shared read attachment interface, automatic temporary packets for
  writable targets, stdout-only result targets, explicit retained destinations,
  actionable admitted file mappings, retention and static child file mappings.
- `guide/agent-method.md` explains the reusable method's pure library and
  published ordinary Agent Run artifact, reviewed-source adoption, explicit
  caller context, local private response-schema placement and independent
  consumer result validation. Small one-call schemas stay beside their calls;
  larger or reused schemas use ordinary descriptive files. Managed TypeSpec
  projection ownership remains explicit.
- `guide/contracts.md` teaches optional managed TypeSpec authoring and generated
  file ownership, including named optional feature catalogs;
  `spec/contract-authoring.md` owns its exact host boundaries.
- `guide/markdown.md` teaches one-file methods, supported Skill authoring,
  exact recipes and the installed sequential interpreter's limits.
- `guide/channels.md` teaches application-owned live progress and subprocess
  consumption; `contracts/` also explains named channel agreements.
  Root and package READMEs introduce the product and link to these owners.
- `guide/*.diagram.json` and matching SVGs own explanatory diagrams alongside
  their guides; the shared diagram workflow is in `docs/AGENTS.md`.
- `use-cases.md` records outcome-oriented product hypotheses.
- `orchestration-patterns.md` records candidate reusable methods.

- `guide/results.md` owns result interpretation, scripting failures, and
  retained-state recovery, including recorded packet inspection without starting
  execution; the quickstart links to it after the first outcome.
- `index.md` and `guide/understand.md` introduce Agent work inside applications
  through the common Flow boundary and Jig's microkernel-inspired responsibilities.
  The landing page follows a suggestion into application checks, reveals Jig's
  execution boundary, and ends at a first run with visible prerequisites.
- `guide/contact-import.md` owns the introductory CSV preview walkthrough:
  code, Agent and mixed mappers share one contract, and code validates the rows.
  Its writable target receives a fresh temporary packet; `--out` retains it.

- `guide/support-case.md` follows contact import with a useful policy decision:
  an Agent proposes a disputed charge, code checks supplied account records,
  and the caller receives eligibility rather than a payment authorization. Its
  result-only target returns stdout unless the operator chooses `--out`.
- `guide/tested-patch.md` teaches reproduced failure, proposal, independent
  checks, and final patch evidence for one issue and one specialist.
- `guide/software-factory.md` teaches exact selection between reviewed
  repair configurations by default, optional semantic routing, retained healthy-peer
  evidence, and the human merge gate.

- `guide/overview.md` owns task-based discovery; `guide/for-agents.md` owns
  machine-readable entry paths; `guide/concepts.md` owns introductory vocabulary
  and common questions. These guides defer to the linked exact contracts.
- `guide/teams.md` explains collaboration through shared methods and explicit
  responsibility, without implying a hosted team product.

## Local Contracts

- Feature claims in guides describe only implemented behavior and defer to
  Jig specifications. General design advice must not imply that a future host
  surface is currently available.
- Contract landing pages explain offline identity/version/digest matching and
  keep downloadable descriptors separate from human guidance. Do not turn an
  identity URL into runtime fetching or change descriptor bytes to edit a page.
- Use cases and patterns are research, not commands, APIs, primitives, product
  availability, or roadmap promises.
- Jig should be able to host workflow methods without having to own each one.
  Keep method-specific semantics inside Flows, prompts, skills, graph
  libraries, or specialist packages unless the host must enforce authority or
  lifecycle.
- Put each concern in its smallest honest layer. These are overlapping design
  dimensions, not mutually exclusive method categories:
  - prompt technique: an Agent instruction, skill, or Flow recipe;
  - graph shape: ordinary Flow or graph-library composition;
  - feedback source: evidence supplied to a check, gate, or loop;
  - specialized optimizer: a reusable Flow or library;
  - recipe: concise runnable guidance using a current public surface;
  - host responsibility: admission, authority, containment, durable
    lifecycle, binding, or approval that Jig must enforce;
  - named pattern: a reusable structure whose boundary prevents a distinct
    failure.
- Add a candidate pattern only when it addresses a recurring named failure,
  has a minimum structure whose removal changes the claim, is more than an
  ordinary graph shape, plausibly transfers to materially different jobs,
  states its collapse condition, and defines a falsifiable comparison against
  the strongest credible simpler baseline, including cost and latency.
- Call a pattern supported only when comparative evidence isolates the value
  of its irreducible structure from extra calls, tokens, tools, or authority,
  and the result transfers beyond its originating example.
- Merge or remove a candidate when it collapses into a primitive, established
  method, domain recipe, or implementation brand. Preserve useful negative
  evidence with the relevant use case rather than keeping a dead pattern.
- Use an established name when its semantics fit. Do not rebrand a known
  technique merely because Jig can host it.
- Lesser or adjacent techniques may appear as short primary-source links
  grouped by family when they clarify provenance, mechanism, or selection.
  Do not write local surveys or full briefs merely for completeness.
- Organize probes around workflow families and their distinguishing property,
  not every branded technique. Compare one representative with the strongest
  simpler baseline. A passing probe supports only the tested variant.
- Multi-Agent structure is neither required nor sufficient for pattern
  status.
- Prefer executable, environmental, independent, or human feedback when it is
  available. Do not call self-critique verification.
- Preserve the current uniform record shape within each catalogue.

## Work Guidance

- Keep `pricing.md` persuasive and easy to scan. Place qualifications beside
  claims that determine who pays or what rights persist. Lead with unconditional
  free personal use and evaluation; introduce small-business eligibility,
  financial thresholds, and purchase terms in the business section. Link to
  the license for edge cases instead of turning the page into legal commentary.
- Keep introductory guides focused on the first useful result. Put optional
  tuning, environment variables, cache internals, and configuration tradeoffs
  in `guide/configuration.md`, reachable through Reference navigation and links.
- First-run file guidance explains that operating-system cleanup may remove
  automatic temporary packets. `--out` chooses a new retained location without
  overwriting an earlier result; result-only examples do not promise a packet
  when output is omitted.

- Use `sh` fences for shell commands; reserve `console` for transcripts with
  prompts and output, so command examples receive syntax highlighting.
- Present supported Agent clients as operator choices, not a product ranking.
  A preferred client in the development environment is not a user default.
- Keep the first greeting input simple: a JSON string with one type check
  and a fallback. Keep the generated starter, commands, and before/after
  results aligned throughout the tutorial.
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
