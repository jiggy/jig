import type { JsonValue } from '../json.js'

export const PRIVATE_FLOW_RESOURCE_CEILINGS = Object.freeze({
  memoryBytes: 256 * 1024 * 1024,
  pids: 64,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  cleanupTimeoutMs: 5_000,
})
export const PRIVATE_AGENT_PROVIDER_PIDS = 128

/** Root plus two two-level branches and their largest effects; no borrowed capacity. */
export const PRIVATE_ROOT_RESOURCE_POLICY = Object.freeze({
  siblingFlows: 2,
  leafEffects: 1,
  childFlowLevels: 2,
  memoryBytes: 1792 * 1024 * 1024,
  pids: 576,
  cpuQuotaMicros: 350_000,
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

/** Reserve each branch's Flow levels and largest effect before dispatch. */
export function privateRootBranchReservation(depths: readonly number[]) {
  if (depths.some((depth) => !Number.isSafeInteger(depth) || depth < 1 || depth > 2))
    throw new TypeError('Invalid branch depth.')
  const flow = PRIVATE_FLOW_RESOURCE_CEILINGS
  const flows = depths.reduce((sum, depth) => sum + depth, 0)
  return Object.freeze({
    memoryBytes: flow.memoryBytes * (1 + flows + depths.length),
    pids: flow.pids * (1 + flows) + depths.length * PRIVATE_AGENT_PROVIDER_PIDS,
    cpuQuotaMicros: flow.cpuQuotaMicros * (1 + flows + depths.length),
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
  const depths = allocations.map((value) =>
    isPrivateChildFlowAllocation(value) ? (value as Record<string, JsonValue>).flowDepth : 1,
  )
  if (depths.some((depth) => depth !== 1 && depth !== 2)) return false
  const reserved = privateRootBranchReservation(depths as number[])
  return (
    reserved.memoryBytes <= PRIVATE_ROOT_RESOURCE_POLICY.memoryBytes &&
    reserved.pids <= PRIVATE_ROOT_RESOURCE_POLICY.pids &&
    reserved.cpuQuotaMicros / reserved.cpuPeriodMicros <=
      PRIVATE_ROOT_RESOURCE_POLICY.cpuQuotaMicros / PRIVATE_ROOT_RESOURCE_POLICY.cpuPeriodMicros
  )
}
