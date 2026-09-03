# Futureproof event plan

[The catalogue](./) is the source of truth for this non-normative brief's
maturity, topology, and next gate.

## Outcome

An organizer chooses among a small set of authorized event plans while seeing
whether the choice survives low, expected, and high attendance. When the
choice changes, the result preserves the organizer-supplied scenario and its
assumptions instead of hiding uncertainty in one blended recommendation.

## Fits / does not fit

This fits bounded decisions with several materially different plausible
futures and weak or disputed probabilities.

It does not fit open-ended event generation, unbounded option search, or a
decision whose consequences can already be calculated completely. A table or
deterministic optimizer is better when all trade-offs are numeric and known.

## Minimum architecture

One logical scenario-analysis role is invoked independently for each explicitly
supplied assumption bundle. This is a single-agent workflow even though it
makes several isolated calls. Every call sees the common facts, one scenario,
the same authorized choices, and the same closed result schema. It does not see
the other scenarios' recommendations.

A deterministic join reports:

- a robust choice when every scenario selects the same option;
- a scenario-choice table when choices differ; or
- `defer` when required facts are absent.

Another synthesis Agent is unnecessary. It would be able to smooth over the
very disagreement the workflow exists to expose.

## Inputs and authority

The organizer supplies common facts, named scenarios, and two to five choices.
Choices describe plans already acceptable for consideration; the Agent cannot
add another one.

The workflow recommends or defers. It cannot book a venue, spend money, invite
people, or modify the supplied choices. The organizer retains the decision.

## Orchestration

1. Validate the common facts, scenario names, and authorized choice IDs.
2. Invoke the same logical role once per scenario, sequentially.
3. Require one choice ID or `defer`, plus a bounded explanation.
4. Join the closed choices deterministically.
5. Attach each free-text explanation to its original decision without trying
   to reconcile it deterministically.
6. Return the complete scenario-choice table, supplied assumption differences,
   and the robust-choice result.

## Contracts

A bounded first probe can use:

```text
input:
  commonFacts
  scenarios: [{ id, assumptions }]
  choices: [{ id, description }]

per-scenario decision:
  choice: <one supplied ID> | defer
  explanation: bounded text

result:
  decisions by scenario
  robustChoice: supplied ID | none
  supplied assumption differences
```

The current Agent contract can constrain `choice` to a closed enum. The Flow,
not the Agent, determines whether the result is invariant.

## Bounds and failure behavior

The first probe uses exactly three scenarios, two to four choices, at most 12
common facts, and one call per scenario with no retry loop. A failed, blocked,
limited, or invalid decision becomes `defer` for that scenario and prevents a
robust-choice claim. Free-text explanations are retained only up to the probe's
declared byte ceiling.

The workflow must not invent probabilities or describe tested scenarios as
exhaustive. Unexpected real conditions return control to the organizer.

## Success and baseline

Compare with one Agent shown all scenarios and with a single manually written
comparison prompt. Use at least 30 fixture decisions whose per-scenario
preferred choices are labelled before execution. Run both methods three times
per fixture, including same-scenario controls to distinguish scenario
sensitivity from model variance.

Demonstration requires zero structurally invalid choice IDs, zero robust-choice
claims after any failed call, at least 90% per-scenario agreement with the
fixture labels, and at least a 25% reduction in false robust-choice claims
relative to the one-call baseline without more than a 10-point loss in
per-scenario accuracy. Record latency and provider cost rather than hiding the
three-call overhead.

## Current requirements

The current alpha already supplies the necessary closed-enum Agent result,
explicit package-local skills, sequential calls, deterministic package code,
and exact admitted execution. The initial probe requires no SemanticRouter,
dynamic catalogue, Event, Hook, Service, or new public SDK surface.

The organizer passes the small input through JSON/1. A future user interface
may improve the experience but is not part of this use case's proof.

## Evidence

This case is specified and appears ready for a clean-room design probe. The
probe builder receives this brief, public documentation, exact released
packages, and a fixed evaluation set. The builder may report a platform gap
but may not add an API to Jig while consuming it.

## Variants

- Choose a venue contract under several attendance outcomes.
- Sequence relocation commitments under several visa or income outcomes.
- Choose an education plan under several admission or funding outcomes.

Each variant must retain explicit choices and scenario assumptions. Asking
several Agents to generate unconstrained plans is a different method.
