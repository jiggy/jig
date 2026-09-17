import { describe, expect, test } from 'bun:test'

import { isPrivateRootFiniteAcpOwner } from '../src/internal/root-finite-acp-controller.js'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { settleTestCommand } from './fixtures/bounded-command.js'

describe('private finite ACP resource controller', () => {
  test('restoration failure boundaries, receipt ordering and actual recipient scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-acp-controller-'))
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'fixtures/acp-controller-faults.ts')],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const result = await settleTestCommand(child, {
      evidence: join(root, 'faults'),
      timeoutMs: 15_000,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('controller fault and scope checks passed')
  })
  test('classifies only its own cleanup-ledger allocation kind', () => {
    const base = {
      parentRunId: `sha256:${'1'.repeat(64)}`,
      operationId: 'agent:1',
    }
    expect(
      isPrivateRootFiniteAcpOwner({
        ...base,
        allocation: {
          digest: `sha256:${'2'.repeat(64)}`,
          value: { kind: 'private-root-agent-owner-allocation/1' },
        },
      }),
    ).toBe(true)
    expect(
      isPrivateRootFiniteAcpOwner({
        ...base,
        allocation: {
          digest: `sha256:${'3'.repeat(64)}`,
          value: { kind: 'private-root-child-owner-allocation/1' },
        },
      }),
    ).toBe(false)
  })
})
