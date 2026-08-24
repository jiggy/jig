# Disposable API ledger

| Probe surface | User need | Existing concept | Pressure exposed | Disposition |
|---|---|---|---|---|
| `openProject(...)` | Let trusted same-user application code address one local Jig project. | Jig host embedding boundary. | The earlier `@jig/client` and self-authored authority object were not earned. | Candidate spelling under `@jigging/jig`; semantics remain open. |
| `runs.start(...)` | Submit GUI work exactly like the CLI. | Root Run admission. | No second web-specific execution path is needed. | Existing semantics. |
| `runs.get(...)` | Render durable status and terminal result. | Run journal/inspection. | `startRun` alone cannot support asynchronous frontends. | Required host-local inspection. |
| `runs.cancel(...)` | Request cancellation safely across HTTP retries. | Owner cancellation and operation idempotency. | Cancellation needs its own client key and does not imply terminal cancellation. | Required host-local control. |
| Bun `serve(...)` | Provide the application HTTP boundary. | Starter/application policy. | Raw network belongs to trusted app code here, not FLOW grants. | Application code, not Jig primitive. |
| Browser polling | Show Run state. | Ordinary HTTP polling. | No Events, callbacks, subscriptions, SSE, or WebSocket are required. | Prefer until measured insufficient. |
| Copied index contracts | Use exact provider/consumer interfaces. | Capability Contract/1. | GUI does not bypass strict service compatibility. | Existing abstraction. |

## Deliberately absent

There is no `GUI.md`, UI Capability Contract, panel registry, slot tree,
browser FLOW runtime, browser Jig credential, portable Journal reader, Service
callback, dynamic Binding, per-Run settings, HTTP Flow, or Jig-managed
application process.
