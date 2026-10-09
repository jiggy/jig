Input contains a customer `message` and an application-supplied account with
chronological charges in USD cents. Return the disputed `chargeId` and
`requestedCreditCents`; use null and zero when the request is ambiguous.
This is a proposal, never a credit authorization. Make one Agent call, validate
its result, and propagate inability or execution failure without replay.

The optional `progress` channel uses the standard user-updates contract. **Case and
Charges** shows the supplied records and a provisional charge interpretation. Jig
renders these same semantic declarations in terminal and web dashboards. Views preserve
literal outcomes and explicit excerpts; they do not execute actions or establish host
success.
