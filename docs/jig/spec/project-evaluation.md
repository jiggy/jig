# Project Evaluation native invocation

*Status: prerelease implementation candidate; native and installed qualification
are required before support can be claimed.*

Project Evaluation runs untrusted candidate code in a reviewed, offline,
keyless Bun/TypeScript environment. It complements [Project Command](project-command.md);
it does not replace command grants or provide a shell.

The [exact descriptor](https://jig.md/contracts/project-evaluation/contract.json) uses ID
`https://jig.md/contracts/project-evaluation`, version `0.1.0`. Its digest is
`sha256:34de8dfd2f60e4fd6dfdd884a2acb1deba0e3f8e27191fdc38d05b3e9edd7192`.
The descriptor uses portable Schema/0 length bounds for digest strings; the
native evidence producer separately constructs and verifies exact SHA-256
identities. It does not extend Schema/0 with regular-expression validation.

## Authority and inputs

An explicit `kind: 'evaluation'` grant selects a captured `recipe` directory
and exactly `attachments: { candidate: 'supplied-read', deliverables:
'operation-create' }`. Up to eight evaluation slots may be selected by a Binding;
direct targets cannot borrow authority.

Four inputs remain separate: the untrusted immutable candidate C, operator-reviewed
recipe R, locked development-inclusive dependencies D prepared at review with
scripts disabled, and application-owned independent acceptance A. Candidate tests
are process evidence, not A's verdict.

The recipe contains `evaluation.json`, `package.json`, `bun.lock`,
`tsconfig.json` and captured compiler parents. Its
[closed schema](https://jig.md/schemas/project-evaluation-recipe-1.schema.json) selects optional
generation, mandatory compilation and exact tests, followed by collection from
`generated`, `dist`, and `reports`. There are no arbitrary steps, executable,
shell, environment, network or package-script selectors. TypeScript is exactly
5.7.3 in D, not a FLOW production dependency.

Review captures R beneath the held project-root descriptor, without following
links. R contains only those four files and the selected bounded compiler
parents; unrelated source files are refused. The ordinary package artifact
store retains exact R and development-inclusive D independently. The effective
recipe/compiler, both content identities, and D's exact dependency layout travel
with the granted slot through the lock, candidate and admitted route.
Admission and execution reacquire and authenticate retained bytes; neither
consults the original recipe directory. New candidate iterations do not install
dependencies or recapture R. Editing the recipe directory proposes new review
meaning; it cannot change an existing admission.

## Invocation and evidence

Use ordinary generic call attachments with `input: {}`:

```ts
const result = await run.call({
  operationId: 'evaluate-candidate',
  slot: 'evaluate',
  input: {},
  attachments: { candidate: { read: candidate }, deliverables: { create: true } },
})
```

Held deliverables are returned at `result.artifacts.deliverables`, never inside
domain JSON. Candidate bytes come from the actual held snapshot, not a text map,
host path, serialized capability, or bearer token.

Each candidate receives fresh bounded scopes. Generation writes generated/reports
and scratch, compilation writes dist/scratch, and tests write fresh reports/scratch.
Completed prior outputs are immutable before the next phase. Native descendant
fencing precedes collection and scope release. Cancellation, quota failures and
uncertain cleanup prevent later phases and cannot claim completed cleanup.
Tests receive a fresh `reports` root: its complete tree replaces generation's
reports in deliverables, including when the new tree is empty. Per-phase evidence
still identifies the original generated report files. The combined emitted-file
and byte limits apply before this selection; collection cannot hide overflow.

All phases belong to one logical call and its existing contained-effect owner.
Each native owner derives from the same parent, operation and closed phase
position. Phase intent, sandbox, fence and cleanup are ordered durable facts;
the next phase cannot be admitted before the previous scope is released.
Recovery fences and releases retained phase owners only, never retries a phase,
advances the program or creates another logical operation.

Candidate configuration remains data. Every Bun invocation disables automatic
environment/configuration loading and installation and selects the reviewed
effective compiler configuration explicitly. Candidate `tsconfig.json`,
`bunfig.toml` and `.env` do not select loader policy.

Completed execution returns `done` even when compile or test exits nonzero.
Evidence identifies C/R/D/environment, ordered phases, logical invocations, actual
termination, observed duration, bounded stream prefixes and output manifests.
Domain evidence contains no root ticket or owner IDs. Application acceptance must
check independently interpretable outputs without importing C into its trusted checker.

## Bounds and lifetime

C: 64 files/8 MiB. R: 32 files/4 MiB. D: 8,192 files/128 MiB.
Combined outputs: 64 files/8 MiB, at most 2 MiB per file. Scratch: 512 MiB.
Execution: 512 MiB memory, 64 tasks, half CPU, 60 seconds total with
15/30/15-second phase caps. The containing root deadline always wins.
Each phase retains 64 KiB per stream and drains within a 16 MiB aggregate pipe limit.

The root aggregate remains 1,792 MiB, 576 tasks and 3.5 CPU. Whole-branch
reservations use the reviewed largest effect: 512 MiB for evaluation, 256 MiB
for smaller effects, with a conservative 128-task effect reservation. A four-level
Flow branch plus evaluation fits; five levels do not. No idle-capacity borrowing.

Common operation replay, retained artifacts, admission and cleanup owners remain
the sole lifecycle authority. Recovery fences uncertain phases and never resumes
execution. Recipe, dependency, compiler/plugin/toolchain or authority changes require
review. Runtime installation and repair are forbidden.
