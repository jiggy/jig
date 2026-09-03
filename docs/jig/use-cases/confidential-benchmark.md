# Confidential benchmark

[The use-case index](./) records this non-normative brief's current evidence
state. The [contained foreign computation family](./catalogue.md#1-contained-foreign-computation)
provides its broader comparison set.

**Evidence state:** `specified`, not demonstrated.

**Claim under test:** an independent host can preserve exact admission and a
bounded execution envelope across an author/operator trust boundary. This
brief does not claim that arbitrary output is safe to disclose.

## Outcome

A lab or procurement team evaluates an externally authored algorithm against
private test cases locally. The algorithm receives only the explicit benchmark
input and cannot use the network or ambient host resources. Edited bytes cannot
run under the earlier admission; the old admitted generation remains runnable
until the operator admits a replacement.

## Fits / does not fit

This fits when the code author and data owner do not fully trust one another
and the test cases can be represented as bounded FLOW JSON/1 input delivered
through a channel that does not expose them as command-line arguments.

It does not fit trusted internal code, hardware-performance comparisons, or a
benchmark whose useful output itself reveals the private cases. A script or
ordinary test runner is simpler when no trust boundary exists.

## Minimum architecture

The minimum architecture is one agentless FLOW package executed as one exact
Jig Run. An Agent would make a deterministic benchmark less predictable and
would introduce another data recipient without improving the calculation.

The operator reviews and admits the package, supplies private input, observes
the local result, and decides whether any result leaves the machine.

## Inputs and authority

The input contains a bounded set of cases and parameters. The package may
compute and return a result; it may not read undeclared host files, access the
network, spawn beyond the Run limits, or persist authority after termination.

Admission authorizes and pins what may run. It does not authenticate the
external author, prove that the algorithm is correct, or establish that its
output is safe to disclose. The operator must treat result and diagnostic
output as potentially containing the complete private input. A public result
needs a narrow result schema and a separate disclosure decision.

The trusted local operator and Jig host can observe the input and result. Jig
also retains canonical root input and terminal data in project-local Run
history. The alpha has no selective reclamation command: removing retained
history requires closing the project and intentionally removing its protected
`.jig` state together with admission state. This is local containment, not
ephemeral secret processing.

## Orchestration

1. Place the candidate algorithm in an ordinary FLOW package.
2. Run `jig check` and review the exact proposed package.
3. Admit the reviewed generation.
4. Invoke the exact Flow with private JSON/1 cases.
5. Validate and retain the local result.
6. Share only an explicitly reviewed projection, if anything.

There is no dynamic selection, child Flow, Agent, Hook, or Service.

## Contracts

A first probe can use a deliberately narrow input:

```json
{
  "cases": [
    { "id": "case-1", "values": [3, 1, 4] }
  ]
}
```

Its result should expose bounded scores and case identifiers rather than
arbitrary prose. The exact schemas belong to the benchmark package, not Jig.

## Bounds and failure behavior

Invalid input fails before useful computation. Timeout, PID exhaustion,
memory exhaustion, prohibited network access, or prohibited host access fail
the Run without a weaker fallback. A changed package is not silently executed
under its former admission.

The first probe must keep inputs small enough for the current JSON command
surface. Large datasets, secret file projection, repeated-query budgets, and
output declassification are different features and must not be implied.

## Success and baseline

Compare Jig with a plain local script and a competently hardened self-hosted
sandbox or CI runner. Use one legitimate package and hostile variants for
network access, host reads, fork pressure, aggregate memory, deadline abuse,
descendant survival, post-admission byte changes, and deliberate encoding of
input in result and diagnostic output. The last variant demonstrates why those
channels require operator review; Jig is not expected to suppress them. Run
each residue-producing case ten times.

The containment probe succeeds when:

- the legitimate package returns the expected result;
- edited bytes cannot execute under the old admission while the retained old
  bytes still behave exactly as reviewed;
- hostile variants cannot use the network, read host files, exceed process or
  memory bounds, survive cancellation, or leave residue;
- there is no author-observable egress during execution;
- all result and diagnostic channels are treated as untrusted disclosures to
  the local operator; and
- a new operator can reproduce the result from public Jig documentation.

The claim is operational isolation and exact admission, not mathematical
correctness or zero information leakage through an operator-shared result.

## Current requirements

The direct alpha already provides exact Run admission, rootless containment,
deadlines, and JSON values on its supported host. Its only public input option
is currently `--input JSON`; placing private cases in a command argument can
expose them through shell history or process inspection. The alpha therefore
supports a hostile-code containment probe with public fixtures, but not the
confidential benchmark claim.

A faithful probe first needs a bounded input path that does not place secret
bytes in command arguments. That requirement does not imply a particular Jig
API, attachment model, or implementation.

## Evidence and falsifier

This case is specified but not demonstrated. A clean-room builder may first
prove containment with public cases, but must stop and report the secret-input
gap rather than changing Jig to make the complete example pass. Once that gap
is addressed independently, the builder should receive only public Jig and
FLOW documentation, exact packages, this brief, and the hostile-test
expectations.

The Jig-specific hypothesis fails if a competently configured disposable VM
or CI sandbox gives the same author/operator workflow, reviewability, and
cleanup with no material additional integration. The confidentiality claim
fails on any author-observable egress or unexpected secret retention, even if
the numerical benchmark result is correct.

## Variants

- Compare a supplier's deterministic pricing formula against a confidential
  demand forecast.
- Evaluate a research algorithm against unpublished synthetic cases.

All variants lose their Jig-specific value when package author and operator
already trust each other.
