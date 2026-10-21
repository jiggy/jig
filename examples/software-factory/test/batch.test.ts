import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sampleBatch from '../batch.json'
import { batchJobs, patchConflicts } from '../flows/factory/batch.ts'
import { loadChecks } from '../flows/factory/checks.ts'
import { readRepairInput } from '../flows/factory/files.ts'

const job = {
  id: 'first',
  directory: 'first',
  checks: 'logs',
  issue: 'Repair both defects.',
  editPaths: ['src/parse.ts', 'src/report.ts'],
}

test('the shipped batch validates and selects its known repair budgets explicitly', () => {
  expect(batchJobs(sampleBatch)).toEqual(sampleBatch.jobs)
  expect(sampleBatch.jobs).toHaveLength(2)
  expect(sampleBatch.jobs.map((entry) => entry.method)).toEqual(['p1', 'p2'])
})

test('batch validates paths, identity, check policy and bounded size', () => {
  expect(batchJobs({ jobs: [job] })).toEqual([job])
  for (const input of [
    { jobs: [] },
    { jobs: [job, job] },
    { jobs: [job, { ...job, id: 'b' }, { ...job, id: 'c' }] },
    { jobs: [{ ...job, directory: '../outside' }] },
    { jobs: [{ ...job, directory: '/tmp' }] },
    { jobs: [{ ...job, checks: '../invented' }] },
    { jobs: [{ ...job, method: 'flow:unreviewed' }] },
    { jobs: [{ ...job, cancelAfterMs: 0 }] },
    { jobs: [{ ...job, id: '../out' }] },
  ])
    expect(() => batchJobs(input)).toThrow()
})

test('patch overlap is reported, never silently combined', () => {
  expect(
    patchConflicts([
      { job: 'a', path: 'project/src/a.ts', content: 'one' },
      { job: 'b', path: 'project/src/a.ts', content: 'two' },
    ]),
  ).toEqual([{ path: 'project/src/a.ts', jobs: ['a', 'b'], conflicting: true }])
})

test('actual project capture rejects missing checks, invalid edit scope and empty files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-factory-capture-'))
  try {
    const source = join(root, 'project')
    await cp(join(import.meta.dir, '../fixtures/log-report'), source, { recursive: true })
    const cases = await loadChecks('logs')
    const request = { issue: job.issue, editPaths: job.editPaths }
    const captured = await readRepairInput(request, source, cases)
    expect(captured.files['src/parse.ts']).toContain('status')
    expect(captured.cases).toEqual(cases)
    await expect(loadChecks('not-installed')).rejects.toThrow('not-installed-cases.json')
    await expect(
      readRepairInput({ ...request, editPaths: ['test/project.test.ts'] }, source, cases),
    ).rejects.toThrow('Select existing')
    const empty = join(root, 'empty')
    await mkdir(join(empty, 'src'), { recursive: true })
    await writeFile(join(empty, 'src/parse.ts'), '')
    await expect(
      readRepairInput({ ...request, editPaths: ['src/parse.ts'] }, empty, cases),
    ).rejects.toThrow('captured content')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
