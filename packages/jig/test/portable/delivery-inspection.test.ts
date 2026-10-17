import { expect, test } from 'bun:test'
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PrivateDeliveryAuthorityRetirement,
  PrivateDeliveryCompletion,
  privateBoundInspection,
  privateCaptureDeliveryInspection,
} from '../../src/internal/delivery-inspection.js'
import {
  privateFileCompletionAllowance,
  privateFileCompletionBudget,
} from '../../src/internal/file-command.js'
import { PrivateRootRunFiles } from '../../src/internal/root-run-files.js'
import {
  PRIVATE_PRESENTATION_DEADLINE_ENV,
  privateConstrainPresentationDeadline,
  privatePresentationNow,
} from '../../src/internal/root-run-timeout-policy.js'

test('no delivery and no publication produces only an empty disposable map', async () => {
  const capture = await privateCaptureDeliveryInspection(undefined, undefined)
  expect(capture.files).toEqual([])
  expect(capture.preview('../operator-file')).toBeUndefined()
  capture.close()
  capture.close()
  expect(capture.preview('missing')).toBeUndefined()
})

test('command completion selects bounded allowances and never expands an existing deadline', () => {
  const before = privatePresentationNow()
  const interactive = new PrivateDeliveryCompletion(undefined, privateFileCompletionAllowance(null))
  const legacy = new PrivateDeliveryCompletion(undefined, privateFileCompletionAllowance(300_000))
  const interactiveEnd = interactive.start()
  const legacyEnd = legacy.start()
  const after = privatePresentationNow()
  expect(interactiveEnd).toBeGreaterThanOrEqual(before + 20_000)
  expect(interactiveEnd).toBeLessThanOrEqual(after + 20_000)
  expect(legacyEnd).toBeGreaterThanOrEqual(before + 60_000)
  expect(legacyEnd).toBeLessThanOrEqual(after + 60_000)
  expect(interactive.start(after + 120_000)).toBe(interactiveEnd)
  const inherited = before + 3500
  const constrained = new PrivateDeliveryCompletion(inherited, privateFileCompletionAllowance(null))
  expect(constrained.start()).toBe(inherited)
  const tighter = before + 1000
  expect(legacy.start(tighter)).toBe(tighter)
  expect(legacy.start(after + 120_000)).toBe(tighter)
  expect(legacy.start()).toBe(tighter)
})

test('command completion preserves closing reserve but honors an expired inherited constraint', () => {
  const now = privatePresentationNow()
  expect(privateConstrainPresentationDeadline({}, 700, now)).toBe(now - 44_300)
  const completion = privateFileCompletionBudget({}, 700)
  expect(completion.start()).toBeGreaterThanOrEqual(now + 60_000)
  expect(completion.start()).toBeLessThan(now + 60_500)
  const inherited = privateFileCompletionBudget(
    { [PRIVATE_PRESENTATION_DEADLINE_ENV]: String(now - 1) },
    700,
  )
  expect(inherited.start()).toBe(now - 1)
})

test('a real timer misses its bound and later completion cannot reverse the result', async () => {
  const start = privatePresentationNow()
  const completion = new PrivateDeliveryCompletion(start + 20)
  const operation = Bun.sleep(60)
  const secondOperation = Bun.sleep(70)
  const joined = completion.join(operation)
  const secondJoin = completion.join(secondOperation)
  const settled = await Promise.allSettled([joined, secondJoin])
  for (const result of settled) {
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected')
      expect(result.reason).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  }
  expect(privatePresentationNow()).toBeGreaterThanOrEqual(start + 20)
  expect(privatePresentationNow() - start).toBeLessThan(500)
  await Promise.all([operation, secondOperation])
  expect(completion.join(operation)).toBe(joined)
  expect(completion.join(secondOperation)).toBe(secondJoin)
  expect(completion.start()).toBe(start + 20)
  await expect(completion.join(operation)).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
})

test('tightening pending real timers preserves successful joins and never refreshes the bound', async () => {
  for (let index = 0; index < 64; index++) {
    const completion = privateFileCompletionBudget({}, 300_000)
    const completed = Bun.sleep(0)
    const successful = completion.join(completed)
    await successful
    const started = privatePresentationNow()
    const operation = Bun.sleep(10)
    const joined = completion.join(operation)
    const deadline = started + 2
    completion.start(deadline)
    await expect(joined).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    expect(privatePresentationNow() - started).toBeLessThan(500)
    expect(completion.start(started + 60_000)).toBe(deadline)
    expect(completion.join(completed)).toBe(successful)
    await completion.join(completed)
    await operation
    expect(completion.join(operation)).toBe(joined)
    await expect(joined).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  }
})

test('successful real file reads stay joined after their actual deadline expires', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-inspection-read-'))
  try {
    const path = join(root, 'evidence')
    await writeFile(path, 'checked evidence')
    const completion = new PrivateDeliveryCompletion(privatePresentationNow() + 100)
    const operation = readFile(path, 'utf8')
    const joined = completion.join(operation)
    expect(await joined).toBe('checked evidence')
    const deadline = completion.start()
    await Bun.sleep(Math.max(0, deadline - privatePresentationNow()) + 5)
    expect(privatePresentationNow()).toBeGreaterThan(deadline)
    await rm(path)
    expect(completion.join(operation)).toBe(joined)
    expect(await completion.join(operation)).toBe('checked evidence')
    expect(completion.start()).toBe(deadline)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('retirement closes a real descriptor and remains complete beyond its deadline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-inspection-close-'))
  const handle = await open(join(root, 'evidence'), 'w+')
  try {
    await handle.writeFile('checked evidence')
    const retirement = new PrivateDeliveryAuthorityRetirement(() => handle.close())
    const deadline = privatePresentationNow() + 100
    const first = retirement.retire({ deadline })
    expect(retirement.retiring).toBe(true)
    expect(retirement.retire({ deadline })).toBe(first)
    await first
    await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' })
    await Bun.sleep(Math.max(0, deadline - privatePresentationNow()) + 5)
    expect(privatePresentationNow()).toBeGreaterThan(deadline)
    expect(retirement.retire({ deadline })).toBe(first)
    await retirement.retire({ deadline })
    await retirement.close()
  } finally {
    await handle.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('late real descriptor closure cannot reverse expired retirement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-inspection-late-close-'))
  const handle = await open(join(root, 'evidence'), 'w+')
  try {
    const retirement = new PrivateDeliveryAuthorityRetirement(async () => {
      await Bun.sleep(60)
      await handle.close()
    })
    const started = privatePresentationNow()
    const first = retirement.retire({ deadline: started + 15 })
    await expect(first).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    expect(privatePresentationNow() - started).toBeLessThan(500)
    await retirement.close()
    await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' })
    expect(retirement.retiring).toBe(true)
    expect(retirement.retire({ deadline: privatePresentationNow() + 1000 })).toBe(first)
    await expect(first).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  } finally {
    await handle.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('real missing-file failure stays memoized even after the file becomes available', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-inspection-failure-'))
  try {
    const path = join(root, 'absent')
    const retirement = new PrivateDeliveryAuthorityRetirement(async () => {
      const handle = await open(path)
      await handle.close()
    })
    const deadline = privatePresentationNow() + 1000
    const first = retirement.retire({ deadline })
    const failure = await first.catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'ENOENT' })
    await writeFile(path, 'now available')
    expect(retirement.retire({ deadline })).toBe(first)
    await expect(retirement.close()).rejects.toBe(failure)
    await expect(first).rejects.toBe(failure)
    expect(retirement.retiring).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('expired and cancelled bounds refuse real file operations without claiming their cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-inspection-bound-'))
  try {
    const path = join(root, 'evidence')
    await writeFile(path, 'checked')
    const expired = readFile(path, 'utf8')
    await expect(
      privateBoundInspection(expired, { deadline: privatePresentationNow() - 1 }),
    ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    expect(await expired).toBe('checked')
    const stop = new AbortController()
    stop.abort()
    const cancelled = readFile(path, 'utf8')
    await expect(
      privateBoundInspection(cancelled, {
        deadline: privatePresentationNow() + 1000,
        signal: stop.signal,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(await cancelled).toBe('checked')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('RootRunFiles with no output memoizes close and refuses new output authority', async () => {
  const files = new PrivateRootRunFiles([], false)
  const first = files.close()
  expect(files.output).toBeUndefined()
  expect(files.close()).toBe(first)
  expect(() => files.retainOutput(undefined)).toThrow('unavailable')
  await first
  expect(files.close()).toBe(first)
})
