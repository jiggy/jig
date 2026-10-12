// Portable observer capture: injected allocation refusal prevents any execution admission.
// Separate process keeps module mocks out of other controller/host tests.
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import * as admission from '../src/internal/activation-admission.js'
import * as store from '../src/internal/activation-admission-store.js'
import * as direct from '../src/internal/direct-run.js'
import * as execution from '../src/internal/execution-backend.js'
import * as context from '../src/internal/invocation-context.js'
import * as artifacts from '../src/internal/package-artifact-store.js'
import * as materialization from '../src/internal/package-materialization.js'
import * as channels from '../src/internal/run-channels.js'
import * as inspection from '../src/package/inspect.js'
import { ChannelBroker } from '../src/run/channels.js'

const digest = `sha256:${'1'.repeat(64)}`
const target = { kind: 'flow', id: 'child' }
const executionBytes = { package: { digest }, layout: { aliases: [] } }
const selected = {
  request: { digest, target, package: { digest } },
  disposition: {
    state: 'ready',
    recipeDigest: digest,
    observationDigest: digest,
    execution: executionBytes,
  },
}
const allocationRefusal = new Error('injected allocation refusal before dispatch')
let durableOperationId: string | undefined
let capturesDisposed = 0
const bytes = new Uint8Array([0x64, 0x69, 0x61, 0x67])
const bindObserver = channels.privateRunDiagnosticObserver
mock.module('../src/internal/run-channels.js', () => ({
  ...channels,
  privateRunDiagnosticObserver(input: Parameters<typeof bindObserver>[0]) {
    const observer = bindObserver(input)
    observer(bytes)
    return observer
  },
}))
mock.module('../src/internal/invocation-context.js', () => ({
  ...context,
  requireParentTarget: () => ({ request: { slots: { child: { kind: 'flow', target } } } }),
  requireParentFlowOwner: async () => undefined,
}))
mock.module('../src/internal/activation-admission.js', () => ({
  ...admission,
  findPrivateActivationCandidateTargetV5: () => selected,
  privateActivationCandidateFlowDepth: () => 1,
}))
mock.module('../src/internal/package-artifact-store.js', () => ({
  ...artifacts,
  captureStoredPackage: async () => ({
    dispose: async () => {
      capturesDisposed++
    },
  }),
}))
mock.module('../src/package/inspect.js', () => ({
  ...inspection,
  inspectCapturedPackage: async () => ({ schemas: {} }),
}))
mock.module('../src/internal/direct-run.js', () => ({
  ...direct,
  planPrivateDirectRun: async () => ({
    digest,
    observation: { digest },
    execution: executionBytes,
    wallClockCeilingMs: 60_000,
  }),
}))
mock.module('../src/internal/package-materialization.js', () => ({
  ...materialization,
  allocatePrivatePackageMaterialization: async () => ({ digest }),
  materializePrivatePackageLease: async () => {
    throw new Error('diagnostic source fixture must not dispatch')
  },
}))
mock.module('../src/internal/execution-backend.js', () => ({
  ...execution,
  planPrivateExecutionOwnerStateAllocation: async () => ({ digest }),
}))
mock.module('../src/internal/activation-admission-store.js', () => ({
  ...store,
  listPrivateRootChildOwners: async () => [],
  allocatePrivateRootChildOwner: async (input: { operationId: string }) => {
    durableOperationId = input.operationId
    throw allocationRefusal
  },
}))
const { executePrivateRootFlowCall } = await import('../src/internal/root-flow-call-controller.js')
const rootArgument = process.argv[2]
assert.ok(rootArgument)
const projectRoot = await realpath(rootArgument)
await mkdir(join(projectRoot, '.jig'), { mode: 0o700 })
const broker = new ChannelBroker()
const root = broker.participant('root')
const parent = broker.participant('flow:actual-parent')
for (const nested of [false, true]) {
  const caller = nested ? parent : root
  const operationId = 'same-own-operation'
  const reports: {
    bytes: Uint8Array
    operations?: readonly string[]
    source?: channels.PrivateRunDiagnosticSource
  }[] = []
  const callEvents: { publisher: string; operationId: string; childPublisher?: string }[] = []
  const input = {
    projectRoot,
    packageStoreRoot: '/unused',
    coordinator: {},
    backend: {},
    installedSupport: {},
    parent: {
      candidate: {},
      run: { runId: digest, coordinatorEpoch: 1 },
      intent: { deadlineUnixMs: Date.now() + 60_000 },
    },
    ...(nested
      ? {
          parentFlow: {
            operationId: 'private-parent',
            target,
            requestDigest: digest,
            parent: null,
          },
        }
      : {}),
    channels: { caller, broker },
    call: { slot: 'child', operationId, input: null },
    diagnosticPath: ['unrelated-path', 'same'],
    parentDeadlineUnixMs: Date.now() + 60_000,
    signal: new AbortController().signal,
    onCall(event: (typeof callEvents)[number]) {
      callEvents.push(event)
    },
    onDiagnostic(
      received: Uint8Array,
      operations?: readonly string[],
      source?: channels.PrivateRunDiagnosticSource,
    ) {
      reports.push({ bytes: received, operations, source })
    },
  }
  await assert.rejects(
    executePrivateRootFlowCall(input as never),
    (error) => error === allocationRefusal,
  )
  assert.equal(reports.length, 1)
  const report = reports[0]
  const callEvent = callEvents[0]
  assert.ok(report)
  assert.ok(callEvent)
  assert.equal(typeof callEvent.childPublisher, 'string')
  assert.equal(report.bytes, bytes)
  assert.deepEqual(report.operations, ['unrelated-path', 'same'])
  assert.deepEqual(report.source, {
    emitter: callEvent.childPublisher,
    call: { publisher: caller.id, operationId },
  })
  assert.equal(callEvent.publisher, caller.id)
  assert.equal(callEvent.operationId, operationId)
  assert.equal(input.call.operationId, operationId)
  if (nested) assert.notEqual(durableOperationId, operationId)
  else assert.equal(durableOperationId, operationId)
}
assert.equal(capturesDisposed, 2)
root.finalize(true)
parent.finalize(true)
console.log('child diagnostic source binding passed')
