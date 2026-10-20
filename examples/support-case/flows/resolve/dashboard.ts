import type { ViewSnapshot } from '@jigging/reporting'

export type SupportState = {
  input: {
    message: string
    account: {
      id: string
      charges: { id: string; invoiceId: string; amountCents: number; status: string }[]
    }
  }
  phase: 'assessing' | 'checking' | 'ready' | 'blocked' | 'limit' | 'failed' | 'cancelled'
  proposal?: { chargeId: string | null; requestedCreditCents: number }
  decision?: {
    accountId: string
    disposition: string
    reason: string
    reply: string
    credit: { chargeId: string; amountCents: number } | null
  }
  reason?: string
}
const stages = {
  assessing: ['Interpreting the customer request', 0],
  checking: ['Checking duplicate-credit policy', 1],
  ready: ['Case decision prepared', 2],
  blocked: ['Interpretation needs attention', 0],
  limit: ['Interpretation limit reached', 0],
  failed: ['Case handling stopped', 0],
  cancelled: ['Case handling cancelled', 0],
} as const
const decisions: Record<string, string> = {
  credit_eligible: 'Duplicate charge is eligible for a credit; none has been issued.',
  no_credit: 'Supplied records do not authorize a credit.',
  manual_review: 'A person needs to review this request; no credit has been issued.',
}
const reasons: Record<string, string> = {
  verified_duplicate:
    'An earlier settled payment has the same invoice and amount. The requested credit matches the later charge and is within USD 50.00.',
  already_refunded: 'The proposed charge is already refunded.',
  no_duplicate_payment: 'No earlier settled payment matches both the invoice and amount.',
  above_credit_limit: 'The duplicate exceeds the USD 50.00 credit limit.',
  amount_mismatch: 'The requested amount differs from the duplicate charge.',
  unknown_charge: 'The proposed charge does not belong to these supplied records.',
  ambiguous_request: 'The assessment could not identify one disputed charge.',
}
function excerpt(text: string, maximum = 1000): string {
  const characters = [...text]
  if (characters.length <= maximum) return text
  return (
    characters.slice(0, maximum).join('') +
    '\n[Excerpt; complete value in the supplied input or result.]'
  )
}

function visibleCharges(state: SupportState) {
  const charges = state.input.account.charges
  const selected = charges.findIndex((charge) => charge.id === state.proposal?.chargeId)
  const included = new Set<number>()
  if (selected >= 0) {
    included.add(selected)
    const proposed = charges[selected]!
    const earlier = charges.findIndex(
      (charge, index) =>
        index < selected &&
        charge.status === 'settled' &&
        charge.invoiceId === proposed.invoiceId &&
        charge.amountCents === proposed.amountCents,
    )
    if (earlier >= 0) included.add(earlier)
  }
  for (let index = 0; index < charges.length && included.size < 12; index++) included.add(index)
  return [...included]
    .sort((left, right) => left - right)
    .map((index) => ({ index, charge: charges[index]! }))
}

export function supportCaseView(state: SupportState): ViewSnapshot {
  const { input, proposal, decision } = state
  const [label, completed] = stages[state.phase]
  let conclusion = 'No credit decision has been made.'
  if (decision) conclusion = decisions[decision.disposition] ?? 'No recognized decision reported.'
  if (state.reason) conclusion = excerpt(state.reason, 512)
  const policyReason = decision
    ? (reasons[decision.reason] ?? decision.reason)
    : 'The interpretation is a proposal until account and policy checks finish.'
  return {
    summary:
      'Resolve a disputed charge using the customer request, supplied account facts and a fixed duplicate-credit policy.',
    sections: [
      {
        title: 'Case status',
        blocks: [
          { kind: 'progress', label, completed, total: 2, unit: 'stages' },
          { kind: 'report', text: conclusion },
          {
            kind: 'facts',
            items: [
              { label: 'Account', value: input.account.id },
              { label: 'Credit limit', value: 'USD 50.00' },
              { label: 'Credit issued', value: false },
            ],
          },
        ],
      },
      {
        title: 'Customer request',
        blocks: [{ kind: 'report', text: excerpt(input.message, 1500) }],
      },
      {
        title: 'Supplied charges',
        blocks: [
          {
            kind: 'collection',
            id: 'charges',
            title:
              'Account records (up to 12; proposed charge and matching earlier payment included)',
            columns: [
              { key: 'charge', label: 'Charge', type: 'text' },
              { key: 'invoice', label: 'Invoice', type: 'text' },
              { key: 'amount', label: 'USD', type: 'text' },
              { key: 'state', label: 'Recorded state', type: 'text' },
              { key: 'proposed', label: 'Proposed charge', type: 'boolean' },
            ],
            rows: visibleCharges(state).map(({ charge, index }) => ({
              id: `charge-${index}`,
              cells: {
                charge: charge.id,
                invoice: charge.invoiceId,
                amount: (charge.amountCents / 100).toFixed(2),
                state: charge.status,
                proposed: charge.id === proposal?.chargeId,
              },
            })),
            total: input.account.charges.length,
          },
        ],
      },
      {
        title: 'Interpretation and policy',
        blocks: [
          {
            kind: 'facts',
            items: [
              { label: 'Proposed charge', value: proposal?.chargeId ?? null },
              { label: 'Requested USD cents', value: proposal?.requestedCreditCents ?? null },
              {
                label: 'Decision',
                value: decision?.disposition ?? 'Pending account and policy checks',
              },
            ],
          },
          { kind: 'report', text: excerpt(policyReason) },
        ],
      },
      {
        title: 'Draft reply',
        blocks: [
          {
            kind: 'report',
            text: decision
              ? excerpt(decision.reply)
              : 'A policy-owned reply will be prepared after checks. No message is sent.',
          },
        ],
      },
    ],
  }
}
