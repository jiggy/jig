import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:https'
import { open, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ATTEMPT_FAILURE_CODES, AttemptClientError, createAttemptClient } from '@jigging/jig/client'

const root = dirname(fileURLToPath(import.meta.url))
const project = join(root, 'project')
const evidence = join(root, 'evidence')
const cli = join(root, 'node_modules/.bin/jig')
let stage = 'preflight'
let cancelSent = false
let startupFailure: Record<string, unknown> | undefined
let lastObservation: Record<string, unknown> | undefined
let observationEvents = 0
let server: ReturnType<typeof createServer> | undefined
let submission: Awaited<ReturnType<ReturnType<typeof createAttemptClient>['submit']>> | undefined
let prepared: Awaited<ReturnType<ReturnType<typeof createAttemptClient>['prepare']>> | undefined
const traffic = { connections: 0, tlsSessions: 0, requests: 0 }

const checkpointStages = ['flow-started', 'native-ready', 'native-initialized', 'codex-session-ready', 'native-startup-failed']
const startupPhases = ['flow-started', 'create-channels', 'await-native-ready', 'initialize', 'session-new', 'checkpoint-ready', 'await-root-cancel']
const causes = [...ATTEMPT_FAILURE_CODES, 'APPLICATION']
const select = (value: unknown, allowed: readonly string[]) => typeof value === 'string' && allowed.includes(value) ? value : null
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}
function projectObservation(result: { observation: unknown; checkpoint: unknown }) {
  const terminal = own(result.observation, 'terminal')
  const checkpointEvidence = own(result.checkpoint, 'evidence')
  const details = own(terminal, 'details')
  const sequence = own(result.checkpoint, 'sequence')
  return {
    execution: select(own(result.observation, 'execution'), ['accepted', 'running', 'terminal', 'uncertain']),
    terminalStatus: select(own(terminal, 'status'), ['succeeded', 'failed', 'lost']),
    terminalCode: select(own(terminal, 'code'), [...ATTEMPT_FAILURE_CODES, 'COORDINATOR_LOST']),
    cleanup: select(own(result.observation, 'cleanup'), ['pending', 'confirmed', 'unresolved']),
    checkpointAvailability: select(own(result.checkpoint, 'availability'), ['available', 'expired', 'unavailable']),
    checkpointSequence: Number.isInteger(sequence) && Number(sequence) >= 1 && Number(sequence) <= 16 ? sequence : null,
    checkpointStage: select(own(checkpointEvidence, 'stage'), checkpointStages),
    startupPhase: select(own(checkpointEvidence, 'startupPhase'), startupPhases) ?? select(own(details, 'startupPhase'), startupPhases),
    startupCause: select(own(checkpointEvidence, 'startupCause'), causes) ?? select(own(details, 'startupCause'), causes),
  }
}
function observe(result: { observation: unknown; checkpoint: unknown }) {
  const projected = projectObservation(result)
  if (JSON.stringify(projected) !== JSON.stringify(lastObservation) && observationEvents++ < 24)
    console.log(JSON.stringify({ event: 'public-observation', stage, ...projected }))
  lastObservation = projected
}
function clientFailure(error: unknown) {
  return error instanceof AttemptClientError ? { code: error.code, operation: error.operation, uncertain: error.uncertain } : {}
}

async function persist(name: string, value: unknown) {
  const file = await open(join(evidence, name), 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync() }
  finally { await file.close() }
  const directory = await open(evidence, 'r')
  try { await directory.sync() } finally { await directory.close() }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function bounded<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(label)), milliseconds) })]) }
  finally { clearTimeout(timer) }
}
async function main() {
  assert.equal(process.platform, 'darwin', 'This diagnostic requires a native ARM Mac')
  assert.equal(process.arch, 'arm64', 'This diagnostic requires a native ARM Mac')
  assert.equal(process.versions.bun, '1.4.4', 'Use the qualified Bun 1.4.4')
  assert.ok(process.env.JIG_CODEX_STARTUP_PATH, 'Select the genuine Codex executable explicitly')
  const codex = await realpath(process.env.JIG_CODEX_STARTUP_PATH)
  server = createServer({ key: await readFile(join(evidence, 'loopback.key')), cert: await readFile(join(evidence, 'loopback.crt')) }, (_request, response) => {
    traffic.requests++
    response.writeHead(503).end() // Never return a fabricated provider/model result.
  })
  server.on('connection', () => { traffic.connections++ })
  server.on('secureConnection', () => { traffic.tlsSessions++ })
  await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const env: NodeJS.ProcessEnv = {
    CODEX_PATH: codex, OPENAI_API: 'responses', OPENAI_API_KEY: 'offline-placeholder',
    OPENAI_MODEL: 'gpt-5.3-codex', OPENAI_BASE_URL: `https://127.0.0.1:${address.port}/v1`,
  }
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'FLOW_NODE', 'JIG_AUTHORING_NODE_PATH'])
    if (process.env[key] !== undefined) env[key] = process.env[key]
  stage = 'review'
  const review = spawnSync(cli, ['review', '--yes', '--allow-authority-changes'], { cwd: project, env, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 4194304 })
  await persist('review.json', { status: review.status, signal: review.signal, stdout: review.stdout, stderr: review.stderr })
  assert.ifError(review.error)
  assert.equal(review.status, 0, 'Public review failed; preserve this fresh consumer')
  const owner = createAttemptClient({ executable: cli, cwd: project, env, timeoutMs: 300000 })
  const observer = createAttemptClient({ executable: cli, cwd: project, env, timeoutMs: 10000 })
  stage = 'inspect'
  const inspected = await observer.inspect({ target: 'binding:startup' })
  assert.ok(inspected && typeof inspected === 'object' && !Array.isArray(inspected))
  const approval: unknown = Reflect.get(inspected, 'approval')
  assert.ok(typeof approval === 'string' && approval.length > 0)
  stage = 'prepare'
  prepared = await owner.prepare({
    expectedApproval: approval, target: 'binding:startup', input: null, files: [],
    constraints: { durationMs: 240000, resultBytes: 1048576, artifactBytes: 4194304 },
    outputIntent: { packet: false, receive: [] },
  })
  // Commit the entire exact Prepared before this diagnostic's single submission.
  await persist('prepared.json', prepared)
  stage = 'submit'
  submission = await owner.submit({ ticket: prepared.ticket, request: prepared.canonicalRequest })
  assert.equal(submission.role, 'owner')
  await persist('receipt.json', submission.receipt)
  const completion = submission.completion.then(observation => ({ observation }), error => ({ error }))
  stage = 'await-ready-checkpoint'
  const readyDeadline = Date.now() + 90000
  let ready = false
  try {
    while (Date.now() < readyDeadline) {
      const result = await observer.result({ ticket: prepared.ticket })
      assert.equal(result.observation.receipt?.runId, submission.receipt.runId)
      observe(result)
      if (result.checkpoint.availability === 'available' && own(result.checkpoint.evidence, 'stage') === 'codex-session-ready') {
        assert.deepEqual(result.checkpoint.evidence, { stage: 'codex-session-ready', initialized: true, sessionCreated: true, promptSent: false })
        ready = true
        await persist('ready-observation.json', result)
        break
      }
      if (own(result.checkpoint.evidence, 'stage') === 'native-startup-failed') {
        startupFailure = { reason: 'flow-reported-startup-failure', observation: lastObservation }
        throw Error('Flow reported a closed startup failure')
      }
      if (result.observation.terminal) {
        startupFailure = { reason: 'terminal-before-ready', observation: lastObservation }
        throw Error('Fresh Run ended before accepted startup checkpoint')
      }
      await sleep(250)
    }
    assert.equal(ready, true, 'No accepted genuine startup checkpoint within ninety seconds')
  } catch (error) {
    startupFailure ??= { reason: ready ? 'ready-observation-failed' : 'ready-not-established', ...clientFailure(error), observation: lastObservation }
    await persist('startup-failure.json', startupFailure)
    console.error(JSON.stringify({ event: 'startup-failure', ...startupFailure }))
  }
  // Exactly one explicit cancellation, including failure teardown. Never retry it.
  stage = 'cancel-once'
  cancelSent = true
  const cancellation = await observer.cancel({ ticket: prepared.ticket })
  await persist('cancellation.json', cancellation)
  console.log(JSON.stringify({ event: 'cancel-acknowledgement', acknowledged: cancellation.acknowledged }))
  assert.equal(cancellation.acknowledged, true)
  stage = 'await-confirmed-cleanup'
  const settlementDeadline = Date.now() + 90000
  let settled: Awaited<ReturnType<typeof observer.result>> | undefined
  while (Date.now() < settlementDeadline) {
    const result = await observer.result({ ticket: prepared.ticket })
    assert.equal(result.observation.receipt?.runId, submission.receipt.runId)
    observe(result)
    if (result.observation.terminal && result.observation.cleanup === 'confirmed') { settled = result; break }
    if (result.observation.cleanup === 'unresolved') throw Error('Fresh Run cleanup was unresolved')
    await sleep(250)
  }
  assert.ok(settled, 'Cancellation acknowledgement did not establish confirmed cleanup within ninety seconds')
  await persist('terminal-observation.json', settled)
  stage = 'validate-confirmed-cleanup'
  assert.equal(settled.observation.cleanup, 'confirmed')
  stage = 'join-owner-completion'
  const ended = await bounded(completion, 15000, 'Owning application connection did not settle')
  if ('error' in ended) throw ended.error
  assert.equal(ended.observation?.receipt?.runId, submission.receipt.runId)
  assert.equal(ended.observation?.cleanup, 'confirmed')
  stage = 'validate-startup-outcome'
  if (startupFailure) throw Error('Startup failed before teardown; preserve its separate closed diagnostic')
  stage = 'validate-cancelled-terminal'
  assert.equal(settled.observation.terminal?.status, 'failed')
  assert.equal(settled.observation.terminal?.status === 'failed' && settled.observation.terminal.code, 'CANCELLED')
  stage = 'validate-loopback-traffic'
  assert.deepEqual(traffic, { connections: 0, tlsSessions: 0, requests: 0 }, 'The selected loopback API endpoint observed traffic without a prompt')
  stage = 'verified'
  const summary = { qualifiedBoundary: 'ordinary-installed-codex-startup-and-root-cancellation', runId: submission.receipt.runId, initialized: ready, sessionCreated: ready, promptSent: false, cancelRequests: 1, terminal: 'CANCELLED', cleanup: 'confirmed', selectedEndpointTraffic: traffic,
    kernelNetworkIsolation: false, providerAuthenticationQualified: false, inferenceQualified: false }
  await persist('summary.json', summary)
  console.log(JSON.stringify(summary))
}
try { await main() }
catch (error) {
  // Preserve private state and tickets. This driver neither resubmits nor resets
  // an attempt after an uncertain transport or cancellation result.
  await persist('failure.json', { stage, cancelSent, startupFailure: startupFailure ?? null, observation: lastObservation ?? null, prepared: prepared !== undefined, submitted: submission !== undefined, traffic,
    ...(error instanceof AttemptClientError ? { code: error.code, operation: error.operation, uncertain: error.uncertain } : { errorCategory: 'assertion-or-application' }) }).catch(() => {})
  console.error(JSON.stringify({ failed: true, stage, cancelSent, startupFailure: startupFailure ?? null, observation: lastObservation ?? null, traffic, evidenceRetained: true,
    ...(error instanceof AttemptClientError ? { code: error.code, operation: error.operation, uncertain: error.uncertain } : {}) }))
  process.exitCode = 1
} finally {
  submission?.close()
  if (server) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server!.close(() => resolve()))
  }
}
