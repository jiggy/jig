# Project Command capability

*Status: prerelease implementation candidate.*

Run a reviewed Bun command against an exact supplied project, without giving
the Flow a shell or the candidate access to an Agent provider. The command
returns host-collected output and termination. Application code decides what
that evidence means.

This is a Jig-owned capability carried by ordinary FLOW Run/1 `effect/call`.
It adds no FLOW protocol method or requirement on other hosts. Its exact
[descriptor](https://jig.md/contracts/project-command.capability.json) has ID
`https://jig.md/contracts/project-command`, version `1.0.0`, and digest
`sha256:aed62fe17f01897545f82d7ee91f163a023721431433c8f4f6981b4367c85bcf`.

## Reviewed authority

The Flow declares one companion, alongside Agent Run if needed:

```yaml
uses:
  command:
    contract: ./contracts/project-command.capability.json
```

The operator configures the permitted invocations in a Binding:

```ts
export default defineBinding({
  package: 'flows/repair',
  commands: {
    tests: { test: ['test/project.test.ts'] },
    cli: { run: 'src/cli.ts' },
  },
})
```

`commands` is an optional map of at most eight LocalNames. Each entry contains
exactly one of `run` (one `.ts` or `.js` entrypoint) or `test` (1–16 distinct
`.test.ts`, `.test.js`, `.spec.ts`, or `.spec.js` paths). Paths are canonical
relative ASCII names, at most 256 bytes and 16 components, without traversal,
backslashes, empty components, or shell syntax. The named files must exist
in the supplied candidate. There is no package-script expansion, search path,
shell command, executable selector, environment map, or runtime registry.

Command policy participates in review, the portable lock, admission identity,
and the exact execution recipe. Editing it requires review and admission.
An omitted or empty map grants no command authority. A map on a package which
does not declare this capability is invalid. An otherwise valid unconfigured
command target is unavailable; unrelated targets remain usable.

A root or exact leaf Binding can use its own command policy. Direct `flow:`
targets have no command policy. A child receives neither parent commands nor
attachments. A context may use at most one active operation, whether Agent,
command, or permitted child Flow. Sequential commands are allowed.

## Request

```ts
const evidence = await run.callEffect({
  operationId: 'candidate-tests',
  slot: 'command',
  method: 'run',
  input: {
    command: 'tests',
    files: {
      'src/value.ts': 'export const value = 2',
      'test/project.test.ts': 'import { test, expect } from "bun:test"; import { value } from "../src/value.ts"; test("value", () => expect(value).toBe(2))',
    },
  },
})
```

- `files` is a map of 1–64 paths to Unicode text, totaling at most 256 KiB in
  UTF-8. File/directory collisions and `.git`, `.jig`, or `node_modules` path
  components are invalid. These are candidate bytes, not live host paths.
- Optional `args` supplies at most 32 argument strings, each at most 1,024
  UTF-8 bytes and without NUL. Arguments follow the approved entrypoint and
  do not become Bun options. Test invocations accept no variable arguments.
- Optional `stdin` supplies at most 16 KiB of text. Omission means empty input.
- Unknown fields, unsupported values, absent commands, and exceeded bounds
  fail before candidate execution. No dependency is fetched or repaired.

Jig fixes Bun's runtime and configuration posture, uses the candidate root
as the working directory, and invokes the selected entrypoint or exact test
paths. Dependencies must already be source-local or supported Bun/Node built-ins.
The capability does not run the Flow package's prepared dependencies.

## Evidence

The SDK returns one value containing:

| Field | Meaning |
| --- | --- |
| `candidateDigest` | SHA-256 of the canonical JSON/1 `files` map, prefixed `sha256:`. No trailing newline is hashed. |
| `command`, `invocation` | Selected policy name and logical argument vector beginning with `bun`; no host paths. |
| `stdinDigest` | SHA-256 of the UTF-8 stdin bytes, prefixed `sha256:`. |
| `stdout`, `stderr` | `{text, truncated}` for the first 64 KiB of each stream. The collector drains the rest. |
| `exitCode`, `signal` | Actual collected termination, with unavailable alternatives represented by `null`. |
| `stopReason` | `exited`, `deadline`, or `cancelled`. |
| `cleanup` | `complete`, only after confirmed whole-tree fencing and owned-resource release. |

Output is decoded as UTF-8 with replacement for invalid or cut-off sequences;
it is not a lossless binary channel. Truncation means the retained prefix is
not complete evidence. Collected text remains untrusted candidate output.

A completed command, including a nonzero exit or process signal, is a
successful effect carrying process evidence—not a successful repair.
Cancellation and deadline expiry are operational failures; collected evidence
may appear at `details.command` when available. Missing evidence is never
invented. The method declares no application-error variants.

Host collection establishes what the process emitted and how it terminated.
It does not establish that repository tests ran honestly: imported candidate
code can interfere with their runner. Independent application assertions must
inspect captured behavior without importing candidate source or accepting its
own `passed` flag. Finite successful assertions do not prove general correctness.

## Execution and lifetime

Each command has its own completed rootless containment envelope before code
starts: immutable candidate text, installed runtime only, isolated network,
no credentials, no ambient PATH, no writable cgroup controls, and bounded
scratch. Source cannot be edited during the invocation. A subsequent candidate
is a new request with its own identity, not mutation of a running workspace.

The private trusted collector remains outside the candidate envelope. The
command has at most ten seconds, additionally bounded by the containing child
and root deadlines, with the current 256 MiB, 64-task, and half-core envelope
ceilings. These are per-envelope limits, not a claim of run-wide scheduling.

Jig records ownership before dispatch. Cancellation, parent settlement, and
coordinator loss fence all owned descendants before release. Independent
supervision survives coordinator failure; later recovery closes retained
ownership without redispatch. Cleanup failure cannot become `cleanup: complete`.
An uncertain command is not retried automatically. Run/1 operation identity
and exact-replay conflict rules apply.

No writable repository, native Agent workspace tools, shell service, package
installation, credentials, arbitrary network, or detached job is authorized
by this capability. It returns observations; the application owns patch policy,
acceptance, and the human decision to apply or merge.
