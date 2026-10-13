import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from '../../src/internal/acp-agent-provider.js'
import { openPrivateCodexAgentProvider } from '../../src/internal/codex-agent-provider.js'
import { fixture, temporary } from '.././codex-installation.fixture.js'
import { installedBunLocation } from '.././fixtures/installed-bun-location.js'
import { nativeElf } from '.././fixtures/native-elf.js'

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
describe('static Codex npm installation selection', () => {
  test('provider pins native bytes without the dispatcher, npm launcher, metadata or Node', async () => {
    const f = await fixture(true)
    await writeFile(f.native, nativeElf(), { mode: 0o700 })
    const helpers = join(dirname(dirname(f.native)), 'codex-resources')
    await mkdir(helpers)
    await writeFile(join(helpers, 'bwrap'), nativeElf(), { mode: 0o700 })
    const provider = await openPrivateCodexAgentProvider(
      installedBunLocation.releaseRoot,
      { PATH: f.bin, OPENAI_API_KEY: 'offline-placeholder', OPENAI_MODEL: 'test-model' },
      f.project,
    )
    const runtime = privateAcpAgentRuntime(provider)
    expect(runtime.environment.CODEX_PATH).toBe(f.native)
    expect(
      runtime.readOnlyMounts.some(({ source }) =>
        /volta-shim|codex\.js|package\.json|\/node$/.test(source),
      ),
    ).toBe(false)
    await writeFile(join(f.home, 'tools/user/bins/codex.json'), 'changed selection')
    await writeFile(f.wrapper, 'changed launcher')
    await revalidatePrivateAcpAgentProvider(provider)
    await writeFile(f.native, nativeElf({ search: '' }))
    await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow(
      'ACP Agent support changed after selection',
    )
  })
})

if (process.platform !== 'linux') throw Error('This suite requires Linux')
