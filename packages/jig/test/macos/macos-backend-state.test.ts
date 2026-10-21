import { expect, test } from 'bun:test'
import {
  chmod,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import {
  cancelPrivateMacosOwnerStateAllocation,
  normalizePrivateMacosOwnerStateAllocationIdentity,
  openPrivateMacosBackendState,
  planPrivateMacosOwnerStateAllocation,
  releasePrivateMacosOwnerState,
} from '../../src/internal/macos-backend-state.js'
import { fixture, unsafeRecordFixture } from '.././macos-backend-state.fixture.js'

for (const [record, operation] of [
  ['state.json', 'open'],
  ['state.pending', 'open'],
  ['release.json', 'release'],
  ['release.pending', 'release'],
  ['owner.json', 'owner'],
  ['sockets.json', 'sockets'],
] as const) {
  test(`native owner record ${record} rejects an unread named pipe without blocking`, async () => {
    await fixture(async (root) => {
      const allocation = await planPrivateMacosOwnerStateAllocation({
        parent: root,
        name: 'pipe',
      })
      const proof = await cancelPrivateMacosOwnerStateAllocation(allocation)
      const parent = record.startsWith('state.')
        ? join(allocation.directory, 'control')
        : allocation.directory
      const path = join(parent, record)
      const original = record === 'state.json' ? await readFile(path) : undefined
      if (original !== undefined) await unlink(path)
      const fifo = Bun.spawnSync(['/usr/bin/mkfifo', '-m', '600', path])
      expect(fifo.exitCode, Buffer.from(fifo.stderr).toString()).toBe(0)
      const request = join(root, 'request.json')
      await writeFile(request, JSON.stringify({ allocation, proof, operation }), { mode: 0o600 })
      const runner = await unsafeRecordFixture(root)
      const child = Bun.spawn(
        [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', runner, request],
        { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      )
      const output = new Response(child.stdout).text()
      const errors = new Response(child.stderr).text()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const status = await Promise.race([
          child.exited,
          new Promise<'blocked'>((resolve) => {
            timer = setTimeout(() => resolve('blocked'), 5_000)
          }),
        ])
        expect(status, `owner record ${record} blocked before its regular-file check`).not.toBe(
          'blocked',
        )
        expect(status, await errors).toBe(0)
        expect(await output).toBe('unsafe-record-refused\n')
        expect(await readdir(parent)).toContain(record)
      } finally {
        clearTimeout(timer)
        child.kill('SIGKILL')
        await child.exited
        await Promise.all([output, errors])
        await unlink(path)
        if (original !== undefined) await writeFile(path, original, { mode: 0o600, flag: 'wx' })
        await releasePrivateMacosOwnerState(allocation, proof)
      }
    })
  }, 10_000)
}
test('native release staging cannot bypass proof or unsafe-record rejection', async () => {
  await fixture(async (root) => {
    for (const kind of ['proof', 'symlink', 'hardlink', 'public', 'oversized', 'forged']) {
      const allocation = await planPrivateMacosOwnerStateAllocation({ parent: root, name: kind })
      const proof = await cancelPrivateMacosOwnerStateAllocation(allocation)
      const pending = join(allocation.directory, 'release.pending')
      const canary = join(root, `${kind}.canary`)
      await writeFile(canary, 'preserve', { mode: 0o600, flag: 'wx' })
      if (kind === 'symlink') await symlink(canary, pending)
      else if (kind === 'hardlink') await link(canary, pending)
      else
        await writeFile(pending, kind === 'oversized' ? Buffer.alloc(65_537) : 'partial', {
          mode: kind === 'public' ? 0o644 : 0o600,
          flag: 'wx',
        })
      if (kind === 'public') await chmod(pending, 0o644)
      if (kind === 'forged')
        await writeFile(join(allocation.directory, 'release.json'), 'forged', {
          mode: 0o600,
          flag: 'wx',
        })
      await expect(
        releasePrivateMacosOwnerState(allocation, kind === 'proof' ? {} : proof),
      ).rejects.toThrow()
      expect(await readdir(allocation.directory)).toContain('release.pending')
      expect(await readdir(root)).toContain(kind)
      expect(await readFile(canary, 'utf8')).toBe('preserve')
      await unlink(pending)
      if (kind === 'forged') await unlink(join(allocation.directory, 'release.json'))
      await releasePrivateMacosOwnerState(allocation, proof)
      expect(await readFile(canary, 'utf8')).toBe('preserve')
    }
  })
}, 10_000)
test(
  'native owner state authenticates allocation and excludes late starts after cancellation',
  async () =>
    fixture(async (root) => {
      const allocation = await planPrivateMacosOwnerStateAllocation({ parent: root, name: 'run' })
      await expect(
        planPrivateMacosOwnerStateAllocation({ parent: root, name: 'run' }),
      ).rejects.toThrow()
      expect(() =>
        normalizePrivateMacosOwnerStateAllocationIdentity({ ...allocation, name: 'other' }),
      ).toThrow()
      const state = await openPrivateMacosBackendState(allocation)
      try {
        expect((await state.read()).phase).toBe('allocated')
        await expect(openPrivateMacosBackendState(allocation)).rejects.toThrow('still held')
        await state.cancel()
        await state.cancel()
        await expect(state.admit()).rejects.toThrow('not permitted')
      } finally {
        await state.close()
      }
      const reopened = await openPrivateMacosBackendState(allocation)
      try {
        expect((await reopened.read()).phase).toBe('cancelled')
        await expect(reopened.seal({ digest: 'different' })).rejects.toThrow('not permitted')
        await expect(reopened.admit()).rejects.toThrow('not permitted')
      } finally {
        await reopened.close()
      }
      const cancellation = await cancelPrivateMacosOwnerStateAllocation(allocation)
      const released = await releasePrivateMacosOwnerState(allocation, cancellation)
      expect((await releasePrivateMacosOwnerState(allocation, cancellation)).digest).toBe(
        released.digest,
      )
      await expect(openPrivateMacosBackendState(allocation)).rejects.toThrow()
    }),
  10_000,
)
test('released native allocation authority cannot recreate its owner directory', async () => {
  await fixture(async (root) => {
    const allocation = await planPrivateMacosOwnerStateAllocation({
      parent: root,
      name: 'released',
    })
    await rm(allocation.directory, { recursive: true })
    await expect(openPrivateMacosBackendState(allocation)).rejects.toThrow()
    expect(await readdir(root)).toEqual([])
  })
})
test('native release preserves unexpected state and resumes only after exact repair', async () => {
  await fixture(async (root) => {
    const allocation = await planPrivateMacosOwnerStateAllocation({
      parent: root,
      name: 'blocked',
    })
    const cancellation = await cancelPrivateMacosOwnerStateAllocation(allocation)
    await mkdir(join(allocation.directory, 'unexpected'))
    await expect(releasePrivateMacosOwnerState(allocation, cancellation)).rejects.toThrow(
      'unexpected state',
    )
    const staged = join(root, '.blocked.release')
    expect(await readdir(root)).toEqual(['.blocked.release'])
    await expect(
      planPrivateMacosOwnerStateAllocation({ parent: root, name: 'blocked' }),
    ).rejects.toThrow('release is incomplete')
    await rm(join(staged, 'unexpected'), { recursive: true })
    await releasePrivateMacosOwnerState(allocation, cancellation)
    expect(await readdir(root)).toEqual([])
  })
})
test(
  'native state rejects forged journals and replaced locks while discarding only interrupted staging',
  async () =>
    fixture(async (root) => {
      for (const mode of ['pending', 'forged', 'lock']) {
        const allocation = await planPrivateMacosOwnerStateAllocation({ parent: root, name: mode })
        const state = await openPrivateMacosBackendState(allocation)
        await state.close()
        const control = join(allocation.directory, 'control'),
          path = join(control, 'state.json')
        const original = await readFile(path)
        await writeFile(join(control, 'state.pending'), 'interrupted write', {
          mode: 0o600,
          flag: 'wx',
        })
        if (mode === 'forged') {
          const changed = JSON.parse(original.toString())
          changed.record.phase = 'active'
          await writeFile(path, JSON.stringify(changed))
        } else if (mode === 'lock') {
          await rename(join(control, 'coordinator.lock'), join(control, 'old-lock'))
          await writeFile(join(control, 'coordinator.lock'), '', { mode: 0o600, flag: 'wx' })
        }
        if (mode === 'pending') {
          const reopened = await openPrivateMacosBackendState(allocation)
          try {
            expect((await reopened.read()).phase).toBe('allocated')
          } finally {
            await reopened.close()
          }
          expect(await readFile(path)).toEqual(original)
          expect(await readdir(control)).not.toContain('state.pending')
        } else {
          await expect(openPrivateMacosBackendState(allocation)).rejects.toThrow(
            mode === 'lock' ? 'lock changed' : 'authentication failed',
          )
          expect(await readFile(join(control, 'state.pending'), 'utf8')).toBe('interrupted write')
        }
      }
    }),
  10_000,
)

if (process.platform !== 'darwin') throw Error('This suite requires a native Mac')
