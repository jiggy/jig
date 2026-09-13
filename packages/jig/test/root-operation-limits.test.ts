import { expect, test } from 'bun:test'
import {
  canReservePrivateRootOperation,
  PRIVATE_AGENT_PROVIDER_PIDS,
  PRIVATE_FLOW_RESOURCE_CEILINGS,
  PRIVATE_ROOT_RESOURCE_POLICY,
  privateRootBranchReservation,
} from '../src/internal/root-operation-limits.js'

const flow = { kind: 'private-root-child-owner-allocation/1' }
const agent = { kind: 'private-root-agent-owner-allocation/1' }
const command = { kind: 'private-contained-effect-owner/1' }

test('two whole branch reservations fit the root budget, including both provider envelopes', () => {
  expect(privateRootBranchReservation(2)).toEqual({
    memoryBytes: PRIVATE_ROOT_RESOURCE_POLICY.memoryBytes,
    pids: PRIVATE_ROOT_RESOURCE_POLICY.pids,
    cpuQuotaMicros: PRIVATE_ROOT_RESOURCE_POLICY.cpuQuotaMicros,
    cpuPeriodMicros: PRIVATE_ROOT_RESOURCE_POLICY.cpuPeriodMicros,
  })
  expect(PRIVATE_FLOW_RESOURCE_CEILINGS.pids).toBeLessThanOrEqual(PRIVATE_AGENT_PROVIDER_PIDS)
  expect(privateRootBranchReservation(3).memoryBytes).toBeGreaterThan(
    PRIVATE_ROOT_RESOURCE_POLICY.memoryBytes,
  )
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
