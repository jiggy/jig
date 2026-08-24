# Scenario: one portable wait over a realm-local timer

## User story

Mira invokes a Python Flow with a short delay. The Flow calls a Bun FLOW Service
which uses the existing Cordis Timer component. The Run completes after the
Cordis-managed timeout fires.

## Desired tree

```text
cordis-timer/
├── jig.ts
├── package.json
├── bindings/
│   ├── cordis-delay.ts
│   └── wait-on-cordis.ts
└── flows/
    ├── cordis-delay/         Bun Service + real Cordis dependency
    └── wait-on-cordis/       Python Run
```

## Activation

1. Jig resolves the two explicit Bindings and prepares their native packages
   under host Runtime/Sandbox policy.
2. The Service creates one Cordis `Context`, installs the unmodified Timer
   Service, and awaits activation.
3. The setup returns one fixed `delay` export and a disposer to the FLOW SDK.
4. The SDK reports that fixed export set; Jig confirms it against `FLOW.md`,
   acknowledges readiness, and keeps the Service request pending.

## Waiting

1. `wait-on-cordis` calls `delay.wait` under one invocation-owned operation.
2. The Service asks `root.timeout(callback, delayMs)` for a disposer. Neither
   the callback nor disposer crosses FLOW.
3. The method remains pending until the callback resolves it.
4. Cancelling the invocation calls the disposer and rejects the pending method.
5. A normal firing returns `{ "completed": true }`; the Python Run returns the
   same result.

## Disposal and loss

Cancelling the Service Mount first closes invocation admission and cancels
pending invocations, then calls the setup result's disposer. Root Fiber disposal
clears any remaining native timer effects before the Mount terminates.

Process loss fails or makes uncertain every outstanding invocation according to
the ordinary Service/1 operation rules. No timer handle exists to heal.

## Replacement

Replacement drains invocation admission, cancels outstanding waits, disposes
and fences the old provider, then activates a new generation. An invocation is
never moved between generations.
