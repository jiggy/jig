// Separate process: injected allocation faults must not affect other host tests.
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { CheckError } from '../src/diagnostics.js'
import * as admission from '../src/internal/activation-admission.js'
import * as store from '../src/internal/activation-admission-store.js'
import * as direct from '../src/internal/direct-run.js'
import * as execution from '../src/internal/execution-backend.js'
import * as context from '../src/internal/invocation-context.js'
import * as artifacts from '../src/internal/package-artifact-store.js'
import * as materialization from '../src/internal/package-materialization.js'
import * as inspection from '../src/package/inspect.js'

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
let failure: Error = new Error('injected child allocation failure')
let disposed = 0
let materialized = 0
mock.module('../src/internal/invocation-context.js', () => ({
  ...context,
  requireParentTarget: () => ({ request: { slots: { child: { kind: 'flow', target } } } }),
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
      disposed++
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
    materialized++
    throw new Error('must not dispatch')
  },
}))
mock.module('../src/internal/execution-backend.js', () => ({
  ...execution,
  planPrivateExecutionOwnerStateAllocation: async () => ({ digest }),
}))
mock.module('../src/internal/activation-admission-store.js', () => ({
  ...store,
  listPrivateRootChildOwners: async () => [],
  allocatePrivateRootChildOwner: async () => {
    throw failure
  },
}))
const { executePrivateRootFlowCall } = await import('../src/internal/root-flow-call-controller.js')
const projectRoot = await realpath(process.argv[2]!)
await mkdir(join(projectRoot, '.jig'), { mode: 0o700 })
const observed: { phase: string; error: unknown }[] = []
let observerThrows = false
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
  call: { slot: 'child', operationId: 'allocate', input: null },
  parentDeadlineUnixMs: Date.now() + 60_000,
  signal: new AbortController().signal,
  onFailure(phase: string, error: unknown) {
    observed.push({ phase, error })
    if (observerThrows) throw new Error('observer failure')
  },
}
for (const throws of [false, true]) {
  observerThrows = throws
  observed.length = 0
  await assert.rejects(executePrivateRootFlowCall(input as never), (error) => error === failure)
  assert.deepEqual(observed, [{ phase: 'allocation', error: failure }])
}
observed.length = 0
failure = new CheckError('unavailable', 'RUN_CHILD_CAPACITY', 'capacity exhausted')
const result = await executePrivateRootFlowCall(input as never)
assert.equal(result.status, 'failed')
assert.equal((result as { code: string }).code, 'RESOURCE_EXHAUSTED')
assert.deepEqual(observed, [])
assert.equal(materialized, 0)
assert.equal(disposed, 3)
console.log('child allocation diagnostics passed')
