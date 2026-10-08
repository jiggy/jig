export const PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS = 30_000
export const PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS = 24 * 60 * 60_000
export const PRIVATE_ROOTLESS_COMMAND_OVERHEAD_ALLOWANCE_MS = 5 * 60_000
export const PRIVATE_PRESENTATION_CLOSE_RESERVE_MS = 45_000
export const PRIVATE_SETTLED_INSPECTION_MS = 60_000
export const PRIVATE_MAX_SETTLED_INSPECTION_MS = 300_000
export const PRIVATE_PRESENTATION_DEADLINE_ENV = 'JIG_PRIVATE_PRESENTATION_DEADLINE'

/** Same-host monotonic time, including across trusted coordinator reexecution. */
export function privatePresentationNow(): number {
  return Number(process.hrtime.bigint() / 1_000_000n)
}

/** This private scalar can constrain presentation only; it is never launch authority. */
export function privatePresentationDeadline(
  environment: Readonly<NodeJS.ProcessEnv>,
): number | undefined {
  const text = environment[PRIVATE_PRESENTATION_DEADLINE_ENV]
  if (text === undefined || !/^(?:0|[1-9][0-9]{0,15})$/.test(text)) return undefined
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : undefined
}

/** Seed before the first actual enclosing timer or child, and never refresh inherited time. */
export function privateConstrainPresentationDeadline(
  environment: Readonly<NodeJS.ProcessEnv>,
  lifetimeMs: number,
  now = privatePresentationNow(),
): number {
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || !Number.isSafeInteger(now) || now < 0)
    throw new TypeError('invalid private presentation lifetime')
  const local = Math.max(0, now + lifetimeMs - PRIVATE_PRESENTATION_CLOSE_RESERVE_MS)
  const inherited = privatePresentationDeadline(environment)
  return Math.min(local, inherited ?? local)
}

export function privateSettledInspectionDeadline(
  inherited: number | undefined,
  platform: NodeJS.Platform,
  now = privatePresentationNow(),
): number {
  return Math.min(
    now + PRIVATE_SETTLED_INSPECTION_MS,
    privateInspectionHardDeadline(inherited, platform, now),
  )
}

/** Read-only navigation may refresh idle time, never this immutable hard bound. */
export function privateInspectionHardDeadline(
  inherited: number | undefined,
  platform: NodeJS.Platform,
  now = privatePresentationNow(),
  standalone = false,
): number {
  if (!standalone && platform === 'linux' && inherited === undefined) return now
  return Math.min(now + PRIVATE_MAX_SETTLED_INSPECTION_MS, inherited ?? Infinity)
}

export function privateRefreshInspectionDeadline(
  deadline: number,
  hard: number,
  now = privatePresentationNow(),
): number | undefined {
  // Input cannot resurrect an expired display before its queued timer runs.
  if (now >= deadline || now >= hard) return undefined
  return Math.min(now + PRIVATE_SETTLED_INSPECTION_MS, hard)
}

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
