import { describe, expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  openPrivateInstalledBunSupport,
  requirePrivateInstalledBunSupport,
  revalidatePrivateInstalledBunSupport,
} from '../src/internal/installed-bun-support.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

describe('fixed installed Bun support', () => {
  test('workspace fixtures name the canonical installed runtime', async () => {
    expect(installedBunLocation.executablePath).toBe(
      await realpath(installedBunLocation.executablePath),
    )
    await expect(openPrivateInstalledBunSupport(installedBunLocation)).resolves.toMatchObject({
      executablePath: installedBunLocation.executablePath,
    })
  })

  test('authenticates the fixed adjacent layout and detects drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-installed-support-'))
    const executable = join(root, 'node_modules', '@oven', 'bun-linux-x64-baseline', 'bin', 'bun')
    const installedCli = join(root, 'libexec', 'installed-cli.js')
    const agent = join(root, 'libexec', 'agent')
    const evaluator = join(root, 'libexec', 'evaluator')
    const preparation = join(root, 'libexec', 'preparation')
    try {
      await mkdir(join(executable, '..'), { recursive: true })
      await mkdir(agent, { recursive: true })
      await mkdir(evaluator, { recursive: true })
      await mkdir(preparation, { recursive: true })
      await copyFile(installedBunLocation.executablePath, executable)
      await writeFile(installedCli, 'installed command\n')
      await writeFile(join(root, 'libexec', 'linux-rootless-supervisor.js'), 'supervisor\n')
      await writeFile(join(evaluator, 'project-evaluator-worker.js'), 'worker\n')
      await writeFile(join(evaluator, 'project-evaluator-sdk.bundle.js'), 'sdk\n')
      await writeFile(join(evaluator, 'project-authoring-1.schema.json'), '{}\n')
      await writeFile(join(agent, 'openai-agent-worker.js'), 'agent worker\n')
      await writeFile(join(preparation, 'bun-native-preparation-worker.js'), 'preparation\n')

      const location = {
        releaseRoot: root,
        executablePath: executable,
        installedCliPath: installedCli,
      }
      const support = await openPrivateInstalledBunSupport(location)
      expect(requirePrivateInstalledBunSupport(support)).toBe(support)
      expect(() => requirePrivateInstalledBunSupport(Object.freeze({ ...support }))).toThrow(
        'installed Bun support was not produced by the fixed host factory',
      )
      expect((await openPrivateInstalledBunSupport(location)).digest).toBe(support.digest)
      expect(support.sandboxExecutablePath).toBe('/jig-runtime/bun')
      expect(support.sandboxAgentWorkerPath).toBe('/jig-agent-worker.js')
      expect(support.sandboxPreparationWorkerPath).toBe('/jig-preparation-worker.js')
      expect(support.runtimeMounts.map(({ destination }) => destination)).toEqual([
        '/jig-runtime/bun',
        '/lib64/ld-linux-x86-64.so.2',
        '/jig-runtime/lib/libc.so.6',
        '/jig-runtime/lib/libm.so.6',
        '/jig-runtime/lib/libdl.so.2',
        '/jig-runtime/lib/libpthread.so.0',
      ])
      await expect(revalidatePrivateInstalledBunSupport(support)).resolves.toBeUndefined()

      await writeFile(join(preparation, 'bun-native-preparation-worker.js'), 'changed\n')
      await expect(revalidatePrivateInstalledBunSupport(support)).rejects.toThrow(
        'installed Bun support changed after selection',
      )
      await writeFile(join(preparation, 'bun-native-preparation-worker.js'), 'preparation\n')
      await expect(revalidatePrivateInstalledBunSupport(support)).resolves.toBeUndefined()

      await writeFile(join(agent, 'openai-agent-worker.js'), 'changed\n')
      await expect(revalidatePrivateInstalledBunSupport(support)).rejects.toThrow(
        'installed Bun support changed after selection',
      )
      await writeFile(join(agent, 'openai-agent-worker.js'), 'agent worker\n')
      await expect(revalidatePrivateInstalledBunSupport(support)).resolves.toBeUndefined()

      await writeFile(installedCli, 'changed command\n')
      await expect(revalidatePrivateInstalledBunSupport(support)).rejects.toThrow(
        'installed Bun support changed after selection',
      )
      await writeFile(installedCli, 'installed command\n')
      await expect(revalidatePrivateInstalledBunSupport(support)).resolves.toBeUndefined()

      await writeFile(join(evaluator, 'project-evaluator-worker.js'), 'changed\n')
      await expect(revalidatePrivateInstalledBunSupport(support)).rejects.toThrow(
        'installed Bun support changed after selection',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
