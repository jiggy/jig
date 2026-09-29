import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settleTestCommand } from './fixtures/bounded-command.js'

test('child allocation diagnostics preserve the original failure and capacity refusal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-child-allocation-'))
  try {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'root-flow-call-controller-faults.ts'), root],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const result = await settleTestCommand(child, {
      evidence: join(root, 'faults'),
      timeoutMs: 15_000,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('child allocation diagnostics passed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
