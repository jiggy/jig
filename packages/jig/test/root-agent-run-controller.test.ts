import { describe, expect, test } from 'bun:test'

import { isPrivateRootAgentRunOwner } from '../src/internal/root-agent-run-controller.js'

describe('private root Agent Run controller', () => {
  test('classifies only its own cleanup-ledger allocation kind', () => {
    const base = {
      parentRunId: `sha256:${'1'.repeat(64)}`,
      operationId: 'agent:1',
    }
    expect(
      isPrivateRootAgentRunOwner({
        ...base,
        allocation: {
          digest: `sha256:${'2'.repeat(64)}`,
          value: { kind: 'private-root-agent-owner-allocation/1' },
        },
      }),
    ).toBe(true)
    expect(
      isPrivateRootAgentRunOwner({
        ...base,
        allocation: {
          digest: `sha256:${'3'.repeat(64)}`,
          value: { kind: 'private-root-child-owner-allocation/1' },
        },
      }),
    ).toBe(false)
  })
})
