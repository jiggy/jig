import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OperationError, type RunContext } from '@jigging/flow'
import { batchJobs, patchConflicts, repairBatch } from '../flows/project/batch.ts'
import { syntheticRepair } from './fixture.ts'

const job = {
  id: 'first',
  directory: 'first',
  checks: 'logs',
  issue: 'Repair both defects.',
  editPaths: ['src/parse.ts', 'src/report.ts'],
}
test('batch validates its paths, identity, check policy, and bounded size before dispatch', () => {
  expect(batchJobs({ jobs: [job] })).toEqual([job])
  for (const input of [
    { jobs: [] },
    { jobs: [job, job] },
    { jobs: [job, { ...job, id: 'b' }, { ...job, id: 'c' }] },
    { jobs: [{ ...job, directory: '../outside' }] },
    { jobs: [{ ...job, directory: '/tmp' }] },
    { jobs: [{ ...job, checks: 'invented' }] },
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
test('synthetic selected cancellation preserves the other worker and its verified patch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-batch-unit-'))
  try {
    const source = join(root, 'source'),
      out = join(root, 'out')
    await mkdir(source)
    await mkdir(out)
    await cp(join(import.meta.dir, '../fixtures/log-report'), join(source, 'first'), {
      recursive: true,
    })
    await cp(join(import.meta.dir, '../fixtures/log-report'), join(source, 'second'), {
      recursive: true,
    })
    const { result } = await syntheticRepair()
    let active = 0,
      peak = 0
    const saves: any[] = []
    const actual = await repairBatch({
      input: {
        jobs: [
          { ...job, cancelAfterMs: 20 },
          { ...job, id: 'second', directory: 'second' },
        ],
      },
      attachments: {
        source: { access: 'read', path: source },
        deliverables: { access: 'read-write', path: out },
      },
      signal: new AbortController().signal,
      callCapability: async (call) => {
        saves.push(structuredClone(call.input))
        return { sequence: saves.length, digest: 'synthetic' }
      },
      runChildFlow: async (call, options) => {
        active++
        peak = Math.max(peak, active)
        try {
          if (call.operationId === 'repair:first')
            await new Promise<void>((_, reject) => {
              options!.signal!.addEventListener(
                'abort',
                () => reject(new OperationError('CANCELLED', 'Selected worker stopped.')),
                { once: true },
              )
            })
          await Bun.sleep(1)
          return result
        } finally {
          active--
        }
      },
    } as unknown as RunContext)
    expect(peak).toBe(2)
    expect(saves.map((s) => s.sequence)).toEqual([1, 2])
    expect(saves[0].evidence.pending).toEqual(['first'])
    expect(saves[0].files['second/review.patch']).toContain('--- a/src/report.ts')
    expect(saves[1].evidence.pending).toEqual([])
    expect(actual.outcome).toBe('blocked')
    expect((actual.output as any).jobs).toMatchObject([
      {
        id: 'first',
        status: 'failed',
        code: 'CANCELLED',
        baseDigest: expect.stringMatching(/^sha256:/),
      },
      { id: 'second', status: 'settled', ready: true },
    ])
    expect((await readdir(out)).sort()).toEqual(['second', 'summary.txt'])
    expect(await readFile(join(out, 'second/review.patch'), 'utf8')).toContain(
      '--- a/src/report.ts',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a bad second project prevents every dispatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-batch-invalid-'))
  try {
    await cp(join(import.meta.dir, '../fixtures/log-report'), join(root, 'first'), {
      recursive: true,
    })
    let calls = 0
    await expect(
      repairBatch({
        input: {
          jobs: [
            job,
            { ...job, id: 'second', directory: 'first', editPaths: ['test/project.test.ts'] },
          ],
        },
        attachments: {
          source: { access: 'read', path: root },
          deliverables: { access: 'read-write', path: join(root, 'unused') },
        },
        signal: new AbortController().signal,
        runChildFlow: async () => {
          calls++
          throw new Error('must not dispatch')
        },
      } as unknown as RunContext),
    ).rejects.toThrow('Select existing')
    expect(calls).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('root interruption preserves the saved first patch without claiming the unfinished job passed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-progress-unit-'))
  const abort = new AbortController()
  const saves: any[] = []
  try {
    await cp(join(import.meta.dir, '../fixtures/log-report'), join(root, 'first'), {
      recursive: true,
    })
    await mkdir(join(root, 'out'))
    const { result } = await syntheticRepair()
    await expect(
      repairBatch({
        input: { jobs: [job, { ...job, id: 'unfinished' }] },
        signal: abort.signal,
        attachments: {
          source: { access: 'read', path: root },
          deliverables: { access: 'read-write', path: join(root, 'out') },
        },
        runChildFlow: async (call) => {
          if (call.operationId === 'repair:first') return result
          await new Promise((_, reject) =>
            abort.signal.addEventListener('abort', () => reject(abort.signal.reason), {
              once: true,
            }),
          )
          throw new Error('unfinished worker must not complete')
        },
        callCapability: async (call) => {
          saves.push(structuredClone(call.input))
          abort.abort(new Error('operator interruption'))
          return { sequence: 1, digest: 'synthetic' }
        },
      } as unknown as RunContext),
    ).rejects.toThrow('operator interruption')
    expect(saves).toHaveLength(1)
    expect(saves[0].evidence.pending).toEqual(['unfinished'])
    expect(saves[0].evidence.jobs).toHaveLength(1)
    expect(saves[0].files['first/review.patch']).toContain('--- a/src/report.ts')
    expect(Object.keys(saves[0].files).some((p) => p.startsWith('unfinished/'))).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
