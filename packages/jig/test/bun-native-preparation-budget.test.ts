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

  test('charges layout metadata to the same aggregate byte ceiling', () => {
    const budget = createPrivateBunPreparationBudget(new AbortController().signal)
    try {
      const maximum = PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.preparedBytes
      budget.retain([{ size: maximum - 1024 }], 'flows/first', 512)
      expect(() => budget.retain([], 'flows/metadata-overflow', 513)).toThrow(
        'project dependency preparation exceeds',
      )
      // A rejected retention must not consume capacity.
      expect(() => budget.retain([], 'flows/exact', 512)).not.toThrow()
      expect(() => budget.retain([], 'flows/one-more', 1)).toThrow(
        'project dependency preparation exceeds',
      )
    } finally {
      budget.dispose()
    }
  })

  test.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid metadata size without consuming budget: %s',
    (metadataBytes) => {
      const budget = createPrivateBunPreparationBudget(new AbortController().signal)
      try {
        expect(() => budget.retain([], 'flows/invalid', metadataBytes)).toThrow(
          'prepared metadata size is invalid',
        )
        expect(() =>
          budget.retain(
            [{ size: PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.preparedBytes }],
            'flows/exact',
          ),
        ).not.toThrow()
      } finally {
        budget.dispose()
      }
    },
  )
})
