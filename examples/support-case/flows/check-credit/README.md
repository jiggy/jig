# Check credit eligibility

Receive `{account, proposal}` and apply the fixed duplicate-credit policy in
`policy.ts`. The proposal must identify a later settled payment matching an
earlier settled invoice and amount; the requested credit must match and be at
most USD 50.00. Account charge identities must be unique.

Return the checked eligibility decision, policy reason and deterministic draft
reply. Customer text, Agent access and payment authority are absent from this
Flow. `done` includes ineligible and manual-review decisions; no credit is issued.
