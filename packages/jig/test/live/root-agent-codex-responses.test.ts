import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { openPrivateProjectSession } from '../../src/internal/project-session-controller.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'
import {
  writeInstalledConversationHelperProject,
  writeOrdinaryAcpAgent,
} from '../fixtures/ordinary-acp-agent.js'
import {
  agentText,
  expectNoAgentOwner,
  nativePublicCommandEnvironment,
  rootlessCgroups,
  rootlessTemporaryEntry,
  runInstalledJigCommand,
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
const nativeCodexApiModel = process.env.JIG_CODEX_RESPONSES_MODEL
const OPENROUTER_RESPONSES_TEST_BASE_URL = 'https://openrouter.ai/api/v1'
if (
  !HOSTILE ||
  nativeCodexPath === undefined ||
  nativeCodexApiModel === undefined ||
  process.env.OPENROUTER_API_KEY === undefined
)
  throw new Error(
    'Selected native Codex API proof requires its host, executable, model, and API key',
  )

const temporaryRoot = await realpath(tmpdir())
const initialTemporaryState = new Set((await readdir(tmpdir())).filter(rootlessTemporaryEntry))
const initialCgroups = new Set(await rootlessCgroups())

describe.serial('private contained Agent Run lifecycle', () => {
  test(
    'executes the ordinary ACP Agent with native Codex through ACP with a Responses-compatible endpoint',
    async () => {
      const root = await mkdtemp(join(temporaryRoot, 'jig-native-codex-api-project-'))
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
                CODEX_PATH: await realpath(nativeCodexPath!),
                OPENAI_API: 'responses',
                OPENAI_API_KEY: process.env.OPENROUTER_API_KEY,
                OPENAI_BASE_URL: OPENROUTER_RESPONSES_TEST_BASE_URL,
                OPENAI_MODEL: nativeCodexApiModel,
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

        const terminal = await runToTerminal(
          session.rootAdministration,
          'native-codex-api',
          'api-text',
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
              agent: { outcome: 'done', output: {} },
            },
          },
        })
        expect(agentText(terminal)).toContain('READY')
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

  test(
    'interrupts an immediate follow-up through installed Jig and published conversation packages with a Responses-compatible endpoint',
    async () => {
      const codexPath = nativeCodexPath
      const apiKey = process.env.OPENROUTER_API_KEY
      const model = nativeCodexApiModel
      if (codexPath === undefined || apiKey === undefined || model === undefined)
        throw new Error('native Codex API qualification requires its executable and API key')
      const proofRoot = await mkdtemp(join(tmpdir(), 'jig-native-codex-installed-conversation-'))
      const root = join(proofRoot, 'consumer')
      const cliRoot = join(proofRoot, 'cli')
      await mkdir(root)
      let clean = false
      try {
        const installed = await writeInstalledConversationHelperProject(root, cliRoot)
        const candidate = JSON.parse(
          await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
        )
        expect(installed.versions).toEqual({
          jig: candidate.version,
          acp: '0.1.0-alpha.3',
          flow: '0.1.0-alpha.12',
          method: '0.1.0-alpha.3',
        })
        console.info(
          `Installed native-conversation packages: ${JSON.stringify(installed.versions)}`,
        )
        const commandEnvironment = nativePublicCommandEnvironment({
          codexPath: await realpath(codexPath),
          apiKey,
          model,
        })
        const runCommand = async (args: readonly string[], timeoutMs = 120_000) => {
          const result = await runInstalledJigCommand(
            installed.command,
            args,
            root,
            commandEnvironment,
            timeoutMs,
          )
          expect(
            result.credentialLeaked,
            'public command output must not contain its credential',
          ).toBeFalse()
          expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0)
          return result
        }

        await runCommand([
          'import-contract',
          'flows/conversation-helper/node_modules/@jigging/agent-method/FLOW.contract.json',
          'flows/conversation-helper/contracts/agent-run',
        ])
        await runCommand([
          'review',
          '--yes',
          '--allow-authority-changes',
          '--allow-resolution-network',
        ])
        const run = await runCommand(
          ['run', 'flow:flows/conversation-helper', '--input', '{}', '--timeout', '3m', '--json'],
          NATIVE_AGENT_TEST_TIMEOUT_MS + 60_000,
        )
        const terminal = JSON.parse(run.stdout) as {
          status: unknown
          outcome: unknown
          output: {
            interruption: unknown
            turn: unknown
            turnNumber: unknown
            turns: unknown
            settlement: unknown
          }
        }
        expect(terminal.status).toBe('succeeded')
        expect(terminal.outcome).toBe('done')
        const output = terminal.output
        expect(['accepted', 'not-running']).toContain(output.interruption)
        expect(['result', 'cancelled']).toContain(output.turn)
        expect(output.turnNumber).toBe(1)
        expect(output.turns).toEqual([
          { turn: 0, type: 'result' },
          { turn: 1, type: output.turn },
        ])
        expect(output.settlement).toEqual({ outcome: 'done', output: { turns: 2 } })
        if (output.turn === 'cancelled') expect(output.interruption).toBe('accepted')
        if (output.interruption === 'not-running') expect(output.turn).toBe('result')
        await expectNoAgentOwner(root)
        await waitForCgroups(initialCgroups)
        await waitForTemporaryState(initialTemporaryState)
        clean = true
      } finally {
        if (clean) await rm(proofRoot, { recursive: true, force: true })
        else console.error(`Installed native conversation fixture retained at ${proofRoot}`)
      }
    },
    NATIVE_AGENT_TEST_TIMEOUT_MS + 180_000,
  )
})
