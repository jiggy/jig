import { describe, expect, test } from 'bun:test'
import type { JsonValue } from '@jigging/flow'
import { review } from '../flows/reviewer/review.ts'

async function reviewed(structured: JsonValue) {
  return review({
    input: {},
    settings: { reviewFocus: 'Check evidence support and unresolved approvals.' },
    callEffect: async () => ({ outcome: 'completed', text: 'Review complete.', structured }),
  })
}

describe('evidence reviewer findings', () => {
  test('approves only when no material findings remain', async () => {
    expect(await reviewed({ findings: [] })).toEqual({
      outcome: 'done',
      output: { verdict: 'approve', issues: [] },
    })
  })

  test('requires revision for a finding and preserves its reason', async () => {
    const reason = 'State that the staff roster still needs approval.'
    expect(await reviewed({ findings: [{ kind: 'revise', reason }] })).toEqual({
      outcome: 'done',
      output: { verdict: 'revise', issues: [reason] },
    })
  })

  test('a blocking finding takes precedence regardless of its position', async () => {
    const revise = { kind: 'revise', reason: 'Clarify the measurement plan.' }
    const blocked = { kind: 'blocked', reason: 'The supplied staffing records conflict.' }
    for (const findings of [
      [revise, blocked],
      [blocked, revise],
    ]) {
      expect(await reviewed({ findings })).toEqual({
        outcome: 'done',
        output: { verdict: 'blocked', issues: findings.map(({ reason }) => reason) },
      })
    }
  })

  test('rejects blank reasons and unknown finding kinds', async () => {
    await expect(reviewed({ findings: [{ kind: 'revise', reason: ' \n ' }] })).rejects.toThrow(
      'nonempty reason',
    )
    await expect(
      reviewed({ findings: [{ kind: 'approve', reason: 'Looks good.' }] }),
    ).rejects.toThrow('unknown review finding')
    await expect(reviewed({ findings: ['An unclassified concern.'] })).rejects.toThrow(
      'unknown review finding',
    )
    await expect(reviewed({ verdict: 'approve', issues: [] })).rejects.toThrow(
      'omitted its review findings',
    )
  })
})
