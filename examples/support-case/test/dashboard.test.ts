import { expect, test } from 'bun:test'
import { type ViewSnapshot, validateReportingMessage } from '@jigging/reporting'
import input from '../fixtures/duplicate.json'
import { caseView as proposal, chargesView as proposalCharges } from '../flows/assess/dashboard.ts'
import { decide } from '../flows/check-credit/policy.ts'
import {
  type SupportState,
  supportCaseOptions,
  supportCaseView,
} from '../flows/resolve/dashboard.ts'

function checked(view: ViewSnapshot) {
  const item = validateReportingMessage({ kind: 'view', id: 'test', title: 'Domain view', ...view })
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
  return item as any
}

test('the application keeps the request, relevant charges, policy and reply together', () => {
  const suggested = { chargeId: 'ch-102', requestedCreditCents: 2400 }
  expect(checked(proposal(input, true, { outcome: 'done', output: suggested })).summary).toContain(
    'no credit decision has been made',
  )
  const final = checked(
    supportCaseView({
      input,
      phase: 'ready',
      proposal: suggested,
      decision: decide(input.account, suggested),
    }),
  )
  expect(final.sections.map((section: any) => section.title)).toEqual([
    'Customer request',
    'Draft reply',
    'Case status',
    'Supplied charges',
    'Interpretation and policy',
  ])
  expect(JSON.stringify(final)).toContain('none has been issued')
  expect(JSON.stringify(final)).toContain('earlier settled payment')
  const pending = checked(supportCaseView({ input, phase: 'checking', proposal: suggested }))
  expect(JSON.stringify(pending)).toContain('Pending account and policy checks')
})

test('maximum escaped requests and charges fit the complete page with disclosed excerpts', () => {
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
  const item = checked(
    supportCaseView({ input: maximal, phase: 'blocked', reason: '\u0001'.repeat(4096) }),
  )
  expect(JSON.stringify(item)).toContain('[Excerpt; complete value')
  expect(
    item.sections.find((section: any) => section.title === 'Supplied charges').blocks[0].rows,
  ).toHaveLength(12)
  expect(
    item.sections.find((section: any) => section.title === 'Supplied charges').blocks[0].total,
  ).toBe(32)
  checked(proposal(maximal, true))
  checked(proposalCharges(maximal))
})

test('a disputed charge beyond the excerpt and its earlier match remain visible', () => {
  const charges = Array.from({ length: 32 }, (_, index) => ({
    id: `charge-${index}`,
    invoiceId: `invoice-${index}`,
    amountCents: 2400,
    status: 'settled',
  }))
  charges[31]!.invoiceId = charges[24]!.invoiceId
  const state: SupportState = {
    input: { message: 'The later payment is a duplicate.', account: { id: 'account', charges } },
    phase: 'checking',
    proposal: { chargeId: 'charge-31', requestedCreditCents: 2400 },
  }
  const visible = checked(supportCaseView(state)).sections.find(
    (section: any) => section.title === 'Supplied charges',
  ).blocks[0].rows
  expect(visible.map((row: any) => row.cells.charge)).toContain('charge-31')
  expect(visible.map((row: any) => row.cells.charge)).toContain('charge-24')
  expect(visible.find((row: any) => row.cells.charge === 'charge-31').cells.proposed).toBe(true)
})

test('a case target follows the supplied account and request independently of changing charge facts', () => {
  const options = supportCaseOptions(input)
  const updated = structuredClone(input)
  updated.account.charges[0]!.amountCents += 1
  expect(supportCaseOptions(updated)).toEqual(options)
  const anotherRequest = supportCaseOptions({
    ...input,
    message: 'Please explain the earlier charge.',
  })
  expect(anotherRequest.target?.instanceKey).not.toBe(options.target?.instanceKey)
  expect(anotherRequest.target?.subjectKey).toBe(options.target?.subjectKey)
  expect(options.landing).toBe(true)
  validateReportingMessage({
    kind: 'view',
    id: 'case',
    ...options,
    ...supportCaseView({ input, phase: 'assessing' }),
  })
})
