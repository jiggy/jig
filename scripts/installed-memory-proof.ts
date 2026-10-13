import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'

type RecordValue = Record<string, unknown>
type MemoryProofStage =
  | 'run-request'
  | 'origin-intent'
  | 'allocation'
  | 'plan-backing'
  | 'prepared-owner'
  | 'enforcement-fence'
  | 'release'
  | 'terminal-record'
  | 'command-result'

export function selectFreshInstalledRun(
  beforeRunIds: readonly string[],
  rows: readonly RecordValue[],
): RecordValue {
  assert.ok(beforeRunIds.length <= 256 && rows.length <= 256)
  assert.equal(new Set(beforeRunIds).size, beforeRunIds.length)
  const afterRunIds = rows.map((row) => row.run_id)
  for (const runId of [...beforeRunIds, ...afterRunIds]) digest(runId)
  assert.equal(new Set(afterRunIds).size, afterRunIds.length)
  assert.deepEqual(
    afterRunIds.filter((runId) => beforeRunIds.includes(runId as string)).sort(),
    [...beforeRunIds].sort(),
    'memory probe cannot remove or substitute earlier Runs',
  )
  const fresh = rows.filter((row) => !beforeRunIds.includes(row.run_id as string))
  assert.equal(fresh.length, 1, 'memory probe must create exactly one fresh Run')
  return fresh[0]!
}

/** Host-side proof of one fresh installed Run; never an input to its consumer. */
export function checkInstalledMemoryProof(
  input: Parameters<typeof validateMemoryProof>[0],
): RecordValue {
  let stage: MemoryProofStage = 'run-request'
  try {
    return validateMemoryProof(input, (next) => {
      stage = next
    })
  } catch {
    // Only literal stages cross this boundary; private values and causes stay private.
    throw new Error(
      `Installed memory enforcement proof rejected at ${stage}; inspect the retained private fixture`,
    )
  }
}

function validateMemoryProof(
  input: {
    readonly row: RecordValue
    readonly beforeRunIds: readonly string[]
    readonly project: { readonly path: string; readonly device: string; readonly inode: string }
    readonly command: {
      readonly exitCode: number
      readonly stdout: string
      readonly stderr: string
    }
  },
  setStage: (stage: MemoryProofStage) => void,
): RecordValue {
  const { row, project, command } = input
  digest(row.run_id)
  assert.equal(input.beforeRunIds.includes(row.run_id as string), false, 'memory Run is stale')
  positive(row.coordinator_epoch)
  positive(row.candidate_revision)
  digest(row.admission_digest)

  const request = bytes(row.request_bytes)
  exact(request, ['kind', 'target', 'input', 'files', 'deadlineUnixMs'])
  assert.equal(request.kind, 'private-root-run-request/1')
  assert.deepEqual(request.target, { kind: 'flow', path: 'flows/memory-pressure' })
  assert.deepEqual(request.input, {})
  assert.deepEqual(request.files, { attachments: [], output: null })
  positive(request.deadlineUnixMs)
  setStage('origin-intent')
  const origin = fact(
    row.origin_bytes,
    row.origin_digest,
    'JIG-Private-Root-Origin-External-Submission/1',
    (value) => ({ submissionId: value.submissionId }),
  )
  exact(origin, ['kind', 'submissionId'])
  assert.equal(origin.kind, 'private-root-external-submission-origin/1')
  assert.ok(typeof origin.submissionId === 'string' && origin.submissionId.length > 0)
  assert.equal(
    row.run_id,
    domain('JIG-Private-Root-Run/2', {
      project: { device: project.device, inode: project.inode },
      originDigest: row.origin_digest,
      requestDigest: domain('JIG-Private-Root-Request/1', request),
      coordinatorEpoch: row.coordinator_epoch,
    }),
  )

  const intent = fact(row.intent_bytes, row.intent_digest, 'JIG-Private-Root-Spawn-Intent/1')
  exact(intent, [
    'kind',
    'runId',
    'admissionDigest',
    'candidateRevision',
    'coordinatorEpoch',
    'requestDigest',
    'recipeDigest',
    'observationDigest',
    'deadlineUnixMs',
  ])
  assert.equal(intent.kind, 'private-root-spawn-intent/1')
  for (const [key, column] of [
    ['runId', 'run_id'],
    ['admissionDigest', 'admission_digest'],
    ['candidateRevision', 'candidate_revision'],
    ['coordinatorEpoch', 'coordinator_epoch'],
  ] as const)
    assert.equal(intent[key], row[column])
  assert.equal(intent.requestDigest, domain('JIG-Private-Root-Request/1', request))
  assert.equal(intent.deadlineUnixMs, request.deadlineUnixMs)

  setStage('allocation')
  const allocation = fact(
    row.allocation_bytes,
    row.allocation_digest,
    'JIG-Private-Root-Execution-Allocation/1',
  )
  exact(allocation, ['kind', 'runId', 'spawnIntentDigest', 'coordinatorEpoch', 'value'])
  assert.equal(allocation.kind, 'private-root-execution-allocation/1')
  assert.equal(allocation.runId, row.run_id)
  assert.equal(allocation.spawnIntentDigest, row.intent_digest)
  assert.equal(allocation.coordinatorEpoch, row.coordinator_epoch)
  assert.equal(allocation.value, null)
  const checkpoints: Record<string, RecordValue> = {}
  for (const name of [
    'plan',
    'backing',
    'sandbox',
    'prepared',
    'provisional',
    'fence',
    'release',
    'admitted',
  ]) {
    const envelope = fact(
      row[`${name}_bytes`],
      row[`${name}_digest`],
      `JIG-Private-Root-Execution-${name[0]!.toUpperCase()}${name.slice(1)}/1`,
    )
    exact(envelope, ['kind', 'runId', 'allocationDigest', 'value'])
    assert.equal(envelope.kind, `private-root-execution-${name}/1`)
    assert.equal(envelope.runId, row.run_id)
    assert.equal(envelope.allocationDigest, row.allocation_digest)
    checkpoints[name] = record(envelope.value)
  }
  setStage('plan-backing')
  const plan = checkpoints.plan!
  exact(plan, [
    'kind',
    'requestDigest',
    'recipeDigest',
    'observationDigest',
    'activationStartedUnixMs',
    'effectiveDeadlineUnixMs',
    'cancellationGraceMs',
    'packageAllocation',
    'ownerAllocation',
  ])
  assert.equal(plan.kind, 'private-direct-root-plan/1')
  assert.equal(plan.requestDigest, intent.requestDigest)
  assert.equal(plan.recipeDigest, intent.recipeDigest)
  assert.equal(plan.observationDigest, intent.observationDigest)
  positive(plan.activationStartedUnixMs)
  positive(plan.effectiveDeadlineUnixMs)
  assert.ok((plan.effectiveDeadlineUnixMs as number) <= (request.deadlineUnixMs as number))
  assert.equal(plan.cancellationGraceMs, 1_000)
  const packageAllocation = record(plan.packageAllocation)
  exact(packageAllocation, [
    'kind',
    'parent',
    'name',
    'path',
    'packageDigest',
    'ownerToken',
    ...(Object.hasOwn(packageAllocation, 'aliases') ? ['aliases'] : []),
  ])
  assert.equal(packageAllocation.kind, 'private-package-materialization-allocation/1')
  assert.equal(packageAllocation.ownerToken, row.allocation_digest)
  const packageParent = record(packageAllocation.parent)
  exact(packageParent, ['path', 'dev', 'ino'])
  assert.equal(packageParent.path, `${project.path}/.jig/private-root-materializations`)
  assert.equal(packageParent.dev, project.device)
  assert.match(packageParent.ino as string, /^[1-9][0-9]*$/)
  assert.equal(packageAllocation.name, `root-${(row.run_id as string).slice(7)}`)
  assert.equal(packageAllocation.path, `${packageParent.path}/${packageAllocation.name}`)
  digest(packageAllocation.packageDigest)
  exact(checkpoints.backing!, ['kind', 'lease'])
  assert.equal(checkpoints.backing!.kind, 'private-direct-root-backing/1')
  const lease = record(checkpoints.backing!.lease)
  assert.equal(lease.kind, 'private-package-materialization-lease/1')
  assert.ok(
    canonical(lease.allocation) === canonical(packageAllocation),
    'backing belongs to a different package allocation',
  )
  setStage('prepared-owner')
  const sandbox = checkpoints.sandbox!
  exact(sandbox, ['kind', 'owner'])
  assert.equal(sandbox.kind, 'private-direct-root-sandbox/1')
  const owner = record(sandbox.owner)
  exact(owner, [
    'bootId',
    'cancellationGraceMs',
    'cleanupTimeoutMs',
    'deadlineUnixMs',
    'delegatedCgroup',
    'delegatedCgroupDevice',
    'delegatedCgroupInode',
    'digest',
    'kind',
    'mechanismDigest',
    'nonce',
    'ownerStateAllocationDigest',
    'ownerStateDevice',
    'ownerStateDirectory',
    'ownerStateInode',
    'ownerStateName',
    'ownerStateParent',
    'ownerStateParentDevice',
    'ownerStateParentInode',
    'ownerToken',
    'runCgroup',
    'runId',
    'sealedPlanDigest',
  ])
  assert.equal(owner.kind, 'private-linux-sealed-owner/1')
  const { digest: ownerDigest, ...ownerFields } = owner
  assert.equal(ownerDigest, domain('JIG-Rootless-Linux-Sealed-Owner/1', ownerFields))
  assert.equal(owner.runId, `root-${(row.run_id as string).slice(7, 50)}`)
  assert.ok(
    typeof owner.delegatedCgroup === 'string' &&
      owner.delegatedCgroup.startsWith('/sys/fs/cgroup/') &&
      posix.normalize(owner.delegatedCgroup) === owner.delegatedCgroup,
  )
  assert.ok(typeof owner.nonce === 'string' && /^[0-9a-f]{24}$/.test(owner.nonce))
  assert.equal(owner.runCgroup, `${owner.delegatedCgroup}/jig-run-${owner.runId}-${owner.nonce}`)
  assert.equal(owner.deadlineUnixMs, plan.effectiveDeadlineUnixMs)
  assert.equal(owner.cancellationGraceMs, plan.cancellationGraceMs)
  assert.equal(owner.cleanupTimeoutMs, 5_000)
  const ownerAllocation = record(plan.ownerAllocation)
  exact(ownerAllocation, [
    'kind',
    'digest',
    'parent',
    'parentDevice',
    'parentInode',
    'name',
    'directory',
    'ownerToken',
  ])
  assert.equal(ownerAllocation.kind, 'private-linux-owner-state-allocation/1')
  const { digest: ownerAllocationDigest, ...ownerAllocationFields } = ownerAllocation
  assert.equal(
    ownerAllocationDigest,
    domain('JIG-Rootless-Linux-Owner-Allocation/1', ownerAllocationFields),
  )
  assert.equal(owner.ownerStateAllocationDigest, ownerAllocationDigest)
  assert.ok(
    typeof ownerAllocation.ownerToken === 'string' &&
      /^[0-9a-f]{64}$/.test(ownerAllocation.ownerToken),
    'invalid private owner token',
  )
  assert.equal(ownerAllocation.parent, `${project.path}/.jig/private-root-owners`)
  assert.equal(ownerAllocation.parentDevice, project.device)
  assert.equal(ownerAllocation.name, `r-${(row.run_id as string).slice(7, 69)}`)
  assert.equal(ownerAllocation.directory, `${ownerAllocation.parent}/${ownerAllocation.name}`)
  for (const [field, allocated] of [
    ['ownerToken', 'ownerToken'],
    ['ownerStateParent', 'parent'],
    ['ownerStateParentDevice', 'parentDevice'],
    ['ownerStateParentInode', 'parentInode'],
    ['ownerStateName', 'name'],
    ['ownerStateDirectory', 'directory'],
  ] as const)
    assert.ok(
      owner[field] === ownerAllocation[allocated],
      'sealed owner differs from this Run allocation',
    )
  const prepared = checkpoints.prepared!
  exact(prepared, ['kind', 'prepared'])
  assert.equal(prepared.kind, 'private-direct-root-prepared/1')
  const preparedOwner = record(prepared.prepared)
  exact(preparedOwner, ['kind', 'digest', 'owner'])
  assert.equal(preparedOwner.kind, 'private-linux-prepared-owner/1')
  assert.ok(
    canonical(preparedOwner.owner) === canonical(owner),
    'prepared owner differs from sealed owner',
  )
  assert.equal(preparedOwner.digest, domain('JIG-Rootless-Linux-Prepared-Owner/1', owner))

  setStage('enforcement-fence')
  const fence = checkpoints.fence!
  exact(fence, ['kind', 'receipt'])
  assert.equal(fence.kind, 'private-direct-root-fence/1')
  const receipt = record(fence.receipt)
  exact(receipt, ['kind', 'ownerDigest', 'stopReason', 'exitCode', 'signal', 'fenced', 'evidence'])
  assert.equal(receipt.kind, 'private-linux-confirmed-enforcement/1')
  assert.equal(receipt.ownerDigest, preparedOwner.digest)
  assert.equal(receipt.fenced, true)
  assert.equal(receipt.stopReason, 'payload_exit')
  const evidence = record(receipt.evidence)
  exact(evidence, ['cpuStat', 'memoryEvents', 'pidsEvents'])
  for (const values of Object.values(evidence)) {
    for (const [key, value] of Object.entries(record(values))) {
      assert.match(key, /^[a-z][a-z0-9_.-]*$/)
      assert.ok(Number.isSafeInteger(value) && (value as number) >= 0)
    }
  }
  const memory = record(evidence.memoryEvents)
  for (const key of ['max', 'oom', 'oom_kill']) positive(memory[key])

  setStage('release')
  const release = checkpoints.release!
  exact(release, [
    'kind',
    'planDigest',
    'backingDigest',
    'fenceDigest',
    'packageReleased',
    'ownerRelease',
  ])
  assert.equal(release.kind, 'private-direct-root-release/1')
  for (const name of ['plan', 'backing', 'fence'])
    assert.equal(release[`${name}Digest`], row[`${name}_digest`])
  assert.equal(release.packageReleased, true)
  const ownerRelease = record(release.ownerRelease)
  exact(ownerRelease, [
    'kind',
    'digest',
    'allocationDigest',
    'directoryDevice',
    'directoryInode',
    'released',
  ])
  const { digest: releaseDigest, ...releaseFields } = ownerRelease
  assert.equal(releaseDigest, domain('JIG-Rootless-Linux-Owner-Release/1', releaseFields))
  assert.equal(ownerRelease.kind, 'private-linux-owner-state-release/1')
  assert.equal(ownerRelease.allocationDigest, owner.ownerStateAllocationDigest)
  assert.equal(ownerRelease.directoryDevice, owner.ownerStateDevice)
  assert.equal(ownerRelease.directoryInode, owner.ownerStateInode)
  assert.equal(ownerRelease.released, true)
  setStage('terminal-record')
  const terminal = fact(row.terminal_bytes, row.terminal_digest, 'JIG-Private-Root-Terminal/1')
  assert.deepEqual(checkpoints.provisional, terminal)
  assert.deepEqual(checkpoints.admitted, terminal)
  const diagnostics = { stderr: '', stderrBytes: 0, stderrTruncated: false }
  assert.deepEqual(terminal.diagnostics, diagnostics)
  const publicTerminal =
    terminal.status === 'succeeded'
      ? { status: 'succeeded', ...record(terminal.result), diagnostics }
      : terminal
  setStage('command-result')
  assert.deepEqual(JSON.parse(command.stdout), publicTerminal)
  let terminalShape: 'parent-succeeded' | 'parent-sigkill'
  if (terminal.status === 'succeeded') {
    exact(terminal, ['status', 'result', 'diagnostics'])
    const result = record(terminal.result)
    exact(result, ['outcome', 'output'])
    assert.equal(result.outcome, 'done')
    const output = record(result.output)
    exact(output, ['exitCode'])
    positive(output.exitCode)
    assert.equal(receipt.exitCode, 0)
    assert.equal(receipt.signal, null)
    assert.equal(command.exitCode, 0)
    assert.equal(command.stderr, '')
    terminalShape = 'parent-succeeded'
  } else {
    assert.deepEqual(terminal, {
      status: 'failed',
      code: 'EXECUTION_FAILED',
      message: 'component exited with code null and signal SIGKILL',
      diagnostics,
    })
    assert.equal(receipt.exitCode, null)
    assert.equal(receipt.signal, 'SIGKILL')
    assert.equal(command.exitCode, 1)
    const message =
      'The Flow could not complete execution.\n\nReported cause:\n  ' +
      '"component exited with code null and signal SIGKILL"\n\n' +
      'Inspect any effects before starting new work. See https://jig.md/guide/results.'
    assert.equal(
      command.stderr,
      'Run failed\n\n' +
        message
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n') +
        '\n\n  Diagnostic code: EXECUTION_FAILED\n',
    )
    terminalShape = 'parent-sigkill'
  }
  return {
    runId: row.run_id,
    terminalShape,
    fenceDigest: row.fence_digest,
    ownerDigest: receipt.ownerDigest,
    memoryEvents: memory,
    fenced: true,
    released: true,
  }
}

function fact(
  value: unknown,
  expectedDigest: unknown,
  identityDomain: string,
  projection: (value: RecordValue) => unknown = (value) => value,
): RecordValue {
  digest(expectedDigest)
  const parsed = bytes(value)
  assert.equal(domain(identityDomain, projection(parsed)), expectedDigest)
  return parsed
}

function bytes(value: unknown): RecordValue {
  assert.ok(value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= 16_777_216)
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value)
  const parsed = record(JSON.parse(text))
  assert.ok(canonical(parsed) === text, 'durable proof bytes must be canonical JSON')
  return parsed
}

function canonical(value: unknown, depth = 0): string {
  assert.ok(depth <= 128)
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value)
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`
  const object = record(value)
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key], depth + 1)}`)
    .join(',')}}`
}

function domain(name: string, value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(name, 'ascii')
    .update('\0', 'ascii')
    .update(canonical(value), 'utf8')
    .digest('hex')}`
}

function record(value: unknown): RecordValue {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value))
  return value as RecordValue
}

function exact(value: RecordValue, keys: readonly string[]): void {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort())
}

function digest(value: unknown): void {
  assert.ok(typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value))
}

function positive(value: unknown): void {
  assert.ok(Number.isSafeInteger(value) && (value as number) > 0)
}
