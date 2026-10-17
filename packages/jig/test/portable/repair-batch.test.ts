import { expect, test } from 'bun:test'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadChecks } from '../../../../examples/tested-patch/flows/project/checks.ts'
import { readRepairInput } from '../../../../examples/tested-patch/flows/project/files.ts'
import { batchJobs, patchConflicts } from '../fixtures/repair-batch/flows/project/batch.ts'

const job = {
  id: 'first',
  directory: 'first',
  checks: 'logs',
  issue: 'Repair both defects.',
  editPaths: ['src/parse.ts', 'src/report.ts'],
}

test('batch validates path, identity, check policy and bounded size data', () => {
  expect(batchJobs({ jobs: [job] })).toEqual([job])
  for (const input of [
    { jobs: [] },
    { jobs: [job, job] },
    { jobs: [job, { ...job, id: 'b' }, { ...job, id: 'c' }] },
    { jobs: [{ ...job, directory: '../outside' }] },
    { jobs: [{ ...job, directory: '/tmp' }] },
    { jobs: [{ ...job, checks: '../invented' }] },
    { jobs: [{ ...job, cancelAfterMs: 0 }] },
    { jobs: [{ ...job, id: '../out' }] },
  ])
    expect(() => batchJobs(input)).toThrow()
})
test('patch overlap data is reported, never silently combined', () => {
  expect(
    patchConflicts([
      { job: 'a', path: 'project/src/a.ts', content: 'one' },
      { job: 'b', path: 'project/src/a.ts', content: 'two' },
    ]),
  ).toEqual([{ path: 'project/src/a.ts', jobs: ['a', 'b'], conflicting: true }])
})

test('actual check files and project capture reject a missing check set and unapproved edit path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-batch-input-'))
  try {
    await cp(
      join(import.meta.dir, '../../../../examples/tested-patch/fixtures/log-report'),
      join(root, 'first'),
      { recursive: true },
    )
    await expect(loadChecks('not-installed')).rejects.toThrow('not-installed-cases.json')
    await expect(
      readRepairInput(
        { issue: job.issue, editPaths: ['test/project.test.ts'] },
        join(root, 'first'),
      ),
    ).rejects.toThrow('Select existing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
