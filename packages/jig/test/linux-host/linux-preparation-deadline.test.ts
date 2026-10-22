import { afterAll, describe, expect, test } from 'bun:test'
import { readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { PrivateExecutionPreparationDeadlineError } from '../../src/internal/execution-process.js'
import {
  privateBootDeadlineFromUnix,
  privateBootRemaining,
} from '../../src/internal/native-clock.js'
import {
  collect,
  createFixture,
  hostConfiguration,
  initialRootlessTemporaryState,
  plan,
  rootlessTemporaryEntry,
  waitForNoRunCgroups,
} from '../linux-rootless-run.fixture.js'

if (process.platform !== 'linux' || process.env.JIG_LINUX_ROOTLESS_HOSTILE !== '1')
  throw new Error('Preparation deadline cases require an opted-in delegated Linux host')

afterAll(async () => {
  await waitForNoRunCgroups()
  const residue = (await readdir(tmpdir())).filter(
    (entry) => rootlessTemporaryEntry(entry) && !initialRootlessTemporaryState.has(entry),
  )
  expect(residue.length).toBe(0)
})

describe.serial('native Linux preparation deadline evidence', () => {
  test('late admission preserves a verified native deadline and releases its owner', async () => {
    const host = await hostConfiguration()
    const fixture = await createFixture('console.log("unexpected payload execution")')
    const requested = plan(host, fixture, 'expired-preparation', { deadlineMs: 1_000 })
    const bootDeadline = privateBootDeadlineFromUnix(requested.limits.deadlineUnixMs)
    let component: Awaited<ReturnType<typeof host.backend.launch>> | undefined
    let failure: unknown
    try {
      const sealed = await host.backend.seal({
        ...requested,
        limits: { ...requested.limits, bootDeadline },
      })
      // The native watchdog includes cancellation grace before fencing.
      const fenceDeadline = {
        ...bootDeadline,
        monotonicMs: bootDeadline.monotonicMs + requested.limits.cancellationGraceMs,
      }
      await Bun.sleep(privateBootRemaining(fenceDeadline) + 50)
      expect(privateBootRemaining(fenceDeadline)).toBe(0)
      await sealed.admit().then(
        (value) => {
          component = value
        },
        (error) => {
          failure = error
        },
      )
      expect(failure).toBeInstanceOf(PrivateExecutionPreparationDeadlineError)
      expect((failure as PrivateExecutionPreparationDeadlineError).code).toBe(
        'EXECUTION_PREPARATION_DEADLINE',
      )
    } finally {
      if (component) {
        await component.terminate()
        await Promise.all([
          collect(component.stdout, 4096),
          collect(component.stderr, 4096),
          component.completion,
        ])
      }
      await waitForNoRunCgroups()
      await rm(fixture, { recursive: true, force: true })
    }
  }, 30_000)

  test('pre-admission cancellation does not manufacture a preparation deadline', async () => {
    const host = await hostConfiguration()
    const fixture = await createFixture('console.log("unexpected payload execution")')
    try {
      const sealed = await host.backend.seal(
        plan(host, fixture, 'cancelled-preparation', { deadlineMs: 30_000 }),
      )
      const cancellation = new AbortController()
      cancellation.abort()
      const failure = await sealed.admit(cancellation.signal).then(
        async (component) => {
          await component.terminate()
          await Promise.all([
            collect(component.stdout, 4096),
            collect(component.stderr, 4096),
            component.completion,
          ])
          return undefined
        },
        (error) => error,
      )
      expect(failure).toBeInstanceOf(Error)
      expect(failure).not.toBeInstanceOf(PrivateExecutionPreparationDeadlineError)
    } finally {
      await waitForNoRunCgroups()
      await rm(fixture, { recursive: true, force: true })
    }
  }, 30_000)
})
