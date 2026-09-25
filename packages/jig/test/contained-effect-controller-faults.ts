// Separate process: module mocks must not affect other host tests.
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import * as store from '../src/internal/activation-admission-store.js'
import * as direct from '../src/internal/direct-run.js'
import { privateDomainDigest } from '../src/internal/identity.js'
import * as installed from '../src/internal/installed-bun-support.js'
import * as context from '../src/internal/invocation-context.js'
import * as linux from '../src/internal/linux-rootless-backend.js'
import {
  PROJECT_COMMAND_CONTRACT_DIGEST,
  PROJECT_COMMAND_CONTRACT_ID,
  PROJECT_COMMAND_CONTRACT_VERSION,
} from '../src/internal/private-project-command.js'

const digest = (n: number) => `sha256:${n.toString(16).padStart(2, '0').repeat(32)}`
const runId = digest(1)
const requestDigest = digest(2)
const operationId = 'same-operation'
const events: string[] = []
let row: any
let failAfterPhysicalRelease = false
const step = (name: string) => events.push(name)
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
  }),
}))
mock.module('../src/internal/installed-bun-support.js', () => ({
  ...installed,
  revalidatePrivateInstalledBunSupport: async () => {},
}))
mock.module('../src/internal/invocation-context.js', () => ({
  ...context,
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
  allocatePrivateRootChildOwner: async () => {
    step('allocate-owner')
    throw new Error('the expired call must not allocate a new owner')
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
mock.module('../src/internal/linux-rootless-backend.js', () => ({
  ...linux,
  normalizePrivateLinuxOwnerStateAllocationIdentity: (value: unknown) => value,
  normalizePrivateLinuxSealedOwnerIdentity: (value: unknown) => value,
  normalizePrivateLinuxConfirmedEnforcementReceipt: (value: unknown) => value,
  normalizePrivateLinuxPreparedOwnerIdentity: () => {},
  normalizePrivateLinuxOwnerStateReleaseReceipt: (value: unknown) => value,
  cancelPrivateLinuxOwnerStateAllocation: async () => {
    step('cancel-unused-owner')
    return { stopReason: 'cancelled' }
  },
  releasePrivateLinuxOwnerState: async () => {
    step('release-owner-state')
    if (failAfterPhysicalRelease) {
      failAfterPhysicalRelease = false
      throw new Error('injected interruption after physical owner release')
    }
    return { digest: digest(9) }
  },
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
      ownerAllocation: priorOwnerAllocation,
    },
  },
  sandbox: {
    digest: digest(11),
    value: {
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
      ownerAllocation: recoveryOwner,
    },
  },
  sandbox: {
    digest: digest(15),
    value: {
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

process.stdout.write('contained effect deadline/prior-owner ordering checks passed\n')
