# Expected Cordis lifecycle

This is a tabletop trace, not runtime output.

## Mount

1. Jig starts one FLOW Service process with one fixed Journal Binding.
2. The provider creates one Cordis root Context.
3. `root.plugin(Timer)` registers the existing `timer` Service.
4. The local bridge Fiber declares `inject: ["timer"]` and becomes active only
   after the Timer Service is visible.
5. The provider registers its one fixed JSON export and signals ready.

No Cordis service object or activation state crosses the FLOW boundary.

## Invoke and fire

1. The Python caller owns one `service/invoke` for `schedule`.
2. The bridge creates a Cordis-managed timeout and retains its disposer.
3. The invocation returns `{ status: "pending" }` with no owned child work.
4. The native callback later runs within the still-live realm.
5. It creates one Mount-owned `journal.append` operation and tracks its
   promise until terminal, cancelled, or uncertain.
6. Journal commit creates the Event and derived recorder Run atomically.

## Cancel Mount

1. Jig closes invocation admission and cancels the pending Mount request.
2. The provider disposes the root Cordis Fiber.
3. Cordis unwinds the bridge and timer effects; pending native timers clear.
4. FLOW cancellation closes outstanding Mount-owned calls.
5. The provider waits for their terminal evidence and only then returns from
   the Mount handler.

