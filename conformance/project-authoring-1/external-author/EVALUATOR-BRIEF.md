# Evaluator brief: Project Authoring Probe/1

Evaluate one frozen author submission without editing it or the platform.
Verify the packet root received out of band and the supplied submission
inventory before running code. Use a fresh disposable copy, local sealed
artifacts only, and no network.

## Static rejection gates

Reject a submission containing symlinks, special files, generated dependency
trees, virtual environments, or unexpected imports. Verify the exact required
tree and that `FLOW.md`, schema, and entrypoint files use their specified
case. Run TypeScript checking, Python compile/import checks, and `jig package
check` on both packages.

The release owner compiles every Schema/1 file with Jig's private Schema/1
implementation and gives the reviewer its closed result. Exercise the exact
fixture matrix supplied by the campaign. Confirm
that `normalizer` has no settings seam, while `reviewer` requires exactly the
documented settings.

## Project declaration

The release owner evaluates the actual `jig.ts` and Binding module through the
existing bounded author evaluator and gives the reviewer its closed result.
Independently normalize and schema-check those values. Through the existing
private linker, assert:

- shallow discovery finds exactly the two FLOW packages and one Binding;
- `normalizer` is a direct Run target with empty settings, slots, and
  attachments;
- `reviewer` is not directly eligible because it has a settings schema;
- the `reviewer` Binding supplies exactly its settings and exact
  `normalizer` Flow slot; and
- no undeclared authority, capability, attachment, candidate set, Hook,
  Service, or Agent projection appears.

Private evaluator/linker use is test instrumentation. It is not an API that
the author may import or a public operational Jig claim.

## Run/1 behavior

The release owner runs the Python normalizer with the sealed Python SDK and a
bounded Run/1 host, then supplies the trace and result. Check the exact normal
result, invalid-input rejection
before package code, clean protocol shutdown, and no trailing stdout frames.

The release owner runs the Bun reviewer with the sealed TypeScript SDK and a bounded Run/1 host.
Relay its one exact `flow/call` to a fresh Python normalizer process. Verify
operation ID, slot, intent, input, complete child-result preservation, exact
root result, and bounded termination. Use a 10-second frame bound and
30-second process bound. Also return the exact campaign-specified injected
child failure and confirm it remains an operational failure rather than a
fabricated domain result.

Do not use a private operational Jig host to hide missing public behavior.
The campaign intentionally separates inert project authoring from Run/1
execution.

## Report

Produce `EVALUATION.json` conforming to the campaign-local result schema plus
`EVALUATION.md` containing:

- packet/submission digests and exact commands;
- every passed and failed gate;
- author-only versus evaluator-only surface use;
- any ambiguity or accidental platform knowledge required;
- whether the public authoring surface was sufficient;
- whether the runtime dependency story was understandable; and
- explicit nonclaims: no operational Jig host, Starter quality, Agent,
  Service, Hook, Semantic Choice, or general orchestration conformance.

A missing interface or unclear instruction is a failed/blocked observation.
Do not repair the submission or expand the product while evaluating it.
