import { expect, test } from 'bun:test'
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cancelPrivateMacosOwnerStateAllocation,
  normalizePrivateMacosOwnerStateAllocationIdentity,
  openPrivateMacosBackendState,
  type PrivateMacosOwnerStateCancellation,
  planPrivateMacosOwnerStateAllocation,
  releasePrivateMacosOwnerState,
} from '../src/internal/macos-backend-state.js'
import type { JsonObject } from '../src/json.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)
async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp('/private/tmp/jig-backend-state-')
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true })
  }
}

async function interruptedReleaseFixture(root: string): Promise<string> {
  const sourceUrl = new URL('../src/internal/macos-backend-state.ts', import.meta.url)
  const directory = fileURLToPath(new URL('.', sourceUrl))
  const source = await readFile(sourceUrl, 'utf8')
  const write = '          await file.writeFile(marker)'
  expect(source.split(write)).toHaveLength(2)
  const module = join(root, 'interrupted-release.ts')
  await writeFile(
    module,
    source
      .replace(
        write,
        `          process.stdout.write('release-write\\n')\n          await new Promise<void>(() => {})\n${write}`,
      )
      .replaceAll("from './", `from '${directory}`)
      .replaceAll("from '../", `from '${fileURLToPath(new URL('..', sourceUrl))}`),
  )
  const runner = join(root, 'release-runner.ts')
  await writeFile(
    runner,
    `import { readFile } from 'node:fs/promises'
import { releasePrivateMacosOwnerState } from ${JSON.stringify(module)}
const { allocation, proof } = JSON.parse(await readFile(process.argv[2], 'utf8'))
await releasePrivateMacosOwnerState(allocation, proof)
`,
  )
  return runner
}

test('constructs the interrupted-release coordinator without native execution', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-release-fixture-')))
  try {
    const runner = await interruptedReleaseFixture(root)
    const built = await Bun.build({ entrypoints: [runner], target: 'bun' })
    expect(built.success, String(built.logs)).toBe(true)
  } finally {
    await rm(root, { recursive: true })
  }
})

native(
  'native release resumes after coordinator loss during marker publication',
  async () => {
    await fixture(async (root) => {
      const runner = await interruptedReleaseFixture(root)
      for (const phase of ['cancelled', 'finished'] as const) {
        const allocation = await planPrivateMacosOwnerStateAllocation({ parent: root, name: phase })
        let proof: PrivateMacosOwnerStateCancellation | JsonObject
        if (phase === 'cancelled') {
          proof = await cancelPrivateMacosOwnerStateAllocation(allocation)
        } else {
          const state = await openPrivateMacosBackendState(allocation)
          proof = { fenced: true, fixture: 'separate backend proof required' }
          try {
            await state.seal({ digest: 'fixture-owner' })
            await state.admit()
            await state.finish(proof)
          } finally {
            await state.close()
          }
        }
        const path = join(root, `${phase}.json`)
        await writeFile(path, JSON.stringify({ allocation, proof }), { mode: 0o600 })
        const child = Bun.spawn(
          [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', runner, path],
          { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        )
        try {
          const reader = child.stdout.getReader()
          const ready = await reader.read()
          reader.releaseLock()
          expect(Buffer.from(ready.value!).toString()).toBe('release-write\n')
          await expect(openPrivateMacosBackendState(allocation)).rejects.toThrow('still held')
          child.kill('SIGKILL')
          await child.exited
          expect(child.signalCode).toBe('SIGKILL')
          const names = await readdir(allocation.directory)
          const staged = names.includes('release.pending') ? 'release.pending' : 'release.json'
          expect(await readFile(join(allocation.directory, staged))).toHaveLength(0)
          const reopened = await openPrivateMacosBackendState(allocation)
          try {
            expect((await reopened.read()).phase).toBe(phase)
            await expect(reopened.admit()).rejects.toThrow('not permitted')
          } finally {
            await reopened.close()
          }
          const receipt = await releasePrivateMacosOwnerState(allocation, proof)
          expect((await releasePrivateMacosOwnerState(allocation, proof)).digest).toBe(
            receipt.digest,
          )
          expect(await readdir(root)).not.toContain(phase)
          expect(await readdir(root)).not.toContain(`.${phase}.release`)
        } finally {
          child.kill('SIGKILL')
          await child.exited
        }
      }
    })
  },
  10_000,
)

native(
  'native release staging cannot bypass proof or unsafe-record rejection',
  async () => {
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
  },
  10_000,
)

native(
  'native owner state commits exact admission once and excludes late starts after cancellation',
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
        const owner = { digest: 'fixture-owner', nonce: 'original' }
        const sealed = state.seal(owner)
        owner.nonce = 'mutated'
        await sealed
        expect((await state.read()).sealed).toEqual({ digest: 'fixture-owner', nonce: 'original' })
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

native('released native allocation authority cannot recreate its owner directory', async () => {
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

native(
  'native release preserves unexpected state and resumes only after exact repair',
  async () => {
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
  },
)

native(
  'fresh native recovery sees committed active state after coordinator death and retains one final receipt',
  async () =>
    fixture(async (root) => {
      const allocation = await planPrivateMacosOwnerStateAllocation({ parent: root, name: 'run' })
      const state = await openPrivateMacosBackendState(allocation)
      await state.seal({ digest: 'fixture-owner' })
      await state.close()
      const path = join(root, 'allocation.json')
      await writeFile(path, JSON.stringify(allocation), { mode: 0o600 })
      const command = [
        process.execPath,
        '--no-env-file',
        '--no-install',
        '--config=/dev/null',
        join(import.meta.dir, 'fixtures/macos-backend-state.ts'),
        path,
      ]
      const child = Bun.spawn([...command, 'admit-hold'], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      try {
        const reader = child.stdout.getReader()
        const ready = await reader.read()
        reader.releaseLock()
        expect(Buffer.from(ready.value!).toString()).toBe('active\n')
        await expect(openPrivateMacosBackendState(allocation)).rejects.toThrow('still held')
        child.kill('SIGKILL')
        await child.exited
        const recovered = await openPrivateMacosBackendState(allocation)
        try {
          expect((await recovered.read()).phase).toBe('active')
          await expect(recovered.cancel()).rejects.toThrow('not permitted')
          const receipt = { fenced: true, fixture: 'separate backend proof required' }
          await recovered.finish(receipt)
          await recovered.finish(receipt)
          await expect(recovered.finish({ fenced: true, different: true })).rejects.toThrow(
            'not permitted',
          )
          await expect(recovered.admit()).rejects.toThrow('not permitted')
        } finally {
          await recovered.close()
        }
        const observer = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
        expect(await observer.exited).toBe(0)
        expect(await new Response(observer.stdout).text()).toBe('finished\n')
        await releasePrivateMacosOwnerState(allocation, {
          fenced: true,
          fixture: 'separate backend proof required',
        })
        await expect(openPrivateMacosBackendState(allocation)).rejects.toThrow()
      } finally {
        child.kill('SIGKILL')
        await child.exited
      }
    }),
  15_000,
)

native(
  'native state rejects forged journals and replaced locks while discarding only interrupted staging',
  async () =>
    fixture(async (root) => {
      for (const mode of ['pending', 'forged', 'lock']) {
        const allocation = await planPrivateMacosOwnerStateAllocation({ parent: root, name: mode })
        const state = await openPrivateMacosBackendState(allocation)
        await state.seal({ digest: 'fixture-owner' })
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
            expect((await reopened.read()).phase).toBe('sealed')
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
