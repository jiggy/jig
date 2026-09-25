import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settleTestCommand } from './fixtures/bounded-command.js'

test('an expired retry resolves and releases its prior contained-effect owner first', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-contained-controller-'))
  try {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'contained-effect-controller-faults.ts')],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const result = await settleTestCommand(child, {
      evidence: join(root, 'faults'),
      timeoutMs: 15_000,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('contained effect deadline/prior-owner ordering checks passed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
