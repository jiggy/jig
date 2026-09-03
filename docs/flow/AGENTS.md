# FLOW documentation

## Purpose

Owns FLOW's independently implementable package, value, process-protocol, SDK,
and capability-contract semantics.

## Ownership

- `spec/` owns normative FLOW specifications and machine companions.
- `index.md` and `guide/` explain and navigate the current portable surface.
- Admission, containment, permissions, persistence, providers, Agent policy,
  and routing belong to a host such as Jig, not FLOW.

## Local Contracts

- Keep FLOW host-neutral. A host example cannot turn a Jig implementation
  choice into a portable requirement.
- FLOW Run/1 owns wire behavior; Run SDK/1 defers to it when they differ.
- Explanatory pages are not a second conformance source.
- The public origin is `https://flow.jig.md`; route changes must reconcile the
  FLOW site navigation, `llms.txt`, and assembly mappings.

## Work Guidance

- Prefer the smallest portable boundary that permits an independent host and
  component to interoperate.

## Verification

- Build the FLOW site into a fresh directory with `scripts/build-site.sh`.

## Child DOX Index

- [spec/AGENTS.md](spec/AGENTS.md) — Normative FLOW specifications and their
  machine-readable schemas and examples.
