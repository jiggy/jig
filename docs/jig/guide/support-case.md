---
title: Handle a disputed charge
---

# Handle a disputed charge

A customer says they were charged twice. Your application needs to understand
which payment they mean, check its records, and determine what it can offer.
An Agent helps with interpretation. Ordinary code decides credit eligibility.

This [support-case example](https://github.com/jiggy/jig/tree/main/examples/support-case)
turns a request and supplied account records into a decision and a reply.
It extends [request triage](./request-triage.md): once software can call an
intelligent method, it can evaluate that method's contribution before proceeding.

## Run a case

Complete [workspace setup](./dependencies.md#local-workspace-packages) and
[configure an Agent](./agents.md) on a [supported host](./index.md#supported-host).
From `examples/support-case`, inspect the two Flows and their policy, then run:

```sh
jig review
jig run binding:support --input @fixtures/duplicate.json --timeout 2m
```

The fixture supplies two settled USD 24 payments for the same invoice. The
customer names the second charge, `ch-102`. When the Agent identifies that
charge and amount, the result includes:

```json
{
  "outcome": "done",
  "output": {
    "accountId": "acct-demo",
    "disposition": "credit_eligible",
    "reason": "verified_duplicate",
    "reply": "The duplicate payment is eligible for a credit of USD 24.00. No credit has been issued.",
    "credit": { "chargeId": "ch-102", "amountCents": 2400 },
    "proposal": { "chargeId": "ch-102", "requestedCreditCents": 2400 }
  }
}
```

The Agent can make a different assessment; this is the expected path, not a
promise of identical model output. Fixtures are synthetic. The example sends
neither payments nor customer messages.

## Follow the decision

There are two Flow packages. The `assess` method uses one Agent call to propose
a charge ID and an amount. The `resolve` method receives that proposal through
its configured slot and applies the application's policy:

```ts
const assessment = await run.runChildFlow({
  operationId: 'assess-case',
  slot: 'assessment',
  input: run.input,
})
```

The [complete caller](https://github.com/jiggy/jig/blob/main/examples/support-case/flows/resolve/resolve.ts)
also checks account identity consistency, preserves `blocked` and `limit`,
and checks cancellation before returning. The child result schema establishes
its shape. It cannot establish that the proposal deserves a credit.

The [policy](https://github.com/jiggy/jig/blob/main/examples/support-case/flows/resolve/policy.ts)
checks the proposed charge against supplied records:

- It belongs to the supplied account and has not already been refunded.
- An earlier settled charge has the same invoice and amount.
- The duplicate is at most USD 50, and the proposed amount matches it exactly.

Only that combination produces `credit_eligible`. Missing or ambiguous charge
references, contradictory amounts, and over-limit cases produce `manual_review`.
An already refunded charge or one without a duplicate produces `no_credit`.
Code constructs the reply from that decision; an Agent's claim that it sent a
credit cannot appear as the application's customer-facing answer.

## Try a convincing wrong answer

The second fixture asks for a credit even though its two payments belong to
different invoices:

```sh
jig run binding:support --input @fixtures/not-duplicate.json --timeout 2m
```

Suppose the Agent confidently returns this perfectly valid proposal:

```json
{ "chargeId": "ch-102", "requestedCreditCents": 2400 }
```

Code returns `no_credit`, with reason `no_duplicate_payment` and `credit: null`.
If the Agent cannot identify a charge, the decision is `manual_review` instead.
Neither path invents a duplicate. The deterministic tests explicitly supply
the wrong proposal, so this property does not depend on persuading a live model
to misbehave during the demonstration.

Try `fixtures/over-limit.json` next. Its duplicate USD 75 payment exceeds the
reviewed policy even if the Agent follows the request to ignore the limit.
The result cannot include an eligible credit.

These checks constrain specific decisions. They do not guarantee correct
interpretation: an Agent could select an eligible charge that the customer did
not intend to dispute. Evaluate that quality separately for your application.

## Use the decision in your application

Select JSON output for a software consumer:

```sh
jig run binding:support --input @fixtures/duplicate.json --timeout 2m --json
```

First check the host's `status`, then the Flow's `outcome`. For `done`, branch
on `output.disposition`. An ordinary eligible case needs no human classification;
`manual_review` tells the caller where judgment remains necessary. `blocked`
and `limit` preserve assessment inability. Execution errors, cancellation, and
uncertain dispatch propagate without automatic retry.

The authenticated caller must supply complete, chronological account records
with unique charge IDs. Keep those records separate from customer-controlled
text. The reviewed Flow contains the policy; customers cannot raise its limit
through input fields or instructions.

The returned credit is a proposed next action backed by the supplied snapshot.
A billing service must check current records and enforce its own authorization
and idempotency before issuing it. This example does not implement a payment
service or make stale eligibility safe to replay.

## Make one change

Open `flows/resolve/policy.ts` and lower `maximumCreditCents` from `5000` to
`2000`. Review the edited application, then run `fixtures/duplicate.json` again.
For the same `ch-102` assessment, the result now contains `manual_review`,
`reason: "above_credit_limit"`, and `credit: null`. The Agent method is unchanged;
code determines the new boundary.

An application could also replace the configured `assessment` method while
keeping its input and result contract. As in request triage, changing its
implementation requires review, even when the caller remains unchanged.

To verify the authored policy from the repository root:

```sh
bun test examples/support-case/test
```

These checks cover wrong proposals, policy limits, inconsistent facts, malformed
results, and honest failure. They establish application behavior using Agent
substitutes, not model accuracy or production throughput.
