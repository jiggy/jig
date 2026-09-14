Input contains a customer `message` and an application-supplied account with
chronological charges in USD cents. Return the disputed `chargeId` and
`requestedCreditCents`; use null and zero when the request is ambiguous.
This is a proposal, never a credit authorization. Make one Agent call, validate
its result, and propagate inability or execution failure without replay.
