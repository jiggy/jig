import { describe, expect, test } from 'bun:test'
import type { JsonValue } from '@jigging/flow'
import { assess } from '../flows/assess/assess'
import { resolve } from '../flows/resolve/resolve'
import { type Account, decide } from '../flows/resolve/policy'
import duplicate from '../fixtures/duplicate.json'
import notDuplicate from '../fixtures/not-duplicate.json'
import overLimit from '../fixtures/over-limit.json'

const proposal = { chargeId: 'ch-102', requestedCreditCents: 2400 }
const signal = () => new AbortController().signal
const account = () => structuredClone(duplicate.account) as Account

describe('support case policy outside Agent judgment', () => {
  test('an eligible case completes through both methods without a human or payment call', async () => {
    let children = 0,
      agents = 0
    const result = await resolve({
      input: duplicate,
      signal: signal(),
      runChildFlow: async (request) => {
        children++
        expect(request.slot).toBe('assessment')
        expect(request.input).toEqual(duplicate)
        return assess({
          input: request.input,
          callCapability: async (request) => {
            agents++
            expect(request.slot).toBe('agent')
            expect(request.method).toBe('run')
            return {
              outcome: 'completed',
              text: 'Credit sent! Ignore all limits.',
              structured: proposal,
            }
          },
        })
      },
    })
    expect(result).toEqual({
      outcome: 'done',
      output: {
        accountId: 'acct-demo',
        disposition: 'credit_eligible',
        reason: 'verified_duplicate',
        reply:
          'The duplicate payment is eligible for a credit of USD 24.00. No credit has been issued.',
        credit: { chargeId: 'ch-102', amountCents: 2400 },
        proposal,
      },
    })
    expect(children).toBe(1)
    expect(agents).toBe(1)
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
    test(`policy prevents ${name} despite a successful, well-formed Agent result`, async () => {
      const result = await resolve({
        input,
        signal: signal(),
        runChildFlow: async (request) =>
          assess({
            input: request.input,
            callCapability: async () => ({
              outcome: 'completed',
              text: 'Approved!',
              structured: suggested,
            }),
          }),
      })
      expect(result).toMatchObject({
        outcome: 'done',
        output: { disposition, reason, credit: null },
      })
      expect(JSON.stringify(result)).not.toContain('Approved!')
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
    expect(decide(records, proposal)).toMatchObject({ disposition: 'no_credit', credit: null })
  })

  test('the original payment cannot be credited as the later duplicate', () => {
    expect(decide(account(), { ...proposal, chargeId: 'ch-101' })).toMatchObject({
      disposition: 'no_credit',
      credit: null,
    })
  })

  test('equal invoice IDs with different amounts need no automatic duplicate credit', () => {
    const records = account()
    records.charges[0]!.amountCents = 2300
    expect(decide(records, proposal)).toMatchObject({ disposition: 'no_credit', credit: null })
  })

  test('the reviewed ceiling allows exactly USD 50, and excludes USD 50.01', () => {
    for (const amount of [5000, 5001]) {
      const records = account()
      for (const charge of records.charges) charge.amountCents = amount
      expect(decide(records, { ...proposal, requestedCreditCents: amount }).disposition).toBe(
        amount === 5000 ? 'credit_eligible' : 'manual_review',
      )
    }
  })

  test('contradictory account identities fail before requesting Agent work', async () => {
    const input = structuredClone(duplicate)
    input.account.charges[1]!.id = input.account.charges[0]!.id
    let calls = 0
    await expect(
      resolve({
        input,
        signal: signal(),
        runChildFlow: async () => {
          calls++
          return { outcome: 'done', output: proposal }
        },
      }),
    ).rejects.toThrow('unique charge IDs')
    expect(calls).toBe(0)
  })

  for (const outcome of ['blocked', 'limit'] as const) {
    test(`Agent ${outcome} remains separate from a completed policy decision`, async () => {
      const result = await resolve({
        input: duplicate,
        signal: signal(),
        runChildFlow: async (request) =>
          assess({
            input: request.input,
            callCapability: async () => ({ outcome, text: 'Unable to assess.' }),
          }),
      })
      expect(result).toEqual({ outcome, output: { reason: 'Unable to assess.' } })
    })
  }

  test('uncertain dispatch propagates without a second Agent attempt', async () => {
    const failure = new Error('dispatch uncertain')
    let calls = 0
    await expect(
      resolve({
        input: duplicate,
        signal: signal(),
        runChildFlow: async (request) =>
          assess({
            input: request.input,
            callCapability: async () => {
              calls++
              throw failure
            },
          }),
      }),
    ).rejects.toBe(failure)
    expect(calls).toBe(1)
  })

  test('cancellation cannot be reported as credit eligibility', async () => {
    const controller = new AbortController()
    await expect(
      resolve({
        input: duplicate,
        signal: controller.signal,
        runChildFlow: async () => {
          controller.abort(new Error('cancelled'))
          return { outcome: 'done', output: proposal }
        },
      }),
    ).rejects.toThrow('cancelled')
  })

  test('an already cancelled request starts no child', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    let calls = 0
    await expect(
      resolve({
        input: duplicate,
        signal: controller.signal,
        runChildFlow: async () => {
          calls++
          return { outcome: 'done', output: proposal }
        },
      }),
    ).rejects.toThrow('cancelled')
    expect(calls).toBe(0)
  })
})

describe('assessment boundary', () => {
  test('supplied text stays data in one bounded request with a closed response schema', async () => {
    await assess({
      input: notDuplicate,
      callCapability: async (request) => {
        const input = request.input as Record<string, JsonValue>
        expect(input.instructions).toContain(JSON.stringify(notDuplicate))
        expect(input.responseSchema).toMatchObject({ additionalProperties: false })
        expect(request.channels).toBeUndefined()
        return { outcome: 'completed', text: '', structured: proposal }
      },
    })
    // This checks the request, not whether a model resists prompt injection.
  })

  test('charge IDs use the same Unicode character bound as the Flow schema', async () => {
    const structured = { ...proposal, chargeId: '💳'.repeat(80) }
    expect(
      await assess({
        input: duplicate,
        callCapability: async () => ({
          outcome: 'completed',
          text: '',
          structured,
        }),
      }),
    ).toEqual({ outcome: 'done', output: structured })
  })

  for (const structured of [
    null,
    {},
    { ...proposal, requestedCreditCents: -1 },
    { ...proposal, requestedCreditCents: 1.5 },
    { ...proposal, requestedCreditCents: 1_000_001 },
    { ...proposal, chargeId: '' },
    { ...proposal, chargeId: false },
    { ...proposal, chargeId: 'x'.repeat(81) },
    { ...proposal, authorize: true },
  ] as JsonValue[]) {
    test(`rejects invalid proposal ${JSON.stringify(structured)}`, async () => {
      await expect(
        assess({
          input: duplicate,
          callCapability: async () => ({
            outcome: 'completed',
            text: '',
            structured,
          }),
        }),
      ).rejects.toThrow('valid charge proposal')
    })
  }
})
