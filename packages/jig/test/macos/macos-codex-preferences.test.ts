import { expect, test } from 'bun:test'
import { appendFile, chmod, copyFile, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPrivateAcpAgentProvider,
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from '../../src/internal/acp-agent-provider.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

// This checks observer identity with actual helper execution. Genuine Codex
// startup is independently required by the native startup suite.
test('actual preference observer is identity-bearing and revalidated before launch', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-preference-identity-')))
  try {
    const observer = join(root, 'observer')
    await copyFile(
      join(installedBunLocation.releaseRoot, 'support/macos-codex-preferences-universal'),
      observer,
    )
    await chmod(observer, 0o700)
    const base = {
      client: 'openai-codex',
      model: 'identity-only',
      credentialMode: 'identity-only',
      adapterPath: await realpath(import.meta.path),
      sandboxAdapterPath: '/agent/adapter',
      executablePath: installedBunLocation.executablePath,
      sandboxExecutablePath: '/agent/client',
      environment: {},
    }
    const ordinary = await createPrivateAcpAgentProvider(base)
    const selected = await createPrivateAcpAgentProvider({
      ...base,
      macosCodexPreferencesObserverPath: observer,
    })
    expect(selected.digest).not.toBe(ordinary.digest)
    expect(privateAcpAgentRuntime(selected).macosCodexPreferenceNotifications).toBe(true)
    expect(privateAcpAgentRuntime(ordinary).macosCodexPreferenceNotifications).toBeUndefined()
    await revalidatePrivateAcpAgentProvider(selected)
    for (const client of ['claude-code', 'pi'])
      await expect(
        createPrivateAcpAgentProvider({
          ...base,
          client,
          macosCodexPreferencesObserverPath: observer,
        }),
      ).rejects.toThrow('native macOS Codex')
    await appendFile(observer, '\n')
    await expect(revalidatePrivateAcpAgentProvider(selected)).rejects.toThrow('observer changed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

if (
  process.platform !== 'darwin' ||
  process.arch !== 'arm64' ||
  process.env.JIG_MACOS_PROCESS_TEST !== '1'
)
  throw Error('This suite requires opted-in native ARM preference identity qualification')
