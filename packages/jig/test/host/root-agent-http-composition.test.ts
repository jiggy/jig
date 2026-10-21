import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StartRootRunReceipt } from '../../src/administration/root.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { openPrivateProjectSession } from '../../src/internal/project-session-controller.js'
import {
  fixtureHost,
  MACOS_FIXTURE_ADMISSION_MS,
  MACOS_FIXTURE_SETTLEMENT_MS,
} from '../fixtures/agent-fixture-host.js'
import { timeFixturePhase } from '../fixtures/phase-timing.js'
import {
  agentPromptPayload,
  closeServer,
  expectNoAgentOwner,
  firstLine,
  httpCoordinatorFailureEvidence,
  rootlessCgroups,
  rootlessTemporaryEntry,
  waitForCgroups,
  waitForTemporaryState,
  waitForTerminal,
  withStore,
  writeAgentMethodProject,
  writeInstalledFixture,
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

const testRoot = join(import.meta.dir, '..')
const temporaryRoot = await realpath(tmpdir())
const initialTemporaryState = new Set((await readdir(tmpdir())).filter(rootlessTemporaryEntry))
const initialCgroups = new Set(await rootlessCgroups())

describe.serial('private contained Agent Run lifecycle', () => {
  for (const nested of [false, true]) {
    test(
      nested
        ? 'runs two unchanged packed HTTP Agents through simultaneous deep specialist branches'
        : 'runs unchanged packed HTTP Agent siblings without a native Agent provider',
      async () => {
        const timingScope = nested ? 'http-deep' : 'http-siblings'
        const expectedLanes = ['left', 'right']
        const root = await mkdtemp(join(temporaryRoot, 'jig-agent-method-project-'))
        const releaseRoot = await mkdtemp(join(temporaryRoot, 'jig-agent-method-release-'))
        const requests: {
          at: number
          method: string | undefined
          url: string | undefined
          body: any
        }[] = []
        const pending: { response: ServerResponse; lane: string }[] = []
        let simultaneousRequests = 0
        let hold = false
        let completed = false
        let primaryFailure: unknown
        // This is a local transport fixture, not independent consumption or model-quality evidence.
        // The unchanged method and trusted HTTP worker run. No Agent provider is configured.
        const server = createServer(async (request, response) => {
          try {
            expect(request.headers.authorization).toBe('Bearer synthetic-unused-credential')
            const body = JSON.parse(await new Response(request as any).text())
            requests.push({ at: Date.now(), method: request.method, url: request.url, body })
            const payload = agentPromptPayload(body.messages[0].content)
            const lane = payload.guidance.find((item: any) => item.label === 'lane')?.text
            if (lane !== 'left' && lane !== 'right') throw new Error('unexpected method request')
            pending.push({ response, lane })
            simultaneousRequests = Math.max(simultaneousRequests, pending.length)
            // Neither response completes until both sibling provider workers have arrived.
            if (!hold && pending.length === expectedLanes.length) {
              for (const item of pending.splice(0)) {
                item.response.writeHead(200, { 'content-type': 'application/json' }).end(
                  JSON.stringify({
                    object: 'chat.completion',
                    choices: [
                      {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                          role: 'assistant',
                          content: JSON.stringify({ lane: item.lane }),
                        },
                      },
                    ],
                  }),
                )
              }
            }
          } catch {
            response.writeHead(400).end()
          }
        })
        let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
        try {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', resolve)
          })
          const address = server.address()
          if (address === null || typeof address === 'string') throw new Error('no recorder port')
          const location = await timeFixturePhase(timingScope, 'installed-support', () =>
            writeInstalledFixture(releaseRoot),
          )
          await timeFixturePhase(timingScope, 'project-construct', () =>
            writeAgentMethodProject(
              root,
              `http://127.0.0.1:${address.port}/v1/chat/completions`,
              nested,
            ),
          )
          const skill = await readFile(
            join(root, 'flows/router/skills/answer-check/SKILL.md'),
            'utf8',
          )
          session = await timeFixturePhase(timingScope, 'project-open', async () =>
            openPrivateProjectSession({
              directory: root,
              host: fixtureHost(
                await openPrivateInstalledBunHost(location, {
                  METHOD_TEST_TOKEN: 'synthetic-unused-credential',
                }),
              ),
            }),
          )
          const plan = await timeFixturePhase(timingScope, 'project-plan', () =>
            session!.plan({ lockMode: 'update' }),
          )
          if (plan.state !== 'applicable')
            throw new Error('Agent method fixture did not produce a Plan')
          await timeFixturePhase(timingScope, 'project-apply', () =>
            session!.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true }),
          )
          const run = (scenario: string) =>
            timeFixturePhase(timingScope, 'run', async () => {
              const started = Date.now()
              const receipt = await session!.rootAdministration.startRun({
                submissionId: `method-${scenario}`,
                target: { kind: 'binding', id: 'method-pair' },
                input: { scenario },
              })
              try {
                // Observe settlement beyond the selected Run budget, including cleanup.
                return await waitForTerminal(
                  session!.rootAdministration,
                  receipt,
                  process.platform === 'darwin' ? MACOS_FIXTURE_SETTLEMENT_MS : 60_000,
                )
              } catch (cause) {
                throw new Error(
                  `Agent method fixture did not settle: ${JSON.stringify({
                    scenario,
                    elapsedMs: Date.now() - started,
                    status: await session!.rootAdministration.runStatus(receipt),
                    requests: requests.map((item) => ({
                      afterMs: item.at - started,
                      guidance: agentPromptPayload(item.body.messages[0].content).guidance,
                    })),
                    owners: withStore(root, (database) =>
                      database
                        .query(
                          'SELECT scope_operation_id, operation_id, allocation_digest IS NOT NULL AS allocated, sandbox_digest IS NOT NULL AS sandboxed, fence_digest IS NOT NULL AS fenced, cleanup_digest IS NOT NULL AS cleaned FROM root_child_owners',
                        )
                        .all(),
                    ),
                  })}`,
                  { cause },
                )
              }
            })
          for (const scenario of ['invalid-input', 'over-grant', 'oversized']) {
            expect(await run(scenario)).toMatchObject({
              terminal: {
                status: 'succeeded',
                outcome: 'done',
                output: {
                  status: 'failed',
                  code: scenario === 'oversized' ? 'RESOURCE_EXHAUSTED' : 'INVALID_INPUT',
                },
              },
            })
            expect(requests).toHaveLength(0)
            await expectNoAgentOwner(root)
          }
          expect(await run('batch')).toMatchObject({
            terminal: {
              status: 'succeeded',
              outcome: 'done',
              output: {
                status: 'succeeded',
                parentHasKey: false,
                results: expectedLanes.map((lane) => ({
                  outcome: 'done',
                  output: { text: JSON.stringify({ lane }), structured: { lane } },
                })),
              },
            },
          })
          expect(requests).toHaveLength(expectedLanes.length)
          expect(simultaneousRequests).toBe(expectedLanes.length)
          const lanes: string[] = []
          for (const request of requests) {
            expect(request).toMatchObject({
              method: 'POST',
              url: '/v1/chat/completions',
              body: {
                model: 'local-recording-fixture',
                max_completion_tokens: 128,
                store: false,
                stream: false,
                n: 1,
              },
            })
            const payload = agentPromptPayload(request.body.messages[0].content)
            expect(payload.skills).toEqual([
              { name: 'answer-check', files: [{ path: 'SKILL.md', content: skill }] },
            ])
            expect(payload.guidance).toHaveLength(1)
            expect(payload.guidance[0].label).toBe('lane')
            lanes.push(payload.guidance[0].text)
            for (const forbidden of [
              'SELECTED_SKILL_MARKER',
              'HIDDEN_SKILL_MARKER',
              'synthetic-unused-credential',
            ])
              expect(JSON.stringify(request.body)).not.toContain(forbidden)
          }
          expect(lanes.sort()).toEqual(expectedLanes)
          await expectNoAgentOwner(root)
          if (nested) {
            hold = true
            const waitForRequest = async (count: number) => {
              const deadline =
                Date.now() + (process.platform === 'darwin' ? MACOS_FIXTURE_ADMISSION_MS : 25_000)
              while (requests.length < count && Date.now() < deadline) await Bun.sleep(25)
              expect(requests).toHaveLength(count)
            }
            const cancelled = await session.rootAdministration.startRun({
              submissionId: 'chain-cancel',
              target: { kind: 'binding', id: 'method-pair' },
              input: { scenario: 'batch' },
            })
            await waitForRequest(4)
            await session.close()
            session = await openPrivateProjectSession({
              directory: root,
              host: fixtureHost(
                await openPrivateInstalledBunHost(location, {
                  METHOD_TEST_TOKEN: 'synthetic-unused-credential',
                }),
              ),
            })
            expect(await waitForTerminal(session.rootAdministration, cancelled)).toMatchObject({
              terminal: { status: 'failed', code: 'CANCELLED' },
            })
            await expectNoAgentOwner(root)
            await session.close()
            session = undefined

            const crashed = Bun.spawn(
              [
                process.execPath,
                join(testRoot, 'fixtures/agent-session-runner.ts'),
                root,
                location.releaseRoot,
                location.executablePath,
                'chain-loss',
                'http-chain',
              ],
              {
                env: { ...process.env, METHOD_TEST_TOKEN: 'synthetic-unused-credential' },
                stdout: 'pipe',
                stderr: 'pipe',
              },
            )
            // Take rejection custody before either process loss or pipe teardown.
            const diagnostics = new Response(crashed.stderr).text()
            const exited = crashed.exited
            void diagnostics.catch(() => undefined)
            void exited.catch(() => undefined)
            let lossFailure: unknown
            let lossFailed = false
            let receipt: StartRootRunReceipt
            try {
              receipt = JSON.parse(await firstLine(crashed.stdout)) as StartRootRunReceipt
              await waitForRequest(6)
            } catch (error) {
              lossFailed = true
              lossFailure = error
              throw error
            } finally {
              const settled = await Promise.allSettled([
                Promise.resolve().then(() => {
                  if (crashed.exitCode === null) crashed.kill('SIGKILL')
                }),
                exited,
                diagnostics,
              ] as const)
              const collected = settled[2]
              if (lossFailed) {
                try {
                  console.error(
                    'http-agent-coordinator-loss-barrier',
                    JSON.stringify({
                      requests: requests.length,
                      stderr: collected.status === 'fulfilled' ? 'collected' : 'unavailable',
                      failures:
                        collected.status === 'fulfilled'
                          ? httpCoordinatorFailureEvidence(collected.value)
                          : [],
                    }),
                  )
                } catch {
                  // Optional diagnostics cannot replace the original assertion.
                }
              }
              const failures = settled.flatMap((result) =>
                result.status === 'rejected' ? [result.reason] : [],
              )
              if (failures.length !== 0) {
                if (lossFailed) failures.unshift(lossFailure)
                // biome-ignore lint/correctness/noUnsafeFinally: Keep primary, process and original stderr failures.
                throw failures.length === 1
                  ? failures[0]
                  : new AggregateError(
                      failures,
                      'HTTP Agent loss barrier and coordinator teardown failed',
                    )
              }
            }
            await waitForCgroups(initialCgroups)
            session = await openPrivateProjectSession({
              directory: root,
              host: fixtureHost(
                await openPrivateInstalledBunHost(location, {
                  METHOD_TEST_TOKEN: 'synthetic-unused-credential',
                }),
              ),
            })
            expect(await waitForTerminal(session.rootAdministration, receipt)).toMatchObject({
              terminal: { status: 'lost', code: 'COORDINATOR_LOST' },
            })
            expect(requests).toHaveLength(6)
            await expectNoAgentOwner(root)
          }
          await session.close()
          session = undefined
          await waitForCgroups(initialCgroups)
          await waitForTemporaryState(initialTemporaryState)
          completed = true
        } catch (error) {
          primaryFailure = error
          throw error
        } finally {
          try {
            await session?.close()
          } catch (cleanupFailure) {
            // biome-ignore lint/correctness/noUnsafeFinally: Retain both assertion and cleanup failures; failed ownership cleanup cannot qualify.
            throw primaryFailure === undefined
              ? cleanupFailure
              : new AggregateError(
                  [primaryFailure, cleanupFailure],
                  'HTTP Agent assertion and fixture cleanup failed',
                )
          } finally {
            for (const item of pending) item.response.destroy()
            await closeServer(server)
            if (completed) {
              await rm(root, { recursive: true, force: true })
              await rm(releaseRoot, { recursive: true, force: true })
            } else console.error(`Retained HTTP Agent fixture: ${root}, ${releaseRoot}`)
          }
        }
      },
      process.platform === 'darwin' ? (nested ? 900_000 : 600_000) : nested ? 240_000 : 150_000,
    )
  }
})
