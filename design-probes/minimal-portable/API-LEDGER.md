# Disposable API ledger

This ledger prevents attractive mock syntax from becoming architecture by
accident. “Candidate” means only that the probe needs to exercise the concept;
it does not freeze a TypeScript spelling.

| Probe surface | User need | Current specification concept | Assumption or open question | Disposition |
|---|---|---|---|---|
| `defineJig({...})` | Return one project desired-state definition. | [`jig.ts` authoring](../../docs/spec/project-policy.md#1-default-project-convention) | Function name and generic typing are unimplemented. | Candidate; keep one root constructor only. |
| `discover("./flows")`, `discover("./bindings")` | Opt into shallow conventional source roots without one helper family per kind. | [Default project convention](../../docs/spec/project-policy.md#1-default-project-convention) | The containing field supplies the member kind; v1 deliberately rejects glob syntax. | Candidate root-source spelling; stable semantics. |
| Omitted `hooks` and optional module fields | Keep an exact project useful without installing unrelated subsystems. | [Project policy §1](../../docs/spec/project-policy.md#1-default-project-convention) makes catalogue, Binding, and Hook sources independently optional. | The current TypeScript frontend shape is not frozen. | Stable behavior; verify ergonomics in the real SDK. |
| `bind({...})` | Author one inert configured use. | [Closed Binding union](../../docs/spec/project-policy.md#2-one-closed-binding-union) | The declaration-only stub models only the package branch needed here. | Candidate; do not generalize from this probe. |
| `use: "./flows/count-text"` | Refer to an installed local FLOW package. | [Project policy §2](../../docs/spec/project-policy.md#2-one-closed-binding-union) resolves local references from the directory containing `jig.ts` and confines them to a configured catalogue snapshot. | String spelling and future source-adapter forms remain frontend choices. | Stable semantics; candidate spelling. |
| Binding `settings` | Configure `minWordLength` or `style` once for one reusable use. | [Schema/1 settings](../../docs/spec/schema-files.md) and Binding normalization. | No defaults, merging, environment fallback, or per-Run overlay. | Stable concept; spelling remains candidate. |
| `jig run <binding> --input <file>` | Start one admitted root Binding with varying input. | [Root Run admission](../../docs/spec/project-policy.md#10-root-run-admission) | CLI spelling is explicitly nonnormative; the frontend owns its retry key. Binding IDs deliberately differ from package names in this probe. | UX candidate only. |
| Cancel Run by durable Run identity | Let a user stop one already admitted owner without exposing a wire request ID. | Run ownership and request-scoped cancellation in [reviewed architecture §5.7](../../docs/design-review/60-reviewed-architecture.md#57-cancellation-and-results). | The required host-local operation and authorization semantics need a focused specification; CLI/module spelling is open. `request/cancel` remains only the FLOW/1 wire consequence. | **Open host API before implementation.** |
| `#!/usr/bin/env python3` and `#!/usr/bin/env deno` | Narrow host Adapter selection without declaring a portable runtime profile. | [Runtime Adapters/1 selector](../../docs/spec/runtime-adapters.md#optional-selector-line) | Tokens are host-local and never executed by the OS. | Stable file convention. |
| `serve(async run => result)` and `run.input` / `run.settings` | Show complete code-backed behavior without hand-writing JSON-RPC. | [Run/1](../../docs/design-review/60-reviewed-architecture.md#5-flow-run1) | `@flow/run` and `flow_run` are hypothetical ordinary native dependencies; SDK names and lock artifacts remain unimplemented. Normal results always contain `output`. | Smallest SDK projection under test, never an extra protocol. |
| `design-api.d.ts`, `design-flow.d.ts` | Type-check hypothetical authoring and TypeScript Run code without implementation packages. | No runtime concept; experiment scaffolding only. | They intentionally omit Services, host capabilities, attachments, Hooks, and bulk recipes. | Delete when real SDKs exist. |
| Omitted `jig.lock` | Let a fresh unlocked project bootstrap without pretending an unfinished serialization exists. | [Project policy §7](../../docs/spec/project-policy.md#7-consent-and-the-lock) permits omission only in unlocked mode and makes the first plan propose it. | Exact serialization remains a focused prerequisite for implementation and public Starters. | Stable bootstrap behavior; byte format remains open. |
| Independent Binding readiness | Keep one exact Flow usable when another runtime is absent on this host. | [Project policy §2.1](../../docs/spec/project-policy.md#21-admission-and-operational-readiness) separates structural admission from operational readiness. | Host machinery changes require a new reviewed generation; Runs never reselect. | Stable lifecycle rule produced by this probe. |
| `expected/*.json` and Markdown walkthroughs | Compare reviewer expectations before an implementation exists. | Eventually derived from conformance fixtures and inspection output. | Shapes are probe-local and marked nonnormative. The probe deliberately avoids inventing a machine event/trace serialization. | Replace rather than preserve. |

## Surfaces deliberately not invented

There is no API here for Agent profiles, semantic routing, Hook callbacks,
Services, graph nodes, runtime commands, sandbox selection, environment
variables, per-Run setting overrides, or fallback behavior. Their absence is
part of the experiment.
