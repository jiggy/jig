import { expect, test } from 'bun:test'
import {
  canReservePrivateRootOperation,
  PRIVATE_AGENT_PROVIDER_PIDS,
  PRIVATE_FLOW_RESOURCE_CEILINGS,
  PRIVATE_ROOT_RESOURCE_POLICY,
  privateRootBranchReservation,
} from '../src/internal/root-operation-limits.js'

const flow = { kind: 'private-root-child-owner-allocation/1', flowDepth: 1 }
const agent = { kind: 'private-root-agent-owner-allocation/1' }
const command = { kind: 'private-contained-effect-owner/1' }

test('two whole branch reservations fit the root budget, including both provider envelopes', () => {
  expect(privateRootBranchReservation([1, 1])).toEqual({
    memoryBytes: PRIVATE_ROOT_RESOURCE_POLICY.memoryBytes,
    pids: PRIVATE_ROOT_RESOURCE_POLICY.pids,
    cpuQuotaMicros: PRIVATE_ROOT_RESOURCE_POLICY.cpuQuotaMicros,
    cpuPeriodMicros: PRIVATE_ROOT_RESOURCE_POLICY.cpuPeriodMicros,
  })
  expect(PRIVATE_FLOW_RESOURCE_CEILINGS.pids).toBeLessThanOrEqual(PRIVATE_AGENT_PROVIDER_PIDS)
  expect(privateRootBranchReservation([1, 1, 1]).memoryBytes).toBeGreaterThan(
    PRIVATE_ROOT_RESOURCE_POLICY.memoryBytes,
  )
})

test('a deeper branch reserves its additional Flow without increasing the aggregate ceiling', () => {
  const deep = { ...flow, flowDepth: 2 }
  expect(canReservePrivateRootOperation([], deep)).toBe(true)
  expect(canReservePrivateRootOperation([deep], flow)).toBe(false)
  expect(canReservePrivateRootOperation([flow], deep)).toBe(false)
  expect(canReservePrivateRootOperation([deep], deep)).toBe(false)
  for (const flowDepth of [0, 3, null, '2'])
    expect(canReservePrivateRootOperation([], { ...flow, flowDepth })).toBe(false)
  expect(canReservePrivateRootOperation([], { kind: flow.kind })).toBe(false)
})

test('root admission permits only two siblings or one exclusive effect, with no queue', () => {
  expect(canReservePrivateRootOperation([], flow)).toBe(true)
  expect(canReservePrivateRootOperation([flow], flow)).toBe(true)
  expect(canReservePrivateRootOperation([flow, flow], flow)).toBe(false)
  for (const effect of [agent, command, null]) {
    expect(canReservePrivateRootOperation([], effect)).toBe(true)
    expect(canReservePrivateRootOperation([flow], effect)).toBe(false)
    expect(canReservePrivateRootOperation([effect], flow)).toBe(false)
    expect(canReservePrivateRootOperation([effect], effect)).toBe(false)
  }
})
