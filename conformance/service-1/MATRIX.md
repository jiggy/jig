# Service/1 candidate coverage

This matrix maps the twelve required cases in
[`service-protocol.md`](../../docs/spec/service-protocol.md#10-required-conformance-cases)
to current executable evidence. It is a gap ledger, not a conformance label.

| Case | Current evidence | Status |
|---|---|---|
| Mount, readiness, concurrent invocation | Both Provider SDKs under the independent Bun peer; private Host with real TypeScript and Python processes | Covered |
| Invocation before readiness acknowledgement | Both Providers fail fatally | Covered |
| Exact readiness owner/set/order/singularity | Private Host wrong-owner, duplicate, unsorted, mismatched, and second-readiness cases | Covered |
| Mount/invocation ownership and stale/cross-owner calls | Provider matrix plus private Host owner and operation tests | Covered |
| Owner-local operation replay/conflict | Private Host repeated and conflicting operation IDs | Covered for the current no-dispatch Host seam |
| Invocation cancellation isolation | Both Providers and private Host sibling case | Covered |
| Recursive Mount cancellation and cleanup | Both Providers, hostile uncooperative process, and contained Python Mount | Covered |
| Cancellation cannot become success | Both Providers plus Host terminal-race cases | Covered |
| Detached invocation/Mount work | Both Providers wait for wire settlement and reject voluntary abandonment | Covered |
| Capability values, declared errors, and operational failures | Both Providers and private Host process integration | Covered |
| Provider crash and restart identity | Crash before readiness and with a pending invocation are covered; fresh durable generation and no-rebind behavior require the Jig controller | Partial |
| Limits, framing, request errors, cancellation, and terminal races | Exact 64 concurrent and 65,536 lifetime bounds, exact/oversize frames, invalid UTF-8, incomplete/trailing output, malformed cancellation, deadlines, and process exits | Covered |

The remaining release boundary is architectural rather than another wire
message: a durable Jig controller must allocate provider generations, pin
consumer leases, drain or lose them, and never silently move an existing lease
to a restarted Provider. A second independently implemented Host must then run
the same portable Host-under-test scenarios. Until both exist, `Service/1 Host`
and `Service/1 Provider` remain candidate labels.
