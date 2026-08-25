# FLOW Service SDK/1

**Status:** closed TypeScript/Python API candidate. It projects
[Service/1](service-protocol.md) without exposing JSON-RPC, wire owner IDs,
provider generations, endpoints, bindings, sandboxes, or Jig records.

## 1. TypeScript surface

```ts
import {
  OperationError,
  ServiceError,
  serveService,
  type ServiceDefinition,
} from "@flowmd/sdk";

const service: ServiceDefinition = {
  exports: {
    sessions: async (context) => {
      if (context.method === "read") {
        return { sessionId: "s-1" };
      }
      throw new OperationError("INVALID_INPUT", "unknown method");
    },
  },

  async mount(context) {
    await openStore();
    try {
      await context.ready();
      await context.cancelled;
    } finally {
      await closeStore();
    }
  },
};

await serveService(service);
```

The public types are conceptually:

```ts
interface ServiceDefinition {
  readonly exports: Readonly<Record<string, ServiceExportHandler>>;
  readonly mount: ServiceMountHandler;
}

type ServiceMountHandler = (
  context: ServiceMountContext,
) => Promise<void>;

type ServiceExportHandler = (
  context: ServiceInvocationContext,
) => Promise<JsonValue>;

interface ServiceOwnerContext {
  readonly signal: AbortSignal;
  callFlow(call: FlowCall, options?: CallOptions): Promise<RunResult>;
  callEffect(call: EffectCall, options?: CallOptions): Promise<JsonValue>;
}

interface ServiceMountContext extends ServiceOwnerContext {
  readonly settings: JsonObject;
  readonly attachments: Readonly<Record<string, Attachment>>;
  readonly scratch: string;
  readonly startupDeadlineUnixMs: number;
  readonly cancelled: Promise<void>;
  ready(): Promise<void>;
}

interface ServiceInvocationContext extends ServiceOwnerContext {
  readonly exportName: string;
  readonly method: string;
  readonly input: JsonValue;
  readonly deadlineUnixMs: number;
}
```

`exports` is captured once before protocol input. Its own enumerable keys must
be 1–256 LocalNames and each value must be a function. Inherited keys,
getters, proxies, later mutation, and dynamic registration are not part of the
contract. The SDK snapshots and freezes the map and sends the keys in canonical
order at readiness.

One export handler receives every contract method for that export. Capability
Contract tooling may later generate typed method dispatch, but Service SDK/1
does not add a second runtime registry.

`ready()` may be called exactly once by the mount handler. It resolves only
after the Host acknowledges the exact export set. Invocation handlers cannot
run before that resolution. Returning from `mount` before acknowledged
readiness is `INVALID_RESULT`.

`cancelled` resolves when the Host cancels the pending mount request. The same
observation aborts `signal`. The mount handler uses ordinary `try/finally` for
cleanup; there is no disposer object or hidden callback convention. It may
return voluntarily after readiness to end the complete Service.

## 2. Declared application errors

An export handler returns the successful contract value directly. The SDK
encodes it as `{ value }` after validating FLOW JSON/1.

To return a named error declared by the exact Capability Contract, it throws:

```ts
throw new ServiceError("not-found", { sessionId: "s-1" });
```

`ServiceError` contains `errorName` and required JSON/1 `data`. It becomes the
tagged `{ error: { name, data } }` result. `OperationError` remains reserved for
portable lifecycle/authority/application-validation failures. Other thrown
values become `EXECUTION_FAILED` and are diagnosed only on stderr.

`EffectError` remains the consumer-side projection of a declared error from a
bound dependency. It is not reused for Provider output.

## 3. Ownership and calls

Both mount and invocation contexts expose the same `callFlow` and `callEffect`
ergonomics as Run SDK/1. The SDK privately attributes calls to the context's
wire owner. A context is not transferable ownership:

- calls through the mount context are Mount-background work;
- calls through an invocation context belong to that invocation; and
- cancellation of one invocation aborts only its context and calls.

Returning from an invocation with a live call fails that invocation. Returning
from the mount handler closes new admission, cancels all remaining owners, and
cannot publish mount success until all calls and handlers settle.

An operation ID is stable within its context owner. Reusing its spelling in a
different invocation is legal and names a different operation.

## 4. Python surface

Python uses the same concepts and ordinary naming conventions:

```python
from flowmd_sdk import OperationError, ServiceDefinition, serve_service


async def sessions(context):
    if context.method == "read":
        return {"sessionId": "s-1"}
    raise OperationError("INVALID_INPUT", "unknown method")


async def mount(context):
    await open_store()
    try:
        await context.ready()
        await context.cancelled()
    finally:
        await close_store()


serve_service(ServiceDefinition(
    exports={"sessions": sessions},
    mount=mount,
))
```

`ServiceError`, `ServiceMountContext`, `ServiceInvocationContext`, and their
call methods follow the existing Python Run SDK naming (`call_flow`,
`call_effect`, `operation_id`). Python may use a frozen dataclass or Protocol
for `ServiceDefinition`; that choice does not alter lifecycle behavior.

## 5. Cancellation and terminal arbitration

An invocation context's signal/deadline wins over a handler value unless the
terminal publication was already claimed. Catching cancellation cannot turn a
cancelled invocation into success. Mount cancellation similarly wins over a
normal mount return.

The SDK cancels pending outbound waits, waits for their wire settlement, and
does not detach tasks it created. Language tasks created independently by
application code remain the author's responsibility; if they continue using a
closed context, calls fail `OWNER_CLOSED`. The outer Host and Sandbox Backend
remain responsible for bounded hard termination.

## 6. Deliberate omissions

Service SDK/1 has no:

- dynamic `provide` or `register` method;
- public Mount, Scope, Context hierarchy, generation, lease, or endpoint;
- subscription, callback, stream, or generic handle primitive;
- background-task supervisor or framework lifecycle;
- generated contract client/server surface;
- provider-selected shutdown grace; or
- transparent provider restart or dependency replacement.

Those omissions keep the SDK a direct projection of Service/1 rather than an
application framework.
