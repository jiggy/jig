// Separate process: module mocks must not affect other host tests.
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import * as store from '../src/internal/activation-admission-store.js'
import * as direct from '../src/internal/direct-run.js'
import * as execution from '../src/internal/execution-backend.js'
import {
  privateLinuxExecutionPlan,
  privateMacosExecutionPlan,
} from '../src/internal/execution-plan.js'
import { normalizeHttpGrant, openPrivateHttpGrants } from '../src/internal/http-grants.js'
import { privateDomainDigest } from '../src/internal/identity.js'
import * as capture from '../src/internal/input-capture.js'
import * as installed from '../src/internal/installed-bun-support.js'
import * as context from '../src/internal/invocation-context.js'
import { privateMacosSandboxProfile } from '../src/internal/macos-sandbox-profile.js'
import { privateBootDeadlineFromUnix } from '../src/internal/native-clock.js'
import { HTTP_REQUEST_CONTRACT_DIGEST } from '../src/internal/private-http-request.js'
import { privateProfileActivate, privateProfileFinish } from '../src/internal/private-profile.js'
import {
  PROJECT_COMMAND_CONTRACT_DIGEST,
  PROJECT_COMMAND_CONTRACT_ID,
  PROJECT_COMMAND_CONTRACT_VERSION,
  PROJECT_COMMAND_LIMITS,
} from '../src/internal/private-project-command.js'
import { JSON_1_LIMITS } from '../src/json.js'

const digest = (n: number) => `sha256:${n.toString(16).padStart(2, '0').repeat(32)}`
const runId = digest(1)
const requestDigest = digest(2)
const operationId = 'same-operation'
const events: string[] = []
let row: any
let failAfterPhysicalRelease = false
let failAllocation = false
let failCollection = false
let dispatch = false
let stopReason = 'setup_failed'
let httpDispatch = false
let workerExitCode = 17
let sealedIntent: any
let writtenInput = ''
const httpCredentialCanary = 'private-http-intent-test-canary'
const httpGrant = normalizeHttpGrant({
  url: 'https://localhost/document',
  method: 'GET',
  bearerEnv: 'HTTP_TEST_TOKEN',
  timeoutMs: 5000,
})
const step = (name: string) => events.push(name)
const allocationFailure = new Error('private allocation diagnostic canary')
const collectionFailure = new Error('private collection diagnostic canary')
privateProfileActivate()
const backend = {
  recoverFence: async () => {
    step('recover-fence')
    return {
      ownerDigest: digest(12),
      stopReason: 'deadline',
      exitCode: null,
      signal: null,
    }
  },
}

const target = () => ({
  request: {
    digest: requestDigest,
    slots: {
      http: {
        kind: 'native',
        native: 'http-request',
        grant: { kind: 'http', ...httpGrant },
        contract: { digest: HTTP_REQUEST_CONTRACT_DIGEST },
      },
      command: {
        kind: 'native',
        native: 'project-command',
        grant: { kind: 'command', run: 'src/cli.ts' },
        contract: {
          id: PROJECT_COMMAND_CONTRACT_ID,
          version: PROJECT_COMMAND_CONTRACT_VERSION,
          digest: PROJECT_COMMAND_CONTRACT_DIGEST,
        },
      },
    },
  },
  disposition: {
    state: 'ready',
    recipeDigest: digest(6),
    observationDigest: digest(7),
    execution: {},
  },
})

mock.module('../src/internal/direct-run.js', () => ({
  ...direct,
  planPrivateDirectRun: async () => ({
    digest: digest(6),
    observation: { digest: digest(7) },
    execution: {},
    bunPolicy: [],
    resourceCeilings: {},
    installedSupport: {
      runtimeMounts: [{ source: '/qualified/bun', destination: '/bun' }],
      httpWorkerPath: '/qualified/http-worker.js',
      sandboxHttpWorkerPath: '/http-worker.js',
    },
    sandboxExecutablePath: '/bun',
  }),
}))
mock.module('../src/internal/installed-bun-support.js', () => ({
  ...installed,
  revalidatePrivateInstalledBunSupport: async () => {},
}))
mock.module('../src/internal/invocation-context.js', () => ({
  ...context,
  privateInvocationBootDeadline: async (input: any, durationMs: number) =>
    privateBootDeadlineFromUnix(
      Math.min(input.parent.intent.deadlineUnixMs, Date.now() + durationMs),
    ),
  requireParentTarget: target,
  requireParentFlowOwner: async () => {},
  protectedOwnerRoot: async () => '/protected/owners',
}))
mock.module('../src/internal/activation-admission-store.js', () => ({
  ...store,
  listPrivateRootChildOwners: async () => {
    step('owners-read')
    return row === undefined ? [] : [row]
  },
  allocatePrivateRootChildOwner: async (input: any) => {
    step('allocate-owner')
    if (failAllocation) throw allocationFailure
    if (dispatch) {
      row = {
        parentRunId: input.parentRunId,
        ...(input.parentOperationId === undefined
          ? {}
          : { parentOperationId: input.parentOperationId }),
        operationId: input.operationId,
        allocation: { digest: digest(3), value: input.allocation },
      }
      return row
    }
    throw new Error('the expired call must not allocate a new owner')
  },
  recordPrivateRootChildSandbox: async (input: any) => {
    row = { ...row, sandbox: { digest: digest(11), value: input.sandbox } }
    return row
  },
  recordPrivateRootChildCleanup: async (input: any) => {
    step('record-cleanup')
    row = { ...row, cleanup: { value: input.cleanup, digest: digest(5) } }
    return row
  },
  recordPrivateRootChildFence: async (input: any) => {
    step('record-fence')
    row = { ...row, fence: { value: input.fence, digest: digest(10) } }
    return row
  },
  closePrivateRootChildOwner: async () => {
    step('close-owner')
    row = undefined
  },
}))
mock.module('../src/internal/execution-backend.js', () => ({
  ...execution,
  privateExecutionSetupAllowance: () => 0,
  planPrivateExecutionOwnerStateAllocation: async (_backend: unknown, input: any) => ({
    ...input,
    digest: digest(8),
  }),
  sealPrivateExecutionOwner: async (_backend: unknown, plan: any, owner: any) => {
    step('seal-worker')
    sealedIntent = plan
    return {
      identity: {
        kind: 'private-linux-sealed-owner/1',
        ownerStateAllocationDigest: owner.digest,
        runId: plan.runId,
        deadlineUnixMs: plan.limits.deadlineUnixMs,
      },
    }
  },
  admitPrivateExecutionOwner: async () => {
    step('admit-worker')
    return {
      stdout: Readable.from(
        (async function* () {
          yield Buffer.from(
            httpDispatch
              ? '{"response":{"status":200,"body":"bounded"},"bodyBytes":7}'
              : 'untrusted success',
          )
          if (failCollection) throw collectionFailure
        })(),
      ),
      stderr: Readable.from([]),
      completion: Promise.resolve({ signal: null }),
      evidence: Promise.resolve({}),
      terminationReason: Promise.resolve(stopReason),
      enforcement: Promise.resolve({
        ownerDigest: digest(12),
        stopReason,
        exitCode: workerExitCode,
        signal: null,
      }),
      write: async (bytes: Buffer) => {
        step('write-input')
        writtenInput += bytes.toString()
      },
      closeInput: async () => {
        step('close-worker-input')
      },
      terminate: async () => {
        step('terminate-worker')
      },
    }
  },
  recoverPrivateExecutionFence: async () => backend.recoverFence(),
  privateExecutionOwnerAllocationDigest: (value: any) =>
    value.ownerStateAllocationDigest ?? value.digest,
  normalizePrivateExecutionOwnerStateAllocationIdentity: (value: unknown) => value,
  normalizePrivateExecutionSealedOwnerIdentity: (value: unknown) => value,
  normalizePrivateExecutionConfirmedEnforcementReceipt: (value: unknown) => value,
  privateExecutionPreparedOwnerDigest: () => digest(12),
  normalizePrivateExecutionOwnerStateReleaseReceipt: (value: unknown) => value,
  cancelPrivateExecutionOwnerStateAllocation: async () => {
    step('cancel-unused-owner')
    return { stopReason: 'cancelled' }
  },
  releasePrivateExecutionOwnerState: async () => {
    step('release-owner-state')
    if (failAfterPhysicalRelease) {
      failAfterPhysicalRelease = false
      throw new Error('injected interruption after physical owner release')
    }
    return { digest: digest(9) }
  },
}))
mock.module('../src/internal/input-capture.js', () => ({
  ...capture,
  capturePrivateInput: () => ({ close: () => step('close-input') }),
}))

const { executePrivateContainedEffect } = await import(
  '../src/internal/root-contained-effect-controller.js'
)

const input = {
  projectRoot: '/project',
  parent: {
    run: { runId, coordinatorEpoch: 1, target: { kind: 'binding', id: 'root' } },
    intent: { requestDigest, deadlineUnixMs: Date.now() - 1_000 },
  },
  coordinator: {},
  installedSupport: {},
  backend,
  parentDeadlineUnixMs: Date.now() - 1_000,
  signal: new AbortController().signal,
  call: {
    operationId,
    slot: 'command',
    input: { files: { 'src/cli.ts': 'console.log("never dispatched")' } },
  },
}

const expiredWithoutPriorOwner = await executePrivateContainedEffect(input as any)
assert.equal(expiredWithoutPriorOwner.status, 'failed')
assert.equal((expiredWithoutPriorOwner as any).code, 'DEADLINE_EXCEEDED')
assert.match((expiredWithoutPriorOwner as any).message, /it was not dispatched/)
assert.ok(events.includes('owners-read'))
assert.ok(!events.includes('allocate-owner'))
assert.equal(row, undefined)

events.length = 0
const deadlineUnixMs = input.parent.intent.deadlineUnixMs
const identity = privateDomainDigest('JIG-Contained-Effect-Owner/1', {
  parentRunId: runId,
  operationId,
  parentOperationId: null,
})
const priorOwnerAllocation = {
  digest: digest(8),
  parent: '/protected/owners',
  name: `x-${identity.slice(7, 69)}`,
}
row = {
  parentRunId: runId,
  operationId,
  allocation: {
    digest: digest(3),
    value: {
      kind: 'private-contained-effect-owner/1',
      effect: 'project-command',
      parentRunId: runId,
      coordinatorEpoch: 1,
      operationId,
      parentRequestDigest: requestDigest,
      parentFlow: null,
      requestDigest: digest(4),
      deadlineUnixMs,
      effectiveBootDeadline: privateBootDeadlineFromUnix(deadlineUnixMs),
      ownerAllocation: priorOwnerAllocation,
    },
  },
  sandbox: {
    digest: digest(11),
    value: {
      kind: 'private-linux-sealed-owner/1',
      ownerStateAllocationDigest: priorOwnerAllocation.digest,
      runId: `effect-${identity.slice(7, 47)}`,
      deadlineUnixMs,
    },
  },
}

const expiredRetry = await executePrivateContainedEffect(input as any)
assert.equal(expiredRetry.status, 'failed')
assert.equal((expiredRetry as any).code, 'UNCERTAIN')
assert.match((expiredRetry as any).message, /prior operation dispatch was fenced/)
assert.ok(!/not dispatched/.test((expiredRetry as any).message))
const expectedOrder: [string, string][] = [
  ['owners-read', 'recover-fence'],
  ['recover-fence', 'record-fence'],
  ['record-fence', 'release-owner-state'],
  ['release-owner-state', 'record-cleanup'],
  ['record-cleanup', 'close-owner'],
]
for (const [before, after] of expectedOrder) {
  assert.ok(
    events.indexOf(before) >= 0 && events.indexOf(before) < events.indexOf(after),
    `${before} before ${after}: ${events}`,
  )
}
assert.ok(!events.includes('allocate-owner'))
assert.equal(row, undefined)

// Simulate coordinator death after physical cleanup but before its durable
// receipt. A later recovery must reuse the recorded fence and converge.
events.length = 0
const recoveryIdentity = privateDomainDigest('JIG-Contained-Effect-Owner/1', {
  parentRunId: runId,
  operationId: 'recover-operation',
  parentOperationId: null,
})
const recoveryOwner = {
  digest: digest(8),
  parent: '/protected/owners',
  name: `x-${recoveryIdentity.slice(7, 69)}`,
}
row = {
  parentRunId: runId,
  operationId: 'recover-operation',
  allocation: {
    digest: digest(13),
    value: {
      kind: 'private-contained-effect-owner/1',
      effect: 'project-command',
      parentRunId: runId,
      coordinatorEpoch: 1,
      operationId: 'recover-operation',
      parentRequestDigest: requestDigest,
      parentFlow: null,
      requestDigest: digest(14),
      deadlineUnixMs: input.parent.intent.deadlineUnixMs,
      effectiveBootDeadline: privateBootDeadlineFromUnix(input.parent.intent.deadlineUnixMs),
      ownerAllocation: recoveryOwner,
    },
  },
  sandbox: {
    digest: digest(15),
    value: {
      kind: 'private-linux-sealed-owner/1',
      ownerStateAllocationDigest: recoveryOwner.digest,
      runId: `effect-${recoveryIdentity.slice(7, 47)}`,
      deadlineUnixMs: input.parent.intent.deadlineUnixMs,
    },
  },
}

const { recoverPrivateContainedEffectOwners } = await import(
  '../src/internal/root-contained-effect-controller.js'
)
failAfterPhysicalRelease = true
await assert.rejects(recoverPrivateContainedEffectOwners(input as any))
assert.ok(row?.fence, 'the proven fence survives an interrupted cleanup receipt')
assert.equal(row?.cleanup, undefined)
assert.ok(events.includes('recover-fence'))
assert.ok(events.includes('release-owner-state'))
assert.ok(!events.includes('close-owner'))

events.length = 0
await recoverPrivateContainedEffectOwners(input as any)
assert.ok(events.includes('release-owner-state'), 'recovery repeats idempotent physical cleanup')
assert.ok(events.includes('record-cleanup'))
assert.ok(events.includes('close-owner'))
assert.equal(row, undefined)

// An allocation journal without a sealed sandbox represents work that never
// reached package dispatch; recovery cancels and releases that reservation.
events.length = 0
const allocationOnlyIdentity = privateDomainDigest('JIG-Contained-Effect-Owner/1', {
  parentRunId: runId,
  operationId: 'allocation-only',
  parentOperationId: null,
})
row = {
  parentRunId: runId,
  operationId: 'allocation-only',
  allocation: {
    digest: digest(16),
    value: {
      kind: 'private-contained-effect-owner/1',
      effect: 'project-command',
      parentRunId: runId,
      coordinatorEpoch: 1,
      operationId: 'allocation-only',
      parentRequestDigest: requestDigest,
      parentFlow: null,
      requestDigest: digest(17),
      deadlineUnixMs: input.parent.intent.deadlineUnixMs,
      effectiveBootDeadline: privateBootDeadlineFromUnix(input.parent.intent.deadlineUnixMs),
      ownerAllocation: {
        digest: digest(18),
        parent: '/protected/owners',
        name: `x-${allocationOnlyIdentity.slice(7, 69)}`,
      },
    },
  },
}
await recoverPrivateContainedEffectOwners(input as any)
assert.ok(events.includes('cancel-unused-owner'))
assert.ok(events.includes('release-owner-state'))
assert.ok(events.includes('close-owner'))
assert.ok(!events.includes('recover-fence'))
assert.equal(row, undefined)

// An authentic fence can carry a non-terminal reason without throwing. Keep
// that reason observable while refusing to promote payload output to success.
dispatch = true
for (const reason of ['setup_failed', 'accounting_failed', 'recovered', 'memory_limit']) {
  events.length = 0
  stopReason = reason
  const failures: unknown[] = []
  const deadline = Date.now() + 30_000
  const result = await executePrivateContainedEffect({
    ...input,
    parent: { ...input.parent, intent: { ...input.parent.intent, deadlineUnixMs: deadline } },
    parentDeadlineUnixMs: deadline,
    onFailure(phase: string, error: any) {
      failures.push({ phase, code: error.code })
      throw new Error('observer failure must not affect settlement')
    },
  } as any)
  assert.equal(result.status, 'failed')
  assert.equal((result as any).code, 'UNCERTAIN')
  assert.deepEqual(failures, [
    { phase: 'settlement', code: `CONTAINED_EFFECT_${reason.toUpperCase()}` },
  ])
  assert.equal(row, undefined)
  assert.ok(events.includes('close-owner'))
  assert.ok(events.includes('close-input'))
}

const currentDeadlineUnixMs = Date.now() + 30_000
const currentInput = {
  ...input,
  parent: {
    ...input.parent,
    intent: { ...input.parent.intent, deadlineUnixMs: currentDeadlineUnixMs },
  },
  parentDeadlineUnixMs: currentDeadlineUnixMs,
}
stopReason = 'payload_exit'
events.length = 0
const completed = await executePrivateContainedEffect(currentInput as any)
assert.equal(completed.status, 'succeeded')
assert.equal((completed as any).result.outcome, 'done')
assert.equal((completed as any).result.output.exitCode, 17)
assert.equal((completed as any).result.output.stdout.text, 'untrusted success')
assert.equal((completed as any).result.output.cleanup, 'complete')
assert.equal(row, undefined)
assert.ok(events.indexOf('close-owner') < events.indexOf('close-input'))

// Allocation refusal still releases only its unused reservation and preserves
// the original exception; profiling never promotes it to an operation result.
events.length = 0
failAllocation = true
await assert.rejects(
  executePrivateContainedEffect(currentInput as any),
  (error) => error === allocationFailure,
)
failAllocation = false
assert.equal(row, undefined)
assert.ok(events.includes('cancel-unused-owner'))
assert.ok(events.includes('release-owner-state'))
assert.ok(!events.includes('close-owner'))

// A pipe failure joins termination and releases the fresh owner before closing
// captured input, while keeping the existing uncertain operation outcome.
events.length = 0
failCollection = true
const collection = await executePrivateContainedEffect(currentInput as any)
failCollection = false
assert.equal(collection.status, 'failed')
assert.equal((collection as any).code, 'UNCERTAIN')
assert.equal(row, undefined)
assert.ok(events.indexOf('terminate-worker') >= 0)
assert.ok(events.indexOf('terminate-worker') < events.indexOf('release-owner-state'))
assert.ok(events.indexOf('close-owner') < events.indexOf('close-input'))

// Capture the actual HTTP constructor at the real controller-to-backend seam.
// The mock replaces native execution, not the intent or either pure translator.
assert.equal(sealedIntent.storageBytes, 512 * 1024 * 1024)
assert.equal(sealedIntent.readOnlyCwd, undefined)
assert.deepEqual(sealedIntent.inputDirectories, ['/jig-input/project'])
assert.equal(sealedIntent.capturedInputs.length, 1)
httpDispatch = true
workerExitCode = 0
stopReason = 'payload_exit'
const httpInput = {
  ...currentInput,
  httpGrants: openPrivateHttpGrants({ HTTP_TEST_TOKEN: httpCredentialCanary }),
  call: { operationId: 'http-file-only', slot: 'http', input: {} },
}
events.length = 0
writtenInput = ''
const http = await executePrivateContainedEffect(httpInput as any)
assert.equal(http.status, 'succeeded')
assert.deepEqual((http as any).result, {
  outcome: 'done',
  output: { status: 200, body: 'bounded' },
})
assert.equal(row, undefined)
assert.equal(sealedIntent.readOnlyCwd, '/')
assert.equal(sealedIntent.storageBytes, 0)
assert.equal(sealedIntent.network, 'inherited')
assert.equal(sealedIntent.maxOutputBytes, JSON_1_LIMITS.bytes + PROJECT_COMMAND_LIMITS.streamBytes)
assert.equal(sealedIntent.limits.cancellationGraceMs, 1000)
assert.equal(sealedIntent.capturedInputs, undefined)
assert.equal(sealedIntent.inputDirectories, undefined)
assert.equal(sealedIntent.output, undefined)
assert.equal(sealedIntent.environment, undefined)
assert.deepEqual(sealedIntent.projections, [
  { source: '/qualified/bun', destination: '/bun', kind: 'file' },
  { source: '/qualified/http-worker.js', destination: '/http-worker.js', kind: 'file' },
])
assert.deepEqual(sealedIntent.command, [{ path: '/bun' }, { path: '/http-worker.js' }])
assert.ok(!JSON.stringify(sealedIntent).includes(httpCredentialCanary))
assert.ok(JSON.parse(writtenInput).bearer === httpCredentialCanary)
assert.ok(sealedIntent.limits.deadlineUnixMs <= currentDeadlineUnixMs)
assert.ok(sealedIntent.limits.deadlineUnixMs <= Date.now() + httpGrant.timeoutMs)
const mac = privateMacosExecutionPlan(sealedIntent, {
  kind: 'private-macos-owner-state-allocation/1',
  directory: '/owner',
} as any)
assert.equal(mac.cwd, '/')
assert.equal(mac.storage, undefined)
assert.deepEqual(mac.files.writableTrees, [])
assert.deepEqual(mac.files.readOnlyTrees, [])
assert.deepEqual(mac.files.readOnlyFiles, ['/qualified/bun', '/qualified/http-worker.js'])
assert.deepEqual(mac.environment, {})
assert.deepEqual(mac.inputDirectories, [])
assert.deepEqual(mac.capturedInputs, [])
assert.deepEqual(mac.command, ['/qualified/bun', '/qualified/http-worker.js'])
const profile = privateMacosSandboxProfile(mac.files)
assert.ok(profile.text.includes('(allow file-read-data (literal "/"))'))
assert.ok(!profile.text.includes('(subpath "/")'))
assert.ok(!profile.text.includes('(subpath "/qualified")'))
assert.ok(!profile.text.includes('file-write*'))
const { readOnlyCwd: _cwd, storageBytes: _storage, ...oldHttp } = sealedIntent
assert.deepEqual(
  privateLinuxExecutionPlan(sealedIntent),
  privateLinuxExecutionPlan({
    ...oldHttp,
    storageBytes: 16 * 1024 * 1024,
  }),
)
for (const [before, after] of [
  ['allocate-owner', 'seal-worker'],
  ['seal-worker', 'admit-worker'],
  ['admit-worker', 'write-input'],
  ['write-input', 'record-fence'],
  ['record-fence', 'release-owner-state'],
  ['release-owner-state', 'close-owner'],
])
  assert.ok(events.indexOf(before) >= 0 && events.indexOf(before) < events.indexOf(after))
// A failed worker and an interrupted file-only worker still settle fresh ownership.
for (const [reason, exitCode, code] of [
  ['payload_exit', 17, 'UNCERTAIN'],
  ['cancelled', 0, 'CANCELLED'],
] as const) {
  stopReason = reason
  workerExitCode = exitCode
  events.length = 0
  const failure = await executePrivateContainedEffect(httpInput as any)
  assert.equal(failure.status, 'failed')
  assert.equal((failure as any).code, code)
  assert.equal(row, undefined)
  assert.ok(events.includes('record-fence') && events.includes('close-owner'))
  assert.ok(events.indexOf('record-fence') < events.indexOf('release-owner-state'))
}
stopReason = 'payload_exit'
workerExitCode = 0
failCollection = true
events.length = 0
const httpCollection = await executePrivateContainedEffect(httpInput as any)
failCollection = false
assert.equal(httpCollection.status, 'failed')
assert.equal((httpCollection as any).code, 'UNCERTAIN')
assert.equal(row, undefined)
assert.ok(events.indexOf('terminate-worker') >= 0)
assert.ok(events.indexOf('terminate-worker') < events.indexOf('release-owner-state'))
assert.ok(!JSON.stringify(httpCollection).includes(httpCredentialCanary))
privateProfileFinish()
process.stdout.write('contained effect deadline/prior-owner ordering checks passed\n')
process.stdout.write('HTTP actual intent/file-only lowering/failure cleanup checks passed\n')
