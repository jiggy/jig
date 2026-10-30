import { expect, test } from 'bun:test'
import { type ViewSnapshot, validateReportingMessage } from '@jigging/reporting'
import { exportedPatchView } from '../flows/export-patch/dashboard.ts'
import { unifiedPatch } from '../flows/export-patch/patch.ts'
import { patchReviewOptions, patchReviewView } from '../flows/project/dashboard.ts'
import {
  repairViewOptions,
  checksView as workerChecks,
  repairView as workerRequest,
} from '../flows/repair/dashboard.ts'
import { input } from './fixture.ts'

test('application and specialist projections retain request identity across live updates', () => {
  const options = patchReviewOptions(input)
  expect(options).toEqual(patchReviewOptions({ ...input }))
  expect(options).toEqual(
    patchReviewOptions({
      ...input,
      files: Object.fromEntries(Object.entries(input.files).reverse()),
    }),
  )
  expect(options.landing).toBe(true)
  expect(options.target?.instanceKey).toMatch(/^[a-f0-9]{64}$/)
  expect(options.target?.instanceKey).not.toBe(
    patchReviewOptions({ ...input, issue: 'A separate repair request' }).target?.instanceKey,
  )
  expect(options.target?.instanceKey).not.toBe(
    patchReviewOptions({ ...input, files: { ...input.files, 'src/parse.ts': 'changed source' } })
      .target?.instanceKey,
  )
  const worker = repairViewOptions(input)
  expect(worker.repair.target?.subjectKey).toBe(options.target?.subjectKey)
  expect(worker.checks.target?.subjectKey).toBe(options.target?.subjectKey)
  expect(worker.repair.target?.definitionId).not.toBe(worker.checks.target?.definitionId)
  for (const [id, value] of Object.entries({ project: options, ...worker })) {
    validateReportingMessage({
      kind: 'view',
      id,
      ...value,
      ...patchReviewView({ phase: 'reading', request: input }),
    })
  }
})

test('exported patches retain literal diff formatting and a complete-file reference', () => {
  const diff = unifiedPatch('src/example.ts', 'const count = 1\n', 'const count = 2\n')
  const item = checked(
    exportedPatchView({ 'review.patch': diff, 'goal.txt': '<script>literal request</script>' }),
  )
  const rows = item.sections[0].blocks[0].rows
  expect(rows[0].details[0]).toEqual({
    kind: 'report',
    format: 'diff',
    text: diff,
    references: [{ kind: 'artifact', attachment: 'files', path: 'review/review.patch' }],
  })
  expect(rows[1].details[0].format).toBe('plain')
  expect(rows[1].details[0].text).toBe('<script>literal request</script>')
  const long = checked(exportedPatchView({ 'proposal-1.patch': 'x'.repeat(8192) }))
  expect(long.sections[0].blocks[0].rows[0].details[0].text).toContain('[Excerpt;')
  expect(long.sections[0].blocks[0].rows[0].details[0].references[0].path).toBe(
    'review/proposal-1.patch',
  )
})

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
