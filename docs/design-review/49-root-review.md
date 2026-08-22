# Root implementation review of candidate 40

This is a defect list, not a second proposal.

## High: ownership is under-specified for mounted background work

The Run examples use `ownerRequestId`. That works while `flow/run` or
`service/invoke` is pending, but candidate 40 lets `service/mount` respond and
then remain alive. Background effects from that Mount no longer have a live
request ID.

Smallest correction: every Run, Mount, and service invocation receives an
opaque host-minted `owner` handle representing its Scope. Outbound operations
must present that handle; the host validates it and derives authority. Request
cancellation still targets pending JSON-RPC IDs, `service/unmount` ends a Mount,
and components receive no general `scope/open` operation. Scope is wire-visible
as an opaque lifetime capability, not a public DI object.

Test: after mount response, a legitimate background append succeeds with the
Mount owner; a forged owner and an owner used after unmount fail before dispatch.

## High: Service export removal cannot be both broken and drained by policy

Candidate 40 says a removed export generation “breaks or drains according to
Jig policy.” Once the Cordis service has disappeared, Jig cannot truthfully
drain calls through it.

Smallest correction: an acknowledged `service/status` snapshot controls
admission. Removing/replacing a generation immediately invalidates its binding
unless that exact generation remains explicitly present as draining and the
provider promises to serve it. The simpler v1 rule is that status removal means
lost; graceful update draining happens between two Mounts while the old Mount
continues advertising the old generation.

Test: remove and re-add one export inside a live realm. Old consumers must fail
`PROVIDER_LOST`; new consumers get a distinct generation. A source update keeps
the old Mount available until its consumers drain.

## High: resource and callback handles over-promise cleanup

The Contract/1 section introduces nominal resource and delegated-Service
handles without specifying token wrapping, ownership transfer from a service
invocation to its caller, delegation, or provider notification at Scope close.
Calling cleanup “best effort” does not resolve authority races.

Smallest correction for v1:

- retain delegated-Service handles because reverse contracted calls are needed
  for UI/Cordis integration;
- define them as host-issued attenuated binding capabilities owned by the
  delegating Scope;
- remove generic resource handles from the stable base until a two-provider
  prototype proves ownership transfer and release;
- represent provider resources as contract-defined IDs plus explicit release
  methods, with no universal cleanup claim.

If resource handles survive prototype testing, add them as a separately tested
Contract/1 feature before freezing rather than leaving prose semantics.

## Medium: Service facts lack an exact type derivation rule

`facts` are declared but the candidate does not state how an append proves that
the provider owns one declared fact schema.

Correction: derive the public fact type from contract identity, exact contract
version, provider registration, and fact name; validate data and publisher
authority before commit. Host lifecycle namespaces remain non-delegable.

## Medium: required Run facilities need a concrete metadata shape

The candidate relies on packages declaring reliable events required but does
not freeze the field. A package cannot preflight a facility it cannot name.

Correction: one optional closed `requires.host` list of versioned FLOW facility
IDs. Do not add arbitrary host capability prose or provider selection there.
For v1 the only base facility beyond Run is durable events. Service requirements
remain under `services.use`.

## Medium: event waits and public outcomes are omitted

The candidate explains publication and Hooks but not how a Flow waits for a
fact, nor the distinction between a successful domain outcome and execution
failure.

Correction: event query/wait is an ordinary bound Events effect, not a new graph
primitive. A short wait may remain live under the Run deadline. A long external
wait returns a declared domain outcome such as `waiting`; a Hook starts a new
Run when the fact arrives. V1 does not persist an opaque continuation. A
`flow/run` result is `{ outcome, output }`; cancellation, provider loss,
protocol failure, and execution failure are not custom outcomes.

## Medium: Runtime Contract/1 needs an ownership and descriptor rule

The package uses an owner URI and version range, but no portable artifact tells
an independent Runtime Provider what conformance it claims. The architecture
can remain sound if this is explicitly a small registry/contract artifact with
tests, not merely a label.

Correction: runtime contract identity, exact contract revision/digest, accepted
artifact kinds, fixed launch semantics, config files, protocol behavior, and a
conformance suite are provider metadata locked at activation. Do not put these
details into every FLOW package.

## Medium: NDJSON framing needs hard limits

Without a negotiated or specified maximum record size, one untrusted component
can force unbounded buffering. Binary values are already out of scope.

Correction: Run/1 defines a minimum mandatory record size and host-advertised
maximum; larger values use granted file/resource attachments. Invalid UTF-8,
oversized records, and stdout contamination are protocol failures.

## Low: “one source of meaning” is too strong

`FLOW.md` semantics and executable behavior can drift. Activation proves bytes,
not semantic equivalence.

Correction: call `FLOW.md` the public semantic declaration and the selected
implementation the operational authority. A mismatch is a package defect;
tests provide evidence only.
