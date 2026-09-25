# Jig specifications

## Purpose

Owns the current Jig host contracts, machine schemas, and exact native invocation
descriptors.

## Ownership

- `cli-experience.md` owns task presentation, progress, color/plain behavior, actionable failures, section boundaries, secondary emphasis, and CLI acceptance requirements.
  It also owns final failure ordering, concise human packet summaries, Agent
  setup cause/selection locations, and one dependency-network notice per review.
  Interrupted delivery retains confirmed terminal/checkpoint evidence, not
  unfinished final files; cleanup uncertainty and forced termination stay explicit.

- Prose files own Jig-specific admission, project, execution, SDK, and Agent
  invocation behavior.
- `machine/` and `contracts/` contain their assigned published companions.
- FLOW specifications continue to own portable package and Run semantics.
- `agent-run.md` owns the explicit-context Agent method interface. Ordinary
  HTTP and ACP method packages offer it and own answer interpretation. Their
  descriptor-relative channel closures remain exact. Its feature catalog owns
  `events`, `conversation`, and `sessions` behavior; package claims and consumer
  requirements do not establish native support, grants or execution evidence.
  Optional native session
  requests produce retention receipts only in final invocation output, never
  individual conversation-turn replies.
  Unavailable receipts include a closed retention reason without weakening
  collection, storage or cleanup failure rules. Finite ACP projects sanitized
  native warnings separately from answer text and never discards typed errors.
- `contract-authoring.md` owns explicit generation, local freshness, bounded
  compiler operation, output ownership and interrupted-publication recovery.
  Identified single-form authoring may emit the descriptor's `features` map;
  support claims and dependency requirements remain package metadata.
- `grants.md` owns inline/named resource policy, capture and reuse, recipient
  identity and explicit authority approval through the existing plan.
- `project-sdk.md` and `project-policy.md` own the approved string `entrypoint`,
  shared Run grammar, per-option overrides and per-invocation job capture, alongside
  contract-keyed `defaultProviders`,
  sole-match review-time resolution and declared `npm:` package targets.
  Selected feature requirements qualify package support before execution;
  unavailable dependencies affect their consumers, not unrelated targets.
  Authoring and lock schemas mirror selected targets and retained effective
  routes, not mutable runtime lookup or new resource authority.
- `http-request.md` owns exact endpoint policy and requests,
  optional JSON/0 response decoding, explicit byte ceilings above unchanged
  defaults, private bearer delivery and finite contained-worker settlement. Its descriptor
  is a native invocation companion, not a FLOW-wide resource model.
- `finite-acp.md` owns the finite native resource grant, exact request/response
  channel bundle, credential separation and independently enforced dispatch
  and cleanup, including separately authorized bounded native retention,
  single-use restoration and clean-exit receipts. Ordinary packages own Agent
  dialogue and answer interpretation.
- `channels.md` owns Jig's direct/broadcast channel support, local limits and
  installed NDJSON output. `contracts/acp-public-updates.json`
  defines the exact optional Agent update meaning, not raw ACP access.

## Local Contracts

- Do not place roadmap features, candidate orchestration patterns, or research
  hypotheses in specifications.
- Keep prose, machine schemas, exact descriptors, implementation, fixtures,
  and tests synchronized.
- A descriptor-byte change must reconcile its documented digest, host
  allowlist, fixtures, lock constants, and published exact bytes.
- Current exclusions must match the implementation and guide claims.
- `project-policy.md` owns installation verification modes and their integrity
  limits. `--verification` overrides `JIG_VERIFICATION`; cached is the installed
  default. Fast may miss changed tool bytes.
  Agent and CLI contracts reference that policy instead of promising unconditional
  fresh byte checks. FLOW schemas and approval authority remain independent.
  Workspace preparation reuse is project-scoped and bound to freshly captured
  complete inputs plus current execution evidence; sibling Jig projects never
  supply reusable preparations. Keep dependency guidance aligned with that scope.
- Native restoration specifications remain distinct from installed-client
  qualification and registry support. Retention requires actual clean native
  exit, validated collection, complete fencing and cleanup, and atomic commit;
  a completed answer or forced closure alone cannot establish retained state.

## Work Guidance

- CLI syntax themes and shell selection belong in `cli-experience.md`; keep
  heading emphasis at least as strong as subordinate details, including expanded
  unavailable-client setup instructions. Keep
  token styling separate from exact review policy and machine output. Field
  diffs must explain execution-only changes without exposing private identities.
  Detailed review expands the same diff with unchanged policy context; never
  serialize change bookkeeping as human policy YAML.
  Terminal Run presentation and `--json` selection must stay synchronized with
  channel output, project policy, help, and the results guide.

- Specify observable guarantees and explicit limits; keep private mechanisms
  private unless users must rely on them.

## Verification

- Run the relevant `packages/jig` tests.
- Build the Jig site into a fresh directory with `scripts/build-site.sh`.

## Child DOX Index

- None.
