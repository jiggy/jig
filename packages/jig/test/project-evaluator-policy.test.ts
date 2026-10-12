import { expect, test } from 'bun:test'

import {
  PRIVATE_AUTHOR_EVALUATOR_MACOS_ENTRY_MS,
  privateAuthorEvaluatorWallClockCeilingMs,
} from '../src/internal/project-evaluator-policy.js'

test('batch overhead is bounded without changing the single-entry ceiling', () => {
  expect(privateAuthorEvaluatorWallClockCeilingMs(1)).toBe(3_000)
  expect(privateAuthorEvaluatorWallClockCeilingMs(3)).toBe(12_500)
  expect(privateAuthorEvaluatorWallClockCeilingMs(256)).toBe(898_000)
})

test('Mac batch overhead preserves the existing ten-second declaration ceiling', () => {
  expect(privateAuthorEvaluatorWallClockCeilingMs(1, PRIVATE_AUTHOR_EVALUATOR_MACOS_ENTRY_MS)).toBe(
    10_000,
  )
  expect(privateAuthorEvaluatorWallClockCeilingMs(3, PRIVATE_AUTHOR_EVALUATOR_MACOS_ENTRY_MS)).toBe(
    33_500,
  )
})
