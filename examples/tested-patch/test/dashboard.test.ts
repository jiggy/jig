import { expect, test } from 'bun:test'
import { type ViewSnapshot, validateReportingMessage } from '@jigging/reporting'
import { patchReviewView } from '../flows/project/dashboard.ts'
import {
  checksView as workerChecks,
  repairView as workerRequest,
} from '../flows/repair/dashboard.ts'
import { input } from './fixture.ts'

function checked(view: ViewSnapshot) {
  const item = validateReportingMessage({ kind: 'view', id: 'test', title: 'Domain view', ...view })
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
  return item as any
}
const check = {
  repositoryTestsPassed: false,
  accepted: false,
  acceptance: Array.from({ length: 8 }, (_, index) => ({
    id: String(index) + '\u0001'.repeat(62),
    passed: index === 0,
  })),
}

test('the complete review page bounds escaped input and compares all fixed checks without child call links', () => {
  const request = {
    ...input,
    issue: 'G' + '\u0001'.repeat(7999),
    editPaths: Array.from({ length: 8 }, (_, index) => `src/${index}${'p'.repeat(240)}.ts`),
  }
  const acceptance = {
    ready: false,
    reason: '\u0001'.repeat(4096),
    baseline: check,
    attempts: [{ evaluation: check }, { evaluation: check }],
    proposals: [],
  }
  const item = checked(
    patchReviewView({
      phase: 'ready',
      request,
      captured: input,
      checked: acceptance,
      files: ['review/summary.txt'],
    }),
  )
  expect(JSON.stringify(item)).toContain('[Excerpt; complete value')
  expect(JSON.stringify(item)).not.toContain(input.files['src/cli.ts']!)
  const comparison = item.sections[2].blocks[0]
  expect(comparison.rows).toHaveLength(9)
  expect(comparison.columns.map((column: any) => column.label)).toEqual([
    'Check',
    'Original',
    'Proposal 1',
    'Proposal 2',
  ])
  expect(JSON.stringify(item)).not.toContain('"kind":"call"')
  const result = {
    outcome: 'blocked',
    output: { reason: acceptance.reason, baseline: check, attempts: acceptance.attempts },
  }
  checked(workerRequest(request, result))
  const worker = checked(workerChecks(result, false, true))
  expect(JSON.stringify(worker)).toContain('"operationId":"attempt-2-8"')
  expect(worker.summary).toContain('provisional')
})

test('unvalidated and interrupted work exposes no final file references', () => {
  const pending = checked(patchReviewView({ phase: 'checking', request: input, captured: input }))
  expect(JSON.stringify(pending)).toContain('No proposal has been accepted')
  expect(JSON.stringify(pending)).not.toContain('"kind":"artifact"')
  const interrupted = checked(
    patchReviewView({ phase: 'failed', request: input, reason: 'The export is unconfirmed.' }),
  )
  expect(JSON.stringify(interrupted)).toContain('The export is unconfirmed.')
  expect(JSON.stringify(interrupted)).not.toContain('"kind":"artifact"')
})

test('the accepted page links the patch and original requested goal after export', () => {
  const ready = checked(
    patchReviewView({
      phase: 'ready',
      request: input,
      checked: {
        ready: true,
        reason: 'Checks passed.',
        baseline: check,
        attempts: [{ evaluation: check }],
        proposals: [],
      },
      files: ['review/goal.txt', 'review/review.patch'],
    }),
  )
  expect(JSON.stringify(ready)).toContain('independently validated')
  expect(ready.sections.at(-1).blocks[0].rows.at(-1).cells.content).toEqual({
    kind: 'artifact',
    attachment: 'deliverables',
    path: 'review/review.patch',
  })
})
