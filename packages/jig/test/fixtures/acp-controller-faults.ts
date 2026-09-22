// Executed in a separate process: module mocks must not alter other host tests.
// This checks the real controller's ordering/scope, not kernel or SQLite behavior.
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import * as store from '../../src/internal/activation-admission-store.js'
import * as acp from '../../src/internal/acp-agent-provider.js'
import * as direct from '../../src/internal/direct-run.js'
import * as installed from '../../src/internal/installed-bun-support.js'
import * as context from '../../src/internal/invocation-context.js'
import * as linux from '../../src/internal/linux-rootless-backend.js'
import * as resource from '../../src/internal/finite-acp-resource.js'
import * as history from '../../src/internal/codex-session-state.js'
import { PrivateFiniteAcpPolicyError } from '../../src/internal/finite-acp-policy.js'
import {
  FINITE_ACP_CONTRACT_ID,
  FINITE_ACP_CONTRACT_VERSION,
  FINITE_ACP_CONTRACT_DIGEST,
} from '../../src/internal/private-finite-acp-contract.js'

const digest = (n: number) => `sha256:${n.toString(16).repeat(64)}`
const reference = '013579ab-cdef-4567-89ab-0123456789ab'
const state = {
  nativeId: reference,
  rolloutPath: `sessions/2026/09/17/rollout-2026-09-17T00-00-00-${reference}.jsonl`,
  bytes: new Uint8Array([1]),
}
const contract = {
  id: FINITE_ACP_CONTRACT_ID,
  version: FINITE_ACP_CONTRACT_VERSION,
  digest: FINITE_ACP_CONTRACT_DIGEST,
}
let mode = 'normal'
let events: string[] = []
let row: any
let saved: { scope: string; reference: string; lifetime?: 'run' } | undefined
let scope: string | undefined
let abort = new AbortController()
let provider = { client: 'openai-codex', digest: digest(4) }
const runtime = { environment: {}, configuration: [], readOnlyMounts: [] }
const step = (name: string) => {
  events.push(name)
}
const allocationOwner = { parent: '/protected/owners', name: '' }
const fence = { stopReason: 'payload_exit', exitCode: 0, signal: null }
const target = (input: any) => ({
  request: {
    digest: input.parentFlow?.requestDigest ?? input.parent.intent.requestDigest,
    slots: {
      [input.call.slot]: {
        kind: 'native',
        native: 'finite-acp',
        grant: { kind: 'acp', client: 'codex', retainSessions: true },
        contract,
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
const backend = {
  observeMechanism: async () => ({ support: { digest: digest(8) } }),
  async seal(_plan: unknown, owner: any) {
    step('seal')
    if (mode === 'startup') throw new Error('startup failed')
    return {
      identity: owner,
      async admit() {
        step('admit')
        return {
          outputDirectory: {
            async close() {
              step('descriptor-close')
              if (mode === 'descriptor') throw new Error('descriptor failed')
            },
          },
        }
      },
    }
  },
  async recoverFence() {
    step('recover-fence')
    return fence
  },
}
mock.module('../../src/internal/acp-agent-provider.js', () => ({
  ...acp,
  requirePrivateAcpAgentProvider: (value: unknown) => value,
  privateAcpAgentRuntime: () => runtime,
  revalidatePrivateAcpAgentProvider: async () => {},
}))
mock.module('../../src/internal/direct-run.js', () => ({
  ...direct,
  planPrivateDirectRun: async () => ({
    digest: digest(6),
    observation: { digest: digest(7) },
    mechanismDigest: digest(8),
    acp: { native: provider, different: provider },
    backend,
    installedSupport: { runtimeMounts: [] },
    bunPolicy: [],
    wallClockCeilingMs: 60_000,
    resourceCeilings: {},
  }),
}))
mock.module('../../src/internal/installed-bun-support.js', () => ({
  ...installed,
  revalidatePrivateInstalledBunSupport: async () => {},
}))
mock.module('../../src/internal/invocation-context.js', () => ({
  ...context,
  requireParentTarget: target,
  requireParentFlowOwner: async () => {},
  protectedOwnerRoot: async () => '/protected/owners',
}))
mock.module('../../src/internal/linux-rootless-backend.js', () => ({
  ...linux,
  planPrivateLinuxOwnerStateAllocation: async (value: any) => ({ ...allocationOwner, ...value }),
  normalizePrivateLinuxOwnerStateAllocationIdentity: (value: unknown) => value,
  normalizePrivateLinuxSealedOwnerIdentity: (value: unknown) => value,
  normalizePrivateLinuxConfirmedEnforcementReceipt: (value: unknown) => value,
  normalizePrivateLinuxOwnerStateReleaseReceipt: (value: unknown) => value,
  cancelPrivateLinuxOwnerStateAllocation: async () => {
    step('cancel-unused')
    return fence
  },
  releasePrivateLinuxOwnerState: async () => {
    step('release')
    if (mode === 'cleanup' || mode === 'native-session-cleanup') throw new Error('cleanup failed')
    return { digest: digest(9) }
  },
}))
mock.module('../../src/internal/activation-admission-store.js', () => ({
  ...store,
  listPrivateRootChildOwners: async () => (row ? [row] : []),
  allocatePrivateRootChildOwner: async (value: any) => {
    step('allocate')
    row = { ...value, allocation: { value: value.allocation, digest: digest(1) } }
    return row
  },
  recordPrivateRootChildSandbox: async (value: any) =>
    (row = { ...row, sandbox: { value: value.sandbox, digest: digest(2) } }),
  recordPrivateRootChildFence: async (value: any) => {
    step('fence')
    return (row = { ...row, fence: { value: value.fence, digest: digest(3) } })
  },
  recordPrivateRootChildCleanup: async (value: any) => {
    step('cleanup')
    return (row = { ...row, cleanup: { value: value.cleanup, digest: digest(5) } })
  },
  closePrivateRootChildOwner: async () => {
    step('owner-close')
    row = undefined
  },
  claimPrivateNativeSession: async (value: any) => {
    step('claim')
    if (saved?.scope !== value.scopeDigest || saved?.reference !== value.reference) return undefined
    const lifetime = saved.lifetime ?? 'project'
    saved = undefined
    return { ...state, lifetime }
  },
  savePrivateNativeSession: async (value: any) => {
    step('save')
    if (mode === 'storage') throw new Error('storage failed')
    if (mode === 'capacity') return undefined
    scope = value.scopeDigest
    saved = {
      scope: value.scopeDigest,
      reference: crypto.randomUUID(),
      ...(value.lifetime === undefined ? {} : { lifetime: value.lifetime }),
    }
    if (mode === 'receipt-loss') abort.abort()
    return { reference: saved.reference }
  },
}))
mock.module('../../src/internal/codex-session-state.js', () => ({
  ...history,
  validatePrivateCodexSession: () => {},
  collectPrivateCodexSession: () => {
    step('collect')
    if (mode === 'invalid-history')
      throw new history.PrivateNativeHistoryUnavailable('unsupported-history')
    if (mode === 'missing-history')
      throw new history.PrivateNativeHistoryUnavailable('missing-history')
    if (mode === 'collection-bug') throw new Error('collector bug')
    return state
  },
}))
mock.module('../../src/internal/finite-acp-resource.js', () => ({
  ...resource,
  runPrivateFiniteAcpResource: async () => {
    step('dispatch')
    if (mode === 'native-failure') throw new Error('native failure')
    if (mode === 'native-session-cancel') abort.abort()
    if (
      ['native-session-failure', 'native-session-cancel', 'native-session-cleanup'].includes(mode)
    )
      throw new PrivateFiniteAcpPolicyError('/private/secret-token', 'native-session')
    if (mode === 'native-protocol-failure')
      throw new PrivateFiniteAcpPolicyError('/private/secret-token')
    if (mode === 'unclassified-failure')
      throw Object.assign(new Error('/private/secret-token'), {
        name: 'PrivateFiniteAcpPolicyError',
        reason: 'native-session',
      })
    if (mode === 'cancel') abort.abort()
    return {
      fence: mode === 'controlled' ? { ...fence, stopReason: 'cancelled' } : fence,
      closed: mode === 'controlled',
      sessionId: reference,
    }
  },
}))
const { executePrivateRootFiniteAcp } = await import(
  '../../src/internal/root-finite-acp-controller.js'
)
function input(session: unknown = { retain: true }): any {
  return {
    projectRoot: '/project',
    packageStoreRoot: '/packages',
    coordinator: {},
    installedSupport: {},
    backend,
    provider,
    parentDeadlineUnixMs: Date.now() + 60_000,
    signal: abort.signal,
    parent: {
      run: { runId: digest(1), coordinatorEpoch: 1, target: { kind: 'binding', id: 'root' } },
      intent: { requestDigest: digest(2), deadlineUnixMs: Date.now() + 60_000 },
    },
    parentFlow: {
      operationId: 'agent',
      target: { kind: 'binding', id: 'agent' },
      requestDigest: digest(3),
      parent: {
        operationId: 'worker',
        target: { kind: 'binding', id: 'worker' },
        requestDigest: digest(5),
        parent: null,
      },
    },
    call: { operationId: 'native', slot: 'native', input: { session } },
    channels: {
      caller: {
        transfer: () => ({
          requests: { endpoint: 'requests' },
          responses: { endpoint: 'responses' },
        }),
      },
      broker: { participant: () => ({ finalize: () => {}, abort: () => {} }) },
    },
  }
}
function reset(value = 'normal') {
  mode = value
  events = []
  row = undefined
  abort = new AbortController()
}
function before(a: string, b: string) {
  assert.ok(
    events.indexOf(a) >= 0 && events.indexOf(a) < events.indexOf(b),
    `${a} before ${b}: ${events}`,
  )
}
const run = async (value = input()) => await executePrivateRootFiniteAcp(value)
for (const [failure, explanation] of [
  ['native-session-failure', 'native client reported a session failure'],
  ['native-protocol-failure', 'exchange violated its validated protocol'],
  ['unclassified-failure', 'no result was proved.'],
]) {
  reset(failure)
  const result: any = await run()
  assert.equal(result.code, 'UNCERTAIN')
  assert.ok(result.message.includes(explanation))
  if (failure === 'unclassified-failure')
    assert.equal(result.message, 'Finite ACP dispatch may have occurred but no result was proved.')
  assert.ok(!JSON.stringify(result).match(/private\/|secret-token/))
  assert.equal(row, undefined)
  assert.ok(events.includes('owner-close'))
}
reset('native-session-cancel')
assert.equal(((await run()) as any).code, 'CANCELLED')
reset('native-session-cleanup')
await assert.rejects(() => run())
reset()
assert.equal((await run()).status, 'succeeded')
for (const [a, b] of [
  ['dispatch', 'collect'],
  ['collect', 'fence'],
  ['cleanup', 'owner-close'],
  ['owner-close', 'descriptor-close'],
  ['descriptor-close', 'save'],
])
  before(a!, b!)
const originalScope = scope!
reset()
assert.equal((await run(input({ retain: true, lifetime: 'run' }))).status, 'succeeded')
assert.equal(saved?.lifetime, 'run')
const temporary = saved!.reference
reset()
assert.equal((await run(input({ restore: temporary }))).status, 'succeeded')
assert.equal(saved?.lifetime, 'run', 'restoration cannot widen the retained lifetime')
before('descriptor-close', 'save')
for (const [failure, reason] of [
  ['controlled', 'not-cleanly-closed'],
  ['invalid-history', 'unsupported-history'],
  ['missing-history', 'missing-history'],
  ['capacity', 'capacity'],
]) {
  reset(failure)
  const result: any = await run()
  assert.deepEqual(result.result.output.session, { status: 'unavailable', reason })
  assert.ok(events.includes('owner-close'))
  assert.equal(events.includes('save'), failure === 'capacity')
}
for (const failure of [
  'startup',
  'native-failure',
  'collection-bug',
  'cancel',
  'cleanup',
  'descriptor',
  'storage',
  'receipt-loss',
]) {
  reset(failure)
  saved = { scope: originalScope, reference }
  let result: any, error: any
  try {
    result = await run(input({ restore: reference }))
  } catch (caught) {
    error = caught
  }
  assert.ok(error || result?.status === 'failed', failure)
  before('claim', 'seal')
  assert.equal(saved !== undefined, failure === 'receipt-loss', failure)
  if (['cleanup', 'descriptor'].includes(failure))
    assert.ok(error, 'cleanup failures must be fatal')
  if (failure !== 'storage' && failure !== 'receipt-loss') assert.ok(!events.includes('save'))
  if (failure !== 'cleanup') assert.equal(row, undefined, `owned work settled: ${failure}`)
  reset()
  assert.equal((await run(input({ restore: reference }))).status, 'failed')
  assert.ok(!events.includes('dispatch'))
}
// Use the controller's real scope construction: only irrelevant Run/operation
// identity or prompt data may change. Accepted recipient/configuration changes
// must reject before startup, without consuming another recipient's reference.
for (const change of [
  (v: any) => {
    v.parent.run.target.id = 'other'
  },
  (v: any) => {
    v.parent.intent.requestDigest = digest(7)
  },
  (v: any) => {
    v.parentFlow.target.id = 'other'
  },
  (v: any) => {
    v.parentFlow.requestDigest = digest(7)
  },
  (v: any) => {
    v.parentFlow.parent.target.id = 'other'
  },
  (v: any) => {
    v.parentFlow.parent.requestDigest = digest(7)
  },
  (v: any) => {
    v.call.slot = 'different'
  },
  (v: any) => {
    provider = v.provider = { ...provider, digest: digest(9) }
  },
]) {
  reset()
  saved = { scope: originalScope, reference }
  const value = input({ restore: reference })
  change(value)
  assert.equal((await run(value)).status, 'failed')
  assert.ok(!events.includes('seal'))
  assert.ok(saved)
  provider = { client: 'openai-codex', digest: digest(4) }
}
reset()
saved = { scope: originalScope, reference }
const fresh = input({ restore: reference })
fresh.parent.run.runId = digest(9)
fresh.call.operationId = 'new-operation'
fresh.parentFlow.operationId = 'new-agent-operation'
fresh.parentFlow.parent.operationId = 'new-worker-operation'
assert.equal((await run(fresh)).status, 'succeeded')
assert.equal(scope, originalScope)
console.log('controller fault and scope checks passed')
