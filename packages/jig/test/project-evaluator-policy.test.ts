import { expect, test } from 'bun:test'

import { privateAuthorEvaluatorWallClockCeilingMs } from '../src/internal/project-evaluator-policy.js'

test('batch overhead is bounded without changing the single-entry ceiling', () => {
  expect(privateAuthorEvaluatorWallClockCeilingMs(1)).toBe(3_000)
  expect(privateAuthorEvaluatorWallClockCeilingMs(3)).toBe(12_500)
  expect(privateAuthorEvaluatorWallClockCeilingMs(256)).toBe(898_000)
})
