# Disposable API ledger

| Probe surface | User need | Existing concept | Pressure exposed | Disposition |
|---|---|---|---|---|
| `connectProject(...)` | Let trusted application code address one local Jig project. | Host frontend boundary. | Transport and authentication are host concerns, not FLOW. | Stable need; spelling and transport open. |
| `runs.start(...)` | Submit GUI work exactly like the CLI. | Root Run admission. | No second web-specific execution path is needed. | Existing semantics. |
| `runs.get(...)` | Render durable status and terminal result. | Run journal/inspection. | `startRun` alone cannot support asynchronous frontends. | Required host-local inspection. |
| `runs.cancel(...)` | Request cancellation safely across HTTP retries. | Owner cancellation and operation idempotency. | Cancellation needs its own client key and does not imply terminal cancellation. | Required host-local control. |
| `events.read(...)` | Render application facts incrementally. | Local Journal inspection. | Portable Journal stays append-only; polling avoids a new stream protocol. | Required bounded host-local inspection. |
| Bun `serve(...)` | Provide the application HTTP boundary. | Starter/application policy. | Raw network belongs to trusted app code here, not FLOW grants. | Application code, not Jig primitive. |
| Browser polling | Show near-live facts and Run state. | Ordinary HTTP polling. | No callbacks, subscriptions, SSE, or WebSocket are required. | Prefer until measured insufficient. |
| Copied index contracts | Use exact provider/consumer interfaces. | Capability Contract/1. | GUI does not bypass strict service compatibility. | Existing abstraction. |

## Deliberately absent

There is no `GUI.md`, UI Capability Contract, panel registry, slot tree,
browser FLOW runtime, client credential in JavaScript, portable Journal reader,
Service callback, dynamic Binding, per-Run settings, HTTP Flow, or Jig-managed
application process.

