import { afterEach, describe, expect, test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
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
    if (client === 'pi') {
    } else {
      test('retains and revalidates a declarative native wrapper target', async () => {
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
        await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow('support changed')
      })
    }
  })
}

if (process.platform !== 'linux') throw Error('This suite requires Linux')
