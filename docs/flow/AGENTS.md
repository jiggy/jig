# FLOW documentation

## Purpose

Owns FLOW's independently implementable package, value, process-protocol, SDK,
and invocation-contract semantics.

## Ownership

- `spec/` owns normative FLOW specifications and machine companions.
- `index.md` and `guide/` explain and navigate the current portable surface.
- `guide/python.md` and `guide/typescript.md` own SDK installation and local
  protocol tutorials; `guide/runtimes.md` owns the language and runtime support
  matrix and new SDK implementation guidance; SDK availability stays independent
  of host support.
- `guide/markdown.md` owns Markdown authoring, composition and outcome examples;
  `guide/skills.md` explains current Skill compatibility and execution gaps;
  `guide/platforms.md` owns host and platform integration across ACP and coding agents.
- `guide/*.diagram.json` and matching SVGs own explanatory diagrams alongside
  their guides; the shared diagram workflow is in `docs/AGENTS.md`.
- Admission, containment, permissions, persistence, providers, Agent policy,
  and routing belong to a host such as Jig, not FLOW.

- `index.md` introduces the shared code/Agent composition promise through a
  package explorer: exactly one `FLOW.<suffix>` entrypoint, alternative Markdown
  or code implementations, host-supported runtimes, ordinary invocation, and
  optional metadata and an invocation contract.
  Its progressive disclosure describes package layers, not automatic Agent
  context loading. `guide/understand.md` develops the same boundary through
  request triage on Jig. Keep host examples distinct from portable requirements.
- `guide/start.mdx` routes authors to complete SDK or host tutorials without
  treating a source candidate as a published install. Its native language tabs
  preserve both examples in the generated `/guide/start.md` resource.

- `guide/overview.md` owns task-based discovery; `guide/for-agents.md` owns
  machine-readable entry paths; `guide/concepts.md` owns introductory vocabulary
  and common questions. These guides defer to the linked exact contracts.

## Local Contracts

- Keep FLOW host-neutral. A host example cannot turn a Jig implementation
  choice into a portable requirement.
- Present Jig by the same support and evidence criteria as other FLOW hosts.
  Adopter cards explain capabilities without assuming a shared project history;
  stewardship information remains in its own supporting material.
- FLOW Run/0 owns wire behavior; Run SDK/0 defers to it when they differ.
- Explanatory pages are not a second conformance source.
- The public origin is `https://flow.jig.md`; route changes must reconcile the
  FLOW site navigation, `llms.txt`, and assembly mappings.

## Work Guidance

- Lead introductions with the applications readers can build by composing
  executable methods. Keep stewardship and governance in supporting reference
  material, after the technical value is clear.
- Make public-alpha status prominent and concise: specifications and APIs may
  change, and early users can help shape them. Avoid lengthy compatibility
  declarations in introductory copy.
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
