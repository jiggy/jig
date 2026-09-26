import { expect, spyOn, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { closeSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capturePrivateOutput } from '../src/internal/captured-output.js'
import {
  PRIVATE_FILE_COMMAND_STOP_GRACE_MS,
  privateOwnFileCommand,
} from '../src/internal/file-command.js'
import { PrivateFileDeliveryOwner } from '../src/internal/file-delivery.js'
import { privateOpenFileRoot } from '../src/internal/file-input.js'
import { PrivateRunCheckpoints } from '../src/internal/private-run-checkpoint.js'

async function fixture(work: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-file-delivery-')))
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
const record = { status: 'succeeded', outcome: 'blocked', output: { reason: 'synthetic evidence' } }

test.skipIf(process.platform !== 'darwin')(
  'native command authenticates its parent and transfers renamed input roots and immutable final output',
  async () =>
    fixture(async (root) => {
      const before = (await readdir('/private/tmp'))
        .filter((name) => name.startsWith('jig-file-owner-'))
        .sort()
      for (const mode of ['snapshot', 'wrong-parent']) {
        const destination = join(root, mode)
        const exit = await privateOwnFileCommand(
          [
            process.execPath,
            '--no-env-file',
            '--no-install',
            '--config=/dev/null',
            join(import.meta.dir, 'fixtures/file-delivery-client.ts'),
          ],
          [destination, join(root, `${mode}.pid`), mode],
          undefined,
          10_000,
        )
        if (mode === 'snapshot') {
          expect(exit).toEqual({ exitCode: 0, signal: null })
          expect([...(await readFile(join(destination, 'files/nested/binary')))]).toEqual([
            0, 255, 128,
          ])
          expect((await readFile(join(destination, 'files/empty'))).length).toBe(0)
          expect(
            JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')).delivery.source,
          ).toBe('final')
        } else {
          expect(exit.exitCode).not.toBe(0)
          await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
        }
      }
      expect(
        (await readdir('/private/tmp')).filter((name) => name.startsWith('jig-file-owner-')).sort(),
      ).toEqual(before)
    }),
  25_000,
)

test('publishes immutable binary and empty output after its source storage is removed', async () =>
  fixture(async (root) => {
    const source = join(root, 'source')
    await mkdir(join(source, 'nested'), { recursive: true })
    await writeFile(join(source, 'nested/binary'), Buffer.from([0, 255, 128]))
    await writeFile(join(source, 'empty'), '')
    const fd = privateOpenFileRoot(source)
    const capture = capturePrivateOutput(fd)
    closeSync(fd)
    await rm(source, { recursive: true })
    const destination = join(root, 'result')
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
    try {
      await owner.prepare(destination, [])
      const receipt = await owner.publish(record, { kind: 'snapshot', capture })
      expect(receipt).toMatchObject({ status: 'written', source: 'final' })
      expect(receipt.files?.map((file) => file.path)).toEqual(['empty', 'nested/binary'])
      expect([...(await readFile(join(destination, 'files/nested/binary')))]).toEqual([0, 255, 128])
      expect((await readFile(join(destination, 'files/empty'))).length).toBe(0)
      expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8'))).toEqual({
        ...record,
        delivery: receipt,
      })
    } finally {
      capture.close()
      await owner.close()
    }
  }))

test('copied or closed output capabilities and cleanup failure never authorize final files', async () =>
  fixture(async (root) => {
    const fd = privateOpenFileRoot(root)
    const capture = capturePrivateOutput(fd)
    closeSync(fd)
    try {
      for (const mode of ['copied', 'cleanup', 'closed']) {
        if (mode === 'closed') capture.close()
        const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
        try {
          await owner.prepare(join(root, mode), [])
          expect(
            await owner.publish(mode === 'cleanup' ? { ...record, cleanup: {} } : record, {
              kind: 'snapshot',
              capture: mode === 'copied' ? { ...capture } : capture,
            }),
          ).toMatchObject({ status: 'failed', code: 'INVALID_FILES' })
        } finally {
          await owner.close()
        }
      }
      expect(await readdir(root)).toEqual([])
    } finally {
      capture.close()
    }
  }))

test('retained bytes survive execution cancellation but never an unconfirmed cleanup or output collision', async () =>
  fixture(async (root) => {
    for (const mode of [
      'cancelled',
      'cleanup',
      'empty-cleanup',
      'collision',
      'absent',
      'late-success',
    ]) {
      const abort = new AbortController()
      const owner = new PrivateFileDeliveryOwner(abort.signal)
      const checkpoints = new PrivateRunCheckpoints({
        runId: `sha256:${'a'.repeat(64)}`,
        method: null,
        input: null,
      })
      checkpoints.accept({
        sequence: 1,
        evidence: { passed: false },
        files: { 'saved.txt': 'accepted bytes' },
      })
      const retained = checkpoints.latest!
      const destination = join(root, mode)
      try {
        await owner.prepare(destination, [])
        abort.abort()
        if (mode === 'collision') {
          await mkdir(destination)
          await writeFile(join(destination, 'keep'), 'unrelated')
        }
        const record = {
          status: mode === 'late-success' ? 'succeeded' : 'lost',
          ...(mode === 'late-success'
            ? { outcome: 'done', output: null }
            : { code: 'COORDINATOR_LOST' }),
          runId: retained.identity.runId,
          ...(mode === 'cleanup' || mode === 'empty-cleanup'
            ? { cleanup: { status: 'failed' } }
            : {}),
          checkpoint: mode === 'absent' || mode === 'empty-cleanup' ? null : retained,
        }
        const receipt = await owner.publish(
          record as any,
          undefined,
          mode === 'absent' || mode === 'empty-cleanup' ? undefined : retained,
          true,
        )
        if (mode === 'cancelled' || mode === 'late-success') {
          expect(receipt).toMatchObject({ status: 'written', source: 'checkpoint' })
          expect(await readFile(join(destination, 'files/saved.txt'), 'utf8')).toBe(
            'accepted bytes',
          )
          expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')).status).toBe(
            mode === 'late-success' ? 'succeeded' : 'lost',
          )
        } else if (mode === 'absent') {
          expect(receipt).toMatchObject({ status: 'written', source: 'none' })
          expect(await readdir(join(destination, 'files'))).toEqual([])
        } else {
          expect(receipt).toMatchObject({
            status: 'failed',
            code:
              mode === 'cleanup'
                ? 'INVALID_FILES'
                : mode === 'empty-cleanup'
                  ? 'CANCELLED'
                  : 'DESTINATION_CHANGED',
          })
          if (mode === 'collision')
            expect(await readFile(join(destination, 'keep'), 'utf8')).toBe('unrelated')
          else await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
        }
        expect(checkpoints.latest?.digest).toBe(retained.digest)
      } finally {
        await owner.close()
        checkpoints.close()
      }
    }
  }))

test('ordinary terminal-only reporting preserves cleanup failure without claiming retained files', async () =>
  fixture(async (root) => {
    const abort = new AbortController()
    const owner = new PrivateFileDeliveryOwner(abort.signal)
    const destination = join(root, 'result')
    const failedCleanup = { ...record, cleanup: { status: 'failed', code: 'PROJECT_CLOSE_FAILED' } }
    try {
      await owner.prepare(destination, [])
      expect(await owner.publish(failedCleanup, undefined, undefined, true)).toMatchObject({
        status: 'written',
        source: 'none',
        files: [],
      })
      expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8'))).toMatchObject({
        cleanup: failedCleanup.cleanup,
        delivery: { status: 'written', source: 'none', files: [] },
      })
      expect(await readdir(join(destination, 'files'))).toEqual([])
    } finally {
      await owner.close()
    }
  }))

test('late cancellation rejects cleanup-failed terminal retention with an empty checkpoint binding', async () =>
  fixture(async (root) => {
    const abort = new AbortController()
    const owner = new PrivateFileDeliveryOwner(abort.signal, async () => abort.abort())
    try {
      await owner.prepare(join(root, 'result'), [])
      expect(
        await owner.publish(
          { ...record, cleanup: { status: 'failed', code: 'PROJECT_CLOSE_FAILED' } },
          undefined,
          undefined,
          true,
        ),
      ).toMatchObject({ status: 'failed', code: 'CANCELLED' })
      expect(await readdir(root)).toEqual([])
    } finally {
      await owner.close()
    }
  }))

async function fixturePid(path: string): Promise<number> {
  const pid = Number(await readFile(path, 'utf8'))
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('invalid owned fixture PID')
  return pid
}

test('accepted checkpoints never make final-file capture survive cancellation', async () =>
  fixture(async (root) => {
    const abort = new AbortController()
    const owner = new PrivateFileDeliveryOwner(abort.signal)
    const checkpoints = new PrivateRunCheckpoints({
      runId: `sha256:${'a'.repeat(64)}`,
      method: null,
      input: null,
    })
    checkpoints.accept({ sequence: 1, evidence: null, files: { 'saved.txt': 'accepted' } })
    try {
      await owner.prepare(join(root, 'result'), [])
      abort.abort()
      // Cancellation must reject before consulting any final-file descriptor,
      // even with a retained checkpoint and interrupted-record permission.
      expect(
        await owner.publish(record, { kind: 'linux-directory', fd: 0 }, checkpoints.latest, true),
      ).toMatchObject({
        status: 'failed',
        code: 'CANCELLED',
      })
      await expect(stat(join(root, 'result'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await owner.close()
      checkpoints.close()
    }
  }))

// Diagnostic acknowledgement for our fixture only; production cleanup uses cgroup fencing.
async function waitUntilStopped(pid: number): Promise<void> {
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    if (process.platform === 'darwin') {
      const result = spawnSync('/bin/ps', ['-o', 'state=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 1000,
      })
      if (result.status === 0 && result.stdout.trim().startsWith('T')) return
    } else if (/^State:\s+T/m.test(await readFile(`/proc/${pid}/status`, 'utf8'))) return
    await Bun.sleep(5)
  }
  throw new Error('owned fixture did not stop')
}

for (const mode of ['cancel', 'success', 'cleanup-failed'] as const) {
  test(`cooperative interruption waits for settled ${mode} evidence before delivery`, async () =>
    fixture(async (root) => {
      const destination = join(root, 'review'),
        pidFile = join(root, 'pid'),
        readyFile = join(root, 'ready')
      const abort = new AbortController()
      let stagedAfterSettlement = false
      const invocation = privateOwnFileCommand(
        [
          process.execPath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          join(import.meta.dir, 'fixtures/file-delivery-client.ts'),
        ],
        [destination, pidFile, `settled-${mode}`, readyFile],
        abort.signal,
        3000,
        async () => {
          stagedAfterSettlement = (await readFile(readyFile, 'utf8')) === 'settled'
        },
      )
      try {
        const readinessDeadline = performance.now() + 1500
        while ((await readFile(readyFile, 'utf8').catch(() => '')) !== 'ready') {
          if (performance.now() >= readinessDeadline) throw new Error('fixture readiness missing')
          await Bun.sleep(5)
        }
        const interrupted = performance.now()
        abort.abort()
        expect(await invocation).toEqual({
          exitCode: mode === 'cleanup-failed' ? 3 : 2,
          signal: null,
        })
        expect(performance.now() - interrupted).toBeGreaterThan(600)
        if (mode === 'cleanup-failed') {
          expect(stagedAfterSettlement).toBe(false)
          await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
        } else {
          expect(stagedAfterSettlement).toBe(true)
          expect(
            JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')),
          ).toMatchObject({
            status: mode === 'success' ? 'succeeded' : 'failed',
            command: { status: 'interrupted' },
            delivery: { status: 'written', source: 'none', files: [] },
          })
          expect(await readdir(join(destination, 'files'))).toEqual([])
        }
        const pid = await fixturePid(pidFile)
        expect(() => process.kill(pid, 0)).toThrow()
        expect((await readdir(root)).filter((name) => name.startsWith('.jig-delivery-'))).toEqual(
          [],
        )
      } finally {
        abort.abort()
        await invocation
      }
    }))
}

for (const trigger of ['deadline', 'cancel', 'late-cancel'] as const) {
  for (const phase of ['before', 'during', 'after'] as const) {
    if (trigger === 'late-cancel' && phase !== 'before') continue
    test(
      `settles a stopped coordinator on ${trigger} ${phase} publication`,
      async () =>
        fixture(async (root) => {
          const destination = join(root, 'review'),
            pidFile = join(root, 'pid'),
            readyFile = join(root, 'ready')
          const abort = new AbortController()
          let pid: number | undefined,
            rescued = false,
            settled = false
          const watchdog = setTimeout(async () => {
            rescued = true
            try {
              process.kill(pid ?? (await fixturePid(pidFile)), 'SIGKILL')
            } catch {}
          }, 2500)
          const started = performance.now()
          let expiryObserved = false
          const timer = globalThis.setTimeout
          const lateClock =
            trigger === 'late-cancel'
              ? spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) =>
                  timer(() => {
                    callback(...args)
                    if (delay === 700) {
                      // Observe the actual production expiry before interrupting,
                      // not a separate clock started before socket setup/spawn.
                      expiryObserved = true
                      abort.abort()
                    }
                  }, delay),
                )
              : undefined
          const invocation = privateOwnFileCommand(
            [
              process.execPath,
              '--no-env-file',
              '--no-install',
              '--config=/dev/null',
              join(import.meta.dir, 'fixtures/file-delivery-client.ts'),
            ],
            [destination, pidFile, phase, readyFile],
            abort.signal,
            700,
            async () => {
              if (phase !== 'during') return
              pid = await fixturePid(pidFile)
              process.kill(pid, 'SIGSTOP')
              await waitUntilStopped(pid)
              if (trigger === 'cancel') abort.abort()
              else await Bun.sleep(800) // Keep staging uncommitted until the deadline fires.
            },
          ).finally(() => {
            settled = true
          })
          try {
            if (trigger === 'cancel' && phase !== 'during') {
              while (!settled) {
                try {
                  await readFile(readyFile)
                  pid = await fixturePid(pidFile)
                  await waitUntilStopped(pid)
                  break
                } catch {
                  await Bun.sleep(5)
                }
              }
              abort.abort()
            }
            expect((await invocation).signal).toBe('SIGKILL')
            if (trigger === 'late-cancel') expect(expiryObserved).toBe(true)
            expect(rescued).toBe(false)
            expect(performance.now() - started).toBeLessThan(
              700 + PRIVATE_FILE_COMMAND_STOP_GRACE_MS + 1000,
            )
            pid ??= await fixturePid(pidFile)
            expect(() => process.kill(pid!, 0)).toThrow()
            expect(
              (await readdir(root)).filter((name) => name.startsWith('.jig-delivery-')),
            ).toEqual([])
            if (phase === 'after')
              expect(
                JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')).outcome,
              ).toBe('blocked')
            else await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
          } finally {
            lateClock?.mockRestore()
            clearTimeout(watchdog)
            if (!settled && pid !== undefined) process.kill(pid, 'SIGKILL')
            await invocation
          }
        }),
      5000,
    )
  }
}

test('publishes record-only outcomes in one private packet with fixed permissions', async () =>
  fixture(async (root) => {
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal),
      destination = join(root, 'review')
    try {
      await owner.prepare(destination, [])
      const delivery = await owner.publish(record, undefined)
      expect(delivery).toMatchObject({ status: 'written', files: [] })
      expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8'))).toEqual({
        ...record,
        delivery,
      })
      expect((await stat(destination)).mode & 0o777).toBe(0o700)
      expect((await stat(join(destination, 'result.json'))).mode & 0o777).toBe(0o600)
    } finally {
      await owner.close()
    }
    expect(await readdir(root)).toEqual(['review'])
  }))

test('rejects destinations inside selected roots and existing destinations before work', async () =>
  fixture(async (root) => {
    const fd = privateOpenFileRoot(root)
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
    try {
      await expect(owner.prepare(join(root, 'review'), [fd])).rejects.toThrow()
    } finally {
      closeSync(fd)
      await owner.close()
    }
    const second = new PrivateFileDeliveryOwner(new AbortController().signal)
    try {
      await expect(second.prepare(root, [])).rejects.toThrow()
    } finally {
      await second.close()
    }
  }))

test('cleans staging when cancellation or a destination collision wins publication', async () =>
  fixture(async (root) => {
    for (const mode of ['cancel', 'collision']) {
      const signal = new AbortController(),
        destination = join(root, mode)
      const owner = new PrivateFileDeliveryOwner(signal.signal, async () => {
        if (mode === 'cancel') signal.abort()
        else {
          await mkdir(destination)
          await writeFile(join(destination, 'keep'), 'untouched')
        }
      })
      try {
        await owner.prepare(destination, [])
        expect(await owner.publish(record, undefined)).toMatchObject({
          status: 'failed',
          code: mode === 'cancel' ? 'CANCELLED' : 'DESTINATION_CHANGED',
        })
      } finally {
        await owner.close()
      }
    }
    expect(await readdir(root)).toEqual(['collision'])
    expect(await readFile(join(root, 'collision', 'keep'), 'utf8')).toBe('untouched')
  }))

test('publication which already won is not retracted by later cancellation', async () =>
  fixture(async (root) => {
    const signal = new AbortController(),
      owner = new PrivateFileDeliveryOwner(signal.signal),
      destination = join(root, 'review')
    await owner.prepare(destination, [])
    expect((await owner.publish(record, undefined)).status).toBe('written')
    signal.abort()
    await owner.close()
    expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')).outcome).toBe(
      'blocked',
    )
  }))

test('a delivery budget expiry preserves execution and cleans uncommitted staging', async () =>
  fixture(async (root) => {
    const clock = spyOn(performance, 'now').mockReturnValue(0)
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal, async () => {
      clock.mockReturnValue(20_001)
    })
    try {
      await owner.prepare(join(root, 'review'), [])
      expect(await owner.publish(record, undefined)).toMatchObject({
        status: 'failed',
        code: 'DEADLINE_EXCEEDED',
      })
      expect(record.status).toBe('succeeded')
      expect(await readdir(root)).toEqual([])
    } finally {
      clock.mockRestore()
      await owner.close()
    }
  }))

test('a substituted output parent never redirects publication or cleanup', async () =>
  fixture(async (root) => {
    const parent = join(root, 'parent'),
      moved = join(root, 'moved')
    await mkdir(parent)
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal, async () => {
      await rename(parent, moved)
      await mkdir(parent)
      await writeFile(join(parent, 'keep'), 'not owned staging')
    })
    try {
      await owner.prepare(join(parent, 'review'), [])
      expect(await owner.publish(record, undefined)).toMatchObject({
        status: 'failed',
        code: 'DESTINATION_CHANGED',
      })
      expect(await readdir(moved)).toEqual([])
      expect(await readFile(join(parent, 'keep'), 'utf8')).toBe('not owned staging')
    } finally {
      await owner.close()
    }
  }))

test(
  'the separate command owner removes staging after its coordinator is killed during copying',
  async () =>
    fixture(async (root) => {
      const destination = join(root, 'review'),
        pidFile = join(root, 'coordinator.pid')
      const exit = await privateOwnFileCommand(
        [
          process.execPath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          join(import.meta.dir, 'fixtures/file-delivery-client.ts'),
        ],
        [destination, pidFile],
        undefined,
        10000,
        async () => {
          const pid = Number(await readFile(pidFile, 'utf8'))
          expect(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid).toBe(true)
          process.kill(pid, 'SIGKILL')
          await Bun.sleep(30)
        },
      )
      expect(exit.signal).toBe('SIGKILL')
      expect(await readdir(root)).toEqual(['coordinator.pid'])
    }),
  15000,
)

test('retained terminal publication still removes staging when its coordinator is lost', async () =>
  fixture(async (root) => {
    const abort = new AbortController(),
      lost = new AbortController()
    const owner = new PrivateFileDeliveryOwner(abort.signal, async () => lost.abort())
    try {
      await owner.prepare(join(root, 'result'), [])
      abort.abort()
      expect(await owner.publish(record, undefined, undefined, true, lost.signal)).toMatchObject({
        status: 'failed',
        code: 'CANCELLED',
      })
      expect(await readdir(root)).toEqual([])
    } finally {
      await owner.close()
    }
  }))
