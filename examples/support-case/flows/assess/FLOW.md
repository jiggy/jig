---
name: support-case-assessment
description: Interpret a customer's disputed charge in one bounded Agent call.
uses:
  agent:
    contract: ./contracts/agent-run.capability.json
outcomes:
  blocked: The Agent cannot complete the assessment.
  limit: The Agent reaches its limit.
---

Input contains a customer `message` and an application-supplied account with
chronological charges in USD cents. Return the disputed `chargeId` and
`requestedCreditCents`; use null and zero when the request is ambiguous.
This is a proposal, never a credit authorization. Make one Agent call, validate
its result, and propagate inability or execution failure without replay.
