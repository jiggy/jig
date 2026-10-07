import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPrivateAcpAgentProvider,
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from '../src/internal/acp-agent-provider.js'
import { observePrivateMacosCodexPreferences } from '../src/internal/macos-codex-preferences.js'

test('preference observer admits only an ordinary zero exit and withholds all helper details', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-preference-observer-')))
  try {
    for (const [script, stage] of [
      ['exit 0', undefined],
      ['exit 71', 'managed-policy'],
      ['exit 70', 'preferences'],
      ['exit 1', 'preferences'],
      ['kill -TERM $$', 'preferences'],
    ] as const) {
      const path = join(root, 'observer')
      await writeFile(path, `#!/bin/sh\necho private-policy-canary >&2\n${script}\n`, {
        mode: 0o700,
      })
      if (stage === undefined) await observePrivateMacosCodexPreferences(path)
      else {
        try {
          await observePrivateMacosCodexPreferences(path)
          throw new Error('unexpected admission')
        } catch (error) {
          expect(error).toMatchObject({ stage })
          expect(String(error)).not.toContain('private-policy-canary')
        }
      }
    }
    await expect(observePrivateMacosCodexPreferences(join(root, 'missing'))).rejects.toMatchObject({
      stage: 'preferences',
    })
    const slow = join(root, 'slow')
    await writeFile(slow, '#!/bin/sh\nwhile :; do :; done\n', { mode: 0o700 })
    await expect(observePrivateMacosCodexPreferences(slow)).rejects.toMatchObject({
      stage: 'preferences',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 10_000)

test.skipIf(process.platform !== 'darwin')(
  'Codex policy is identity-bearing, fresh on revalidation and absent from other providers',
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-preference-selection-')))
    try {
      const executable = join(root, 'client'),
        adapter = join(root, 'adapter.js'),
        observer = join(root, 'observer'),
        state = join(root, 'policy')
      await writeFile(executable, 'native fixture', { mode: 0o700 })
      await writeFile(adapter, 'adapter fixture')
      await writeFile(state, '0\n')
      await writeFile(observer, `#!/bin/sh\nread decision < '${state}'\nexit "$decision"\n`, {
        mode: 0o700,
      })
      const base = {
        client: 'openai-codex',
        model: 'test',
        credentialMode: 'test',
        adapterPath: adapter,
        sandboxAdapterPath: '/agent/adapter',
        executablePath: executable,
        sandboxExecutablePath: '/agent/client',
        environment: {},
      }
      const ordinary = await createPrivateAcpAgentProvider(base)
      await expect(
        createPrivateAcpAgentProvider({
          ...base,
          macosCodexPreferencesObserverPath: join(root, 'missing-observer'),
        }),
      ).rejects.toMatchObject({ stage: 'installation' })
      const selected = await createPrivateAcpAgentProvider({
        ...base,
        macosCodexPreferencesObserverPath: observer,
      })
      expect(selected.digest).not.toBe(ordinary.digest)
      expect(privateAcpAgentRuntime(selected).macosCodexPreferenceNotifications).toBe(true)
      expect(privateAcpAgentRuntime(ordinary).macosCodexPreferenceNotifications).toBeUndefined()
      for (const client of ['claude-code', 'pi'])
        await expect(
          createPrivateAcpAgentProvider({
            ...base,
            client,
            macosCodexPreferencesObserverPath: observer,
          }),
        ).rejects.toThrow('native macOS Codex')
      await revalidatePrivateAcpAgentProvider(selected)
      await writeFile(state, '71\n')
      await expect(revalidatePrivateAcpAgentProvider(selected)).rejects.toMatchObject({
        stage: 'managed-policy',
      })
      await writeFile(state, '0\n')
      await revalidatePrivateAcpAgentProvider(selected)
      await writeFile(observer, '#!/bin/sh\nexit 0\n')
      await expect(revalidatePrivateAcpAgentProvider(selected)).rejects.toThrow('observer changed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
