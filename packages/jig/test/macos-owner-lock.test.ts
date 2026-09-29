import { expect, test } from 'bun:test'
import { mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  acquirePrivateMacosOwnerLock,
  requirePrivateMacosOwnerLock,
} from '../src/internal/macos-owner-lock.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)
native(
  'native coordinator locks exclude competing starts and become recoverable after coordinator death',
  async () => {
    const root = await mkdtemp('/private/tmp/jig-owner-lock-')
    const directory = await open(root, 'r')
    const command = [
      process.execPath,
      '--no-env-file',
      '--no-install',
      '--config=/dev/null',
      join(import.meta.dir, 'fixtures/macos-owner-lock.ts'),
      root,
    ]
    try {
      const held = await acquirePrivateMacosOwnerLock(directory)
      try {
        const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
        expect(await child.exited).toBe(3)
        expect(await new Response(child.stdout).text()).toBe('busy\n')
        await expect(requirePrivateMacosOwnerLock({ ...held })).rejects.toThrow('not active')
      } finally {
        await held.close()
      }
      await expect(requirePrivateMacosOwnerLock(held)).rejects.toThrow('not active')
      const holder = Bun.spawn([...command, 'hold'], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      try {
        const reader = holder.stdout.getReader()
        const ready = await reader.read()
        reader.releaseLock()
        expect(Buffer.from(ready.value!).toString()).toBe('acquired\n')
        await expect(acquirePrivateMacosOwnerLock(directory)).rejects.toThrow('still held')
        holder.kill('SIGKILL')
        await holder.exited
        const recovered = await acquirePrivateMacosOwnerLock(directory)
        try {
          expect((await requirePrivateMacosOwnerLock(recovered)).fd).toBeGreaterThan(0)
        } finally {
          await recovered.close()
        }
      } finally {
        holder.kill('SIGKILL')
        await holder.exited
      }
      expect((await directory.stat()).isDirectory()).toBe(true)
    } finally {
      await directory.close()
      await rm(root, { recursive: true })
    }
  },
  15_000,
)

native(
  'native coordinator lock identity detects replacement and rejects unsafe lock files',
  async () => {
    const root = await mkdtemp('/private/tmp/jig-owner-lock-')
    const directory = await open(root, 'r')
    try {
      const held = await acquirePrivateMacosOwnerLock(directory)
      try {
        await rename(join(root, 'coordinator.lock'), join(root, 'original'))
        await writeFile(join(root, 'coordinator.lock'), '', { flag: 'wx', mode: 0o600 })
        await expect(requirePrivateMacosOwnerLock(held)).rejects.toThrow('identity changed')
      } finally {
        await held.close()
      }
      await writeFile(join(root, 'coordinator.lock'), 'unexpected bytes')
      await expect(acquirePrivateMacosOwnerLock(directory)).rejects.toThrow('unsafe')
    } finally {
      await directory.close()
      await rm(root, { recursive: true })
    }
  },
)
