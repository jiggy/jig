export type Charge = {
  id: string
  invoiceId: string
  amountCents: number
  status: 'settled' | 'refunded'
}
export type Account = { id: string; charges: Charge[] }
export type Proposal = { chargeId: string | null; requestedCreditCents: number }

// Reviewed application policy, never a field supplied by the customer or Agent.
const maximumCreditCents = 5000

export function decide(account: Account, proposal: Proposal) {
  const finish = (
    disposition: 'credit_eligible' | 'no_credit' | 'manual_review',
    reason: string,
    reply: string,
    credit: { chargeId: string; amountCents: number } | null = null,
  ) => ({ accountId: account.id, disposition, reason, reply, credit, proposal })
  const manual = (reason: string) =>
    finish(
      'manual_review',
      reason,
      'We need to review this request before determining a credit. No credit has been issued.',
    )
  if (proposal.chargeId === null) return manual('ambiguous_request')
  const index = account.charges.findIndex((charge) => charge.id === proposal.chargeId)
  if (index === -1) return manual('unknown_charge')
  const charge = account.charges[index]!
  if (charge.status === 'refunded')
    return finish(
      'no_credit',
      'already_refunded',
      'The supplied account records show this charge was already refunded.',
    )
  const duplicate = account.charges
    .slice(0, index)
    .some(
      (previous) =>
        previous.status === 'settled' &&
        previous.invoiceId === charge.invoiceId &&
        previous.amountCents === charge.amountCents,
    )
  if (!duplicate)
    return finish(
      'no_credit',
      'no_duplicate_payment',
      'The supplied account records do not show a duplicate payment for this charge.',
    )
  if (charge.amountCents > maximumCreditCents) return manual('above_credit_limit')
  if (proposal.requestedCreditCents !== charge.amountCents) return manual('amount_mismatch')
  return finish(
    'credit_eligible',
    'verified_duplicate',
    `The duplicate payment is eligible for a credit of USD ${(charge.amountCents / 100).toFixed(2)}. No credit has been issued.`,
    { chargeId: charge.id, amountCents: charge.amountCents },
  )
}
