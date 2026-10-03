import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from '../src/internal/acp-agent-provider.js'
import { openPrivateClaudeAgentProvider } from '../src/internal/claude-agent-provider.js'
import { openPrivatePiAgentProvider } from '../src/internal/pi-agent-provider.js'
import { nativeElf } from './fixtures/native-elf.js'
import { nativeMachO } from './fixtures/native-macho.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

for (const client of ['claude', 'pi'] as const) {
  describe(`${client} reviewed native installation`, () => {
    test('retains installation paths and snapshots configuration before asynchronous discovery', async () => {
      const f = await fixture(client)
      const pending = f.open()
      f.environment.PATH = f.project
      f.environment.ANTHROPIC_MODEL = 'changed-model'
      f.environment.PI_MODEL = 'changed-model'
      const provider = await pending
      const runtime = privateAcpAgentRuntime(provider)
      expect(provider.model).toBe(client === 'claude' ? 'test-model' : 'mistral/test-model')
      expect(runtime.executablePath).toBe(f.executable)
      expect(runtime.sandboxExecutablePath).toBe(f.executable)
      expect(runtime.readOnlyMounts).toContainEqual({ source: f.library, destination: f.library })
      expect(runtime.environment.LD_LIBRARY_PATH).toBeUndefined()
      await revalidatePrivateAcpAgentProvider(provider)
    })

    for (const file of [
      'executable',
      'library',
      'launcher',
      'adapter',
      ...(client === 'pi' ? ['manifest', 'dark', 'light'] : []),
    ] as const) {
      test(`rejects replaced ${file} bytes before launch and changes reviewed identity`, async () => {
        const f = await fixture(client)
        const provider = await f.open()
        const path = f.paths[file]
        await writeFile(path, Buffer.concat([await readFile(path), Buffer.from('\n')]))
        await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow('support changed')
        expect((await f.open()).digest).not.toBe(provider.digest)
      })
    }

    test('rejects a shell launcher during review without executing it', async () => {
      const f = await fixture(client)
      const marker = join(f.root, 'executed')
      await writeFile(f.executable, `#!/bin/sh\ntouch '${marker}'\n`)
      await expect(f.open()).rejects.toMatchObject({ stage: 'wrapper' })
      await expect(readFile(marker)).rejects.toThrow()
    })

    test('rejects missing libraries and support routed through project symlinks', async () => {
      const f = await fixture(client)
      await rm(f.library)
      await expect(f.open()).rejects.toMatchObject({ stage: 'installation' })
      const localLibrary = join(f.project, 'libfixture.so')
      await writeFile(localLibrary, nativeElf())
      await symlink(localLibrary, f.library)
      await expect(f.open()).rejects.toMatchObject({ stage: 'installation' })
    })

    if (client === 'pi') {
      test('rejects project-selected sibling assets and binary wrappers', async () => {
        const f = await fixture(client)
        const localTheme = join(f.project, 'theme.json')
        await writeFile(localTheme, '{}')
        await rm(f.paths.dark)
        await symlink(localTheme, f.paths.dark)
        await expect(f.open()).rejects.toMatchObject({ stage: 'installation' })
        await rm(f.paths.dark)
        await writeFile(f.paths.dark, '{}')
        const wrapped = join(f.root, 'wrapped')
        await writeFile(wrapped, nativeElf(), { mode: 0o700 })
        await writeFile(
          f.executable,
          nativeElf({
            wrapper: `makeCWrapper '${wrapped}' \\\n    --inherit-argv0 \\\n    --prefix 'PATH' ':' '/operator/bin'\n\n`,
          }),
        )
        await expect(f.open()).rejects.toMatchObject({ stage: 'installation' })
      })
    } else {
      test.skipIf(process.platform !== 'linux')(
        'retains and revalidates a declarative native wrapper target',
        async () => {
          const f = await fixture(client)
          const wrapped = join(f.root, '.claude-wrapped')
          await writeFile(wrapped, nativeElf(), { mode: 0o700 })
          await writeFile(
            f.executable,
            nativeElf({
              wrapper: `makeCWrapper '${wrapped}' \\\n    --inherit-argv0 \\\n    --prefix 'PATH' ':' '/operator/bin'\n\n`,
            }),
          )
          const provider = await f.open()
          expect(privateAcpAgentRuntime(provider).readOnlyMounts).toContainEqual({
            source: wrapped,
            destination: wrapped,
          })
          await writeFile(wrapped, nativeElf({ needed: ['changed.so'] }))
          await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow(
            'support changed',
          )
        },
      )
    }
  })
}

async function fixture(client: 'claude' | 'pi') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-native-provider-runtime-')))
  temporary.push(root)
  const project = join(root, 'project')
  const install = join(root, 'operator')
  const release = join(root, 'release')
  const agent = join(release, 'libexec', 'agent')
  await Promise.all(
    [project, agent, join(install, 'theme')].map((path) => mkdir(path, { recursive: true })),
  )
  const executable = join(install, client)
  const library = join(install, 'libfixture.so')
  const paths: Record<string, string> = {
    executable,
    library,
    launcher: join(agent, `${client}-agent-launcher.js`),
    adapter: join(agent, client === 'claude' ? 'claude-agent-acp.js' : 'pi-acp.js'),
    manifest: join(install, 'package.json'),
    dark: join(install, 'theme', 'dark.json'),
    light: join(install, 'theme', 'light.json'),
  }
  await Promise.all([
    writeFile(
      executable,
      process.platform === 'darwin'
        ? nativeMachO({ needed: ['@loader_path/libfixture.so'] })
        : nativeElf({ needed: ['libfixture.so'], search: '$ORIGIN' }),
      {
        mode: 0o700,
      },
    ),
    writeFile(library, process.platform === 'darwin' ? nativeMachO({ library }) : nativeElf()),
    writeFile(paths.launcher!, 'launcher', { mode: 0o700 }),
    writeFile(paths.adapter!, 'adapter'),
    writeFile(
      paths.manifest!,
      JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '0.84.4' }),
    ),
    writeFile(paths.dark!, '{}'),
    writeFile(paths.light!, '{}'),
  ])
  const environment: Record<string, string> =
    client === 'claude'
      ? {
          PATH: install,
          ANTHROPIC_API_KEY: 'test-secret',
          ANTHROPIC_MODEL: 'test-model',
        }
      : { PATH: install, PI_PROVIDER: 'mistral', PI_MODEL: 'test-model', PI_API_KEY: 'test-secret' }
  const opener = client === 'claude' ? openPrivateClaudeAgentProvider : openPrivatePiAgentProvider
  return {
    root,
    project,
    paths,
    executable,
    library,
    environment,
    open: () => opener(release, environment, project),
  }
}
