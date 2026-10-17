import { expect, test } from 'bun:test'
import { readPrivateAttemptClock } from '../../src/internal/attempt-clock.js'
import {
  normalizePrivateBootDeadline,
  privateBootDeadlineFromUnix,
  privateBootRemaining,
  readPrivateNativeClock,
  watchPrivateBootDeadline,
} from '../../src/internal/native-clock.js'

const bootId = '11111111-1111-1111-1111-111111111111'

test('deadline decoding rejects malformed coordinates', () => {
  for (const value of [
    { bootId: `${bootId}\n`, monotonicMs: 1 },
    { bootId, monotonicMs: -1 },
    { bootId, monotonicMs: Number.NaN },
    { bootId, monotonicMs: 1, unixMs: 1 },
    { monotonicMs: 1 },
  ])
    expect(() => normalizePrivateBootDeadline(value)).toThrow('invalid native boot deadline')
})

test('pure deadline arithmetic preserves serialization and rejects a different boot', () => {
  const deadline = privateBootDeadlineFromUnix(60_000, { bootId, monotonicMs: 1000 }, 50_000)
  expect(deadline.monotonicMs).toBe(11_000)
  const decoded = normalizePrivateBootDeadline(JSON.parse(JSON.stringify(deadline)))
  expect(privateBootRemaining(decoded, { bootId, monotonicMs: 6000 })).toBe(5000)
  expect(privateBootRemaining(decoded, { bootId, monotonicMs: 11_000 })).toBe(0)
  expect(() =>
    privateBootRemaining(decoded, {
      bootId: '22222222-2222-2222-2222-222222222222',
      monotonicMs: 0,
    }),
  ).toThrow('clock changed')
})

test('watchdog expires once against the actual elapsed clock', async () => {
  const before = readPrivateNativeClock()
  const deadline = { ...before, monotonicMs: before.monotonicMs + 100 }
  const reasons: string[] = []
  const close = watchPrivateBootDeadline(deadline, (reason) => reasons.push(reason))
  try {
    expect(reasons).toEqual([])
    await Bun.sleep(250)
    expect(privateBootRemaining(deadline)).toBe(0)
    expect(reasons).toEqual(['deadline'])
    await Bun.sleep(75)
    expect(reasons).toEqual(['deadline'])
  } finally {
    close()
  }
})

test('closing the watchdog prevents its elapsed notification', async () => {
  const before = readPrivateNativeClock()
  const reasons: string[] = []
  const close = watchPrivateBootDeadline(
    { ...before, monotonicMs: before.monotonicMs + 100 },
    (reason) => reasons.push(reason),
  )
  close()
  await Bun.sleep(250)
  expect(reasons).toEqual([])
})

test('real subprocess preserves boot identity and serialized elapsed deadline', async () => {
  const before = await readPrivateAttemptClock()
  const nativeBefore = readPrivateNativeClock()
  const deadline = { ...nativeBefore, monotonicMs: nativeBefore.monotonicMs + 5000 }
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `
        import {readPrivateAttemptClock} from ${JSON.stringify(new URL('../../src/internal/attempt-clock.ts', import.meta.url).pathname)};
        import {normalizePrivateBootDeadline, privateBootRemaining, readPrivateNativeClock} from ${JSON.stringify(new URL('../../src/internal/native-clock.ts', import.meta.url).pathname)};
        await Bun.sleep(100);
        const deadline = normalizePrivateBootDeadline(JSON.parse(process.argv[1]));
        console.log(JSON.stringify({attempt: await readPrivateAttemptClock(), native: readPrivateNativeClock(), remaining: privateBootRemaining(deadline), deadline}));
      `,
      JSON.stringify(deadline),
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [text, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(stderr).toBe('')
  expect(code).toBe(0)
  const observed = JSON.parse(text)
  const after = await readPrivateAttemptClock()
  const nativeAfter = readPrivateNativeClock()
  expect(observed.deadline).toEqual(deadline)
  expect(observed.attempt.bootId).toBe(before.bootId)
  expect(after.bootId).toBe(before.bootId)
  expect(observed.attempt.monotonicMs).toBeGreaterThanOrEqual(before.monotonicMs)
  expect(observed.attempt.monotonicMs).toBeLessThanOrEqual(after.monotonicMs)
  expect(observed.native.bootId).toBe(nativeBefore.bootId)
  expect(observed.native.monotonicMs).toBeGreaterThanOrEqual(nativeBefore.monotonicMs + 90)
  expect(observed.native.monotonicMs).toBeLessThanOrEqual(nativeAfter.monotonicMs)
  expect(observed.remaining).toBeLessThanOrEqual(4910)
  expect(observed.remaining).toBeGreaterThanOrEqual(privateBootRemaining(deadline))
})
