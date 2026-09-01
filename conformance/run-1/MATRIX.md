# Run/1 evidence matrix

**Status:** Phase 1 release-candidate evidence complete; this is not a general
certification programme or a published conformance label.

The Bun and independent Python host peers execute the same black-box component
behaviours through separate framing, validation, and process harnesses. The
scenario manifest is only a review inventory: matching its strings is not
evidence by itself. The rows below refer to the executable tests which exercise
each behaviour.

| Seam | Bun host peer | Independent Python host peer |
|---|---:|---:|
| Complete shared JSON/1 positive and negative fixtures | Yes | Yes |
| Complete shared message-schema fixtures | Yes | Yes |
| Structured `params` envelope rule | Yes | Yes |
| Golden full-duplex conversation, TypeScript component | Yes | Yes |
| Golden full-duplex conversation, Python component | Yes | Yes |
| Direction and request/notification form | Yes | Yes |
| Invalid root params and second root | Yes | Yes |
| Root response then immediate host-stdin half-close | Yes | Yes |
| Root cancellation, duplicate cancellation, and wire quiescence | Yes | Yes |
| Malformed root cancellation | Yes | Yes |
| Call-specific cancellation and late-response tombstone | Yes | Yes |
| Abandoned-call failure and wire quiescence | Yes | Yes |
| Complete shared hostile-frame corpus | Yes | Yes |
| Exact and oversized root frame boundaries | Yes | Yes |
| Exact and oversized component frame boundaries | Yes | Yes |
| At most 64 unresolved component requests on wire | Yes | Yes |
| 65,536-request sender and receiver lifetime boundaries | Yes | Yes |
| Invalid method params consume the receiver lifetime budget | Yes | Yes |
| Request-ID reuse after settlement is fatal | Yes | Yes |
| Operation join, settled replay, and conflict | Yes | Yes |
| Cancellation of one waiter joined to shared work | Yes | Yes |
| `UNCERTAIN` replay without redispatch and fresh-ID recovery | Yes | Yes |
| Unknown and duplicate child-response IDs | Yes | Yes |
| Malformed child result and standard child JSON-RPC error | Yes | Yes |
| Trailing output and nonzero exit | Yes | Yes |
| Legal stderr diagnostics | Yes | Yes |

The operation rows exercise small reference-peer ledgers implementing the
frozen Run/1 rules. They are not evidence that a durable production operation
store exists. In particular, persistence across a host crash remains a Jig
implementation responsibility rather than part of this component-facing
corpus.

Selected terminal orderings are additionally tested against the private Jig
host: result, cancellation, deadline, EOF, root-request and child-response
write rejection, nonzero exit, signal exit, and forced termination each retain
the expected classification in the exercised ordering. These cases are not an
exhaustive proof of every pairwise race. The lightweight peer tests for
pre-response process exit are harness checks, not independent proof of Jig's
classification policy; the private host tests are the authority for those
selected classifications.

The 64-request test specifies only the wire ceiling. The TypeScript SDK rejects
another live call locally; the Python SDK queues additional calling tasks. Both
policies conform because neither emits a 65th unresolved request. The fixed
65,536-request lifetime is separate and common to both SDKs.

The exact 16 MiB frame boundary is a protocol gate. Peak RSS or memory
amplification at that boundary is implementation hardening evidence, not a
portable Run/1 pass/fail rule.

Package build and clean-install checks prove artifact shape and importability.
The Python source-distribution smoke permits ordinary PEP 517 build-dependency
resolution; it is not claimed to be an offline or hermetic build proof.
