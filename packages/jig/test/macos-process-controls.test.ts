import { test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { runMacosFixture } from './fixtures/macos-launchd.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)
native(
  'exclusive owner accounts and signals its exact coalition without touching an outside child',
  async () => {
    await runMacosFixture(
      fileURLToPath(new URL('./fixtures/macos-process-owner.ts', import.meta.url)),
      [],
      { empty: true, signal: 'SIGKILL', passed: true },
    )
  },
  25_000,
)
