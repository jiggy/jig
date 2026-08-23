# Scenario: two exact Flows, no Agent

## User story

Mira wants a minimal Jig project which can perform two independent pieces of
work:

1. Package `count-text` accepts text and returns a word count. Its exact
   implementation is rooted at `flow.py` and selects a host-local `python3`
   Adapter token.
2. Package `render-summary` accepts an already computed count and returns
   display text. Its exact implementation is rooted at `flow.ts` and selects a
   host-local `deno` Adapter token.

The Flows are intentionally not connected. Composition would add no evidence
to this probe. Mira configures them as Bindings named `count-long-words` and
`compact-summary`, making it visible that a reusable configured use is not the
same identity as its package. She may start either Binding with different Run
input.

## Project-shaped files

```text
minimal-portable/
├── .gitignore
├── jig.ts
├── bindings/
│   ├── compact-summary.ts
│   └── count-long-words.ts
├── flows/
│   ├── count-text/
│   │   ├── FLOW.md
│   │   ├── flow.py
│   │   ├── pyproject.toml
│   │   ├── input.schema.json
│   │   ├── settings.schema.json
│   │   └── result.schema.json
│   └── render-summary/
│       ├── FLOW.md
│       ├── flow.ts
│       ├── deno.json
│       ├── input.schema.json
│       ├── settings.schema.json
│       └── result.schema.json
└── examples/
```

`.jig/` is absent and ignored. Host policy is absent because the operator, not
the project or a Starter, selects trusted Runtime Adapters and a Sandbox
Backend.

## Probe-only harness

```text
minimal-portable/
├── EXPERIMENT.md
├── SCENARIO.md
├── API-LEDGER.md
├── design-api.d.ts           declaration-only scaffolding
├── design-flow.d.ts          hypothetical Run SDK shape
├── tsconfig.json             noEmit authoring check
└── expected/                 nonnormative tabletop fixtures
```

These files review the hypothetical project and are not proposed Jig
conventions.

## Tabletop journey

1. `jig inspect <explicit-package-path>` can read either inert FLOW package
   without evaluating project TypeScript, native manifests, or implementation
   files. With no prior normalized project state, it does not infer `./flows`.
2. `jig check` captures `jig.ts` and both Binding declarations in an
   authority-free configuration evaluator.
3. From that captured project definition, catalogue discovery finds only the
   two immediate child directories which contain exact-case `FLOW.md`.
4. Binding normalization resolves each relative `use` from the directory
   containing `jig.ts`, confirms that it remains confined to the captured
   project and names one configured catalogue member, then validates the
   complete settings object against `settings.schema.json`.
5. `jig plan` deterministically selects host machinery for each Binding. It
   records either one exact staged activation recipe or one exact
   operational-unavailability reason. The recipe pins the Adapter/toolchain,
   preparation plan, launch-planner identity, Backend plans, and authority
   envelope; the concrete launch plan cannot be derived until preparation
   produces its immutable snapshot. The selector token `deno` is an opaque
   local mapping, not a Deno version requirement.
6. The plan presents one aggregate candidate containing both exact package
   revisions, both Bindings, each readiness result, and the semantic and
   authority delta. A fresh unlocked project may have no `jig.lock`; the plan
   proposes its first lock, while `--locked` would reject the omission.
7. Nothing can run until the candidate is explicitly applied. Applying it pins
   one immutable project admission generation, including each Binding's exact
   readiness result.
8. `jig run count-long-words --input examples/count-text.input.json` allocates
   a root Run, pins the admitted Binding/generation, validates its input, and
   uses only the pinned `python3` recipe. It executes package-influenced
   preparation as a separate Backend-supervised child activation, derives the
   concrete launch from that sealed prepared snapshot through the pinned
   planner, validates it against the recipe, and launches the final owner only
   through the pinned Sandbox Backend.
9. `jig run compact-summary --input examples/render-summary.input.json`
   follows the same path with the pinned `deno` recipe.
10. Missing or ambiguous runtime machinery yields an admitted-but-unavailable
    Binding when the package, settings, references, contracts, and authority
    remain valid. It does not block the independent ready Binding, cannot enter
    a Resolver candidate set, and terminates an explicit root Run before
    preparation or spawn. Jig never interprets either Markdown body because
    neither package nor Binding opts into instruction fallback.

The implementation roots now contain complete, small pseudocode against
hypothetical language SDKs. They expose input/settings/result flow, but steps
8–9 remain expected architecture rather than executable demonstrations because
the SDKs, Runtime Adapters, Sandbox Backend, and host do not exist.

## Host matrices to reason through

| Host | Python Flow | TypeScript Flow | Expected project behavior |
|---|---|---|---|
| `python3` and `deno` mappings plus an enforcing Backend | `ADMITTED + READY` | `ADMITTED + READY` | Both use their pinned plans after admission. |
| `python3` only | `ADMITTED + READY` | `ADMITTED + UNAVAILABLE(RUNTIME_UNAVAILABLE)` | `count-long-words` remains usable; an explicit `compact-summary` Run terminates before spawn. |
| `deno` only | `ADMITTED + UNAVAILABLE(RUNTIME_UNAVAILABLE)` | `ADMITTED + READY` | `compact-summary` remains usable; the unavailable Binding is excluded from resolution. |
| Two eligible implementations for one token with no host preference | Depends on token | Depends on token | The affected Binding is admitted with `RUNTIME_AMBIGUOUS`; enumeration order cannot choose. |
| Runtime machinery exists but no conforming Backend exists | `ADMITTED + UNAVAILABLE` | `ADMITTED + UNAVAILABLE` | The exact reason is `SANDBOX_UNAVAILABLE` before package code. |

## Ergonomic acceptance questions

- Can a newcomer identify the two runnable units, their configurable values,
  and their inputs without opening implementation code?
- Does adding the second runtime require only another ordinary Flow directory
  and Binding, with no runtime profile in `FLOW.md` or `jig.ts`?
- Is it clear that settings are configured once in Bindings while input varies
  per Run?
- Can the user see what is pending, active, and host-unavailable without reading
  `.jig/`?
- Can one Binding remain usable when the other lacks local runtime support?
- Does every author-controlled fact have one obvious source of truth?
- Is the project-root base for `use: "./flows/..."` evident in diagnostics and
  editor help, and does moving a Binding file leave its target unchanged?
- Can an unlocked first plan explain that it will create `jig.lock`, while a
  locked operation rejects the missing file without inventing a placeholder?

## Success and falsification

The design passes this probe when two independent reviewers can tabletop the
journey and failures without inventing a new kernel concept, an ambient Agent,
an implicit authority grant, or a second configuration source.

The design fails when common actions require redundant declarations, runtime
selection leaks into project policy, exact execution silently degrades, or the
expected state cannot be explained from ordinary project files plus explicit
host prerequisites.
