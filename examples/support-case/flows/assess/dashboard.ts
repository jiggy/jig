import type { RunResult } from '@jigging/flow'
import type { ViewSnapshot } from '@jigging/user-updates'

interface CaseInput {
  message: string
  account: {
    id: string
    charges: { id: string; invoiceId: string; amountCents: number; status: string }[]
  }
}
function excerpt(text: string, limit = 512): string {
  const chars = [...text]
  return (
    chars.slice(0, limit).join('') +
    (chars.length > limit
      ? '\n[Excerpt; complete value in the supplied input or final result.]'
      : '')
  )
}
export function chargesView(input: CaseInput): ViewSnapshot {
  const charges = input.account.charges
  return {
    summary: `${charges.length} supplied account records, in chronological order. These are caller-supplied facts; no billing system is queried.`,
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'charges',
            title: 'Supplied charges (first 12)',
            columns: [
              { key: 'charge', label: 'Charge', type: 'text' },
              { key: 'invoice', label: 'Invoice', type: 'text' },
              { key: 'cents', label: 'USD cents', type: 'number' },
              { key: 'state', label: 'Recorded state', type: 'text' },
            ],
            rows: charges.slice(0, 12).map((charge, index) => ({
              id: `charge-${index}`,
              cells: {
                charge: charge.id,
                invoice: charge.invoiceId,
                cents: charge.amountCents,
                state: charge.status,
              },
              details: [
                {
                  kind: 'report',
                  text: `Chronological record ${index + 1}. A later settled charge must match an earlier settled invoice and amount; a proposal alone cannot authorize a credit.`,
                },
              ],
            })),
            total: charges.length,
          },
        ],
      },
    ],
  }
}
export function caseView(
  input: CaseInput,
  assessmentOnly: boolean,
  result?: RunResult,
): ViewSnapshot {
  const output = result?.output as
    | {
        disposition?: string
        reason?: string
        reply?: string
        chargeId?: string | null
        requestedCreditCents?: number
        credit?: { chargeId: string; amountCents: number } | null
        proposal?: { chargeId: string | null; requestedCreditCents: number }
      }
    | undefined
  const descriptions: Record<string, string> = {
    credit_eligible: 'Duplicate charge is eligible for a credit; none has been issued.',
    no_credit: 'Supplied records do not authorize a credit.',
    manual_review: 'A person needs to review this request; no credit has been issued.',
  }
  const proposal = assessmentOnly ? output : output?.proposal
  return {
    summary: !result
      ? assessmentOnly
        ? 'Identify the disputed charge and requested amount. This assessment can only propose; it cannot authorize a credit.'
        : 'Check an interpretation against supplied account records and the fixed duplicate-credit policy.'
      : result.outcome !== 'done'
        ? `Assessment ${result.outcome}; no credit decision is available.`
        : assessmentOnly
          ? 'Interpretation returned for application policy to check; no credit decision has been made.'
          : (descriptions[output?.disposition ?? ''] ?? 'No decision reported.'),
    sections: [
      {
        title: 'Customer request',
        blocks: [
          { kind: 'report', text: excerpt(input.message, 2000) },
          {
            kind: 'facts',
            items: [
              { label: 'Account', value: input.account.id },
              { label: 'Supplied charges', value: input.account.charges.length },
              { label: 'Credit cap', value: 'USD 50.00; exact duplicate amount required.' },
              { label: 'Side effects', value: 'No payment or reply is sent.' },
            ],
          },
        ],
      },
      {
        title: 'Interpretation and decision',
        blocks: !result
          ? [
              {
                kind: 'report',
                text: 'Waiting for the reviewed assessment. Customer text cannot change account facts or application policy.',
              },
            ]
          : result.outcome !== 'done'
            ? [
                {
                  kind: 'report',
                  text: `Reported cause: ${excerpt(output?.reason ?? 'No reason supplied.')}`,
                },
              ]
            : [
                {
                  kind: 'facts',
                  items: [
                    { label: 'Proposed charge', value: proposal?.chargeId ?? null },
                    { label: 'Proposed USD cents', value: proposal?.requestedCreditCents ?? null },
                    {
                      label: 'Decision',
                      value: assessmentOnly
                        ? 'Pending application checks'
                        : (output?.disposition ?? null),
                    },
                    {
                      label: 'Policy reason',
                      value: assessmentOnly
                        ? 'Not evaluated by this assessor'
                        : (output?.reason ?? null),
                    },
                  ],
                },
                {
                  kind: 'report',
                  text: assessmentOnly
                    ? 'The consuming application must check this proposal against its own facts and policy.'
                    : (output?.reply ?? 'No reply reported.'),
                },
              ],
      },
    ],
  }
}
