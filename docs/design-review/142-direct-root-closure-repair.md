# Direct-root closure repair

**Status:** implementation in progress. The Linux containment mechanism and
exact Python/Bun recipes remain valid evidence, but the integrated durable
root-Run milestone is not closed until the four gaps below pass fault and
hostile proofs.

This is a correction checkpoint, not a new product phase. It introduces no
public FLOW field, Run/1 method, Root Administration member, Runtime Adapter
SPI, Sandbox Backend SPI, or Sley integration.

## 1. Why the prior closure claim was too strong

The current path can:

1. durably allocate one admitted root Run;
2. reproduce an exact Python or Bun recipe;
3. execute the package in the private cgroup-v2/Bubblewrap envelope; and
4. persist and replay a protocol terminal.

Four boundary failures remain:

- a protocol-valid success is persisted without checking the package's
  declared outcomes or `result.schema.json`;
- a launch whose Backend fence cannot be confirmed is collapsed into an
  ordinary terminal while its package materialization is released;
- cancellation or deadline expiry before `RunHostSession` starts can be
  misclassified as `EXECUTION_FAILED`; and
- fallible work after committing a spawn intent can prevent the controller
  from receiving its unique launch authority, while replay correctly refuses
  to redispatch it.

The first is an application-result admission defect. The other three are one
shared ownership defect: durable allocation, dispatch ownership, Backend
admission, fence evidence, backing lifetime, and terminal publication are not
yet represented as one recoverable sequence.

## 2. Required private lifecycle

The repaired implementation must preserve this order:

```text
durable spawn intent
    -> recoverable dispatch ownership
    -> exact Run backing retained
    -> Backend admission may begin
    -> complete tree fence confirmed
    -> Run backing released
    -> package result admitted
    -> durable terminal published
```

The exact internal record layout remains implementation-private. It must,
however, retain enough identity for a trusted successor to recover one exact
Jig-owned launch without scanning ambient processes or host cgroups.

Public Root Administration continues to expose only `pending` and `terminal`.
A launch remains `pending` while its fence is unproved. Fence uncertainty is
not a package outcome and must not be converted to `EXECUTION_FAILED`,
`CANCELLED`, `DEADLINE_EXCEEDED`, or `COORDINATOR_LOST` merely to settle the
record.

Only a confirmed fence permits backing release and terminal publication. A
coordinator may release ownership only after cleanup is complete or after one
durable, independently reacquirable cleanup owner has accepted the debt.

## 3. Failure precedence

After fencing is confirmed:

```text
controller cancellation before a committed root response
    -> CANCELLED

absolute deadline expiry before or during startup
    -> DEADLINE_EXCEEDED

other planning, preparation, or execution failure
    -> EXECUTION_FAILED

clean protocol/process success with an undeclared or schema-invalid result
    -> INVALID_RESULT
```

These distinctions use typed private results or errors, never human-message
matching. Existing protocol, channel, resource, cancellation, deadline,
execution, and cleanup failures retain precedence over result validation.

## 4. Result admission

For one clean provisional success, the allowed domain outcomes are exactly:

```text
done + the own keys of FLOW.md outcomes
```

If `result.schema.json` exists, it validates the complete
`{ outcome, output }` value. Absence admits any FLOW JSON/1 output after the
base envelope and declared-outcome rule pass. Rejection is `INVALID_RESULT`
and preserves bounded process diagnostics plus Schema/1 diagnostic details.

The validator uses the protected admitted Package/1 inspection. It never
rereads visible project source after execution.

## 5. Required proofs

Focused and hostile tests must cover:

- valid `done` and custom outcomes, undeclared and reserved outcomes, and
  correlated result-schema acceptance and rejection;
- cancellation and deadline expiry before admission, between admission and
  readiness, and after readiness;
- loss of the Backend terminal fencing receipt;
- retained package backing while a fence remains unproved;
- coordinator failure and exact cleanup-owner reacquisition;
- a fallible post-allocation step without an orphaned current-epoch Run;
- no terminal before exact process-tree quiescence and cleanup;
- replay of admitted failure without package redispatch;
- real contained Python and Bun runs; and
- zero residual processes, cgroups, private devices, control sockets, and
  package materializations after every settled case.

## 6. Stop conditions

Stop rather than broaden the repair if it appears to require:

- a public Backend, Runtime Adapter, scheduler, or cleanup SPI;
- ambient cgroup or process scanning;
- weaker process-group, `ulimit`, or `/proc` fallback semantics;
- a content-addressed prepared-tree store, retention manager, or package GC
  solely to avoid one Run backing lease;
- Nix lifecycle management or another package-manager integration;
- child Flows, effects, Agents, Hooks, Services, Semantic Choice, or Sley; or
- terminal publication before an exact fence can be proved.

Once these proofs pass, the direct-root slice may be called closed again. Only
then should deterministic exact `flow/call` composition be selected as the
next product phase.
