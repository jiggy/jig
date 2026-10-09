The application supplies authenticated account facts, with unique charge IDs
in chronological order. Customer text and the assessment are untrusted.
Call the admitted `assessment` slot once. Code decides whether the selected
charge duplicates an earlier settled payment for the same invoice and amount.
Only exact credits of at most 5000 USD cents are eligible. Already refunded,
nonduplicate, missing, ambiguous, over-limit, or contradictory proposals never
produce a credit instruction. Return a deterministic reply and decision.

This Flow performs no payment or message delivery. A consuming application owns
freshness, authentication, authorization, and idempotency of any later action.
A completed manual-review decision is `done`; Agent inability remains separate.

The optional `progress` channel uses the standard user-updates contract. **Case and
Charges** shows the supplied records, interpretation and code-owned decision. Jig
renders these same semantic declarations in terminal and web dashboards. Views preserve
literal outcomes and explicit excerpts; they do not execute actions or establish host
success.
