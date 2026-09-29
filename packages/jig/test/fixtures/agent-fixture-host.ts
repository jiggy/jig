import type { PrivateProjectSessionHost } from '../../src/internal/project-session-controller.js'

// Explicit operator budgets for native composition evidence, not production defaults.
export const MACOS_FIXTURE_RUN_MS = 5 * 60_000
export const MACOS_FIXTURE_SETTLEMENT_MS = MACOS_FIXTURE_RUN_MS + 75_000
export const MACOS_FIXTURE_ADMISSION_MS = 3 * 60_000
export function fixtureHost(host: PrivateProjectSessionHost): PrivateProjectSessionHost {
  return process.platform === 'darwin' ? { ...host, runTimeoutMs: MACOS_FIXTURE_RUN_MS } : host
}
