# Underpayment reconstruction

[The catalogue](./) is the source of truth for this non-normative brief's
maturity, topology, and next gate.

## Outcome

A worker, union, or legal clinic receives a source-linked ledger of possible
pay discrepancies derived from a contract, roster, time records, and
payslips. Language understanding extracts claims from messy records; exact
code performs dates, rates, rounding, and monetary arithmetic.

## Fits / does not fit

This fits repeated cases where independently maintained jurisdictional rule
packages are used by workers, unions, or clinics; inputs mix narrative rules
with inconsistent documents; and an inspectable calculation materially reduces
professional review time.

It does not fit a final legal determination, an automatic claim, or a case
whose rules have not been encoded and reviewed for the relevant jurisdiction.
A spreadsheet, payroll-audit product, or local purpose-built application is
better when the operator already owns and trusts the complete stack.

## Minimum architecture

The minimum architecture uses one logical extraction Agent followed by
deterministic normalization and calculation. The Agent may be invoked once per
document without becoming a multi-agent design.

A second extractor or reviewer is added only if measured error rates show that
independent reconstruction materially improves the ledger. “Two Agents are
safer” is not sufficient evidence.

## Inputs and authority

Inputs are the worker's records, the applicable agreement, calculation rules,
and explicit jurisdiction. The extraction Agent receives only those sources
and the exact skills selected for extraction.

The Flow may produce a draft evidence ledger. It cannot decide legal
entitlement, submit a claim, contact an employer, or transfer money. A named
professional or the worker owns the final interpretation and action.

## Orchestration

1. Validate the document set and declared jurisdiction.
2. Invoke the extraction role over bounded source units.
3. Reject or flag fields without source coordinates or with ambiguous source
   meaning.
4. Normalize shifts, rate periods, allowances, and deductions.
5. Apply reviewed rules with exact decimal arithmetic.
6. Render each discrepancy with its source facts, rule revision, and
   calculation.
7. Return ambiguous items separately for human review.

## Contracts

The Agent result needs typed collections such as:

```text
shift       source, date, start, end, break, status
pay line    source, period, kind, units, rate, amount, status
rule fact   source, effective range, condition, calculation reference
```

`status` is `extracted` or `ambiguous`; it is not an uncalibrated model
confidence score. Time is represented as instants plus integer seconds. Money
is represented as an ISO currency code plus integer minor units, except where
a reviewed jurisdictional rule explicitly requires another exact decimal
representation.

The deterministic result needs, for every possible discrepancy, the source
facts, applied rule, calculation steps, amount, and unresolved assumptions.
Free-form prose is supplementary and never the arithmetic authority.

## Bounds and failure behavior

The first evaluation is limited to one jurisdiction, one reviewed agreement,
eight payslips, 100 shifts, and 200 pay lines per case. Missing or contradictory
facts produce an unresolved item rather than an invented value. Unsupported
jurisdiction or document quality stops the calculation clearly.

Agent failure cannot silently fall back to guessed data. Deterministic
calculation never rounds through binary floating point. No partial ledger is
described as complete.

## Success and baseline

The credible baselines are manual professional review, specialist payroll
audit software, a spreadsheet after manual data entry, one ordinary LLM asked
to calculate everything, and a local LLM extraction application followed by
the same deterministic calculator.

Evaluation needs at least 30 professionally prepared cases with known source
facts and calculations. Demonstration requires zero incorrect amounts in the
final discrepancy ledger, source and rule links for every ledger item, at
least 99% precision and 95% recall for extracted monetary and time facts, and
at least a 30% median reduction in professional review time relative to the
best non-Jig baseline. Ambiguous facts do not count as correct extractions.

The result must also show a cross-party benefit from independently distributed
and admitted rule packages. Packaging an ordinary chatbot prompt is not
enough.

## Current requirements

The current alpha can run one skill-limited Agent and deterministic package
code, but its public input and structured-result surfaces cannot carry this
case faithfully. An application must also supply OCR or text extraction and a
source-coordinate convention; those are application components or external
preprocessing, not presumed Jig responsibilities. None of these requirements
is a promised Jig feature.

The alpha's fixed Agent provider sends instructions, selected skills, and any
records included in those instructions to OpenRouter and its selected Google
model. `store: false` is not a general retention guarantee. Real wage records
require an explicitly acceptable data processor or a suitably isolated local
provider; the current provider must not be treated as appropriate merely
because the Flow is contained.

Domain rules, professional oversight, OCR quality, and privacy policy remain
application responsibilities regardless of how input and result transport is
eventually implemented.

## Evidence

This case is specified but cannot yet be probed honestly against the public
alpha. The next evidence is a domain-reviewed fixture corpus and an exact
input/output contract independent of any proposed Jig API.

## Variants

- Reconstruct benefits or expense reimbursements from policy and statements.
- Trace food-production lots from supplier and production records.
- Assemble a disaster-claim evidence matrix without performing coverage
  adjudication.

These variants may justify different skills and deterministic rule engines;
they are not automatically the same demonstrated use case.
