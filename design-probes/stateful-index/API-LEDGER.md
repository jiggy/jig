# Disposable API ledger

This ledger distinguishes stable semantics from probe-only spelling.

| Probe surface | User need | Specification concept | Pressure exposed | Disposition |
|---|---|---|---|---|
| `discover("./...")` | Opt into conventional shallow project sources. | Project policy source capture. | No new discovery form is needed. | Reuse existing candidate spelling. |
| `bindingRef("document-index")` | Reuse one exact configured Service. | Immutable Binding reference. | Three consumers need distinct Run Bindings but one provider Binding. | Stable semantics. |
| Imported `@jig/journal#append` | Give a portable custom producer exact Event authority. | Host-capability Binding plus Journal contract. | This Binding is real application authority, unlike the removed Hook-owned watcher glue. | Stable semantics; module spelling hypothetical. |
| `event(bindingRef(...), type)` | React to one exact Service producer. | Hook Event-selector source. | Complements the owned Event Source form. | Stable semantics. |
| `serveService`, `mount.provide`, `mount.ready` | Expose one fixed capability set for one pending Service lifetime. | Service/1 mount and first complete status snapshot. | The probe needs no public Mount handle or lifecycle callback. | Stable semantics; SDK spelling open. |
| `mount.effects` | Drain a persistent outbox during startup. | Mount-background effect ownership. | Background recovery must not be attributed to a consumer invocation. | Stable need; SDK spelling open. |
| handler `invocation.effects` | Attribute `journal.append` caused by `upsert` to that invocation. | Service invocation child ownership and dependency revision. | The previous one-argument Service handler sketch was insufficient. | **Required SDK projection; no public Scope object.** |
| Atomic JSON snapshot plus outbox | Couple local state intent and eventual publication. | Provider implementation over ordinary attachment and effect calls. | Jig cannot atomically commit arbitrary provider files with its Journal. | Application pattern, not Jig primitive. |
| Separate read/write contracts | Give ingestion mutation authority without granting it to search/audit. | Existing Capability Contract exports. | Splitting at an authority boundary avoids a method-filter DSL; readers still receive the complete read interface. | Preferred existing abstraction. |
| Exact contract copies in independent packages | Establish strict provider/consumer compatibility. | Capability Contract/1 exact triple. | Repetition is visible and intentionally tests whether tooling, not another manifest abstraction, should help. | Keep until probe review. |
| Stop-then-start writable replacement | Prevent concurrent writers to one attachment. | Binding drain, fencing, and write lease. | Generic shadow-first rollout contradicts exclusive writable authority. | Normative correction accepted; exact API remains internal. |
| Bun and Python selector lines | Exercise preferred future probe runtimes. | Runtime Adapter token. | No runtime profile or project Backend choice is needed. | Stable semantics. |

## Surfaces deliberately absent

There is no Agent, Session, Spindle graph, Semantic Choice, dynamic Service
Binding update, public Mount handle, callback, subscription, replay API,
cross-provider transaction, automatic invocation retry, Service migration
method, or project-selected Sandbox Backend.
