# Run/1 evidence matrix

**Status:** pre-probe evidence, not a stable conformance label.

| Seam | Bun host peer | Independent Python host peer |
|---|---:|---:|
| JSON/1 positive and negative fixtures | Yes | Representative independent checks |
| Message-schema fixtures | Yes | No |
| Golden full-duplex conversation, TypeScript component | Yes | Yes |
| Golden full-duplex conversation, Python component | Yes | Yes |
| Direction and request/notification form | Yes | No |
| Invalid root params and second root | Yes | No |
| Root cancellation, duplicate cancellation, and wire quiescence | Yes | No |
| Representative fatal frames | Yes | No |
| At most 64 unresolved component requests on wire | Yes | No |
| Reference-host operation join, settled replay, and conflict | Yes | Yes |
| Reference-host rejection of a malicious 65th request | Yes | Yes |
| Unknown and duplicate child-response IDs | Yes | Yes |
| Malformed child result and standard child JSON-RPC error | Yes | Yes |
| Trailing output and nonzero exit | Yes | No |
| Legal stderr diagnostics | Yes | Yes |

The current black-box evidence does not yet cover:

- cancellation of one waiter joined to a shared host operation;
- uncertain host dispatch, persistence, and recovery behavior;
- deadline, cancellation, result, and forced-kill terminal races;
- call-specific cancellation and abandoned-call quiescence across both SDKs;
- the complete behavioral matrix under a second independent peer;
- total request-ID lifetime bounds; or
- memory amplification at the legal 16 MiB frame limit.

The host-operation and malicious-request rows exercise small reference-peer
implementations of the frozen Run/1 rules. They are executable cross-peer
fixtures, not evidence that a production Jig host exists or already conforms.

The 64-request test specifies only the wire ceiling. An SDK may queue a 65th
call or reject it locally; Run SDK/1 deliberately does not select one policy.
Short no-frame timeouts are regression evidence, not proof that a frame can
never arrive.

Private package build and clean-install checks live with each SDK. They prove
artifact shape and importability, not publication readiness or stable Run/1
conformance.
