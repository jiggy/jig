# FLOW documentation

## Purpose

Owns FLOW's independently implementable package, value, process-protocol, SDK,
and capability-contract semantics.

## Ownership

- `spec/` owns normative FLOW specifications and machine companions.
- `index.md` and `guide/` explain and navigate the current portable surface.
- `guide/python.md` owns the Python install and protocol quickstart; SDK
  availability stays independent of any host's language support.
- `guide/*.diagram.json` and matching SVGs own explanatory diagrams alongside
  their guides; the shared diagram workflow is in `docs/AGENTS.md`.
- Admission, containment, permissions, persistence, providers, Agent policy,
  and routing belong to a host such as Jig, not FLOW.

- `index.md` introduces callable methods through the proposal-workshop example;
  `guide/understand.md` develops the Skills bridge, capability compounding, and
  responsibility boundaries. Keep the example host-specific and FLOW independent.
- `guide/start.mdx` routes authors to complete SDK or host tutorials without
  treating a source candidate as a published install. Its native language tabs
  preserve both examples in the generated `/guide/start.md` resource.

- `guide/overview.md` owns task-based discovery; `guide/for-agents.md` owns
  machine-readable entry paths; `guide/concepts.md` owns introductory vocabulary
  and common questions. These guides defer to the linked exact contracts.

## Local Contracts

- Keep FLOW host-neutral. A host example cannot turn a Jig implementation
  choice into a portable requirement.
- FLOW Run/1 owns wire behavior; Run SDK/1 defers to it when they differ.
- Explanatory pages are not a second conformance source.
- The public origin is `https://flow.jig.md`; route changes must reconcile the
  FLOW site navigation, `llms.txt`, and assembly mappings.

## Work Guidance

- Lead introductions with the applications readers can build by composing
  executable methods. Keep stewardship and governance in supporting reference
  material, after the technical value is clear.
- Keep Python installation guidance independent of the current alpha number:
  link to the PyPI project and use `--pre`; exact versions belong in manifests
  and immutable release records.
- Prefer the smallest portable boundary that permits an independent host and
  component to interoperate.

## Verification

- Build the FLOW site into a fresh directory with `scripts/build-site.sh`.

## Child DOX Index

- [spec/AGENTS.md](spec/AGENTS.md) — Normative FLOW specifications and their
  machine-readable schemas and examples.
