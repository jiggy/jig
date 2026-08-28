# Private Service-hosting checkpoint

**Status:** closed on 2026-08-28 as one private hosting and durable-ownership
proof. This checkpoint does not claim a Root-to-Service invocation path, a
complete Service/1 Host conformance label, a public Service controller, or a
provider/runtime/sandbox SPI.

## 1. Earned boundary

The repository now proves the two sides needed before a real Service consumer
can be connected:

```text
portable Service side
    Service/1 wire + TypeScript/Python Provider SDKs
    -> real stateful counter process across sequential invocations

private Jig ownership side
    admitted exact Bun Service Binding
    -> one real contained and acknowledged Mount
    -> durable generation, lease, invocation, dispatch, terminal and closure
    -> fenced recovery and ordered release
```

Those sides deliberately remain unjoined. The private direct-Run planner does
not yet admit the capability-backed Binding which a root `effect/call` would
need to reach a Service export. Directly submitting a Service target as a root
Run also remains an exact refusal. Building a live invocation controller at
this point would therefore create unreachable machinery or require an
unreviewed widening of mixed effect dispatch.

## 2. Real Mount lifecycle

One exact admitted Bun Service package now runs inside the same private Linux
cgroup-v2/Bubblewrap envelope as a Run. Trusted code durably records, in
order:

```text
Mount allocation
    -> package and owner-state plan
    -> retained package backing
    -> sealed sandbox owner
    -> race-free prepared process
    -> provisional generation at service/ready
    -> flushed readiness acknowledgement
    -> acknowledged generation admission
    -> terminal classification
    -> complete Backend fence
    -> package and owner-state release
    -> Mount closure
```

The Provider sees none of those host identities or controls. A second start
for the same admitted Binding/generation cannot acquire startup ownership.
Host lifetime, voluntary exit, startup cancellation, readiness timeout,
Provider loss, and coordinator loss remain distinct classifications. Recovery
receives no recipe and never restarts or replaces a Provider. Normal and
recovered closure waits for the confirmed whole-tree fence before release and
leaves no cgroup, private-device, package-materialization, or owner-state
residue.

## 3. Durable invocation ownership

The private activation store separately proves one exact chain:

```text
acknowledged provider generation
    -> owner Run + effect slot lease
    -> owner Run + operation ID invocation allocation
    -> possible-dispatch admission before the first Provider request byte
    -> validated terminal observation
    -> operation closure
    -> lease release
    -> Mount release and closure
```

Allocation fixes the exact generation, export, method, canonical input, and
host-owned deadline. Same-operation replay is byte-exact; changed reuse is
`OPERATION_CONFLICT`. The readiness acknowledgement is the admission boundary:
no lease or invocation can open before it is durably complete.

The Service Host session exposes a pre-write gate, so a durable dispatch fact
can be committed immediately before the first `service/invoke` frame byte.
Durable terminal and closure records are correlated to that exact fact. On a
confirmed Mount fence, an allocation with no dispatch record closes as
host-prewrite `UNAVAILABLE`; a possibly dispatched invocation without a
trusted terminal closes as provider-loss `UNCERTAIN`. Neither path redispatches
work or transparently rebinds the owner. Mount release requires the complete
sorted set of linked lease releases, and lease release requires the complete
sorted set of invocation closures.

Strict reload recomputes identities and rejects corrupt or cross-linked Mount,
generation, lease, invocation, dispatch, terminal, closure, fence, and release
evidence. The durable state is therefore ready to be consumed by a later live
dispatcher without defining that dispatcher's public shape in advance.

## 4. What is not proved

This checkpoint does not prove:

- a root Flow calling the stateful counter through `effect/call`;
- Root A receiving `1`, replay receiving `1`, and Root B receiving `2` through
  the contained acknowledged generation;
- a controller which joins one live Service session to the durable invocation
  allocation/dispatch/terminal records;
- Service dependencies, project-wide startup ordering, automatic restart,
  shadow replacement, migration, or transparent rebinding;
- a portable Host-under-test corpus or a second independent Service Host; or
- a public Service host, controller, provider registry, Runtime Adapter, or
  Sandbox Backend interface.

Service/1 remains a separate conformance target, and its Provider SDK
candidates remain useful at this boundary. Run/1 does not wait for full
Service conformance.

## 5. Next valid seam

The selected next product slice is the private Plan/2 local control plane in
[`150-private-project-admission-frontier.md`](150-private-project-admission-frontier.md).
A later mixed-effect composition slice may admit one exact Service export from
an already admitted root Binding, then complete the counter witness using this
unchanged ownership substrate. That later slice must not add Service methods
to Root Administration, let the package select a Provider generation, replay
possibly dispatched work, or infer a public SPI from this one mechanism.
