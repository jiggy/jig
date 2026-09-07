import type { JsonValue } from '../json.js'

export const PRIVATE_FLOW_RESOURCE_CEILINGS = Object.freeze({
  memoryBytes: 256 * 1024 * 1024,
  pids: 64,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  cleanupTimeoutMs: 5_000,
})
export const PRIVATE_AGENT_PROVIDER_PIDS = 128

/** Fixed aggregate payload budget; trusted supervisors remain outside it. */
export const PRIVATE_ROOT_RESOURCE_POLICY = Object.freeze({
  siblingFlows: 2,
  leafEffects: 1,
  memoryBytes: 1280 * 1024 * 1024,
  pids: 448,
  cpuQuotaMicros: 250_000,
  cpuPeriodMicros: 100_000,
  reservation: 'whole-branch-until-cleanup' as const,
})

export function isPrivateChildFlowAllocation(value: JsonValue): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, JsonValue>).kind === 'private-root-child-owner-allocation/1'
  )
}

/** Reserve a Flow plus its largest possible effect before either can start. */
export function privateRootBranchReservation(branches: number) {
  if (!Number.isSafeInteger(branches) || branches < 0) throw new TypeError('Invalid branch count.')
  const flow = PRIVATE_FLOW_RESOURCE_CEILINGS
  return Object.freeze({
    memoryBytes: flow.memoryBytes * (1 + branches * 2),
    pids: flow.pids + branches * (flow.pids + PRIVATE_AGENT_PROVIDER_PIDS),
    cpuQuotaMicros: flow.cpuQuotaMicros * (1 + branches * 2),
    cpuPeriodMicros: flow.cpuPeriodMicros,
  })
}

/** Called inside the durable allocation transaction; fenced rows still count. */
export function canReservePrivateRootOperation(
  current: readonly JsonValue[],
  proposed: JsonValue,
): boolean {
  const allocations = [...current, proposed]
  const allFlows = allocations.every(isPrivateChildFlowAllocation)
  if (!allFlows && allocations.length !== 1) return false
  if (allocations.length > PRIVATE_ROOT_RESOURCE_POLICY.siblingFlows) return false
  // An exclusive effect (or other private ownership record) conservatively
  // reserves one whole branch too. Nested effects consume their parent's
  // already reserved capacity, never a fresh independent root budget.
  const reserved = privateRootBranchReservation(allocations.length)
  return (
    reserved.memoryBytes <= PRIVATE_ROOT_RESOURCE_POLICY.memoryBytes &&
    reserved.pids <= PRIVATE_ROOT_RESOURCE_POLICY.pids &&
    reserved.cpuQuotaMicros / reserved.cpuPeriodMicros <=
      PRIVATE_ROOT_RESOURCE_POLICY.cpuQuotaMicros / PRIVATE_ROOT_RESOURCE_POLICY.cpuPeriodMicros
  )
}
