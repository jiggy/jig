# Jig specifications

## Purpose

Owns the current Jig host contracts, machine schemas, and exact native
invocation descriptors.

## Ownership

Read each specification affected by a change. Its requirements remain mandatory.
The task maps in CLI experience and project policy route readers through related
sections.

| Specification | Responsibility |
| --- | --- |
| `cli-experience.md` | All public CLI presentation, progress, review, diagnostics, display navigation, interruption, and acceptance requirements |
| `project-policy.md`, `project-sdk.md` | Source capture, preparation, planning, admission, targets, entrypoints, provider selection, root files, and execution policy |
| `web-display.md` | Browser access, bounded transport, navigation, immutable text/image previews, and finite presentation authority |
| `reporting.md` | Optional-port selection, separate CLI allocation, semantic application views, stderr presentation, and qualification |
| `display-archive.md` | Explicit final bundles, atomic presentation retention, original receipts, evidence binding, scoped inspection, and generation checks |
| `agent-run.md` | Explicit Agent values, package claims, feature contracts, channels, conversations, and session receipts |
| `finite-acp.md` | Native grants, credential separation, client selection, bounded lifecycle, retention, and restoration |
| `http-request.md` | Endpoint grants, requests, response decoding, private bearer delivery, and contained-worker settlement |
| `execution-client.md` | Non-dispatching preparation and lookup, exact ticket acceptance, owner/observer roles, scoped cancellation, bounded retention, forgetting, and export without re-execution |
| `project-command.md` | Bounded candidate execution and trusted command evidence collection |
| `project-evaluation.md` | Reviewed Bun/TypeScript evaluation, exact descriptor, closed recipes, and candidate evidence distinct from application acceptance |
| `run-checkpoint.md` | Root-owned latest aggregate retention, held artifact associations, and publication independent of writable root attachments |
| `contract-authoring.md` | Explicit generation, freshness, compiler limits, generated ownership, and publication recovery |
| `grants.md` | Resource policy, capture, recipient identity, reuse, and explicit authority approval |
| `channels.md` | Direct and broadcast support, local limits, and installed NDJSON output |
| `machine/`, `contracts/` | Published machine companions and exact invocation descriptors |

Other prose specifications own the Jig behavior named in their titles. FLOW
specifications own portable package and Run semantics. The reporting descriptor
and scoped libraries belong to `packages/reporting/` and
`packages/jiggy-reporting/`. Rendering packages own presentation. Jig retains
execution authority and authenticated evidence access. Ordinary Agent packages
own prompt preparation, protocol dialogue, and answer interpretation.

Package declarations do not prove native support, grant authority, or establish
execution evidence.

## Local Contracts

- Do not place roadmap features, candidate orchestration patterns, or research
  hypotheses in specifications.
- Keep prose, machine schemas, exact descriptors, implementation, fixtures, and
  tests synchronized.
- A descriptor-byte change must reconcile its documented digest, host allowlist,
  fixtures, lock constants, and published exact bytes.
- Current exclusions must match the implementation and guide claims.
- Execution client examples preserve selected receipt approval, exact tickets,
  conservative dispatch evidence, and original final/checkpoint status.
  Retained allowances, shared attempt quota, live artifact limits, and review
  archives remain distinct. Logical reservations do not promise physical space.
- Child file routes distinguish fixed reads, supplied held artifacts, and fresh
  operation-created outputs. Forwarded artifact results are separate from domain
  results. The original protected attempt owns the latest accepted checkpoint.
- `project-policy.md` owns installation verification modes and their integrity
  limits. `--verification` overrides `JIG_VERIFICATION`. Cached is the installed
  default. Fast may miss changed tool bytes. Agent and CLI contracts reference
  that policy instead of promising unconditional fresh byte checks. FLOW schemas
  and approval authority remain independent.

  Workspace preparation reuse is project-scoped and bound to freshly captured
  installer inputs and current preparation support. Fresh source and authority
  always receive independent execution planning. Sibling Jig projects never
  supply reusable preparations. Keep dependency guidance aligned with that
  scope. Workspace capture prioritizes a qualifying root above the Jig
  application over standalone member declarations. Require direct membership of
  the selected package.

  An application's own patterns cannot expand an outer root's members.
  Dependency lock formats follow the current pinned preparer's readers: version
  1 on Linux and versions 1/2 on Mac, without conversion or source-policy
  relaxation. Keep format refusal distinct from unsupported dependency sources.
- Native restoration specifications remain distinct from installed-client
  qualification and registry support. Retention requires actual clean native
  exit, validated collection, complete fencing and cleanup, and atomic commit. A
  completed answer or forced closure alone cannot establish retained state.

## Work Guidance

- CLI syntax themes and shell selection belong in `cli-experience.md`. Keep
  heading emphasis at least as strong as subordinate details, including expanded
  unavailable-client setup instructions. Keep token styling separate from exact
  review policy and machine output. Field diffs must explain execution-only
  changes without exposing private identities. Detailed review expands the same
  diff with unchanged policy context. Never serialize change bookkeeping as
  human policy YAML.

  Terminal Run presentation and `--json` selection must stay synchronized with
  channel output, project policy, help, and the results guide.

- Specify observable guarantees and explicit limits. Keep private mechanisms
  private unless users must rely on them.

## Verification

- Run the relevant `packages/jig` tests.
- Build the Jig site into a fresh directory with `scripts/build-site.sh`.

## Child DOX Index

- None.
