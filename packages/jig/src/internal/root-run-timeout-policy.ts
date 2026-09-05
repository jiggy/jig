export const PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS = 30_000
export const PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS = 24 * 60 * 60_000
export const PRIVATE_ROOTLESS_COMMAND_OVERHEAD_ALLOWANCE_MS = 5 * 60_000

export function requirePrivateRootRunTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS) {
    throw new TypeError(
      `root Run timeout must be between 1 and ${PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS} milliseconds`,
    )
  }
  return value
}

export function privateRootlessCommandLifetime(timeoutMs: number): number {
  return requirePrivateRootRunTimeout(timeoutMs) + PRIVATE_ROOTLESS_COMMAND_OVERHEAD_ALLOWANCE_MS
}
