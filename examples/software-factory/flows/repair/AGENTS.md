# Factory repair specialist

## Purpose

Turn one captured factory issue into a checked patch proposal under the
operator's fixed commands and application-owned acceptance cases.

## Ownership

- `policy.ts` validates bounded source, editable paths, and Agent proposals.
- `repair.ts` owns baseline reproduction, at most two proposals, command calls,
  and outcome evidence. Call intents distinguish baseline checks from each
  numbered proposal; returned calls never establish check acceptance.
- `evidence.ts` evaluates collected command output against unchanged cases.
- `progress.ts` owns the closed application-local progress shape and bounded
  worker reports of check facts and procedural next steps. The `./progress`
  manifest export lets the factory consume this shape as a declared dependency.
- `FLOW.*`, `settings.schema.json`, and `contracts/` declare the portable method
  and its Agent and command boundaries.

## Local Contracts

- The optional `progress` channel reports observed phases, proposal numbers,
  logical command/case starts, check aggregates and structural rejection causes.
  Actual invocation text follows collected command evidence; no raw logs, stdin
  or model reasoning are projected. It cannot establish acceptance or alter
  command evidence; close it on every terminal path. Final blocked reasons retain
  the last structural rejection or failed-check facts even without observation.
- The factory's two Bindings select `maxProposals: 1` or `2`; both use the same
  reviewed commands and acceptance policy. A second proposal is allowed only
  after observed failure and within the same bounded repair call.
- Candidate text can replace only selected source files. Original input and
  acceptance cases stay fixed, and no proposal applies or merges a patch.
- Agent judgment and command output remain evidence, not authority to change
  grants or declare success without independent checks.
- Operational errors retain method evidence plus supplied collaborator details
  under `operationDetails`, plus the observed baseline/proposal/check stage and
  current proposal number. This evidence comes from execution, independently of
  optional progress delivery; never flatten or invent command verdicts.

- `dashboard.ts` owns optional standalone Repair and Checks views on the
  canonical `updates` channel. Their command verdicts stay provisional for callers;
  call references name only this publisher’s operations. The private `progress`
  protocol and factory relay remain separate.

## Work Guidance

- Keep this Flow editable and fully owned by the software-factory project.
  Use its public Flow and Agent dependencies without importing another example.

## Verification

- `bun test examples/software-factory/test` covers both configurations,
  rejection paths, routing integration, and application evidence checks.

## Child DOX Index

- None.
