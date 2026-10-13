import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settleTestCommand } from './fixtures/bounded-command.js'

test('root protocol recovery joins importer loans only after fencing and preserves pending owners', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-root-import-retirement-'))
  try {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'fixtures/root-import-retirement.ts'), root],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const result = await settleTestCommand(child, {
      evidence: join(root, 'retirement'),
      timeoutMs: 15_000,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('root importer retirement ordering passed: 9 scenarios')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
