import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { openPrivateProjectSession } from '../../src/internal/project-session-controller.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'
import { writeOrdinaryAcpAgent } from '../fixtures/ordinary-acp-agent.js'
import {
  EXPECTED_STRUCTURED_AGENT_RESULT,
  expectNoAgentOwner,
  rootlessCgroups,
  rootlessTemporaryEntry,
  runToTerminal,
  waitForCgroups,
  waitForTemporaryState,
  writeProject,
} from '../fixtures/root-agent-lifecycle.js'

const HOSTILE =
  process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ||
  (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
const NATIVE_AGENT_TIMEOUT_MS = 120_000
const NATIVE_AGENT_TEST_TIMEOUT_MS = 180_000
const nativeCodexPath = process.env.JIG_CODEX_PROOF_PATH
if (!HOSTILE || nativeCodexPath === undefined || process.env.CODEX_HOME === undefined)
  throw new Error(
    'Selected native Codex subscription proof requires its host, executable, and file-backed subscription',
  )

const temporaryRoot = await realpath(tmpdir())
const initialTemporaryState = new Set((await readdir(tmpdir())).filter(rootlessTemporaryEntry))
const initialCgroups = new Set(await rootlessCgroups())

describe.serial('private contained Agent Run lifecycle', () => {
  test(
    'executes the ordinary ACP Agent with native Codex through ACP with an operator-provided file-backed subscription',
    async () => {
      const root = await mkdtemp(join(temporaryRoot, 'jig-native-codex-project-'))
      let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
      try {
        await writeProject(root)
        await writeOrdinaryAcpAgent(root, 'codex')
        session = await openPrivateProjectSession({
          directory: root,
          host: Object.freeze({
            ...(await openPrivateInstalledBunHost(
              installedBunLocation,
              {
                CODEX_HOME: process.env.CODEX_HOME,
                CODEX_MODEL: 'gpt-5.3-codex-spark',
                CODEX_PATH: await realpath(nativeCodexPath!),
              },
              root,
            )),
            runTimeoutMs: NATIVE_AGENT_TIMEOUT_MS,
          }),
        })
        const plan = await session.plan({ lockMode: 'update' })
        if (plan.state !== 'applicable')
          throw new Error('native Codex fixture did not produce a Plan')
        await session.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true })

        expect(
          await runToTerminal(
            session.rootAdministration,
            'native-codex-subscription',
            'success',
            NATIVE_AGENT_TEST_TIMEOUT_MS,
          ),
        ).toMatchObject({
          state: 'terminal',
          terminal: {
            status: 'succeeded',
            outcome: 'done',
            output: {
              status: 'succeeded',
              parentHasKey: false,
              agent: { outcome: 'done', output: { structured: EXPECTED_STRUCTURED_AGENT_RESULT } },
            },
          },
        })
        await expectNoAgentOwner(root)
        await session.close()
        session = undefined
        await waitForCgroups(initialCgroups)
        await waitForTemporaryState(initialTemporaryState)
      } finally {
        await session?.close().catch(() => undefined)
        await rm(root, { recursive: true, force: true })
      }
    },
    NATIVE_AGENT_TEST_TIMEOUT_MS,
  )
})
