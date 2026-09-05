import { describe, expect, test } from 'bun:test'

import {
  createPrivateBunPreparationBudget,
  PRIVATE_BUN_PROJECT_PREPARATION_LIMITS,
} from '../src/internal/bun-native-preparation-budget.js'

describe('private aggregate Bun preparation budget', () => {
  test('bounds distinct actual preparations and ignores duplicate reservations', () => {
    const budget = createPrivateBunPreparationBudget(new AbortController().signal)
    try {
      for (
        let index = 0;
        index < PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.distinctPackages;
        index += 1
      ) {
        budget.reserve(`sha256:${index.toString(16).padStart(64, '0')}`, `flows/${index}`)
      }
      budget.reserve(`sha256:${'0'.repeat(64)}`, 'flows/reused')
      expect(() => budget.reserve(`sha256:${'f'.repeat(64)}`, 'flows/overflow')).toThrow(
        'distinct dependency preparations',
      )
    } finally {
      budget.dispose()
    }
  })

  test('accepts the exact aggregate byte ceiling and rejects one byte more', () => {
    const budget = createPrivateBunPreparationBudget(new AbortController().signal)
    try {
      budget.retain([{ size: PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.preparedBytes }], 'flows/exact')
      expect(() => budget.retain([{ size: 1 }], 'flows/overflow')).toThrow(
        'project dependency preparation exceeds',
      )
    } finally {
      budget.dispose()
    }
  })

  test('inherits cancellation and has one fixed absolute deadline', () => {
    const parent = new AbortController()
    const before = Date.now()
    const budget = createPrivateBunPreparationBudget(parent.signal)
    try {
      expect(budget.deadlineUnixMs).toBeGreaterThanOrEqual(
        before + PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.wallClockMs,
      )
      expect(budget.deadlineUnixMs).toBeLessThanOrEqual(
        Date.now() + PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.wallClockMs,
      )
      parent.abort(new Error('closed'))
      expect(() => budget.reserve(`sha256:${'0'.repeat(64)}`, 'flows/value')).toThrow('closed')
    } finally {
      budget.dispose()
    }
  })
})
