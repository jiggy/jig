# Agent context experiment

## Purpose

Test whether textual relationship representations improve understanding of Jig applications.

## Ownership

Owns the audited support-case source packet, equivalent renderers, and bounded provider screening harness.
Product CLI, admission, and runtime behavior remain outside this experiment.

## Local Contracts

- Treat the packet as maintainer-interpreted source, without admission or execution claims.
- Verify every source hash and quote before rendering or evaluation.
- Give each representation the same facts, source anchors, questions, and edit task.
- Preserve bounded credential-screened response bodies, failed requests, usage, and protocol corrections under `.tmp/`.
- Keep response-schema validity separate from answer omissions and edit validity. Derive provider/model coverage from actual receipts.
- Use only authorized provider capacity with credentials supplied through environment variables.
- Never evaluate provider-generated code. Apply only the exact allowed numeric replacement to original policy source.
- Distinguish screening from independent consumer or general coding-performance evidence.

## Work Guidance

Keep public example source as the only application knowledge supplied to providers.
Record semantic audit and protocol limitations before selecting a representation.

## Verification

Run `node --test scripts/experiments/visual-flows/agent-context.test.mjs`.
The parent directory's test pattern includes these checks in ordinary tooling CI.
Generate representations into a fresh directory with `node scripts/experiments/visual-flows/agent-context/experiment.mjs NEW_DIRECTORY`.
Run the opt-in provider screening with `node scripts/experiments/visual-flows/agent-context/run.mjs NEW_DIRECTORY`.

## Child DOX Index

- None.
