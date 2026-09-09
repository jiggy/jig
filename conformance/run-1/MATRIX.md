# Run/1 evidence matrix

**Status:** Executable coverage inventory, not a general certification programme
or a published conformance label. Invocation, direct-channel, and broadcast
exchanges have separate coverage below.

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
| Direct create, capability endpoint mapping, structured items and clean end | `channels.test.ts`, both SDK components | `test_channels.py`, both SDK components |
| Failed observation with a separately successful capability result | `channels.test.ts`, both SDK components | `test_channels.py`, both SDK components |
| Incoming named grants, child mapping, onward capability forwarding, and caught pre-transfer rejection | `channel-wiring.test.ts`, both SDKs | `test_channel_wiring.py`, both SDKs |
| Parent/worker/opposite-language monitor exchange with optional output forwarding | `channel-wiring.test.ts`, three real SDK processes | Individual role exchanges in `test_channel_wiring.py`; not a three-process bridge |
| Monitor filtering, deliberate receiver disposal, and incomplete observation without lost work results | `channel-wiring.test.ts` | `test_channel_wiring.py` |
| Direct-channel positive and hostile message shapes | Shared `messages.json` | Same shared fixtures, independent validator |
| Broadcast creation, subscriptions, immutable suffix identity and independent clean intervals | `broadcast.test.ts`, both SDK components | `test_broadcast.py`, both SDK components |
| Caught subscriber failure with an independently completed sibling interval | `broadcast.test.ts`, both SDK components | `test_broadcast.py`, both SDK components |
| Adaptive structured request/reply exchange over two named direct channels | `conversation.test.ts`, TS analysis/Python dataset and inverse | `test_conversation.py`, same actual process pairings |
| Exact conversation descriptors match the public Channel Contract/1 and Schema/1 companion | `conversation.test.ts`, including unsupported-keyword rejection | Not independently repeated; the peer derives identities from those fixture descriptors |
| Duplicate/unexpected reply rejection, outstanding-request EOF, close ordering and cancellation settlement | `conversation.test.ts`, both pairings | `test_conversation.py`, both pairings |

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

Python wheel and sdist clean-install checks run JSON/1 and runtime subprocess
cases plus a typed public consumer outside the checkout. CI covers Python
3.11–3.14 on Linux and representative macOS/Windows interpreters; configured
coverage is not a claim that a particular workflow run succeeded.
The Python source-distribution smoke permits ordinary PEP 517 build-dependency
resolution; it is not claimed to be an offline or hermetic build proof.

## SDK parity ownership

| Shared concern | Executable evidence for both languages |
| --- | --- |
| Invocation, settings, attachments, scratch, deadline and result | `components.test.ts`, Python peer golden conversation; both SDK runtime suites |
| Child Flow and capability calls, application versus operational errors | Golden conversation, component matrix, installed Python runtime tests |
| Strict JSON/1, frames, invalid results and error envelopes | Shared fixtures, both peer matrices and both SDK JSON/runtime suites |
| Cancellation, pending calls, channel loss and terminal ordering | Both peer matrices plus language-specific runtime race tests |
| Outstanding/lifetime ceilings and correlation | Both peer matrices |
| Snapshots and public typing | SDK-specific tests and installed consumers; these are projection checks, not wire certification |
| Protocol-safe ordinary logging | TypeScript stdio tests and Python installed runtime suite |
| Direct endpoint disposal, late cancellation failure, abandoned receiver, retained allocation, and settlement reserves | Both SDK channel suites; host allocation/containment remains separate evidence |
| Broadcast source/subscription allocation cancellation, late-grant cleanup and fresh-subscription abandonment | Both SDK broadcast suites; malformed grants and ordinary recovery are projection checks |

The channel traces exercise scripted bounded JSON values, not native
Agent/ACP support, binary transfer or session control. Broadcast peers prove
suffix interpretation and recovery through real subprocesses; only broker
tests establish actual queue isolation, publication sequencing and capacity
enforcement. Scripted `LAGGED` responses do not prove those host properties.
The wiring peers supply invocation-bound grants and script rejected admission;
they prove forwarding and ordinary recovery, not production named-contract
resolution or atomic host transfer enforcement.
The structured conversation peers forward values emitted by the actual dataset
and analysis processes. Changing one dataset reading changes the subsequent
query sequence and lower-bound result. These finite witnesses use at most 128
ordered samples, eight sequential queries and 96 wire frames; neither peer is
a general channel broker. Two exact named identities and beginning-only grants
are supplied by the witness. Production descriptor resolution and rejection
remain host-owned evidence; the Python process is not a claimed Jig runtime.
They establish cross-language protocol behavior through actual subprocesses,
not an independent consumer usability study. The SDK race tests and private
host tests retain their own claim boundaries.

TypeScript's request objects/AbortSignal and Python's keyword arguments/asyncio
cancellation are intentional Run SDK/1 projections. Python queues beyond the
wire concurrency ceiling while TypeScript refuses additional live calls, as
allowed above. A shared protocol change must update both peers, both SDKs and
this evidence inventory; successful npm publication alone is not Python parity.
