# Factory repair specialist

## Purpose

Turn one captured factory issue into a checked patch proposal under the
operator's fixed commands and application-owned acceptance cases.

## Ownership

- `policy.ts` validates bounded source, editable paths, and Agent proposals.
- `repair.ts` owns baseline reproduction, at most two proposals, command calls,
  and outcome evidence.
- `evidence.ts` evaluates collected command output against unchanged cases.
- `FLOW.*`, `settings.schema.json`, and `contracts/` declare the portable method
  and its Agent and command boundaries.

## Local Contracts

- The optional `progress` channel reports only observed repair phases and
  proposal numbers. It cannot establish acceptance or alter command evidence;
  close it on every terminal path.
- The factory's two Bindings select `maxProposals: 1` or `2`; both use the same
  reviewed commands and acceptance policy. A second proposal is allowed only
  after observed failure and within the same bounded repair call.
- Candidate text can replace only selected source files. Original input and
  acceptance cases stay fixed, and no proposal applies or merges a patch.
- Agent judgment and command output remain evidence, not authority to change
  grants or declare success without independent checks.

## Work Guidance

- Keep this Flow editable and fully owned by the software-factory project.
  Use its public Flow and Agent dependencies without importing another example.

## Verification

- `bun test examples/software-factory/test` covers both configurations,
  rejection paths, routing integration, and application evidence checks.

## Child DOX Index

- None.
