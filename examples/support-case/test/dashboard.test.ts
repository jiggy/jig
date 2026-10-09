import { expect, test } from 'bun:test'
import { type ViewSnapshot, validateUserUpdate } from '@jigging/user-updates'

function checked(view: ViewSnapshot, id = 'test') {
  const item = validateUserUpdate({ kind: 'view', id, title: 'Domain view', ...view })
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
  return item as any
}

import input from '../fixtures/duplicate.json'
import { caseView as proposal, chargesView as proposalCharges } from '../flows/assess/dashboard.ts'
import { caseView as decision, chargesView as decisionCharges } from '../flows/resolve/dashboard.ts'

test('policy decision and proposal use different claims, while retaining supplied charge context', () => {
  const assessed = { outcome: 'done', output: { chargeId: 'ch-102', requestedCreditCents: 2400 } }
  const proposed = checked(proposal(input, true, assessed))
  expect(proposed.summary).toContain('no credit decision has been made')
  expect(JSON.stringify(proposed.sections)).toContain('Pending application checks')
  const final = checked(
    decision(input, false, {
      outcome: 'done',
      output: {
        disposition: 'credit_eligible',
        reason: 'verified_duplicate',
        reply: 'Eligible; no credit has been issued.',
        proposal: assessed.output,
      },
    }),
  )
  expect(final.summary).toContain('none has been issued')
  expect(JSON.stringify(final)).toContain('verified_duplicate')
})

test('maximum supplied records and escaped requests are bounded with visible omissions', () => {
  const maximal = {
    message: '\u0001'.repeat(8000),
    account: {
      id: '\u0001'.repeat(80),
      charges: Array.from({ length: 32 }, (_, index) => ({
        id: String(index) + '\u0001'.repeat(78),
        invoiceId: '\u0001'.repeat(80),
        amountCents: 5000,
        status: 'settled',
      })),
    },
  }
  for (const [view, list] of [
    [decision, decisionCharges],
    [proposal, proposalCharges],
  ] as const) {
    expect(JSON.stringify(checked(view(maximal, view === proposal)))).toContain(
      '[Excerpt; complete value',
    )
    const item = checked(list(maximal))
    expect(item.sections[0].blocks[0].rows).toHaveLength(12)
    expect(item.sections[0].blocks[0].total).toBe(32)
  }
  expect(
    JSON.stringify(
      checked(
        decision(input, false, {
          outcome: 'blocked',
          output: { reason: 'No assessment is available.' },
        }),
      ),
    ),
  ).toContain('No assessment is available.')
})
