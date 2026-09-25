import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type JsonValue, OperationError, type RunContext } from '@jigging/flow'
import sampleBatch from '../batch.json'
import { batchJobs, patchConflicts, repairBatch } from '../flows/factory/batch.ts'
import { syntheticRepair } from './fixture.ts'

const job = {
  id: 'first',
  directory: 'first',
  checks: 'logs',
  issue: 'Repair both defects.',
  editPaths: ['src/parse.ts', 'src/report.ts'],
}
test('the shipped batch validates and leaves both method choices to the router', () => {
  expect(batchJobs(sampleBatch)).toEqual(sampleBatch.jobs)
  expect(sampleBatch.jobs).toHaveLength(2)
  expect(sampleBatch.jobs.every((entry) => !Object.hasOwn(entry, 'method'))).toBe(true)
})
test('the shipped batch invokes the router for both jobs and honors abstention', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-shipped-batch-'))
  try {
    const source = join(root, 'source')
    const out = join(root, 'out')
    await cp(join(import.meta.dir, '../fixtures'), source, { recursive: true })
    await mkdir(out)
    const routes: string[] = []
    const actual = await repairBatch({
      input: sampleBatch,
      attachments: {
        source: { access: 'read', path: source },
        deliverables: { access: 'read-write', path: out },
      },
      signal: new AbortController().signal,
      call: async (call) => {
        if (call.slot === 'router') {
          routes.push(call.operationId)
          return { outcome: 'done', output: { candidateId: null, reason: 'Abstain for test.' } }
        }
        if (call.slot === 'checkpoint') return { outcome: 'done', output: null }
        throw new Error('An abstaining router must not dispatch a repair.')
      },
    } as unknown as RunContext)
    expect(routes.sort()).toEqual(['route:logs', 'route:timesheet'])
    expect(actual.outcome).toBe('blocked')
    const output = actual.output as { jobs: { status: string }[] }
    expect(output.jobs.map((entry) => entry.status)).toEqual(['unrouted', 'unrouted'])
    expect(await readFile(join(out, 'summary.txt'), 'utf8')).toContain('routing (automatic)')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('batch validates its paths, identity, check policy, and bounded size before dispatch', () => {
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

test('factory-owned repair reports observed baseline, proposal, check, and finish phases', async () => {
  const messages: JsonValue[] = []
  let closed = 0
  const { result } = await syntheticRepair(1, false, {
    progress: {
      direction: 'send',
      delivery: 'direct',
      send: async (value: JsonValue) => messages.push(value),
      close: async () => {
        closed++
      },
    },
  })
  expect(result.outcome).toBe('done')
  expect(messages).toEqual([
    { phase: 'baseline', attempt: 0 },
    { phase: 'proposal', attempt: 1 },
    { phase: 'check', attempt: 1 },
    { phase: 'finished', attempt: 1 },
  ])
  expect(closed).toBe(1)
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
        if (call.slot === 'checkpoint') {
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
          if (call.slot === 'checkpoint') {
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
        channels: {},
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
        if (call.slot === 'checkpoint') {
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
    expect(await readFile(join(out, 'summary.txt'), 'utf8')).toContain(
      'routing (automatic): single-pass',
    )
  })
})

test('an explicit reviewed method bypasses semantic routing and remains visible in evidence', async () => {
  await batchFixture(async (run, out) => {
    const { result } = await syntheticRepair()
    const workers: string[] = []
    const actual = await repairBatch({
      ...run,
      input: {
        jobs: [
          { ...job, method: 'p1' },
          { ...job, id: 'second', method: 'p2' },
        ],
      },
      call: async (call) => {
        if (call.slot === 'router') throw new Error('explicit choices must not be routed')
        if (call.slot === 'checkpoint') return { outcome: 'done', output: null }
        workers.push(call.slot)
        return result
      },
    })

    expect(actual.outcome).toBe('done')
    expect(workers.sort()).toEqual(['checked-correction', 'single-pass'])
    expect((actual.output as any).jobs.map((entry: any) => entry.routing)).toEqual([
      { mode: 'explicit', candidateId: 'p1', slot: 'single-pass' },
      { mode: 'explicit', candidateId: 'p2', slot: 'checked-correction' },
    ])
    expect(await readFile(join(out, 'summary.txt'), 'utf8')).toContain('routing (explicit)')
  })
})

test('optional progress reports bounded work phases and closes independently of checkpoints', async () => {
  await batchFixture(async (run) => {
    const { result } = await syntheticRepair()
    const messages: JsonValue[] = []
    const order: string[] = []
    let closed = 0
    let checkpointCount = 0
    let releaseSettled!: () => void
    let firstSettled!: () => void
    const allowSettled = new Promise<void>((resolve) => (releaseSettled = resolve))
    const firstSettledSent = new Promise<void>((resolve) => (firstSettled = resolve))
    const withRepairPhases = async () => {
      const values = [
        { phase: 'baseline', attempt: 0 },
        { phase: 'proposal', attempt: 1 },
        { phase: 'check', attempt: 1 },
        { phase: 'finished', attempt: 1 },
      ]
      let index = 0
      let ended = false
      return {
        send: {
          direction: 'send' as const,
          delivery: 'direct' as const,
          send: async () => {},
          close: async () => {
            ended = true
          },
        },
        receive: {
          [Symbol.asyncIterator]() {
            return this
          },
          async next() {
            if (index < values.length) return { done: false as const, value: values[index++]! }
            ended = true
            return { done: true as const, value: undefined }
          },
          async return() {
            ended = true
            return { done: true as const, value: undefined }
          },
          get ended() {
            return ended
          },
        },
      }
    }
    const actualPromise = repairBatch({
      ...run,
      channel: async () => withRepairPhases(),
      channels: {
        progress: {
          direction: 'send',
          delivery: 'broadcast',
          send: async (value: JsonValue) => {
            messages.push(value)
            if (value.phase === 'settled') {
              order.push('progress-settled')
              if (value.jobId === 'first') {
                firstSettled()
                await allowSettled
              }
            }
          },
          close: async () => {
            closed++
          },
        },
      },
      call: async (call) => {
        if (call.slot === 'router')
          return { outcome: 'done', output: { candidateId: 'p2', reason: 'Synthetic choice.' } }
        if (call.slot === 'checkpoint') {
          checkpointCount++
          order.push('checkpoint')
          return { outcome: 'done', output: null }
        }
        expect(call.channels?.progress).toBeDefined()
        return result
      },
    })
    await firstSettledSent
    expect(checkpointCount).toBeGreaterThan(0)
    expect(order.indexOf('checkpoint')).toBeLessThan(order.indexOf('progress-settled'))
    releaseSettled()
    const actual = await actualPromise

    expect(actual.outcome).toBe('done')
    expect(messages).toContainEqual({ jobId: 'first', phase: 'selecting', attempt: 0 })
    expect(messages).toContainEqual({ jobId: 'first', phase: 'invoking', attempt: 0, method: 'p2' })
    expect(messages).toContainEqual({ jobId: 'first', phase: 'baseline', attempt: 0, method: 'p2' })
    expect(messages).toContainEqual({ jobId: 'first', phase: 'proposal', attempt: 1, method: 'p2' })
    expect(messages).toContainEqual({ jobId: 'first', phase: 'check', attempt: 1, method: 'p2' })
    expect(messages).toContainEqual({
      jobId: 'first',
      phase: 'settled',
      attempt: 0,
      status: 'review-ready',
      method: 'p2',
    })
    expect(messages).toContainEqual({
      jobId: 'second',
      phase: 'settled',
      attempt: 0,
      status: 'review-ready',
      method: 'p2',
    })
    expect(closed).toBe(1)
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
          if (call.slot === 'checkpoint') return { outcome: 'done', output: null }
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
          if (call.slot === 'checkpoint') return { outcome: 'done', output: null }
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
          if (call.slot === 'checkpoint') return { outcome: 'done', output: null }
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
