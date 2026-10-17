import { describe, expect, test } from 'bun:test'
import duplicate from '../fixtures/duplicate.json'
import notDuplicate from '../fixtures/not-duplicate.json'
import overLimit from '../fixtures/over-limit.json'
import { type Account, decide } from '../flows/resolve/policy'

const proposal = { chargeId: 'ch-102', requestedCreditCents: 2400 }
const account = () => structuredClone(duplicate.account) as Account

describe('pure duplicate-credit policy', () => {
  test('an eligible proposal produces only eligibility, never an issued credit', () => {
    expect(decide(account(), proposal)).toEqual({
      accountId: 'acct-demo',
      disposition: 'credit_eligible',
      reason: 'verified_duplicate',
      reply:
        'The duplicate payment is eligible for a credit of USD 24.00. No credit has been issued.',
      credit: { chargeId: 'ch-102', amountCents: 2400 },
      proposal,
    })
  })

  for (const [name, input, suggested, disposition, reason] of [
    ['a plausible but wrong credit', notDuplicate, proposal, 'no_credit', 'no_duplicate_payment'],
    [
      'an over-limit credit',
      overLimit,
      { ...proposal, requestedCreditCents: 7500 },
      'manual_review',
      'above_credit_limit',
    ],
    [
      'an inflated amount',
      duplicate,
      { ...proposal, requestedCreditCents: 4900 },
      'manual_review',
      'amount_mismatch',
    ],
    [
      'a charge outside this account',
      duplicate,
      { ...proposal, chargeId: 'other-account-charge' },
      'manual_review',
      'unknown_charge',
    ],
    [
      'an ambiguous request',
      duplicate,
      { chargeId: null, requestedCreditCents: 0 },
      'manual_review',
      'ambiguous_request',
    ],
  ] as const) {
    test(`policy prevents ${name} using ordinary proposal data`, () => {
      expect(decide(input.account as Account, suggested)).toMatchObject({
        disposition,
        reason,
        credit: null,
        proposal: suggested,
      })
    })
  }

  test('an already refunded charge cannot become a second credit', () => {
    const records = account()
    records.charges[1]!.status = 'refunded'
    expect(decide(records, proposal)).toMatchObject({
      disposition: 'no_credit',
      reason: 'already_refunded',
      credit: null,
    })
  })

  test('a refunded earlier charge is not evidence of two settled payments', () => {
    const records = account()
    records.charges[0]!.status = 'refunded'
    expect(decide(records, proposal)).toMatchObject({
      disposition: 'no_credit',
      reason: 'no_duplicate_payment',
      credit: null,
    })
  })

  test('the original payment cannot be credited as the later duplicate', () => {
    expect(decide(account(), { ...proposal, chargeId: 'ch-101' })).toMatchObject({
      disposition: 'no_credit',
      reason: 'no_duplicate_payment',
      credit: null,
    })
  })

  test('equal invoice IDs with different amounts do not establish a duplicate', () => {
    const records = account()
    records.charges[0]!.amountCents = 2300
    expect(decide(records, proposal)).toMatchObject({
      disposition: 'no_credit',
      reason: 'no_duplicate_payment',
      credit: null,
    })
  })

  test('equal amounts on different invoices do not establish a duplicate', () => {
    const records = account()
    records.charges[0]!.invoiceId = 'another-invoice'
    expect(decide(records, proposal)).toMatchObject({
      disposition: 'no_credit',
      reason: 'no_duplicate_payment',
      credit: null,
    })
  })

  test('the reviewed ceiling allows exactly USD 50 and excludes USD 50.01', () => {
    for (const amount of [5000, 5001]) {
      const records = account()
      for (const charge of records.charges) charge.amountCents = amount
      expect(decide(records, { ...proposal, requestedCreditCents: amount }).disposition).toBe(
        amount === 5000 ? 'credit_eligible' : 'manual_review',
      )
    }
  })

  test('policy does not mutate authenticated records or the proposal', () => {
    const records = account()
    const before = structuredClone(records)
    const suggested = structuredClone(proposal)
    decide(records, suggested)
    expect(records).toEqual(before)
    expect(suggested).toEqual(proposal)
  })
})
