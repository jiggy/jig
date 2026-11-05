# Draft recovery example

## Purpose

Demonstrate a nested Flow recovering useful saved draft material without replaying its original worker.

## Ownership

- `flows/recovery/` owns the fixed two-attempt policy and preserved recovery trace.
- `flows/repair/` owns saved-data validation and input adaptation.
- `flows/evaluate/` owns acceptance of actual report bytes and binary material.
- Other Flows own original production, completion, and explicit final forwarding.
- `bindings/` owns the reviewed slot map and operator-selected Agent.

## Local Contracts

- Use public packages and ordinary reviewed Bindings.
- Retrieve only after the exact original child call settles.
- Preserve original results and distinguish absent checkpoints from unavailable checkpoints.
- Validate adapted input before semantic selection. Validate selector membership before the fixed fallback call.
- Permit at most two worker attempts. Abstention, rejection, and exhaustion stop without another attempt.
- Propagate cancellation and uncertain effects. The example's workers receive only local file powers.
- Forward an accepted final artifact explicitly through both recovery and outer Flows.
- Keep this domain policy outside the generic selector exports.

## Work Guidance

- Keep deliberate failures visibly synthetic.
- Use deterministic Agent peers only as separately identified mechanics evidence.

## Verification

- `test/recovery.node.mjs` checks only pure failure-code policy with ordinary data.
- Jig's installed semantic recovery host test consumes this example from the packed archive and executes the real workers, checkpoint, repair, selector and acceptance checks.
- Real Agent quality requires separate live evaluation.

## Child DOX Index

- None.
