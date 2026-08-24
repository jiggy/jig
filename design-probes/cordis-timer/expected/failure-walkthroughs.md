# Expected Cordis failure walkthroughs

## Missing native dependency

If native preparation cannot resolve the declared Cordis or FLOW SDK packages,
the Service is unavailable before launch. Jig does not synthesize a Timer.

## Activation failure

If `root.plugin(Timer)` rejects, setup never returns an export set and the Mount
fails. Process supervision fences the partially initialized process tree; no
provider generation becomes callable.

## Invalid delay

Schema validation rejects zero, negative, non-integral, and over-limit delays
before provider invocation. The wrapper does not duplicate contract validation.

## Invocation cancellation

The invocation signal calls the realm-local timer disposer and rejects the
pending method. Cancellation is a FLOW protocol result, not a named capability
error invented by this contract.

## Provider loss

The operation ledger reports a pending wait as failed or uncertain according to
available evidence. A replacement provider is a new generation; it cannot heal
or resume the lost native timer.

## Contract mismatch

Jig derives URI, exact version, and descriptor digest independently from the
consumer and provider copies. Any mismatch prevents Binding before code loads.

## Disposal failure

Jig trusts neither process EOF nor Cordis disposal alone as OS fencing proof.
The Sandbox Backend still terminates and proves cleanup of the process tree.
