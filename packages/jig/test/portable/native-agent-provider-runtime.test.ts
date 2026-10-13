import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from '../../src/internal/acp-agent-provider.js'
import { nativeElf } from '.././fixtures/native-elf.js'
import { fixture, temporary } from '.././native-agent-provider-runtime.fixture.js'

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
    }
  })
}
