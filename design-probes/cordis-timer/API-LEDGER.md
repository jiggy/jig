# Disposable API ledger

| Probe surface | Need | Status | Design pressure |
|---|---|---|---|
| `new Context()` | Own one foreign runtime realm. | Real Cordis API. | Jig must not mirror Cordis Context. |
| `root.plugin(Timer)` | Reuse the published component unchanged. | Real Cordis API. | Timer activation stays inside the realm. |
| `root.timeout(callback, delay)` | Own a native timer and disposer. | Real Cordis API. | Callback and disposer cannot cross FLOW. |
| `root.fiber.dispose()` | Unwind all realm effects. | Real Cordis API. | Scope cancellation needs no Cordis-specific host method. |
| `serveService(setup => ServiceDefinition)` | Expose fixed methods and one disposer. | Shared candidate `@flowmd/sdk` projection of reviewed Service/1 semantics. | The SDK, not every wrapper, owns ready/wait/cancel ceremony; the wrapper needs no Mount plumbing. |
| `serve_run(handler)` | Serve a Python FLOW Run. | Candidate `flowmd_sdk` projection of Run/1. | PyPI distribution is `flowmd-sdk`; the import is concrete and intentional. |
| `run.effects.call(...)` | Invoke `delay.wait`. | Existing FLOW effect seam. | The consumer sees only its local slot and contract method. |
| Two explicit Bindings | Activate a Service and fill a consumer dependency. | Existing Jig policy. | Neither case qualifies for a zero-configuration default Binding. |

## Deliberately absent

There is no bridge plugin, Journal provider, Hook, Event, timer ID, timer map,
settings schema, scheduler state, callback capability, dynamic export,
Cordis-aware Jig module, DSH compatibility layer, Service migration, persistent
schedule, transparent restart, or generic `grants` object.
