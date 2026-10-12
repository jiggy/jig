/** Jig's reviewed native turn authority; independent of client and host mechanism. */
export const PRIVATE_NATIVE_TURN_POLICY = Object.freeze({
  default: 1,
  minimum: 1,
  maximum: 8,
})

export function isPrivateNativeTurnAllowance(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= PRIVATE_NATIVE_TURN_POLICY.minimum &&
    value <= PRIVATE_NATIVE_TURN_POLICY.maximum
  )
}
