# Saturday kitchen roster

## Purpose

Make Agent preferences useful under checked availability and workload rules,
with focused, independently callable Flows and a visible CSV result.

## Ownership

- `flows/roster` coordinates reading, proposing, checking and exporting. It owns
  the continuously updated application page and checks each child result before
  continuing. `view.ts` projects coordinator state into portable sections, four
  shift summaries, volunteer workload and the exported CSV reference.
- `flows/read-roster` reads one bounded `scenario.json` from its read attachment,
  validates the scenario and reports any role with no eligible volunteer.
- `flows/propose-roster` receives scenario data, calls one configured Agent and
  returns a provisional proposal. Its pure `interpretProposal` checks returned
  data and bounds stopped reasons. It has no attachments.
- `flows/check-roster` independently validates the scenario and complete proposal,
  owns hard scheduling policy and derives rows from supplied facts.
- `flows/export-roster` formats eight supplied rows and exclusively writes one
  CSV. It owns formatting checks, not scheduling policy or Agent judgment.
- `bindings` and `jig.ts` own reviewed routes, static file maps, the editable
  inline ACP grant and complete default entrypoint.
- `fixtures` contains feasible and visibly uncovered synthetic Saturdays.
- `test` owns application/contract checks. `README.md` owns public
  instructions.

## Local Contracts

- Scope: six volunteers, four Saturday shifts, cook/serve roles, one proposal and
  a checked CSV. No calendar, messages, solver, negotiation, retries or optimality.
- Minute intervals are half-open within one day. Cover both roles in every
  shift exactly once. Check known IDs, qualifications, full availability,
  overlaps and total minutes. Preferences are soft and cannot override hard
  constraints.
- The root has only read-only `source`. Check complete assignments before calling
  the exporter with `attachments.files.create: true`, authorized by its reviewed
  Binding. Require the returned `artifacts.files` grant and forward it as
  `artifactResults.schedule`. The exporter creates `roster.csv` exclusively.
  Root views reference attachment `schedule`, path `roster.csv`.
- Declare every nonstandard stopped outcome in the Flow contract, separately
  from its result schema. Obvious uncovered roles, Agent abstention and Agent
  limits remain explicit stopped outcomes. An invalid proposal returns
  `blocked` with its violated rule. It never becomes a partial roster.

  Programming, I/O and cancellation failures remain distinct. Trim Agent stop
  explanations and clip them to 240 Unicode scalars with an ellipsis. Only
  missing or empty explanations fail validation.
- Every Flow offers optional views via `@jigging/reporting` and carries the exact
  licensed `jig:reporting` descriptor. Views stay provisional until the final
  application/host result. No cross-Flow implementation imports.
- Keep the private Agent shape separate from scheduling validation. Check its
  bounded structured-output profile with the ordinary public Agent method.

## Work Guidance

- Use descriptive names, separate validation steps and readable errors.
  Mechanical formatting stays local. Substantive stages retain their Flow
  boundaries.
- Schema data may repeat at independent boundaries. Do not import a sibling
  Flow.
- Keep plans, candidate evidence and live Agent results under `.tmp/`.

## Verification

- `bun test examples/kitchen-roster/test` checks real leaves, scheduling policy,
  pure response interpretation, root view projections, exclusive output,
  reporting descriptors and actual Agent response-schema preparation.
- `packages/jig/test/host/installed-kitchen-roster.test.ts` owns installed
  composition with a deterministic public proposal Flow. Native execution
  requires the existing whole-suite opt-in and actual host qualification.
- Injected coordinator and channel substitutes are not qualification.
  Cancellation after proposal, clipped coordinator stops, export failure after
  writes and all-five publisher observations remain unproved native windows.
- An admitted Jig Run is required for host-composition claims. Deterministic
  substitutes and a live Agent run remain distinct evidence.

## Child DOX Index

- None.
