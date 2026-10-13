import { expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { observePrivateMacosCodexPreferences } from '../../src/internal/macos-codex-preferences.js'

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
