import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { openPrivateProjectSession } from '../../src/internal/project-session-controller.js'
import { installedBunLocation } from '.././fixtures/installed-bun-location.js'
import { writeOrdinaryAgent } from '.././fixtures/ordinary-agent.js'
import {
  expectNoChildResidue,
  rootlessCgroups,
  rootlessTemporaryEntry,
  treeContains,
  waitForRootlessCgroups,
  waitForRootlessTemporaryState,
  waitForTerminalStatus,
  writeAgentRouterProject,
} from '.././private-foreground.fixture.js'

const initialRootlessTemporaryState = new Set(
  (await readdir(tmpdir())).filter(rootlessTemporaryEntry),
)
const initialRootlessCgroups = new Set(await rootlessCgroups())

describe.serial('private rootless project session', () => {
  test('executes one packed ordinary HTTP Agent choice and exact child without retaining its key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-private-agent-router-'))
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
    try {
      await writeAgentRouterProject(root)
      const api = process.env.OPENAI_API ?? 'responses'
      const model = process.env.OPENAI_MODEL
      const credential = process.env.OPENAI_API_KEY
      if ((api !== 'responses' && api !== 'chat-completions') || !model || !credential)
        throw new Error(
          'The opted-in HTTP Agent proof requires OPENAI_MODEL, OPENAI_API_KEY and a supported OPENAI_API',
        )
      const base = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
      await writeOrdinaryAgent(root, {
        url: `${base}/${api === 'responses' ? 'responses' : 'chat/completions'}`,
        api,
        model,
        bearerEnv: 'OPENAI_API_KEY',
        maxCompletionTokens: 4096,
        default: true,
      })
      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation, {
          OPENAI_API_KEY: credential,
        }),
      })
      const plan = await session.plan({ lockMode: 'update' })
      if (plan.state !== 'applicable') throw new Error('Agent router did not produce a Plan')
      expect(plan.review.text).toContain('https://jig.md/contracts/agent-run')
      await session.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true })

      const started = Date.now()
      const receipt = await session.rootAdministration.startRun({
        submissionId: 'agent-router-live',
        target: { kind: 'binding', id: 'ticket-router' },
        input: { route: 'technical', ticket: 'Login fails after password reset' },
      })
      const status = await waitForTerminalStatus(session.rootAdministration, receipt)
      expect(Date.now() - started).toBeLessThan(30_000)
      expect(status).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'succeeded',
          outcome: 'done',
          output: {
            route: 'technical',
            evidence: [{ source: 'ticket', sourceLine: 1, amount: null, ambiguity: null }],
            parentHasKey: false,
            child: {
              outcome: 'done',
              output: { handled: 'technical' },
            },
          },
        },
      })
      await session.close()
      session = undefined
      await expectNoChildResidue(root)
      expect(await treeContains(root, credential)).toBeFalse()
      await waitForRootlessCgroups(initialRootlessCgroups)
      await waitForRootlessTemporaryState(initialRootlessTemporaryState)
    } finally {
      await session?.close().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  }, 180_000)
})

if (process.env.JIG_OPENAI_AGENT_PROOF !== '1')
  throw Error('This suite requires explicit OpenAI qualification')
