# Check repair evidence

Receive `{captured, result}`: the original bounded project and a repair worker’s
complete result. Validate source, candidate and command identities, recompute
all acceptance verdicts, and require a reproduced defect and changed passing
candidate before reporting a review-ready patch.

Return checked verdicts and accepted proposal data, including unsuccessful
attempts for inspection. This Flow receives no files or execution grants.
`evidence.ts` owns proposal acceptance; `commands.ts` checks collected behavior;
`identity.ts` defines stable JSON identities. Presentation consumes the checked
summary and never decides acceptance.
