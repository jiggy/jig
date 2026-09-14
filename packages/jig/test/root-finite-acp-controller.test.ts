import { describe, expect, test } from 'bun:test'

import { isPrivateRootFiniteAcpOwner } from '../src/internal/root-finite-acp-controller.js'

describe('private finite ACP resource controller', () => {
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
