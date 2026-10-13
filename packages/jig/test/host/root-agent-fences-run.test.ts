import { describe, test } from 'bun:test'
import { readdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { withPrivateMacosGuardianDiagnostics } from '../../src/internal/macos-guardian-diagnostics.js'
import {
  qualifyAgentFence,
  rootlessCgroups,
  rootlessTemporaryEntry,
} from '../fixtures/root-agent-lifecycle.js'

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
const initialTemporaryState = new Set((await readdir(tmpdir())).filter(rootlessTemporaryEntry))
const initialCgroups = new Set(await rootlessCgroups())

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

const nested = false
const acp = false
describe.serial('private contained Agent Run lifecycle', () => {
  guardianLifecycleTest(
    `fences ${nested ? 'specialist' : 'root'} Agent ${acp ? 'ACP' : 'Run'} success, invalid output, cancellation, deadline, and loss`,
    () => qualifyAgentFence(nested, acp, temporaryRoot, initialCgroups, initialTemporaryState),
    process.platform === 'darwin' ? 900_000 : nested ? 240_000 : 180_000,
  )
})
