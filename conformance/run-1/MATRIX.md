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
| Trailing output and nonzero exit | Yes | No |
| Legal stderr diagnostics | Yes | Yes |

The current black-box evidence does not yet cover:

- host-side operation joining, replay, and `OPERATION_CONFLICT`;
- defensive host handling of a malicious 65th request;
- deadline, cancellation, result, and forced-kill terminal races;
- unknown or duplicate response IDs across both SDK components;
- call-specific cancellation and abandoned-call quiescence across both SDKs;
- malformed child results and standard JSON-RPC child errors across both SDKs;
- the complete behavioral matrix under a second independent peer;
- total request-ID lifetime bounds; or
- memory amplification at the legal 16 MiB frame limit.

The 64-request test specifies only the wire ceiling. An SDK may queue a 65th
call or reject it locally; Run SDK/1 deliberately does not select one policy.
Short no-frame timeouts are regression evidence, not proof that a frame can
never arrive.

Private package build and clean-install checks live with each SDK. They prove
artifact shape and importability, not publication readiness or stable Run/1
conformance.
