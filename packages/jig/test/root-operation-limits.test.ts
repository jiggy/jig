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

test('two two-level branches exactly fit the fixed root budget, including both effects', () => {
  expect(PRIVATE_ROOT_RESOURCE_POLICY).toEqual({
    siblingFlows: 2,
    leafEffects: 1,
    childFlowLevels: 5,
    memoryBytes: 1792 * 1024 * 1024,
    pids: 576,
    cpuQuotaMicros: 350_000,
    cpuPeriodMicros: 100_000,
    reservation: 'whole-branch-until-cleanup',
  })
  expect(privateRootBranchReservation([2, 2])).toEqual({
    memoryBytes: PRIVATE_ROOT_RESOURCE_POLICY.memoryBytes,
    pids: PRIVATE_ROOT_RESOURCE_POLICY.pids,
    cpuQuotaMicros: PRIVATE_ROOT_RESOURCE_POLICY.cpuQuotaMicros,
    cpuPeriodMicros: PRIVATE_ROOT_RESOURCE_POLICY.cpuPeriodMicros,
  })
  expect(PRIVATE_FLOW_RESOURCE_CEILINGS).toEqual({
    memoryBytes: 256 * 1024 * 1024,
    pids: 64,
    cpuQuotaMicros: 50_000,
    cpuPeriodMicros: 100_000,
    cleanupTimeoutMs: 5_000,
  })
  expect(PRIVATE_AGENT_PROVIDER_PIDS).toBe(128)
  expect(privateRootBranchReservation([1, 1])).toEqual({
    memoryBytes: 1280 * 1024 * 1024,
    pids: 448,
    cpuQuotaMicros: 250_000,
    cpuPeriodMicros: 100_000,
  })
})

test('both sibling branches can reserve two Flow levels without borrowing capacity', () => {
  const deep = { ...flow, flowDepth: 2 }
  expect(canReservePrivateRootOperation([], deep)).toBe(true)
  expect(canReservePrivateRootOperation([deep], flow)).toBe(true)
  expect(canReservePrivateRootOperation([flow], deep)).toBe(true)
  expect(canReservePrivateRootOperation([deep], deep)).toBe(true)
  expect(canReservePrivateRootOperation([deep, deep], flow)).toBe(false)
  expect(canReservePrivateRootOperation([flow, deep], flow)).toBe(false)
  for (const flowDepth of [0, 6, 1.5, null, '2']) {
    expect(canReservePrivateRootOperation([], { ...flow, flowDepth })).toBe(false)
    expect(canReservePrivateRootOperation([deep], { ...flow, flowDepth })).toBe(false)
  }
  expect(canReservePrivateRootOperation([], { kind: flow.kind })).toBe(false)
  for (const depths of [[0], [6], [1.5], [2, 6], [Number.NaN], [Infinity]])
    expect(() => privateRootBranchReservation(depths)).toThrow('Invalid branch depth.')
})

test('deeper useful methods fit the same aggregate budget without borrowing or expanding it', () => {
  expect(canReservePrivateRootOperation([], { ...flow, flowDepth: 5 })).toBe(true)
  expect(canReservePrivateRootOperation([{ ...flow, flowDepth: 5 }], flow)).toBe(false)
  expect(canReservePrivateRootOperation([{ ...flow, flowDepth: 3 }], flow)).toBe(true)
  expect(
    canReservePrivateRootOperation([{ ...flow, flowDepth: 3 }], { ...flow, flowDepth: 2 }),
  ).toBe(false)
  expect(canReservePrivateRootOperation([flow], { ...flow, flowDepth: 3 })).toBe(true)
  expect(privateRootBranchReservation([3, 1])).toEqual(privateRootBranchReservation([2, 2]))
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
    expect(canReservePrivateRootOperation([{ ...flow, flowDepth: 2 }], effect)).toBe(false)
    expect(canReservePrivateRootOperation([effect], { ...flow, flowDepth: 2 })).toBe(false)
  }
})
