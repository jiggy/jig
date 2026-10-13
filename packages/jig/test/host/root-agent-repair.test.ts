import { describe, test } from 'bun:test'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { withPrivateMacosGuardianDiagnostics } from '../../src/internal/macos-guardian-diagnostics.js'
import { qualifyRepairScenario } from '../fixtures/root-agent-lifecycle.js'

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
) {
  throw new Error(
    'This suite requires JIG_LINUX_ROOTLESS_HOSTILE=1 on Linux or JIG_MACOS_PROCESS_TEST=1 on macOS',
  )
}

const temporaryRoot = await realpath(tmpdir())

function guardianLifecycleTest(name: string, run: () => Promise<void>, timeoutMs: number): void {
  test(
    name,
    () =>
      withPrivateMacosGuardianDiagnostics(
        (event) => console.error('agent-guardian-recovery', JSON.stringify(event)),
        run,
      ),
    timeoutMs,
  )
}

describe.serial('contained repair file application', () => {
  guardianLifecycleTest(
    'exports successful repair evidence through a JSON leaf and real contained commands',
    () => qualifyRepairScenario('successful', temporaryRoot),
    process.platform === 'darwin' ? 420_000 : 180_000,
  )
})
