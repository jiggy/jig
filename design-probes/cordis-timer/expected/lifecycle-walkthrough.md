# Expected Cordis lifecycle

This is a tabletop trace, not runtime output.

## Mount

1. Jig admits the explicit `cordis-delay` Service Binding and starts its Bun
   executable through FLOW Service/1.
2. The provider creates one Cordis root Context.
3. `root.plugin(Timer)` registers the existing `timer` Service.
4. Setup returns the fixed `delay.wait` export and root Fiber disposer.
5. The FLOW SDK reports the exports; Jig validates them, reports ready, and
   waits for cancellation.

No Cordis service object or activation state crosses the FLOW boundary.

## Invoke

1. The Python Run owns one operation calling `delay.wait`.
2. The method creates a Cordis-managed timeout and retains its disposer only in
   the pending Promise closure.
3. The callback removes the abort listener, resolves the method, and lets the
   operation and Run complete.
4. No provider-owned timer state remains.

## Cancel invocation or Mount

Invocation cancellation calls the local timer disposer and rejects that method.
Mount cancellation first closes invocation admission and cancels remaining
methods. The SDK then calls `root.fiber.dispose()`, and FLOW waits for disposal
before the Service process terminates.
