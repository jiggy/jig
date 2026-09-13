import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  createPrivateAcpAgentProvider,
  revalidatePrivateAcpAgentProvider,
} from '../src/internal/acp-agent-provider.js'
import { inspectPrivateNativeAgentRuntime as inspect } from '../src/internal/native-agent-runtime.js'
import { nativeElf } from './fixtures/native-elf.js'

const roots = new Set<string>()
afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })))
  roots.clear()
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jig-native-runtime-'))
  roots.add(root)
  const project = join(root, 'project')
  await mkdir(project)
  const executable = join(root, 'codex')
  return { root, project, executable }
}
async function file(path: string, options: Parameters<typeof nativeElf>[0] = {}) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, nativeElf(options), { mode: 0o700 })
}
function wrapper(executable: string, path: string) {
  return `makeCWrapper '${executable}' \\\n    --inherit-argv0 \\\n    --prefix 'PATH' ':' '${path}'\n\n`
}

describe('native Agent runtime metadata', () => {
  test('matches fresh provider evidence and still rejects changes before launch', async () => {
    const { root, project, executable } = await fixture()
    const library = join(root, 'libone.so')
    await file(library)
    await file(executable, { needed: ['libone.so'], search: root })
    const inspected = await inspect(executable, project)
    const create = (mounts = inspected.mounts) =>
      createPrivateAcpAgentProvider({
        client: 'test',
        model: 'test',
        credentialMode: 'none',
        adapterPath: executable,
        sandboxAdapterPath: '/agent/adapter',
        executablePath: executable,
        sandboxExecutablePath: '/agent/client',
        environment: {},
        readOnlyMounts: mounts,
      })
    const provider = await create()
    expect(() => inspected.verifyProvider(provider)).not.toThrow()
    expect(() => inspected.verifyProvider({ ...provider })).toThrow()
    const incomplete = await create([])
    expect(() => inspected.verifyProvider(incomplete)).toThrow('runtime changed')
    await writeFile(library, Buffer.concat([nativeElf(), Buffer.from('changed')]))
    const changed = await create()
    expect(() => inspected.verifyProvider(changed)).toThrow('runtime changed')
    await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow('support changed')
    await file(library)
    await writeFile(executable, Buffer.concat([nativeElf(), Buffer.from('changed')]))
    const changedExecutable = await create()
    expect(() => inspected.verifyProvider(changedExecutable)).toThrow('runtime changed')
  })

  test('retains transitive ELF libraries and their lookup paths without retaining directories', async () => {
    const { root, project, executable } = await fixture()
    const library = join(root, 'lib', 'libone.so')
    const target = join(root, 'actual', 'libone.so')
    const nested = join(root, 'lib', 'libtwo.so')
    const loader = join(root, 'loader')
    await file(loader)
    await file(target, { needed: ['libtwo.so'], search: join(root, 'lib') })
    await file(nested)
    await symlink(target, library)
    await file(executable, { interpreter: loader, needed: ['libone.so'], search: '$ORIGIN/lib' })
    const result = await inspect(executable, project)
    expect(result.pathPrefix).toBe('')
    expect(result.mounts).toEqual([
      { source: loader, destination: loader, role: 'support' },
      { source: target, destination: library, role: 'support' },
      { source: nested, destination: nested, role: 'support' },
    ])
  })

  test('resolves loader-owned libraries through an operator-managed interpreter link', async () => {
    const { root, project, executable } = await fixture()
    const loader = join(root, 'runtime', 'ld.so')
    const alias = join(root, 'ld.so')
    const library = join(root, 'runtime', 'libfixture.so')
    await file(loader)
    await file(library)
    await symlink(loader, alias)
    await file(executable, { interpreter: alias, needed: ['libfixture.so'] })
    const result = await inspect(executable, project)
    expect(result.mounts).toEqual([
      { source: loader, destination: alias, role: 'support' },
      { source: library, destination: library, role: 'support' },
    ])
  })

  test('reads a binary wrapper and retains the actual executable without running it', async () => {
    const { root, project, executable } = await fixture()
    const wrapped = join(root, '.codex-wrapped')
    await file(wrapped)
    await file(executable, { wrapper: wrapper(wrapped, join(root, 'tools')) })
    const result = await inspect(executable, project)
    expect(result.pathPrefix).toBe(join(root, 'tools'))
    expect(result.mounts).toEqual([{ source: wrapped, destination: wrapped, role: 'support' }])
    await file(executable, {
      wrapper: wrapper(wrapped, join(root, 'tools')).replace(
        '--inherit-argv0',
        '--add-flags dangerous',
      ),
    })
    await expect(inspect(executable, project)).rejects.toThrow(
      'unsupported native Agent binary wrapper',
    )
  })

  test('rejects libraries reached through the project even when their final target is outside it', async () => {
    const { root, project, executable } = await fixture()
    const target = join(root, 'real.so')
    await file(target)
    await symlink(target, join(project, 'lib.so'))
    await symlink(project, join(root, 'shortcut'))
    await file(executable, { needed: ['lib.so'], search: join(root, 'shortcut') })
    await expect(inspect(executable, project)).rejects.toThrow('enters the project')
  })

  test('rejects wrapped executables in the project', async () => {
    const { root, project, executable } = await fixture()
    const wrapped = join(project, '.codex-wrapped')
    await file(wrapped)
    await file(executable, { wrapper: wrapper(wrapped, root) })
    await expect(inspect(executable, project)).rejects.toThrow('enters the project')
  })

  test.each(['relative', '/absolute::/other', '$UNKNOWN/lib'])(
    'rejects library lookup with ambient meaning: %s',
    async (search) => {
      const { project, executable } = await fixture()
      await file(executable, { search })
      await expect(inspect(executable, project)).rejects.toThrow()
    },
  )

  test('does not apply a parent RUNPATH to an indirect library', async () => {
    const { root, project, executable } = await fixture()
    await file(join(root, 'lib', 'first.so'), { needed: ['second-only-in-parent.so'] })
    await file(join(root, 'lib', 'second-only-in-parent.so'))
    await file(executable, { needed: ['first.so'], search: join(root, 'lib') })
    await expect(inspect(executable, project)).rejects.toThrow('shared library is unavailable')
  })

  test('reuses a direct shared library for an indirect requirement without another RUNPATH', async () => {
    const { root, project, executable } = await fixture()
    const first = join(root, 'lib', 'first.so')
    const shared = join(root, 'lib', 'shared.so')
    await file(first, { needed: ['shared.so'] })
    await file(shared)
    await file(executable, { needed: ['first.so', 'shared.so'], search: join(root, 'lib') })
    const result = await inspect(executable, project)
    expect(result.mounts).toEqual([
      { source: first, destination: first, role: 'support' },
      { source: shared, destination: shared, role: 'support' },
    ])
  })

  test('rejects malformed, non-ELF, missing, and privileged support', async () => {
    const { root, project, executable } = await fixture()
    await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    await expect(inspect(executable, project)).rejects.toThrow('not ELF')
    const bytes = nativeElf()
    bytes.writeBigUInt64LE(2n ** 63n, 32)
    await writeFile(executable, bytes)
    await expect(inspect(executable, project)).rejects.toThrow('ELF bounds')
    const library = join(root, 'missing.so')
    await file(executable, { needed: [library] })
    await expect(inspect(executable, project)).rejects.toThrow()
    await file(library)
    // Bun 1.3.3 chmod masks special bits; use the OS utility to create this hostile mode.
    expect(Bun.spawnSync(['chmod', '4700', library]).exitCode).toBe(0)
    await expect(inspect(executable, project)).rejects.toThrow('runtime file is invalid')
  })
})
