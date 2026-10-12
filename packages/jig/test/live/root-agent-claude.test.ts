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
const nativeClaudePath = process.env.JIG_CLAUDE_PROOF_PATH
const nativeClaudeApiModel = process.env.JIG_CLAUDE_ANTHROPIC_MODEL
const OPENROUTER_ANTHROPIC_TEST_BASE_URL = 'https://openrouter.ai/api'
if (
  !HOSTILE ||
  nativeClaudePath === undefined ||
  nativeClaudeApiModel === undefined ||
  process.env.OPENROUTER_API_KEY === undefined
)
  throw new Error(
    'Selected native Claude API proof requires its host, executable, model, and API key',
  )

const temporaryRoot = await realpath(tmpdir())
const initialTemporaryState = new Set((await readdir(tmpdir())).filter(rootlessTemporaryEntry))
const initialCgroups = new Set(await rootlessCgroups())

describe.serial('private contained Agent Run lifecycle', () => {
  test(
    'executes the ordinary ACP Agent with native Claude Code through ACP with an Anthropic-compatible endpoint',
    async () => {
      const root = await mkdtemp(join(temporaryRoot, 'jig-native-claude-api-project-'))
      let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
      try {
        await writeProject(root)
        await writeOrdinaryAcpAgent(root, 'claude')
        session = await openPrivateProjectSession({
          directory: root,
          host: Object.freeze({
            ...(await openPrivateInstalledBunHost(
              installedBunLocation,
              {
                CLAUDE_PATH: await realpath(nativeClaudePath!),
                ANTHROPIC_API_KEY: '',
                ANTHROPIC_AUTH_TOKEN: process.env.OPENROUTER_API_KEY,
                ANTHROPIC_BASE_URL: OPENROUTER_ANTHROPIC_TEST_BASE_URL,
                ANTHROPIC_MODEL: nativeClaudeApiModel,
              },
              root,
            )),
            runTimeoutMs: NATIVE_AGENT_TIMEOUT_MS,
          }),
        })
        const plan = await session.plan({ lockMode: 'update' })
        if (plan.state !== 'applicable')
          throw new Error('native Claude fixture did not produce a Plan')
        await session.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true })

        const terminal = await runToTerminal(
          session.rootAdministration,
          'native-claude-api',
          'api-structured',
          NATIVE_AGENT_TEST_TIMEOUT_MS,
        )
        expect(terminal).toMatchObject({
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
        expect(JSON.stringify(terminal)).not.toContain(process.env.OPENROUTER_API_KEY!)
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
