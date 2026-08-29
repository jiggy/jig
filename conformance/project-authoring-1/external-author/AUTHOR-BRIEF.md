# Author brief: one small mixed-language Jig project

Build the following complete project in your assigned directory using only the
sealed packet. Do not inspect Jig/FLOW source or invent platform APIs.

```text
project/
├── jig.ts
├── package.json
├── tsconfig.json
├── flows/
│   ├── normalizer/
│   │   ├── FLOW.md
│   │   ├── flow.py
│   │   ├── pyproject.toml
│   │   ├── input.schema.json
│   │   └── result.schema.json
│   └── reviewer/
│       ├── FLOW.md
│       ├── flow.ts
│       ├── package.json
│       ├── input.schema.json
│       ├── settings.schema.json
│       └── result.schema.json
├── bindings/
│   └── reviewer.ts
└── REPORT.md
```

Generated dependency directories, virtual environments, lock caches, and
build output must stay outside both FLOW package trees.

## Project declaration

`jig.ts` discovers the immediate FLOW packages under `./flows` and Binding
declarations under `./bindings` using the documented inert Project Authoring
SDK. It does not enumerate those entries by hand.

## `normalizer`

`normalizer` is a zero-configuration direct Python Run target. Its root input
is exactly:

```json
{ "text": "  Build the smallest correct thing.  " }
```

It trims leading and trailing whitespace and returns exactly:

```json
{
  "outcome": "done",
  "output": { "text": "Build the smallest correct thing." }
}
```

Use `flowmd_sdk.serve`. Provide singleton-precise input and result Schema/1
files: each admits exactly the complete value shown here. Do not add
`settings.schema.json`, capability uses, attachments, or child slots.

## `reviewer`

`reviewer` is a Bun Run package whose complete input is the same object as the
normalizer input. Its complete settings object is:

```json
{ "prefix": "reviewed: " }
```

It calls child-Flow slot `normalizer` exactly once:

```json
{
  "operationId": "normalize:1",
  "slot": "normalizer",
  "intent": "Normalize the text before producing the review label.",
  "input": { "text": "  Build the smallest correct thing.  " }
}
```

On child success, return exactly:

```json
{
  "outcome": "done",
  "output": {
    "label": "reviewed: Build the smallest correct thing.",
    "normalization": {
      "outcome": "done",
      "output": { "text": "Build the smallest correct thing." }
    }
  }
}
```

Preserve the complete child `RunResult` in `normalization`; do not flatten it
or infer success from output alone. Use `@flowmd/sdk` and provide
singleton-precise input, settings, and result Schema/1 files: each admits
exactly the complete value shown here. The Flow package declares no capability
use or attachment. Flow-call slots belong in Binding data, not `FLOW.md`.

## Binding

`bindings/reviewer.ts` configures `./flows/reviewer` with the exact settings
above and one exact slot:

```text
normalizer -> flowRef("./flows/normalizer")
```

It has no attachments and no candidate set. The Python target remains directly
eligible; do not create a hidden Binding for it.

## Native metadata and checks

Declare candidate dependencies by the distribution names and exact versions
listed in `CAMPAIGN.json`. Install only the local sealed artifacts. The packet
does not grant network access after preparation.

Follow the campaign-local `SETUP.md` commands. Run TypeScript checking, Python
bytecode/import checking, and the sealed campaign checker `jig package check`
against both FLOW package directories. Exit 0 prints an informational package
summary; exit 1 means the inert package is invalid; exit 2 means the check was
unavailable or used incorrectly. The checker does not execute package code or
establish runtime readiness. Also import
and exercise the Project Authoring helpers sufficiently to show that the
declarations construct frozen inert values.

The packed Jig candidate does not open, plan, apply, or execute projects. Do
not compensate with a new helper. The evaluator exercises the two Run
implementations through Run/1 separately from the inert project declaration.

## Report

Record in `REPORT.md`:

- every supplied document and public export used;
- commands run and their results;
- choices that were not obvious from the documentation;
- whether the direct-target versus Binding distinction was clear;
- whether the three schema roles and Flow-call slot ownership were clear;
- anything you could not validate with the supplied public surface;
- every workaround; and
- any missing interface that prevented completion.

Surrender the completed tree without changing it; the campaign runner freezes
it with evaluator-only tooling before handoff. Stop and report a blocker if a required operation is
undocumented. Do not add
Agents, Semantic Choice, Hooks, Services, Journal effects, administration,
`projectRunTargets()`, or a platform-specific runtime/sandbox interface.
