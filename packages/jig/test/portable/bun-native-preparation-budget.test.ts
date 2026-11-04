import { describe, expect, test } from 'bun:test'
import {
  createPrivateBunPreparationBudget,
  PRIVATE_BUN_PROJECT_PREPARATION_LIMITS,
} from '../../src/internal/bun-native-preparation-budget.js'
import {
  DEFAULT_PROJECT_DEPENDENCY_LIMITS,
  DEPENDENCY_PREPARATION_LIMIT_POLICY,
} from '../../src/project/limits.js'

describe('private aggregate Bun preparation budget', () => {
  test('bounds distinct actual preparations and ignores duplicate reservations', () => {
    const budget = createPrivateBunPreparationBudget(new AbortController().signal)
    try {
      for (let index = 0; index < DEFAULT_PROJECT_DEPENDENCY_LIMITS.maxPreparations; index += 1) {
        budget.reserve(`sha256:${index.toString(16).padStart(64, '0')}`, `flows/${index}`)
      }
      budget.reserve(`sha256:${'0'.repeat(64)}`, 'flows/reused')
      let failure: unknown
      try {
        budget.reserve(`sha256:${'f'.repeat(64)}`, 'flows/overflow')
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        kind: 'invalid',
        code: 'PACKAGE_BUN_PROJECT_COUNT_LIMIT',
        path: 'flows/overflow',
        preparationLimit: { dimension: 'preparations', observed: 17, maximum: 16 },
      })
    } finally {
      budget.dispose()
    }
  })

  for (const maximum of [1, 32, DEPENDENCY_PREPARATION_LIMIT_POLICY.maximum.maxPreparations]) {
    test(`enforces an explicit count allowance of ${maximum} with duplicate reuse`, () => {
      const budget = createPrivateBunPreparationBudget(new AbortController().signal)
      const deadline = budget.deadlineUnixMs
      try {
        for (let index = 0; index < maximum; index += 1)
          budget.reserve(
            `sha256:${index.toString(16).padStart(64, '0')}`,
            `flows/${index}`,
            maximum,
          )
        expect(() =>
          budget.reserve(`sha256:${'0'.repeat(64)}`, 'flows/reused', maximum),
        ).not.toThrow()
        let failure: unknown
        try {
          budget.reserve(`sha256:${'f'.repeat(64)}`, 'flows/overflow', maximum)
        } catch (error) {
          failure = error
        }
        expect(failure).toMatchObject({
          code: 'PACKAGE_BUN_PROJECT_COUNT_LIMIT',
          preparationLimit: {
            dimension: 'preparations',
            observed: maximum + 1,
            maximum,
          },
        })
        // Reserving more packages never renews the shared review deadline.
        expect(budget.deadlineUnixMs).toBe(deadline)
      } finally {
        budget.dispose()
      }
    })
  }

  test('rejects invalid count allowances even for a previously reserved package', () => {
    const budget = createPrivateBunPreparationBudget(new AbortController().signal)
    const digest = `sha256:${'0'.repeat(64)}`
    try {
      budget.reserve(digest, 'flows/value')
      for (const maximum of [0, -1, 1.5, 257, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
        expect(() => budget.reserve(digest, 'flows/value', maximum)).toThrow('maxPreparations')
      expect(() => budget.reserve(digest, 'flows/value', 1)).not.toThrow()
    } finally {
      budget.dispose()
    }
  })

  test('accepts the exact aggregate byte ceiling and rejects one byte more', () => {
    const budget = createPrivateBunPreparationBudget(new AbortController().signal)
    try {
      budget.reserve(
        `sha256:${'0'.repeat(64)}`,
        'flows/exact',
        DEPENDENCY_PREPARATION_LIMIT_POLICY.maximum.maxPreparations,
      )
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
  for (const [suiteCaseIndex, suiteCaseValue] of [
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ].entries()) {
    test(
      'rejects invalid metadata size without consuming budget: %s' +
        ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
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
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
    )
  }
})
