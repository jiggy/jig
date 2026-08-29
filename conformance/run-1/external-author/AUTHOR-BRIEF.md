# Author brief: first-settlement planning Flow

Build one code-backed FLOW package in your assigned directory.

The sealed campaign manifest identifies your author language, its exact local
Runtime Adapter selector token, the SDK artifact, and the package-check
command. You may use ordinary built-in language concurrency primitives. Do not
invent a new FLOW, Jig, or SDK API to hide the behavior below.

## Root values

The root input is exactly:

```json
{ "goal": "select a football game benchmark" }
```

The complete settings object is exactly:

```json
{ "recordName": "benchmark-selection.json" }
```

## Concurrent child calls

Start both child Flow calls before awaiting either one. Both use slot
`planner`, but have distinct semantic and transport-independent identities.
`fast` and `deep` are application-local labels used to correlate the calls;
they are not extra `callFlow`/`call_flow` fields.

The `fast` call is:

```json
{
  "operationId": "plan-fast:1",
  "slot": "planner",
  "input": {
    "goal": "select a football game benchmark",
    "approach": "fast"
  }
}
```

The `deep` call is:

```json
{
  "operationId": "plan-deep:1",
  "slot": "planner",
  "input": {
    "goal": "select a football game benchmark",
    "approach": "deep"
  }
}
```

Give each call useful human-readable intent. Do not assume which call is
emitted or settled first.

The **first settlement decides**:

- A fulfilled child `RunResult` is the winner, including its complete
  `outcome` and `output`.
- If the first-settled child raises `OperationError`, preserve that exact
  error as the root operational failure.

In either case, explicitly cancel the other still-pending local call and
observe its local completion before the handler finishes:

- TypeScript supplies a distinct call-specific `AbortSignal` to each call and
  aborts the loser.
- Python schedules each call as an `asyncio.Task`, cancels the loser task, and
  awaits it.

The two languages do not expose local cancellation through the same exception
type. Do not depend on remote work being undone, a cancellation
acknowledgement, or a particular late terminal result. Let unexpected
programming failures escape.

## Normal-result branch

Only after selecting a normal winner, call the local capability slot `records`
with:

```json
{
  "operationId": "record-selection:1",
  "slot": "records",
  "method": "save",
  "input": {
    "name": "benchmark-selection.json",
    "winner": "fast or deep",
    "result": "the complete winning child RunResult"
  }
}
```

The field names and topology above are exact exercise-local requirements.

On effect success, return exactly:

```json
{
  "outcome": "done",
  "output": {
    "winner": "fast or deep",
    "result": "the complete winning child RunResult",
    "receipt": "the unwrapped effect value"
  }
}
```

If `records.save` raises `EffectError` named `already-recorded`, return exactly:

```json
{
  "outcome": "unchanged",
  "output": {
    "winner": "fast or deep",
    "result": "the complete winning child RunResult",
    "error": {
      "name": "already-recorded",
      "data": "the exact EffectError data"
    }
  }
}
```

Let every other effect or programming failure remain a failure. Never call
`records.save` when the first settlement was an `OperationError`.

## Package surface

Declare `records` as an explicitly local capability seam in `FLOW.md` and
declare the custom `unchanged` outcome. Document concurrency, winner
selection, cancellation, the normal result, and `already-recorded` behavior in
the Markdown body.

Provide these root files:

```text
FLOW.md
flow.ts or flow.py
input.schema.json
settings.schema.json
result.schema.json
```

The schemas must describe the exact root values and both normal result shapes.
They must use the supplied FLOW Schema/1 dialect, not unrestricted JSON
Schema. The supplied documentation includes its normative rules, machine
meta-schema, and examples.

Native dependency metadata may be included when your language needs it, but
generated dependencies and environments must not be placed inside the FLOW
package. Declare the candidate SDK dependency by its distribution name and
the exact version named by the campaign manifest. The evaluator installs the
assigned local artifact.

Run the sealed package-check command supplied by the campaign. It checks the
inert package and its Schema/1 files; it does not execute the Flow or validate
Run/1 behavior.

## Report

Write `REPORT.md` beside—not inside—the FLOW package. Record:

- documents, public exports, and ordinary language primitives used;
- every choice that was not obvious from those sources;
- how you ensured both calls started before either was awaited;
- how you cancelled and observed the losing local wait;
- anything you could not validate without a Jig host or additional tooling;
- any workaround; and
- the commands you would expect an ordinary author to run.

Do not propose or invent new platform APIs in the package. If the documented
surface is insufficient, leave the package incomplete and report the blocker.
