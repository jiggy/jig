# Evaluator brief: adversarial first-settlement host

Freeze the evaluator from this file, `AUTHOR-BRIEF.md`, and the public Run/1
documents before reading an author package. Execute only a fresh copy of the
submitted package with its assigned SDK artifact installed locally. Do not
resolve packages from the Jig workspace.

Run every scenario in a fresh component process and a fresh scratch tree. Send
the exact root input and settings from the author brief, with no attachments
and a finite deadline. Bound and clean up the complete process tree on every
result. Scenario selection and temporary paths must not be visible to the
component.

Before behavior tests, independently run Package/1 and Schema/1 checks, strict
language checks, and invalid input/settings instances against the submitted
schemas. Do not trust the author's report or test harness.

## Common admission

Before answering either child request, receive exactly the two expected
`flow/call` requests. Their arrival order is unconstrained. Validate:

- distinct valid component request IDs;
- slot `planner`;
- operation IDs `plan-fast:1` and `plan-deep:1` exactly once each;
- their exact `goal` and matching `approach` inputs; and
- useful nonempty human-readable intents.

Map each opaque request ID to its application-local `fast` or `deep` label.
For every scenario, choose the **second request observed on the wire** as the
first-settled call. This prevents source emission order from selecting the
winner accidentally.

The normal result for label `<label>` is:

```json
{
  "outcome": "done",
  "output": {
    "approach": "<label>",
    "candidate": "<label> candidate"
  }
}
```

The late result for the cancelled loser uses the same shape with that loser's
label and `"candidate": "late <label> candidate"`.

## Scenario 1: normal winner

1. Return the normal result for the dynamically selected winner while leaving
   the loser request unresolved.
2. Require exactly one `request/cancel` notification targeting the loser's
   opaque request ID.
3. Require `effect/call` with operation `record-selection:1`, slot `records`,
   method `save`, and this exact input:

   ```json
   {
     "name": "benchmark-selection.json",
     "winner": "<winner label>",
     "result": "<complete winner RunResult>"
   }
   ```

   Cancellation and effect-request frame order is unconstrained. Do not answer
   the effect until cancellation has been observed.
4. Return effect value `{ "recordId": "record-17" }`.
5. Keep the loser's original request unresolved briefly and reject any root
   response during that interval.
6. Return the loser's late normal result to its original request. Only then
   accept this exact root result:

   ```json
   {
     "outcome": "done",
     "output": {
       "winner": "<winner label>",
       "result": "<complete winner RunResult>",
       "receipt": { "recordId": "record-17" }
     }
   }
   ```

## Scenario 2: declared effect error

Repeat the normal-winner sequence, but return:

```json
{
  "error": {
    "name": "already-recorded",
    "data": { "recordId": "record-17" }
  }
}
```

from `records.save`. After the cancelled loser settles, require exactly:

```json
{
  "outcome": "unchanged",
  "output": {
    "winner": "<winner label>",
    "result": "<complete winner RunResult>",
    "error": {
      "name": "already-recorded",
      "data": { "recordId": "record-17" }
    }
  }
}
```

## Scenario 3: first-settled operational failure

Return this operational JSON-RPC error to the dynamically selected first
settlement while leaving the loser unresolved:

```json
{
  "code": -32000,
  "message": "planner unavailable",
  "data": {
    "code": "UNAVAILABLE",
    "details": { "operationId": "<winner operationId>" }
  }
}
```

Require cancellation of the loser and forbid `effect/call`. Keep the loser
wire-pending briefly and reject a premature root response. After returning its
late normal result, require the root to preserve the exact operational error
code, message, and data rather than converting it to an application outcome.

## Universal checks and limits

Every scenario requires:

- Run/1 direction and closed-field checks for exercised frames;
- no cancellation of the selected first-settled call;
- no second or trailing root frame;
- EOF and exit status zero after the one root terminal response;
- a bounded timeout with forced complete-tree termination on failure; and
- a clean scratch/process baseline after termination.

Use a fresh reader and isolated protocol state for every scenario. Do not
share writable scenario state, leak scenario names to the component, abandon
an outstanding stream reader, or infer descendant cleanup from the immediate
process alone.

The evaluator must not assume a particular initial child-call order,
transport-ID spelling, cancel/effect order, or remote cancellation result. A
late successful loser response is intentional and legal.

Black-box evidence can prove that explicit cancellation occurred before the
effect completed and that the SDK withheld the root until wire work settled.
It cannot prove that application code awaited the rejected promise/task.
Source review must separately check local loser observation.

Do not turn this small host into a complete JSON/1, Package/1, Schema/1, or
Run/1 conformance implementation, and do not make platform changes to satisfy
an author package. Record a missing interface as a blocked result.
