# Request triage

## Purpose

Demonstrate one caller composing with code, Agent judgment, or both through
one method contract, using a suggested support queue as the bounded result.

## Ownership

- `flows/intake/` owns the unchanged caller; `bindings/` chooses its classifier.
- `bindings/model.ts` selects the ordinary ACP Agent with an inline Claude Code policy;
  the contract-keyed project default supplies it to Agent and mixed classifiers.
- `flows/code/`, `flows/agent/`, and `flows/mixed/` independently implement the
  same input, result, and outcome contract. Each package remains self-contained.
- `fixtures/` contains synthetic requests; `test/` checks application behavior
  with deterministic Agent substitutes.
- The [public guide](../../docs/jig/guide/request-triage.md) owns the walkthrough.

- `bindings/model.ts` owns the explicit ACP client/model/turn/session policy.
  Agent and mixed classifiers each keep their small private response schema
  beside the call and validate the complete returned queue suggestion.

## Local Contracts

- `jig.ts` owns the complete default invocation: `binding:intake --input @fixtures/labeled.json --timeout 1m`. Ordinary
  `jig run` uses reviewed defaults and returns its result on stdout without a
  packet. The README and guide offer optional `--out` to save the record in a
  new retained destination; they never promise an automatic `result.json`.
  Explicit targets bypass defaults; display choices remain operator options.

- `done` returns a suggested `billing`, `technical`, or `manual` queue. Manual
  classification is a valid suggestion. No variant dispatches a business action.
- Code recognizes explicit prefixes; mixed uses that rule before requesting
  one Agent interpretation. Agent and mixed validate structured suggestions.
- `blocked` and `limit` stay visible through the caller. Execution failures
  propagate without replay. Shared shape does not prove equal behavior.
- Operators choose Agents and powers. Changing a Binding or implementation
  requires review; the caller never chooses a new target at runtime.

- Package-local `dashboard.ts` projections offer Request through the
  optional canonical `progress` channel. FLOW entrypoints own scoped publishers,
  activity and failure notices; pure methods retain their exact results and policy.
  The existing reporting profile serves terminal and web without display code.
  Tests validate complete escaped items, provisional meanings and evidence links.

## Work Guidance

- Complexity cap: one caller with three interchangeable implementations. Keep
  queue suggestions as its sole result; no routing service, live queue, or
  business action.
- Keep the example small enough to explain the boundary before orchestration.
- Do not add provider defaults, queues, persistence, or a general router.

## Verification

- Run `bun test examples/request-triage/test` after workspace setup. These tests
  also run against the packed SDK in `scripts/test-release.sh`.
- Retain admitted Jig Run evidence separately from substitute-based tests.
  Neither proves classification quality, injection resistance, or production scale.

## Child DOX Index

- None.
