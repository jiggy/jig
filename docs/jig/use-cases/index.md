# Jig use cases

This area records non-normative product hypotheses for Jig. It exists to
answer a practical question: **which recurring jobs become materially better
when FLOW packages run under an independent host with exact admission,
bounded authority, composition, and durable control?**

It is not a roadmap and does not imply that Jig currently implements every
surface mentioned here. Product support is defined by the normative
specifications and release documentation.

## Four records, four purposes

The documentation keeps these records separate:

- A **case family** groups jobs that test the same Jig-specific claim. The
  [catalogue](./catalogue.md) retains all credible examples as named variants
  without promoting every domain reskin into a separate architecture.
- A **use-case brief** specifies one recurring user outcome, the least complex
  architecture that could produce it, its authority boundary, strongest
  alternative, and a falsifiable evaluation.
- An **orchestration pattern** is a reusable method inside a use case. The
  [pattern handbook](./patterns.md) records candidate methods and the
  conditions under which they are unnecessary.
- A **design probe** is an independent implementation attempt. It consumes
  public documentation and artifacts; it may reveal a missing surface, but it
  must not invent that surface while trying to use Jig.

A tutorial may later teach a demonstrated use case. A pattern by itself is
not a use case, and a probe passing is not automatically evidence of user
value.

## Evidence standard

Every use-case brief must state:

1. a recognizable user and observable outcome;
2. the situation in which the job recurs;
3. the minimum adequate topology;
4. what authority each participant receives and retains;
5. the exact Jig surface required, separated from application prerequisites;
6. the strongest credible non-Jig alternative;
7. the condition under which Jig loses to that alternative;
8. bounded failure and stopping behavior; and
9. a reproducible next evidence gate.

An entry that cannot answer these questions remains a variant in the
catalogue or is deleted. It does not receive a full page merely because the
story is appealing.

Evidence maturity has three values:

- `candidate`: the recurring outcome and Jig thesis are plausible, but the
  full architecture or evaluation is unsettled;
- `specified`: a full brief defines the authority, bounds, baseline, and
  falsifiable evaluation; and
- `demonstrated`: an independent artifact has passed that evaluation against
  an exact public Jig release or commit.

These values describe evidence, not product availability. Failed hypotheses
are removed; Git is the archive.

## Minimum topology

Topology describes the least complicated method that preserves the claim:

- `agentless`: deterministic or conventional code is sufficient;
- `single-agent`: one logical AI role, even when called repeatedly; and
- `multi-agent`: independently scoped roles are essential because they have
  different evidence, skills, authority, or commitments.

Several calls, personas, or votes do not by themselves constitute a
multi-agent architecture. A strong agentless or single-agent case is better
than decorative orchestration.

## Specified briefs

| Use case | Minimum topology | Jig claim under test | Evidence state |
| --- | --- | --- | --- |
| [Confidential benchmark](./confidential-benchmark.md) | `agentless` | Exact admission and containment let one party run another party's code against private cases without author-observable egress. | `specified`; the confidential claim is blocked on a non-argument secret-input path. |
| [Underpayment reconstruction](./underpayment-reconstruction.md) | `single-agent` | A distributable extraction procedure can hand source-linked facts to exact, independently maintained rules without giving the Agent adjudication authority. | `specified`; blocked on domain fixtures, acceptable data processing, and richer document/result transport. |
| [Futureproof event plan](./futureproof-event-plan.md) | `single-agent` | Isolated calls over declared futures expose unstable recommendations while a deterministic join prevents false robustness claims. | `specified`; ready for an independent bounded probe. |

None is yet `demonstrated`. The table deliberately includes one agentless,
one bounded-Agent, and one static-composition case so the catalogue does not
equate Jig with a single application shape.

## Surface ladder

Use cases should earn product surfaces in increasing order of operational
cost. This is a dependency map, not a release schedule.

| Earliest distinguishing surface | Representative public story | What must already be true |
| --- | --- | --- |
| Exact admitted Run | External algorithm or parser runs as a bounded, dependency-closed FLOW package. | Admission, containment, input/result handling, and cleanup are independently proven. |
| One bounded Agent call | A response gate or policy reviewer returns a closed, reviewable decision with selected package-local skills. | The Agent receives no ambient authority and invalid structured output fails closed. |
| Static child composition | A Gauntlet, independent review, or scenario plan composes exact bound Flows without dynamic discovery. | Parent and child authority, deadlines, failure, and result contracts remain explicit. |
| Authorized semantic choice | A diagnostic front desk chooses one compatible, admitted procedure or abstains. | Deterministic code owns eligibility; semantic ranking cannot admit or invent a target. |
| Durable fact activation | A close event creates one allocation or one exception packet without unsafe redispatch. | Event identity, admission, replay policy, and uncertain dispatch are explicit. |
| Stateful capability | Independent packages call a long-lived privacy, evidence, instrument, or consent authority through a stable contract. | Lifecycle, identity, compatibility, revocation, and conformance have concrete users. |
| Complete application | A software factory or persistent job campaign coordinates external state, humans, Agents, and bounded procedures. | Its constituent static methods and state boundaries have already been demonstrated independently. |

This ordering prevents an ambitious application from justifying a generic
framework in advance. A smaller case may skip later surfaces permanently.

## Current evidence queue

The next probe should be
[Futureproof event plan](./futureproof-event-plan.md). It exercises the public
Agent and child-composition slice without asking for Semantic Choice, Events,
Services, or a new SDK. Its comparison with one all-scenarios Agent can also
disprove the proposed orchestration rather than merely show that it runs.

The confidential benchmark may be exercised with public hostile fixtures to
validate containment, but that does **not** demonstrate confidential input
handling. Underpayment reconstruction should not be implemented until a
domain owner supplies a reviewed corpus and data-processing posture. The
catalogue records later candidates; it does not put them all into the active
probe queue.

## Promotion rule

A variant earns a full brief only when it represents a recurring job, survives
the strongest-alternative test, and needs a materially different authority or
evaluation model from its family. A specified brief becomes demonstrated only
after a clean-room builder reproduces its stated checks using public Jig and
FLOW material.

The builder reports missing surfaces instead of changing Jig. Platform work
and consumer evidence remain separate experiments.
