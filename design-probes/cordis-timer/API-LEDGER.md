# Disposable API ledger

| Probe surface | Need | Specification concept | Pressure exposed | Disposition |
|---|---|---|---|---|
| `new Context()` | Own one foreign runtime realm. | Runner-private implementation. | Jig must not mirror Cordis Context. | Private dependency code. |
| `root.plugin(Timer)` | Reuse the published component unchanged. | Cordis Fiber lifecycle. | Existing component stays inside realm. | Real Cordis API. |
| Bridge `inject: ["timer"]` | Wait for Timer availability locally. | Cordis dependency injection. | Local reactivity does not require dynamic FLOW Binding snapshots. | Private adapter logic. |
| `ctx.timeout(callback, delay)` | Own native callbacks and cleanup. | Cordis effect/disposer. | Callbacks cannot cross FLOW; root disposal is sufficient. | Private adapter logic. |
| `mount.provide("scheduler", ...)` | Publish bounded JSON methods. | Capability Contract + Service export. | One static interface is sufficient. | Existing FLOW abstraction. |
| `mount.effects.call(...)` in callback | Publish after scheduling invocation returns. | Mount-background effect ownership. | Later callback work must not be misattributed to the caller. | Existing corrected SDK projection. |
| Root Fiber `dispose()` | Clear timers on Mount cancellation. | Mount cleanup. | No Cordis-specific host cleanup method needed. | Private adapter logic. |
| Exact npm dependencies | Reuse a real component revision. | Native dependency metadata and lock. | FLOW does not own Cordis versions. | Existing Runtime Adapter rule. |

## Deliberately absent

There is no `service/bindings`, post-readiness export update, serialized
disposer, timer handle, callback capability, Cordis contract, Cordis-aware Jig
module, DSH compatibility layer, Service migration, persistent schedule, or
transparent restart.

