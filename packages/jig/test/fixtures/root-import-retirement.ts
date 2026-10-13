// Isolated lifecycle-order injection; this grants no native qualification.
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdir, open, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import * as admission from '../../src/internal/activation-admission.js'
import * as store from '../../src/internal/activation-admission-store.js'
import * as bound from '../../src/internal/bound-attachments.js'
import * as direct from '../../src/internal/direct-run.js'
import * as execution from '../../src/internal/execution-backend.js'
import {
  createPrivateFileImportTarget,
  type PrivateFileImportTarget,
  PrivateFileImportUnconfirmedError,
} from '../../src/internal/execution-file-import.js'
import * as intent from '../../src/internal/flow-execution-intent.js'
import { createPrivateRootFlowFileContext } from '../../src/internal/flow-file-context.js'
import * as artifacts from '../../src/internal/package-artifact-store.js'
import * as materialization from '../../src/internal/package-materialization.js'
import * as effects from '../../src/internal/root-contained-effect-controller.js'
import * as acp from '../../src/internal/root-finite-acp-controller.js'
import * as children from '../../src/internal/root-flow-call-controller.js'
import * as channels from '../../src/internal/run-channels.js'
import * as inspection from '../../src/package/inspect.js'
import * as session from '../../src/run/session.js'

const root = await realpath(process.argv[2]!)
await mkdir(join(root, '.jig'), { mode: 0o700 })
const digest = `sha256:${'1'.repeat(64)}`
const request = {
  digest,
  target: { kind: 'flow', path: 'flows/root' },
  package: { digest },
  attachments: { files: 'read-write' },
  boundAttachments: {},
  slots: {},
  settings: {},
}
const selected = {
  request,
  disposition: {
    state: 'ready',
    execution: { package: { digest }, layout: { aliases: [] } },
  },
}
const protocolError = new Error('injected root protocol failure')
const checkpointError = new Error('injected root checkpoint failure')
const closeError = new Error('injected importer close failure')
const childError = new execution.PrivateExecutionFenceUnconfirmedError('child fence unknown')
const fence = { ownerDigest: digest }
let mode = ''
let events: string[] = []
let admitted = false
let fenced = false
let rawCloses = 0
let childrenPending = false
let checkpointFailures = 0
let lifecycle: Record<string, any> = {}
let target: PrivateFileImportTarget
let signal: AbortController
let work: Record<string, any>
let releaseStage: (() => void) | undefined
let observed: unknown[] = []

mock.module('../../src/internal/activation-admission.js', () => ({
  ...admission,
  findPrivateActivationCandidateTargetV5: () => selected,
}))
mock.module('../../src/internal/activation-admission-store.js', () => ({
  ...store,
  reacquirePrivateRootExecutionWork: async () => ({ ...work, lifecycle }),
  recordPrivateRootExecutionCheckpoint: async ({ checkpoint, value }: any) => {
    events.push(`checkpoint-${checkpoint}`)
    if (checkpoint === 'provisional') {
      if (mode === 'outer-terminal-checkpoint-failure') throw checkpointError
      if (
        (mode === 'outer-recovery' || mode === 'outer-fence-checkpoint-failure') &&
        checkpointFailures++ < 3
      )
        throw checkpointError
    }
    if (mode === 'outer-fence-checkpoint-failure' && checkpoint === 'fence') throw checkpointError
    lifecycle = { ...lifecycle, [checkpoint]: { digest, value } }
    return lifecycle
  },
  closePrivateRootExecution: async ({ terminal }: any) => {
    events.push('root-close')
    return { ...work.run, terminal }
  },
}))
mock.module('../../src/internal/package-artifact-store.js', () => ({
  ...artifacts,
  captureStoredPackage: async () => ({ dispose: async () => {} }),
}))
mock.module('../../src/package/inspect.js', () => ({
  ...inspection,
  inspectCapturedPackage: async () => ({ schemas: {}, invocation: { outcomes: { done: {} } } }),
}))
mock.module('../../src/internal/direct-run.js', () => ({
  ...direct,
  planPrivateDirectRun: async () => ({
    digest,
    request,
    observation: { digest },
    execution: selected.disposition.execution,
    wallClockCeilingMs: 60_000,
    installedSupport: {},
    mechanismDigest: digest,
  }),
}))
mock.module('../../src/internal/installed-bun-support.js', () => ({
  revalidatePrivateInstalledBunSupport: async () => {},
}))
mock.module('../../src/internal/flow-execution-intent.js', () => ({
  ...intent,
  privateFlowExecutionIntent: () => ({}),
}))
mock.module('../../src/internal/bound-attachments.js', () => ({
  ...bound,
  openBoundAttachments: async () => ({ attachments: [], close() {} }),
}))
mock.module('../../src/internal/package-materialization.js', () => ({
  ...materialization,
  allocatePrivatePackageMaterialization: async (options: any) => ({
    ...options,
    parent: { path: options.protectedParent },
    digest,
  }),
  materializePrivatePackageLease: async (_capture: any, allocation: any) => ({
    root: '/unused',
    identity: { allocation },
  }),
  disposePrivatePackageMaterializationLease: async () => {
    events.push('package-close')
  },
  recoverPrivatePackageMaterializationAllocation: async () => ({ state: 'absent' }),
}))
mock.module('../../src/internal/execution-backend.js', () => ({
  ...execution,
  planPrivateExecutionOwnerStateAllocation: async (_backend: any, options: any) => options,
  normalizePrivateExecutionOwnerStateAllocationIdentity: (value: any) => value,
  normalizePrivateExecutionSealedOwnerIdentity: (value: any) => value,
  normalizePrivateExecutionConfirmedEnforcementReceipt: (value: any) => value,
  privateExecutionLocations: () => ({ scratch: '/unused', attachment: () => '/jig-output' }),
  sealPrivateExecutionOwner: async () => ({ identity: { digest, mechanismDigest: digest } }),
  recoverPrivateExecutionFence: async () => {
    events.push('recover-fence')
    if (mode === 'fence-unknown')
      throw new execution.PrivateExecutionFenceUnconfirmedError('root fence unknown')
    fenced = true
    return fence
  },
  releasePrivateExecutionOwnerState: async () => {
    assert(fenced)
    assert.equal(rawCloses, 1)
    assert.equal(childrenPending, false)
    events.push('native-close')
    return { digest }
  },
  admitPrivateExecutionOwner: async (_sealed: any, _signal: any, prepared: any) => {
    await prepared({ digest })
    admitted = true
    events.push('admit')
    return {
      outputImport: target,
      get enforcement() {
        events.push('component-fence')
        fenced = true
        return Promise.resolve(fence)
      },
    }
  },
}))
mock.module('../../src/internal/root-flow-call-controller.js', () => ({
  ...children,
  recoverPrivateRootFlowCallOwners: async () => {
    if (!admitted) return
    events.push('children-join')
    if (mode === 'child-unknown' || mode === 'early-pending') {
      childrenPending = true
      throw childError
    }
  },
}))
mock.module('../../src/internal/root-finite-acp-controller.js', () => ({
  ...acp,
  recoverPrivateRootFiniteAcpOwners: async () => {},
}))
mock.module('../../src/internal/root-contained-effect-controller.js', () => ({
  ...effects,
  recoverPrivateContainedEffectOwners: async () => {},
}))
mock.module('../../src/internal/run-channels.js', () => ({
  ...channels,
  PrivateRunChannels: class {
    static async open() {
      return { broker: { abort() {} }, root: { id: 'root' }, grants: {}, async settle() {} }
    }
  },
}))
mock.module('../../src/run/session.js', () => ({
  ...session,
  RunHostSession: class {
    async run() {
      if (mode === 'early-pending') {
        // Real RunHost normal completion already joins original enforcement.
        fenced = true
        return {
          status: 'succeeded',
          result: { outcome: 'done', output: null },
          diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
        }
      }
      if (mode.startsWith('outer-')) signal.abort()
      throw protocolError
    }
  },
}))

const { executePrivateRootRunLaunch } = await import('../../src/internal/root-run-controller.js')
function contains(value: unknown, sought: unknown): boolean {
  if (value === sought) return true
  if (value instanceof AggregateError && value.errors.some((error) => contains(error, sought)))
    return true
  return value instanceof Error && contains(value.cause, sought)
}
for (const scenario of [
  'protocol',
  'fence-unknown',
  'close-unknown',
  'child-unknown',
  'early-pending',
  'stage-join',
  'outer-recovery',
  'outer-fence-checkpoint-failure',
  'outer-terminal-checkpoint-failure',
]) {
  mode = scenario
  events = []
  observed = []
  admitted = fenced = childrenPending = false
  rawCloses = checkpointFailures = 0
  signal = new AbortController()
  lifecycle = { runId: digest, allocation: { digest } }
  work = {
    candidate: {},
    lifecycle,
    run: { runId: digest, coordinatorEpoch: 1, target: request.target, input: null, files: {} },
    intent: {
      deadlineUnixMs: Date.now() + 60_000,
      requestDigest: digest,
      recipeDigest: digest,
      observationDigest: digest,
    },
  }
  const held = await open(root)
  target = createPrivateFileImportTarget({
    async stage() {
      const directory = await open(root)
      return {
        directory,
        async commit() {
          throw new Error('test never commits')
        },
        async close() {
          assert(fenced, 'root importer stage cannot retire before the parent fence')
          events.push('stage-closing')
          await new Promise<void>((resolve) => {
            releaseStage = resolve
          })
          await directory.close()
          events.push('stage-closed')
        },
      }
    },
    async close() {
      assert(fenced, 'root importer cannot retire before the parent fence')
      assert(events.includes('children-join'))
      events.push('importer-close')
      rawCloses++
      await held.close()
      if (mode === 'close-unknown') throw new PrivateFileImportUnconfirmedError(closeError)
    },
  })
  if (mode === 'stage-join') {
    await target.stage({
      directory: 'copied',
      operationId: 'child',
      deadlineUnixMs: Date.now() + 60_000,
      signal: signal.signal,
    })
  }
  const files = {
    async bindCheckpoint() {},
    projection() {
      return {
        context: createPrivateRootFlowFileContext({
          declarations: { files: 'read-write' },
          captured: [],
        }),
        plan: {},
        attachments: {},
      }
    },
    retainOutput() {},
  }
  const pending = executePrivateRootRunLaunch({
    projectRoot: root,
    packageStoreRoot: '/unused',
    runId: digest,
    coordinator: { epoch: 1, async verify() {} },
    installedSupport: {},
    backend: {},
    files,
    signal: signal.signal,
    onFailure: (_phase, error) => observed.push(error),
  } as never)
  if (mode === 'stage-join') {
    for (let wait = 0; releaseStage === undefined && wait < 100; wait++)
      await new Promise((resolve) => setTimeout(resolve, 1))
    assert(releaseStage, 'root retirement must join the outstanding stage')
    assert(!events.includes('native-close'))
    assert(!events.includes('root-close'))
    releaseStage()
  }
  if (mode.endsWith('checkpoint-failure')) {
    await assert.rejects(pending, (error) => error === checkpointError)
  } else {
    const disposition = await pending
    const expectedPending = ['fence-unknown', 'close-unknown', 'child-unknown', 'early-pending']
    assert.equal(disposition.state, expectedPending.includes(mode) ? 'pending' : 'terminal', mode)
    if (mode === 'outer-recovery' && disposition.state === 'terminal')
      assert.equal(disposition.run.terminal?.code, 'CANCELLED')
  }
  assert(observed.some((error) => contains(error, protocolError)) || mode === 'early-pending')
  if (mode === 'fence-unknown') {
    assert.equal(rawCloses, 0)
    assert(!events.includes('package-close'))
    assert(!events.includes('native-close'))
    // Join the fixture's real descriptor only after separately confirming its
    // fake fence; this is not evidence of native recovery.
    fenced = true
    events.push('children-join')
    await target.close()
  } else {
    assert.equal(rawCloses, 1, mode)
    assert(events.indexOf('children-join') < events.indexOf('importer-close'), mode)
    if (['protocol', 'stage-join', 'outer-recovery'].includes(mode)) {
      assert(events.indexOf('importer-close') < events.indexOf('package-close'), mode)
      assert(events.indexOf('importer-close') < events.indexOf('native-close'), mode)
      assert(events.indexOf('native-close') < events.indexOf('root-close'), mode)
    } else {
      assert(!events.includes('package-close'), mode)
      assert(!events.includes('native-close'), mode)
      assert(!events.includes('root-close'), mode)
    }
  }
  if (mode === 'close-unknown') {
    assert(observed.some((error) => contains(error, closeError)))
    await assert.rejects(target.close(), PrivateFileImportUnconfirmedError)
    assert.equal(rawCloses, 1, 'unconfirmed close is never retried')
  }
  if (mode === 'child-unknown' || mode === 'early-pending') {
    assert(childrenPending, 'retiring parent imports cannot clear unresolved child ownership')
    assert.equal(lifecycle.release, undefined)
  }
  if (mode === 'early-pending') assert.equal(lifecycle.provisional.value.status, 'succeeded')
  if (mode === 'stage-join')
    assert(events.indexOf('stage-closed') < events.indexOf('importer-close'))
  if (mode.startsWith('outer-') && !mode.startsWith('outer-terminal-'))
    assert.equal(lifecycle.provisional.value.code, 'CANCELLED')
  if (mode === 'outer-terminal-checkpoint-failure') assert.equal(lifecycle.provisional, undefined)
}
console.log('root importer retirement ordering passed: 9 scenarios')
