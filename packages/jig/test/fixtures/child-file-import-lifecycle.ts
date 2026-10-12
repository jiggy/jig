// Isolated process: these lifecycle-order mocks grant no native qualification.
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdir, open, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import * as admission from '../../src/internal/activation-admission.js'
import * as store from '../../src/internal/activation-admission-store.js'
import * as direct from '../../src/internal/direct-run.js'
import * as execution from '../../src/internal/execution-backend.js'
import * as transfers from '../../src/internal/execution-file-import.js'
import * as intent from '../../src/internal/flow-execution-intent.js'
import {
  bindPrivateFlowFileImportTarget,
  createPrivateRootFlowFileContext,
} from '../../src/internal/flow-file-context.js'
import * as invocation from '../../src/internal/invocation-context.js'
import * as artifacts from '../../src/internal/package-artifact-store.js'
import * as materialization from '../../src/internal/package-materialization.js'
import * as effects from '../../src/internal/root-contained-effect-controller.js'
import * as acp from '../../src/internal/root-finite-acp-controller.js'
import * as inspection from '../../src/package/inspect.js'
import * as session from '../../src/run/session.js'

const root = await realpath(process.argv[2]!)
await mkdir(join(root, '.jig'), { mode: 0o700 })
const digest = `sha256:${'1'.repeat(64)}`
const target = { kind: 'flow', path: 'flows/child' }
const request = {
  digest,
  target,
  package: { digest },
  attachments: { files: 'read-write' },
  slots: {},
}
const selected = {
  request,
  disposition: {
    state: 'ready',
    recipeDigest: digest,
    observationDigest: digest,
    execution: { package: { digest }, layout: { aliases: [] } },
  },
}
let events: string[] = []
let mode = 'normal'
let outcome = 'done'
let serial = 0
const rows = new Map<string, any>()
const fence = { ownerDigest: digest }
const release = { digest }

mock.module('../../src/internal/invocation-context.js', () => ({
  ...invocation,
  requireParentTarget: () => ({
    request: {
      slots: {
        copy: {
          kind: 'flow',
          target,
          attachments: { files: { into: 'photos', directory: 'copies' } },
        },
      },
    },
  }),
}))
mock.module('../../src/internal/activation-admission.js', () => ({
  ...admission,
  findPrivateActivationCandidateTargetV5: () => selected,
  privateActivationCandidateFlowDepth: () => 1,
}))
mock.module('../../src/internal/package-artifact-store.js', () => ({
  ...artifacts,
  captureStoredPackage: async () => ({ dispose: async () => {} }),
}))
mock.module('../../src/package/inspect.js', () => ({
  ...inspection,
  inspectCapturedPackage: async () => ({
    mode: 'run',
    schemas: {},
    invocation: { outcomes: { blocked: {} } },
  }),
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
mock.module('../../src/internal/package-materialization.js', () => ({
  ...materialization,
  allocatePrivatePackageMaterialization: async (options: any) => ({
    ...options,
    parent: { path: options.protectedParent },
    digest,
  }),
  normalizePrivatePackageMaterializationAllocationIdentity: (value: any) => value,
  privatePackageMaterializationMatches: () => true,
  materializePrivatePackageLease: async (_capture: any, allocation: any) => {
    events.push('prepare')
    return { root: '/unused', identity: { allocation } }
  },
  disposePrivatePackageMaterializationLease: async () => {
    events.push('package-close')
  },
  recoverPrivatePackageMaterializationAllocation: async () => ({ state: 'absent' }),
}))
mock.module('../../src/internal/execution-backend.js', () => ({
  ...execution,
  planPrivateExecutionOwnerStateAllocation: async (parent: any, options: any) => options,
  normalizePrivateExecutionOwnerStateAllocationIdentity: (value: any) => value,
  normalizePrivateExecutionSealedOwnerIdentity: (value: any) => value,
  normalizePrivateExecutionConfirmedEnforcementReceipt: (value: any) => value,
  normalizePrivateExecutionOwnerStateReleaseReceipt: (value: any) => value,
  observePrivateExecutionBackendMechanism: async () => ({ support: { digest } }),
  privateExecutionLocations: () => ({ scratch: '/unused', attachment: () => '/jig-output' }),
  sealPrivateExecutionOwner: async () => ({ identity: { digest } }),
  cancelPrivateExecutionOwnerStateAllocation: async () => {
    events.push('cancel-owner')
    return {}
  },
  recoverPrivateExecutionFence: async () => fence,
  releasePrivateExecutionOwnerState: async () => {
    events.push('native-close')
    return release
  },
  admitPrivateExecutionOwner: async () => {
    events.push('dispatch')
    const source = await open(root)
    let closed = false
    return {
      output: {
        kind: 'linux-directory',
        directory: {
          fd: source.fd,
          async close() {
            if (closed) return
            closed = true
            events.push('source-close')
            await source.close()
          },
        },
      },
      get enforcement() {
        events.push('fence')
        return Promise.resolve(fence)
      },
      async terminate() {
        events.push('terminate')
      },
    }
  },
}))
mock.module('../../src/internal/root-finite-acp-controller.js', () => ({
  ...acp,
  recoverPrivateRootFiniteAcpOwners: async () => {
    events.push('acp-join')
  },
}))
mock.module('../../src/internal/root-contained-effect-controller.js', () => ({
  ...effects,
  recoverPrivateContainedEffectOwners: async () => {
    events.push('effect-join')
  },
}))
mock.module('../../src/run/session.js', () => ({
  ...session,
  RunHostSession: class {
    async run() {
      events.push('result')
      return { status: 'succeeded', result: { outcome, output: { count: 1 } }, diagnostics: {} }
    }
  },
}))
mock.module('../../src/internal/execution-file-import.js', () => ({
  ...transfers,
  copyPrivateFileImportOutput: async ({ stage }: any) => {
    transfers.requirePrivateFileImportStage(stage)
    events.push('copy')
    if (mode === 'copy-failure') throw new Error('injected profile refusal')
  },
}))
mock.module('../../src/internal/activation-admission-store.js', () => ({
  ...store,
  listPrivateRootChildOwners: async () => [...rows.values()],
  allocatePrivateRootChildOwner: async (input: any) => {
    const row = {
      parentRunId: input.parentRunId,
      operationId: input.operationId,
      allocation: { digest, value: input.allocation },
    }
    rows.set(input.operationId, row)
    return row
  },
  recordPrivateRootChildSandbox: async (input: any) => {
    const row = rows.get(input.operationId)
    row.sandbox = { digest, value: input.sandbox }
    return row
  },
  recordPrivateRootChildFence: async (input: any) => {
    const row = rows.get(input.operationId)
    row.fence = { digest, value: input.fence }
    return row
  },
  recordPrivateRootChildCleanup: async (input: any) => {
    const row = rows.get(input.operationId)
    row.cleanup = { digest, value: input.cleanup }
    return row
  },
  closePrivateRootChildOwner: async (input: any) => {
    events.push('row-close')
    rows.delete(input.operationId)
  },
}))

const { executePrivateRootFlowCall } = await import(
  '../../src/internal/root-flow-call-controller.js'
)
function caller() {
  const context = createPrivateRootFlowFileContext({
    declarations: { photos: 'read-write' },
    captured: [],
  })
  const native = transfers.createPrivateFileImportTarget({
    async stage() {
      events.push('stage')
      if (mode === 'stage-unknown')
        throw new transfers.PrivateFileImportUnconfirmedError(new Error('lost setup ACK'))
      const directory = await open(root)
      let closed: Promise<void> | undefined
      return {
        directory,
        async commit() {
          events.push('commit')
          assert(events.includes('source-close'))
          assert(events.includes('package-close'))
          assert(events.includes('native-close'))
          assert(events.includes('row-close'))
          if (mode === 'commit-unknown')
            throw new transfers.PrivateFileImportUnconfirmedError(new Error('lost commit ACK'))
          return mode === 'absent' ? ('absent' as const) : ('committed' as const)
        },
        close() {
          closed ??= (async () => {
            events.push('stage-close')
            await directory.close()
            if (mode === 'close-unknown')
              throw new transfers.PrivateFileImportUnconfirmedError(new Error('unknown close'))
          })()
          return closed
        },
      }
    },
    async close() {},
  })
  bindPrivateFlowFileImportTarget(context, native)
  return context
}
async function run(context: ReturnType<typeof caller>) {
  serial++
  return executePrivateRootFlowCall({
    projectRoot: root,
    packageStoreRoot: '/unused',
    coordinator: {},
    backend: {},
    installedSupport: {},
    files: context,
    parent: {
      candidate: {},
      run: { runId: digest, coordinatorEpoch: 1 },
      intent: { deadlineUnixMs: Date.now() + 60_000 },
    },
    call: { slot: 'copy', operationId: `copy-${serial}`, input: null },
    parentDeadlineUnixMs: Date.now() + 60_000,
    signal: new AbortController().signal,
  } as never)
}

for (const kind of [
  'normal',
  'absent',
  'copy-failure',
  'stage-unknown',
  'commit-unknown',
  'close-unknown',
]) {
  mode = kind
  outcome = 'done'
  events = []
  const context = caller()
  try {
    if (kind.endsWith('unknown')) {
      await assert.rejects(
        run(context),
        (error: any) =>
          error instanceof session.RunHostFatalOperationError && error.code === 'UNCERTAIN',
      )
      assert.equal(rows.size, 0)
      const dispatched = events.filter((event) => event === 'dispatch').length
      await assert.rejects(
        run(context),
        (error: any) => error instanceof session.RunHostFatalOperationError,
      )
      assert.equal(events.filter((event) => event === 'dispatch').length, dispatched)
    } else {
      const result = await run(context)
      events.push('reply')
      assert.equal(
        result.status,
        kind === 'normal' ? 'succeeded' : 'failed',
        JSON.stringify({ result, events }),
      )
      assert.equal(rows.size, 0)
      if (kind === 'normal') {
        for (const [before, after] of [
          ['stage', 'dispatch'],
          ['fence', 'copy'],
          ['copy', 'source-close'],
          ['source-close', 'native-close'],
          ['native-close', 'row-close'],
          ['row-close', 'commit'],
          ['commit', 'stage-close'],
          ['stage-close', 'reply'],
        ])
          assert(
            events.indexOf(before!) < events.indexOf(after!),
            `${before} must precede ${after}`,
          )
        const retry = await run(context)
        assert.equal(retry.status, 'failed')
        assert.equal((retry as any).code, 'UNAVAILABLE')
        assert.equal(events.filter((event) => event === 'dispatch').length, 1)
      } else {
        assert.equal(events.includes('commit'), kind === 'absent')
        mode = 'normal'
        assert.equal((await run(context)).status, 'succeeded')
      }
    }
  } finally {
    context.close()
  }
}
for (const value of ['blocked', 'undeclared']) {
  mode = 'normal'
  outcome = value
  events = []
  const context = caller()
  try {
    const result = await run(context)
    assert.equal(result.status, value === 'blocked' ? 'succeeded' : 'failed')
    assert.equal(events.includes('copy'), value === 'blocked')
    assert.equal(events.includes('commit'), value === 'blocked')
  } finally {
    context.close()
  }
}
console.log('child file import lifecycle ordering passed')
