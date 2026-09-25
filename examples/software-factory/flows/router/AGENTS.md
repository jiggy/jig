# Semantic Router

## Purpose

Keep semantic choice reusable: select one supplied eligible candidate or abstain,
without acquiring authority to execute the candidate.

## Ownership

- This ordinary Flow package owns the generic prompt, bounded input and complete
  result validation, and its public usage README.
- `decision.ts` exports the caller boundary check; `route.ts` invokes one ordinary
  Agent. Factory candidate meaning and slot wiring stay outside this package.
- `../../test/router.test.ts` owns controlled-Agent boundary checks.

## Local Contracts

- Accept only task text and up to 16 distinct opaque IDs with descriptions;
  validate and snapshot the complete set before calling the Agent.
- Empty sets abstain without an Agent call. A sole eligible candidate still needs
  an applicability judgment. No automatic selection, retry or fallback.
- Instruct the Agent to treat mandatory requirements as hard constraints and
  preferences as soft constraints; never intentionally downgrade requirements.
  Ask it to abstain when no description supports the requirements or missing
  information prevents that judgment. A stated default may guide only among
  suitable candidates. These prompt rules are probabilistic, not enforced
  semantic guarantees; preserve live failures as evidence.
- Return a supplied ID or explicit null with a bounded reason. Agent blocked/limit
  and operational failures remain distinct from a completed abstention.
- No domain keywords, candidate implementations, target paths, credentials,
  provider clients, filesystem discovery, dispatch, or host imports.
- Candidate descriptions are Agent-visible natural language and can influence
  judgment, including through instruction-like text. Consumers supply reviewed,
  application-owned candidates and never treat membership as semantic correctness,
  prompt-injection resistance, permission, or policy validation.
- Consumers validate complete results and exact membership before invoking their
  application-owned map. The router result alone never authorizes dispatch.

## Work Guidance

- Candidate changes belong in caller data and exact project wiring, not the prompt.
- Use only public package dependencies and the ordinary Agent contract bundle.

## Verification

- `bun test examples/software-factory/test/router.test.ts`
- Admitted host runs and live judgments are separate evidence from these tests.

## Child DOX Index

- None.
