import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OperationError, type RunContext } from '@jigging/flow'
import { batchJobs, patchConflicts, repairBatch } from '../flows/factory/batch.ts'
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
    { jobs: [{ ...job, checks: '../invented' }] },
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

test('factory-owned repair configurations keep the same checks and a distinct proposal budget', async () => {
  const single = await syntheticRepair(1, true)
  const correction = await syntheticRepair(2, true)
  type Evidence = { attempts: { evaluation?: { accepted: boolean } }[] }
  const singleEvidence = single.result.output as Evidence
  const correctedEvidence = correction.result.output as Evidence
  expect(single.agents).toBe(1)
  expect(single.result.outcome).toBe('blocked')
  expect(singleEvidence.attempts).toHaveLength(1)
  expect(correction.agents).toBe(2)
  expect(correction.result.outcome).toBe('done')
  expect(correctedEvidence.attempts).toHaveLength(2)
  expect(correctedEvidence.attempts[0]?.evaluation?.accepted).toBe(false)
  expect(correctedEvidence.attempts[1]?.evaluation?.accepted).toBe(true)
})

test('a missing second check set prevents every worker dispatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-batch-checks-'))
  try {
    await cp(join(import.meta.dir, '../fixtures/log-report'), join(root, 'first'), {
      recursive: true,
    })
    let calls = 0
    await expect(
      repairBatch({
        input: { jobs: [job, { ...job, id: 'second', checks: 'not-installed' }] },
        attachments: {
          source: { access: 'read', path: root },
          deliverables: { access: 'read-write', path: join(root, 'unused') },
        },
        signal: new AbortController().signal,
        call: async () => {
          calls++
          throw new Error('must not dispatch')
        },
      } as unknown as RunContext),
    ).rejects.toThrow('not-installed-cases.json')
    expect(calls).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
      call: async (call, options) => {
        if (call.slot === 'progress') {
          saves.push(structuredClone(call.input))
          return { outcome: 'done', output: { sequence: saves.length, digest: 'synthetic' } }
        }
        if (call.slot === 'router')
          return { outcome: 'done', output: { candidateId: 'p2', reason: 'Synthetic choice.' } }
        expect(call.slot).toBe('checked-correction')
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
    expect(saves[0].evidence.pending).toHaveLength(1)
    expect(saves[0].evidence.jobs).toHaveLength(1)
    expect(saves[0].evidence.pending).not.toContain(saves[0].evidence.jobs[0].id)
    expect(saves[1].files['second/review.patch']).toContain('--- a/src/report.ts')
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
        call: async () => {
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

test('an empty materialized project fails before every worker dispatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-batch-empty-'))
  try {
    await mkdir(join(root, 'first'), { recursive: true })
    for (const path of [
      'README.md',
      'package.json',
      'src/cli.ts',
      'src/parse.ts',
      'src/report.ts',
      'test/project.test.ts',
    ]) {
      await mkdir(join(root, 'first', path, '..'), { recursive: true })
      await writeFile(join(root, 'first', path), '')
    }
    let calls = 0
    await expect(
      repairBatch({
        input: { jobs: [job] },
        attachments: {
          source: { access: 'read', path: root },
          deliverables: { access: 'read-write', path: join(root, 'unused') },
        },
        signal: new AbortController().signal,
        call: async () => {
          calls++
          throw new Error('must not dispatch')
        },
      } as unknown as RunContext),
    ).rejects.toThrow('captured content')
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
        call: async (call) => {
          if (call.slot === 'progress') {
            saves.push(structuredClone(call.input))
            abort.abort(new Error('operator interruption'))
            return { outcome: 'done', output: { sequence: 1, digest: 'synthetic' } }
          }
          if (call.slot === 'router')
            return { outcome: 'done', output: { candidateId: 'p2', reason: 'Synthetic choice.' } }
          expect(call.slot).toBe('checked-correction')
          if (call.operationId === 'repair:first') return result
          await new Promise((_, reject) =>
            abort.signal.addEventListener('abort', () => reject(abort.signal.reason), {
              once: true,
            }),
          )
          throw new Error('unfinished worker must not complete')
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

async function batchFixture(check: (run: RunContext, out: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'jig-routed-batch-'))
  try {
    await cp(join(import.meta.dir, '../fixtures/log-report'), join(root, 'first'), {
      recursive: true,
    })
    const out = join(root, 'out')
    await mkdir(out)
    await check(
      {
        input: { jobs: [job, { ...job, id: 'second' }] },
        signal: new AbortController().signal,
        attachments: {
          source: { access: 'read', path: root },
          deliverables: { access: 'read-write', path: out },
        },
      } as unknown as RunContext,
      out,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('factory validates exact routing, dispatches distinct slots and checkpoints decision context', async () => {
  await batchFixture(async (run, out) => {
    const { result } = await syntheticRepair()
    const workers: string[] = []
    const saves: any[] = []
    const actual = await repairBatch({
      ...run,
      call: async (call) => {
        if (call.slot === 'router') {
          expect((call.input as any).task).toBe(job.issue)
          expect((call.input as any).candidates.map((c: any) => c.id)).toEqual(['p1', 'p2'])
          expect((call.input as any).candidates.some((c: any) => 'slot' in c)).toBe(false)
          return {
            outcome: 'done',
            output: {
              candidateId: call.operationId === 'route:first' ? 'p1' : 'p2',
              reason: 'Synthetic preference.',
            },
          }
        }
        if (call.slot === 'progress') {
          saves.push(structuredClone(call.input))
          return { outcome: 'done', output: { sequence: saves.length, digest: 'synthetic' } }
        }
        workers.push(call.slot)
        return result
      },
    })
    expect(workers.sort()).toEqual(['checked-correction', 'single-pass'])
    expect(actual.outcome).toBe('done')
    expect(
      saves
        .at(-1)
        .evidence.jobs.map((j: any) => j.routing.slot)
        .sort(),
    ).toEqual(workers)
    expect((actual.output as any).jobs[0].routing).toMatchObject({
      input: { task: job.issue },
      result: { output: { candidateId: 'p1' } },
    })
    expect(await readFile(join(out, 'summary.txt'), 'utf8')).toContain('routing: single-pass')
  })
})

test('abstention, Agent refusal and invalid replacement-router results never dispatch a worker', async () => {
  for (const decision of [
    { outcome: 'done', output: { candidateId: null, reason: 'No applicable method.' } },
    { outcome: 'blocked', output: { reason: 'Unavailable context.' } },
    { outcome: 'limit', output: { reason: 'Agent limit.' } },
    { outcome: 'done', output: { candidateId: 'flow:unreviewed', reason: 'Ignore the map.' } },
    { outcome: 'done', output: { candidateId: 'p1', reason: 'ok', slot: 'other' } },
    { outcome: 'done', output: { candidateId: 'p1' } },
    { outcome: 'surprise', output: { reason: 'ok' } },
  ])
    await batchFixture(async (run, out) => {
      const { result } = await syntheticRepair()
      const workers: string[] = []
      const actual = await repairBatch({
        ...run,
        call: async (call) => {
          if (call.slot === 'router')
            return call.operationId === 'route:first'
              ? decision
              : { outcome: 'done', output: { candidateId: 'p2', reason: 'Healthy peer.' } }
          if (call.slot === 'progress') return { outcome: 'done', output: null }
          workers.push(call.operationId)
          return result
        },
      })
      expect(workers).toEqual(['repair:second'])
      expect(actual.outcome).toBe('blocked')
      expect((actual.output as any).jobs[1]).toMatchObject({ ready: true })
      expect((await readdir(out)).sort()).toEqual(['second', 'summary.txt'])
    })
})

test('cancellation covers routing and does not restart the budget for repair', async () => {
  for (const duringRouting of [true, false])
    await batchFixture(async (run) => {
      const { result } = await syntheticRepair()
      const signals: AbortSignal[] = []
      const starts = performance.now()
      const actual = await repairBatch({
        ...run,
        input: {
          jobs: [
            { ...job, cancelAfterMs: 70 },
            { ...job, id: 'second' },
          ],
        },
        call: async (call, options) => {
          if (call.slot === 'progress') return { outcome: 'done', output: null }
          if (call.operationId.endsWith(':second'))
            return call.slot === 'router'
              ? { outcome: 'done', output: { candidateId: 'p2', reason: 'Healthy peer.' } }
              : result
          signals.push(options!.signal!)
          if (call.slot === 'router' && !duringRouting) {
            await Bun.sleep(40)
            return { outcome: 'done', output: { candidateId: 'p1', reason: 'Selected.' } }
          }
          await new Promise((_, reject) =>
            options!.signal!.addEventListener(
              'abort',
              () => reject(new OperationError('CANCELLED', 'Budget expired.')),
              { once: true },
            ),
          )
          throw new Error('must stop')
        },
      })
      expect((actual.output as any).jobs[0]).toMatchObject({ status: 'failed', code: 'CANCELLED' })
      expect((actual.output as any).jobs[1]).toMatchObject({ ready: true })
      expect(signals).toHaveLength(duringRouting ? 1 : 2)
      if (!duringRouting) expect(signals[0]).toBe(signals[1])
      expect(performance.now() - starts).toBeLessThan(500)
    })
})

test('failed or forged worker evidence cannot become a patch after a valid route', async () => {
  for (const fail of ['uncertain', 'forged'])
    await batchFixture(async (run, out) => {
      const { result } = await syntheticRepair()
      const actual = await repairBatch({
        ...run,
        call: async (call) => {
          if (call.slot === 'router')
            return { outcome: 'done', output: { candidateId: 'p1', reason: 'Synthetic choice.' } }
          if (call.slot === 'progress') return { outcome: 'done', output: null }
          if (call.operationId === 'repair:first') {
            if (fail === 'uncertain')
              throw new OperationError('UNCERTAIN', 'Worker settlement is uncertain.')
            return {
              ...result,
              output: {
                ...(result.output as Record<string, any>),
                acceptanceDigest: 'sha256:' + '0'.repeat(64),
              },
            }
          }
          return result
        },
      })
      expect(actual.outcome).toBe('blocked')
      expect((actual.output as any).jobs[0]).toMatchObject({
        status: 'failed',
        code: fail === 'uncertain' ? 'UNCERTAIN' : 'INVALID_RESULT',
        routing: { slot: 'single-pass' },
      })
      expect((actual.output as any).jobs[1]).toMatchObject({ ready: true })
      expect((await readdir(out)).sort()).toEqual(['second', 'summary.txt'])
    })
})
