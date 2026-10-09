import { expect, test } from 'bun:test'
import { type ViewSnapshot, validateUserUpdate } from '@jigging/user-updates'

function checked(view: ViewSnapshot, id = 'test') {
  const item = validateUserUpdate({ kind: 'view', id, title: 'Domain view', ...view })
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
  return item as any
}

import { checksView, evidenceView, repairView } from '../flows/project/dashboard.ts'
import {
  checksView as workerChecks,
  repairView as workerRequest,
} from '../flows/repair/dashboard.ts'
import { input } from './fixture.ts'

test('maximum repair views expose check meaning without source text or child-namespace call links', () => {
  const check = {
    repositoryTestsPassed: false,
    accepted: false,
    acceptance: Array.from({ length: 8 }, (_, index) => ({
      id: String(index) + '\u0001'.repeat(62),
      passed: index === 0,
    })),
  }
  const maximal = {
    ...input,
    issue: 'G' + '\u0001'.repeat(7999),
    editPaths: Array.from({ length: 8 }, (_, index) => `src/${index}${'p'.repeat(240)}.ts`),
  }
  const result = {
    outcome: 'blocked',
    output: {
      reason: '\u0001'.repeat(4096),
      baseline: check,
      attempts: [{ evaluation: check }, { evaluation: check }],
    },
  }
  for (const view of [repairView, workerRequest]) {
    const item = checked(view(maximal, result))
    expect(JSON.stringify(item)).toContain('[Excerpt; complete value')
    expect(JSON.stringify(item)).not.toContain(input.files['src/cli.ts']!)
  }
  const caller = checked(checksView(result, true))
  expect(caller.sections[0].blocks[1].rows).toHaveLength(27)
  expect(JSON.stringify(caller)).not.toContain('"kind":"call"')
  const worker = checked(workerChecks(result, false, true))
  expect(JSON.stringify(worker)).toContain('"operationId":"attempt-2-8"')
  expect(worker.summary).toContain('provisional')
  expect(caller.summary).toContain('recomputed')
})

test('review references require caller acceptance and retain the exact requested goal file', () => {
  const pending = checked(evidenceView())
  expect(pending.sections[0].blocks[0].rows).toEqual([])
  expect(checked(repairView(input, { outcome: 'done', output: {} })).summary).toContain(
    'Worker reports',
  )
  expect(checked(repairView(input, { outcome: 'done', output: {} }, true)).summary).toContain(
    'independently validated',
  )
  const evidence = checked(
    evidenceView(['goal.txt', 'summary.txt', 'proposal-1.patch', 'review.patch']),
  )
  expect(evidence.sections[0].blocks[0].rows.at(-1).cells.content).toEqual({
    kind: 'artifact',
    attachment: 'deliverables',
    path: 'review.patch',
  })
  expect(evidence.summary).toContain('after verified packet delivery')
})
