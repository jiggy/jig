import { expect, spyOn, test } from 'bun:test'
import { closeSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PRIVATE_FILE_COMMAND_STOP_GRACE_MS,
  privateOwnFileCommand,
} from '../src/internal/file-command.js'
import { PrivateFileDeliveryOwner } from '../src/internal/file-delivery.js'
import { privateOpenFileRoot } from '../src/internal/linux-file-input.js'

async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'jig-file-delivery-'))
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
const record = { status: 'succeeded', outcome: 'blocked', output: { reason: 'synthetic evidence' } }

// Diagnostic acknowledgement for our fixture only; production cleanup uses cgroup fencing.
async function waitUntilStopped(pid: number): Promise<void> {
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    if (/^State:\s+T/m.test(await readFile(`/proc/${pid}/status`, 'utf8'))) return
    await Bun.sleep(5)
  }
  throw new Error('owned fixture did not stop')
}

for (const trigger of ['deadline', 'cancel'] as const) {
  for (const phase of ['before', 'during', 'after'] as const) {
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
              process.kill(pid ?? Number(await readFile(pidFile, 'utf8')), 'SIGKILL')
            } catch {}
          }, 2500)
          const started = performance.now()
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
              pid = Number(await readFile(pidFile, 'utf8'))
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
                  pid = Number(await readFile(pidFile, 'utf8'))
                  await waitUntilStopped(pid)
                  break
                } catch {
                  await Bun.sleep(5)
                }
              }
              abort.abort()
            }
            expect((await invocation).signal).toBe('SIGKILL')
            expect(rescued).toBe(false)
            expect(performance.now() - started).toBeLessThan(
              700 + PRIVATE_FILE_COMMAND_STOP_GRACE_MS + 1000,
            )
            pid ??= Number(await readFile(pidFile, 'utf8'))
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
      await owner.prepare(destination, process.pid, [])
      const delivery = await owner.publish(record, process.pid, undefined)
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
      await expect(owner.prepare(join(root, 'review'), process.pid, [fd])).rejects.toThrow()
    } finally {
      closeSync(fd)
      await owner.close()
    }
    const second = new PrivateFileDeliveryOwner(new AbortController().signal)
    try {
      await expect(second.prepare(root, process.pid, [])).rejects.toThrow()
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
        await owner.prepare(destination, process.pid, [])
        expect(await owner.publish(record, process.pid, undefined)).toMatchObject({
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
    await owner.prepare(destination, process.pid, [])
    expect((await owner.publish(record, process.pid, undefined)).status).toBe('written')
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
      await owner.prepare(join(root, 'review'), process.pid, [])
      expect(await owner.publish(record, process.pid, undefined)).toMatchObject({
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
      await owner.prepare(join(parent, 'review'), process.pid, [])
      expect(await owner.publish(record, process.pid, undefined)).toMatchObject({
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
