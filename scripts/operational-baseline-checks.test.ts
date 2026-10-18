import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkInstalledMemoryProof, selectFreshInstalledRun } from './installed-memory-proof.js'
import { checkInvalidRunTarget, finishOperationalBaseline } from './operational-baseline-checks.js'

test('invalid target assertion requires every current selector and the closed diagnostic', () => {
  const stderr =
    'Error: Run target is invalid\n\n  use flow:<path>, npm:<package> or binding:<id>, for example flow:flows/hello.\n\n  Diagnostic code: JIG_RUN_TARGET_INVALID\n'
  expect(() => checkInvalidRunTarget({ stdout: '', stderr })).not.toThrow()
  for (const changed of [
    stderr.replace(', npm:<package>', ''),
    stderr.replace('binding:<id>', ''),
    stderr.replace('JIG_RUN_TARGET_INVALID', 'INTERNAL'),
  ]) {
    expect(() => checkInvalidRunTarget({ stdout: '', stderr: changed })).toThrow()
  }
  expect(() => checkInvalidRunTarget({ stdout: 'unexpected', stderr })).toThrow()
})

for (const [mainFailed, residueFailed] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
] as const) {
  test(`baseline teardown: main failure=${mainFailed}, residue failure=${residueFailed}`, async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'jig-baseline-check-'))
    const evidence = join(temporary, 'evidence.json')
    await writeFile(evidence, 'original evidence')
    const original = new Error('original assertion')
    const residue = new Error('owned work remains')
    let checked = false
    let removed = false
    try {
      let failure: AggregateError | undefined
      try {
        await finishOperationalBaseline({
          failures: mainFailed ? [original] : [],
          temporary,
          checkResidue: async () => {
            checked = true
            if (residueFailed) throw residue
          },
          removeFixture: async () => {
            removed = true
            await rm(temporary, { recursive: true })
          },
        })
      } catch (error) {
        failure = error as AggregateError
      }
      expect(checked).toBe(true)
      expect(removed).toBe(!mainFailed && !residueFailed)
      if (mainFailed || residueFailed) {
        expect(failure).toBeInstanceOf(AggregateError)
        expect(failure!.message).toContain(temporary)
        expect(failure!.errors).toEqual([
          ...(mainFailed ? [original] : []),
          ...(residueFailed ? [residue] : []),
        ])
        expect(await readFile(evidence, 'utf8')).toBe('original evidence')
      } else {
        expect(failure).toBeUndefined()
        expect(await Bun.file(evidence).exists()).toBe(false)
      }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })
}

test('fixture removal failure is reported, never converted into success', async () => {
  const removal = new Error('removal failed')
  try {
    await finishOperationalBaseline({
      failures: [],
      temporary: '/fixture',
      checkResidue: async () => {},
      removeFixture: async () => {
        throw removal
      },
    })
    throw new Error('expected failure')
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([removal])
    expect((error as Error).message).toContain('possibly partial')
  }
})

type MemoryRecord = Record<string, unknown>

// Inert validator inputs only. These bytes establish no native owner, OOM, fence
// or release evidence and are never installed in a database or passed to a host.
function memoryProofFixture(victim: 'descendant' | 'root') {
  const project = { path: '/fixture/project', device: '42', inode: '99' }
  const row: MemoryRecord = {
    candidate_revision: 1,
    coordinator_epoch: 1,
    admission_digest: memoryDigest('admission', {}),
  }
  const store = (column: string, value: MemoryRecord, identityDomain?: string) => {
    row[`${column}_bytes`] = Buffer.from(memoryCanonical(value))
    if (identityDomain) row[`${column}_digest`] = memoryDigest(identityDomain, value)
  }
  const origin = {
    kind: 'private-root-external-submission-origin/1',
    submissionId: 'memory-fixture',
  }
  store('origin', origin)
  row.origin_digest = memoryDigest('JIG-Private-Root-Origin-External-Submission/1', {
    submissionId: origin.submissionId,
  })
  const request = {
    kind: 'private-root-run-request/1',
    target: { kind: 'flow', path: 'flows/memory-pressure' },
    input: {},
    files: { attachments: [], output: false },
    deadlineUnixMs: 20_000,
  }
  store('request', request)
  const requestDigest = memoryDigest('JIG-Private-Root-Request/1', request)
  row.run_id = memoryDigest('JIG-Private-Root-Run/2', {
    project: { device: project.device, inode: project.inode },
    originDigest: row.origin_digest,
    requestDigest,
    coordinatorEpoch: 1,
  })
  const hex = (row.run_id as string).slice(7)
  // The activated target describes executable package meaning; it is not the
  // root invocation's input/files/deadline request and uses a different domain.
  const activationFields = {
    kind: 'activation-request/4',
    target: request.target,
    mode: 'run',
    packagePath: 'flows/memory-pressure',
    package: { kind: 'flow-package/0', digest: memoryDigest('source-package', {}) },
    entrypoint: { path: 'FLOW.ts', suffix: 'ts' },
    settings: {},
    slots: {},
    attachments: {},
  }
  const activationRequest = {
    ...activationFields,
    digest: memoryDigest('JIG-Activation-Request/4', activationFields),
  }
  const candidate = {
    kind: 'private-activation-candidate/5',
    projectRoot: { device: project.device, inode: project.inode },
    captureDigest: memoryDigest('capture', {}),
    observedSemanticDigest: memoryDigest('observed', {}),
    activationMeaningDigest: memoryDigest('meaning', {}),
    resolutionInputDigest: memoryDigest('resolution', {}),
    planningObservationDigest: memoryDigest('planning', {}),
    lockDigest: memoryDigest('lock', {}),
    declarationArtifact: {
      kind: 'author-closure/1',
      closureDigest: memoryDigest('closure', {}),
      package: { kind: 'flow-package/0', digest: memoryDigest('declaration-package', {}) },
    },
    targets: [
      {
        request: activationRequest,
        disposition: {
          state: 'ready',
          recipeDigest: memoryDigest('recipe', {}),
          observationDigest: memoryDigest('observation', {}),
          execution: {
            package: { kind: 'flow-package/0', digest: memoryDigest('package', {}) },
            layout: { flowRoot: '', members: [], aliases: [] },
          },
        },
      },
    ],
  }
  row.candidate_bytes = Buffer.from(`${memoryCanonical(candidate)}\n`)
  row.candidate_digest = memoryDigest('JIG-Private-Activation-Candidate/5', candidate)
  const admission = {
    kind: 'private-activation-admission/2',
    baseGeneration: null,
    planDigest: memoryDigest('admission-plan', {}),
    candidateRevision: 1,
    candidateDigest: row.candidate_digest,
    lockDigest: candidate.lockDigest,
  }
  row.admission_bytes = Buffer.from(`${memoryCanonical(admission)}\n`)
  row.admission_digest = memoryDigest('JIG-Private-Activation-Admission/2', admission)
  const intent = {
    kind: 'private-root-spawn-intent/1',
    runId: row.run_id,
    admissionDigest: row.admission_digest,
    candidateRevision: 1,
    coordinatorEpoch: 1,
    requestDigest: activationRequest.digest,
    recipeDigest: memoryDigest('recipe', {}),
    observationDigest: memoryDigest('observation', {}),
    deadlineUnixMs: request.deadlineUnixMs,
  }
  store('intent', intent, 'JIG-Private-Root-Spawn-Intent/1')
  store(
    'allocation',
    {
      kind: 'private-root-execution-allocation/1',
      runId: row.run_id,
      spawnIntentDigest: row.intent_digest,
      coordinatorEpoch: 1,
      value: null,
    },
    'JIG-Private-Root-Execution-Allocation/1',
  )
  const packageAllocation = {
    kind: 'private-package-materialization-allocation/1',
    parent: { path: `${project.path}/.jig/private-root-materializations`, dev: '42', ino: '100' },
    name: `root-${hex}`,
    path: `${project.path}/.jig/private-root-materializations/root-${hex}`,
    packageDigest: memoryDigest('package', {}),
    ownerToken: row.allocation_digest,
  }
  const allocationFields = {
    kind: 'private-linux-owner-state-allocation/1',
    parent: `${project.path}/.jig/private-root-owners`,
    parentDevice: '42',
    parentInode: '101',
    name: `r-${hex.slice(0, 62)}`,
    directory: `${project.path}/.jig/private-root-owners/r-${hex.slice(0, 62)}`,
    ownerToken: 'a'.repeat(64),
  }
  const ownerAllocation = {
    ...allocationFields,
    digest: memoryDigest('JIG-Rootless-Linux-Owner-Allocation/1', allocationFields),
  }
  const ownerFields = {
    kind: 'private-linux-sealed-owner/1',
    runId: `root-${hex.slice(0, 43)}`,
    nonce: 'b'.repeat(24),
    ownerToken: ownerAllocation.ownerToken,
    mechanismDigest: memoryDigest('mechanism', {}),
    sealedPlanDigest: memoryDigest('sealed-plan', {}),
    bootId: '11111111-1111-1111-1111-111111111111',
    delegatedCgroup: '/sys/fs/cgroup/own/fixture',
    delegatedCgroupDevice: '52',
    delegatedCgroupInode: '102',
    runCgroup: `/sys/fs/cgroup/own/fixture/jig-run-root-${hex.slice(0, 43)}-${'b'.repeat(24)}`,
    deadlineUnixMs: 15_000,
    cancellationGraceMs: 1_000,
    cleanupTimeoutMs: 5_000,
    ownerStateParent: ownerAllocation.parent,
    ownerStateParentDevice: '42',
    ownerStateParentInode: '101',
    ownerStateName: ownerAllocation.name,
    ownerStateDirectory: ownerAllocation.directory,
    ownerStateDevice: '42',
    ownerStateInode: '103',
    ownerStateAllocationDigest: ownerAllocation.digest,
  }
  const owner = {
    ...ownerFields,
    digest: memoryDigest('JIG-Rootless-Linux-Sealed-Owner/1', ownerFields),
  }
  const prepared = {
    kind: 'private-linux-prepared-owner/1',
    owner,
    digest: memoryDigest('JIG-Rootless-Linux-Prepared-Owner/1', owner),
  }
  const checkpoint = (name: string, value: MemoryRecord) =>
    store(
      name,
      {
        kind: `private-root-execution-${name}/1`,
        runId: row.run_id,
        allocationDigest: row.allocation_digest,
        value,
      },
      `JIG-Private-Root-Execution-${name[0]!.toUpperCase()}${name.slice(1)}/1`,
    )
  checkpoint('plan', {
    kind: 'private-direct-root-plan/1',
    requestDigest: activationRequest.digest,
    recipeDigest: intent.recipeDigest,
    observationDigest: intent.observationDigest,
    activationStartedUnixMs: 10_000,
    effectiveDeadlineUnixMs: 15_000,
    activationStartedBoot: { bootId: owner.bootId, monotonicMs: 2_000 },
    effectiveBootDeadline: { bootId: owner.bootId, monotonicMs: 7_000 },
    cancellationGraceMs: 1_000,
    packageAllocation,
    ownerAllocation,
  })
  checkpoint('backing', {
    kind: 'private-direct-root-backing/1',
    lease: {
      kind: 'private-package-materialization-lease/1',
      allocation: packageAllocation,
      transaction: { path: packageAllocation.path, dev: '42', ino: '104' },
      package: { path: `${packageAllocation.path}/package`, dev: '42', ino: '105' },
    },
  })
  checkpoint('sandbox', { kind: 'private-direct-root-sandbox/1', owner })
  checkpoint('prepared', { kind: 'private-direct-root-prepared/1', prepared })
  checkpoint('fence', {
    kind: 'private-direct-root-fence/1',
    receipt: {
      kind: 'private-linux-confirmed-enforcement/1',
      ownerDigest: prepared.digest,
      stopReason: 'payload_exit',
      exitCode: victim === 'root' ? null : 0,
      signal: victim === 'root' ? 'SIGKILL' : null,
      fenced: true,
      evidence: {
        cpuStat: { usage_usec: 123 },
        memoryEvents: { low: 0, high: 0, max: 19, oom: 1, oom_kill: 1 },
        pidsEvents: { max: 0 },
      },
    },
  })
  const releaseFields = {
    kind: 'private-linux-owner-state-release/1',
    allocationDigest: ownerAllocation.digest,
    directoryDevice: '42',
    directoryInode: '103',
    released: true,
  }
  checkpoint('release', {
    kind: 'private-direct-root-release/1',
    planDigest: row.plan_digest,
    backingDigest: row.backing_digest,
    fenceDigest: row.fence_digest,
    packageReleased: true,
    ownerRelease: {
      ...releaseFields,
      digest: memoryDigest('JIG-Rootless-Linux-Owner-Release/1', releaseFields),
    },
  })
  const diagnostics = { stderr: '', stderrBytes: 0, stderrTruncated: false }
  const terminal =
    victim === 'root'
      ? {
          status: 'failed',
          code: 'EXECUTION_FAILED',
          message: 'component exited with code null and signal SIGKILL',
          diagnostics,
        }
      : {
          status: 'succeeded',
          result: { outcome: 'done', output: { exitCode: 137 } },
          diagnostics,
        }
  checkpoint('provisional', terminal)
  checkpoint('admitted', terminal)
  store('terminal', terminal, 'JIG-Private-Root-Terminal/1')
  const message =
    'The Flow could not complete execution.\n\nReported cause:\n  ' +
    '"component exited with code null and signal SIGKILL"\n\n' +
    'Inspect any effects before starting new work. See https://jig.md/guide/results.'
  const command = {
    exitCode: victim === 'root' ? 1 : 0,
    stdout: JSON.stringify(
      victim === 'root'
        ? terminal
        : { status: 'succeeded', outcome: 'done', output: { exitCode: 137 }, diagnostics },
    ),
    stderr:
      victim === 'root'
        ? 'Run failed\n\n' +
          message
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n') +
          '\n\n  Diagnostic code: EXECUTION_FAILED\n'
        : '',
  }
  return { row, project, beforeRunIds: [memoryDigest('previous', {})], command }
}

function memoryCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(memoryCanonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as MemoryRecord
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${memoryCanonical(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function memoryDigest(domain: string, value: unknown): string {
  return `sha256:${createHash('sha256').update(domain).update('\0').update(memoryCanonical(value)).digest('hex')}`
}

function memoryRecord(value: unknown): MemoryRecord {
  return value as MemoryRecord
}

function mutateMemoryCheckpoint(
  fixture: ReturnType<typeof memoryProofFixture>,
  name: string,
  change: (value: MemoryRecord) => void,
): void {
  const envelope = JSON.parse(
    Buffer.from(fixture.row[`${name}_bytes`] as Uint8Array).toString(),
  ) as MemoryRecord
  change(memoryRecord(envelope.value))
  fixture.row[`${name}_bytes`] = Buffer.from(memoryCanonical(envelope))
  fixture.row[`${name}_digest`] = memoryDigest(
    `JIG-Private-Root-Execution-${name[0]!.toUpperCase()}${name.slice(1)}/1`,
    envelope,
  )
}

for (const victim of ['descendant', 'root'] as const) {
  test(`memory exhaustion requires a fresh confirmed OOM fence with ${victim} terminal shape`, () => {
    const fixture = memoryProofFixture(victim)
    expect(checkInstalledMemoryProof(fixture)).toMatchObject({
      terminalShape: victim === 'root' ? 'parent-sigkill' : 'parent-succeeded',
      fenced: true,
      released: true,
      memoryEvents: { max: 19, oom: 1, oom_kill: 1 },
    })
    const previous = { run_id: fixture.beforeRunIds[0]! }
    expect(selectFreshInstalledRun(fixture.beforeRunIds, [previous, fixture.row])).toBe(fixture.row)
    for (const changed of [
      [],
      [previous],
      [fixture.row],
      [previous, fixture.row, fixture.row],
      [previous, fixture.row, { run_id: memoryDigest('extra', {}) }],
    ]) {
      expect(() => selectFreshInstalledRun(fixture.beforeRunIds, changed)).toThrow()
    }
    expect(() =>
      checkInstalledMemoryProof({
        ...fixture,
        beforeRunIds: [...fixture.beforeRunIds, fixture.row.run_id as string],
      }),
    ).toThrow()
  })
}

for (const victim of ['descendant', 'root'] as const) {
  for (const stage of [
    'command-json',
    'command-terminal',
    'parent-terminal',
    'parent-receipt',
    'command-exit',
    'command-stderr',
  ] as const) {
    test(`memory validator attributes ${victim} rejection to ${stage} without private causes`, () => {
      const fixture = memoryProofFixture(victim)
      const privateText = 'private-command-payload-must-not-escape'
      if (stage === 'command-json') fixture.command.stdout = privateText
      if (stage === 'command-terminal') {
        fixture.command.stdout = JSON.stringify({ privateText })
      }
      if (stage === 'parent-terminal') {
        const terminal = JSON.parse(
          Buffer.from(fixture.row.terminal_bytes as Uint8Array).toString(),
        ) as MemoryRecord
        if (victim === 'root') terminal.message = privateText
        else memoryRecord(terminal.result).outcome = privateText
        fixture.row.terminal_bytes = Buffer.from(memoryCanonical(terminal))
        fixture.row.terminal_digest = memoryDigest('JIG-Private-Root-Terminal/1', terminal)
        for (const name of ['provisional', 'admitted']) {
          mutateMemoryCheckpoint(fixture, name, (value) => {
            Object.assign(value, terminal)
          })
        }
        fixture.command.stdout = JSON.stringify(
          victim === 'root'
            ? terminal
            : {
                status: 'succeeded',
                ...memoryRecord(terminal.result),
                diagnostics: terminal.diagnostics,
              },
        )
      }
      if (stage === 'parent-receipt') {
        mutateMemoryCheckpoint(fixture, 'fence', (fence) => {
          memoryRecord(fence.receipt).signal = privateText
        })
        mutateMemoryCheckpoint(fixture, 'release', (release) => {
          release.fenceDigest = fixture.row.fence_digest
        })
      }
      if (stage === 'command-exit') fixture.command.exitCode = 2
      if (stage === 'command-stderr') fixture.command.stderr = privateText
      let rejection: unknown
      try {
        checkInstalledMemoryProof(fixture)
      } catch (error) {
        rejection = error
      }
      expect(rejection).toBeInstanceOf(Error)
      expect((rejection as Error).message).toBe(
        `Installed memory enforcement proof rejected at ${stage}; inspect the retained private fixture`,
      )
      expect((rejection as Error).cause).toBeUndefined()
      expect(Object.hasOwn(rejection!, 'actual')).toBe(false)
      expect(Object.hasOwn(rejection!, 'expected')).toBe(false)
      expect((rejection as Error).stack).not.toContain(privateText)
    })
  }
}

test('memory proof requires the current no-output request identity', () => {
  for (const output of [null, true, 'false']) {
    const fixture = memoryProofFixture('root')
    const request = JSON.parse(Buffer.from(fixture.row.request_bytes as Uint8Array).toString())
    expect(request.files).toEqual({ attachments: [], output: false })
    request.files.output = output
    fixture.row.request_bytes = Buffer.from(memoryCanonical(request))
    expect(() => checkInstalledMemoryProof(fixture)).toThrow(
      'Installed memory enforcement proof rejected at run-request',
    )
  }
})

for (const field of ['activationStartedBoot', 'effectiveBootDeadline']) {
  for (const value of [
    undefined,
    null,
    {},
    { bootId: '11111111-1111-1111-1111-111111111111', monotonicMs: -1 },
    { bootId: '11111111-1111-1111-1111-111111111111', monotonicMs: 0.5 },
    { bootId: '11111111-1111-1111-1111-111111111111', monotonicMs: '7000' },
    { bootId: '11111111-1111-1111-1111-111111111111', monotonicMs: Number.MAX_SAFE_INTEGER + 1 },
    { bootId: '11111111-1111-1111-1111-111111111111\n', monotonicMs: 7_000 },
    { bootId: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', monotonicMs: 7_000 },
    { bootId: '11111111-1111-1111-1111-111111111111', monotonicMs: 7_000, extra: true },
    { bootId: '22222222-2222-2222-2222-222222222222', monotonicMs: 7_000 },
  ]) {
    test(`memory validator rejects malformed or foreign ${field}: ${JSON.stringify(value)}`, () => {
      const fixture = memoryProofFixture('root')
      mutateMemoryCheckpoint(fixture, 'plan', (plan) => {
        if (value === undefined) delete plan[field]
        else plan[field] = value
      })
      // Unsafe JSON integers fail canonical envelope decoding before plan parsing.
      const stage =
        value != null && 'monotonicMs' in value && value.monotonicMs === Number.MAX_SAFE_INTEGER + 1
          ? 'allocation'
          : 'plan-backing'
      expect(() => checkInstalledMemoryProof(fixture)).toThrow(`rejected at ${stage}`)
    })
  }
}

test('memory validator binds both native boot coordinates to the sealed owner boot', () => {
  const fixture = memoryProofFixture('root')
  mutateMemoryCheckpoint(fixture, 'plan', (plan) => {
    for (const field of ['activationStartedBoot', 'effectiveBootDeadline'])
      memoryRecord(plan[field]).bootId = '22222222-2222-2222-2222-222222222222'
  })
  expect(() => checkInstalledMemoryProof(fixture)).toThrow('rejected at prepared-owner')
})

test('memory validator permits zero native coordinates without deriving them from wall time', () => {
  const fixture = memoryProofFixture('root')
  mutateMemoryCheckpoint(fixture, 'plan', (plan) => {
    for (const field of ['activationStartedBoot', 'effectiveBootDeadline'])
      memoryRecord(plan[field]).monotonicMs = 0
  })
  mutateMemoryCheckpoint(fixture, 'release', (release) => {
    release.planDigest = fixture.row.plan_digest
  })
  expect(() => checkInstalledMemoryProof(fixture)).not.toThrow()
})

test('memory validator rejects the invocation digest in the activation intent domain', () => {
  const fixture = memoryProofFixture('root')
  const request = JSON.parse(Buffer.from(fixture.row.request_bytes as Uint8Array).toString())
  const intent = JSON.parse(Buffer.from(fixture.row.intent_bytes as Uint8Array).toString())
  intent.requestDigest = memoryDigest('JIG-Private-Root-Request/1', request)
  fixture.row.intent_bytes = Buffer.from(memoryCanonical(intent))
  fixture.row.intent_digest = memoryDigest('JIG-Private-Root-Spawn-Intent/1', intent)
  expect(() => checkInstalledMemoryProof(fixture)).toThrow('rejected at origin-intent')
})

for (const field of ['transaction', 'package']) {
  test(`memory validator rejects a foreign backing ${field} path`, () => {
    const fixture = memoryProofFixture('root')
    mutateMemoryCheckpoint(fixture, 'backing', (backing) => {
      memoryRecord(memoryRecord(backing.lease)[field]).path = '/foreign/package'
    })
    expect(() => checkInstalledMemoryProof(fixture)).toThrow('rejected at plan-backing')
  })
}

for (const key of ['max', 'oom', 'oom_kill']) {
  for (const value of [undefined, 0, -1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    test(`memory proof rejects ${key}=${String(value)} despite SIGKILL`, () => {
      const fixture = memoryProofFixture('root')
      mutateMemoryCheckpoint(fixture, 'fence', (fence) => {
        const counters = memoryRecord(
          memoryRecord(memoryRecord(fence.receipt).evidence).memoryEvents,
        )
        if (value === undefined) delete counters[key]
        else counters[key] = value
      })
      expect(() => checkInstalledMemoryProof(fixture)).toThrow()
    })
  }
}

for (const stopReason of [
  'deadline',
  'cancelled',
  'coordinator_lost',
  'setup_failed',
  'core_dump',
  'recovered',
]) {
  test(`memory proof rejects ${stopReason} even with positive counters`, () => {
    const fixture = memoryProofFixture('root')
    mutateMemoryCheckpoint(fixture, 'fence', (fence) => {
      memoryRecord(fence.receipt).stopReason = stopReason
    })
    expect(() => checkInstalledMemoryProof(fixture)).toThrow()
  })
}

test('memory proof rejects missing, altered and foreign durable relationships', () => {
  const changes: ((fixture: ReturnType<typeof memoryProofFixture>) => void)[] = [
    (f) => {
      f.row.fence_bytes = null
    },
    (f) => {
      f.row.fence_digest = memoryDigest('other-fence', {})
    },
    (f) => {
      f.row.fence_bytes = Buffer.concat([f.row.fence_bytes as Uint8Array, Buffer.from('\n')])
    },
    (f) => {
      f.row.coordinator_epoch = 2
    },
    (f) => {
      f.project.inode = '1000'
    },
    (f) => {
      f.command.stdout = JSON.stringify({ status: 'succeeded', outcome: 'done', output: {} })
    },
    (f) => {
      f.command.stderr += 'unrelated failure\n'
    },
    (f) => {
      f.command.exitCode = 137
    },
    (f) =>
      mutateMemoryCheckpoint(f, 'fence', (v) => {
        memoryRecord(v.receipt).ownerDigest = memoryDigest('foreign-owner', {})
      }),
    (f) =>
      mutateMemoryCheckpoint(f, 'fence', (v) => {
        memoryRecord(v.receipt).fenced = false
      }),
    (f) =>
      mutateMemoryCheckpoint(f, 'fence', (v) => {
        memoryRecord(v.receipt).signal = 'SIGTERM'
      }),
    (f) =>
      mutateMemoryCheckpoint(f, 'release', (v) => {
        v.packageReleased = false
      }),
    (f) =>
      mutateMemoryCheckpoint(f, 'release', (v) => {
        v.fenceDigest = memoryDigest('other-fence', {})
      }),
    (f) =>
      mutateMemoryCheckpoint(f, 'release', (v) => {
        const release = memoryRecord(v.ownerRelease)
        release.allocationDigest = memoryDigest('other-allocation', {})
        const { digest: _oldDigest, ...fields } = release
        release.digest = memoryDigest('JIG-Rootless-Linux-Owner-Release/1', fields)
      }),
    (f) =>
      mutateMemoryCheckpoint(f, 'prepared', (v) => {
        memoryRecord(memoryRecord(v.prepared).owner).runId = 'other-run'
      }),
    (f) =>
      mutateMemoryCheckpoint(f, 'backing', (v) => {
        memoryRecord(memoryRecord(v.lease).allocation).ownerToken = memoryDigest(
          'other-root-allocation',
          {},
        )
      }),
    (f) =>
      mutateMemoryCheckpoint(f, 'admitted', (v) => {
        v.code = 'DEADLINE_EXCEEDED'
      }),
  ]
  for (const change of changes) {
    const fixture = memoryProofFixture('root')
    change(fixture)
    expect(() => checkInstalledMemoryProof(fixture)).toThrow()
  }
})

test('memory proof refuses a successful parent whose allocating child exits zero', () => {
  const fixture = memoryProofFixture('descendant')
  for (const name of ['provisional', 'admitted'])
    mutateMemoryCheckpoint(fixture, name, (value) => {
      memoryRecord(memoryRecord(value.result).output).exitCode = 0
    })
  const terminal = JSON.parse(
    Buffer.from(fixture.row.terminal_bytes as Uint8Array).toString(),
  ) as MemoryRecord
  memoryRecord(memoryRecord(terminal.result).output).exitCode = 0
  fixture.row.terminal_bytes = Buffer.from(memoryCanonical(terminal))
  fixture.row.terminal_digest = memoryDigest('JIG-Private-Root-Terminal/1', terminal)
  const output = JSON.parse(fixture.command.stdout) as MemoryRecord
  memoryRecord(output.output).exitCode = 0
  fixture.command.stdout = JSON.stringify(output)
  expect(() => checkInstalledMemoryProof(fixture)).toThrow()
})

test('memory proof rejects a self-consistent owner naming a different cgroup leaf', () => {
  const fixture = memoryProofFixture('root')
  const sandbox = JSON.parse(
    Buffer.from(fixture.row.sandbox_bytes as Uint8Array).toString(),
  ) as MemoryRecord
  const owner = memoryRecord(memoryRecord(sandbox.value).owner)
  owner.runCgroup = '/sys/fs/cgroup/unrelated-leaf'
  const { digest: _oldDigest, ...fields } = owner
  owner.digest = memoryDigest('JIG-Rootless-Linux-Sealed-Owner/1', fields)
  mutateMemoryCheckpoint(fixture, 'sandbox', (value) => {
    value.owner = owner
  })
  const prepared = {
    kind: 'private-linux-prepared-owner/1',
    owner,
    digest: memoryDigest('JIG-Rootless-Linux-Prepared-Owner/1', owner),
  }
  mutateMemoryCheckpoint(fixture, 'prepared', (value) => {
    value.prepared = prepared
  })
  mutateMemoryCheckpoint(fixture, 'fence', (value) => {
    memoryRecord(value.receipt).ownerDigest = prepared.digest
  })
  mutateMemoryCheckpoint(fixture, 'release', (value) => {
    value.fenceDigest = fixture.row.fence_digest
  })
  expect(() => checkInstalledMemoryProof(fixture)).toThrow()
})

test('rejected memory evidence is retained while the existing teardown still checks residue', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-memory-proof-check-'))
  const retained = join(temporary, 'memory-command.json')
  const fixture = memoryProofFixture('root')
  mutateMemoryCheckpoint(fixture, 'fence', (value) => {
    memoryRecord(memoryRecord(memoryRecord(value.receipt).evidence).memoryEvents).oom_kill = 0
  })
  await writeFile(retained, JSON.stringify(fixture.command), { mode: 0o600 })
  let checked = false
  let removed = false
  let original: unknown
  try {
    try {
      checkInstalledMemoryProof(fixture)
    } catch (error) {
      original = error
    }
    expect(original).toBeDefined()
    try {
      await finishOperationalBaseline({
        failures: [original],
        temporary,
        checkResidue: async () => {
          checked = true
        },
        removeFixture: async () => {
          removed = true
          await rm(temporary, { recursive: true })
        },
      })
      throw new Error('expected rejection to remain a failure')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toEqual([original])
      expect((error as Error).message).toContain(temporary)
    }
    expect(checked).toBe(true)
    expect(removed).toBe(false)
    expect(JSON.parse(await readFile(retained, 'utf8'))).toEqual(fixture.command)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('memory proof rejection never renders private owner token data or raw parse causes', () => {
  const secret = 'private-owner-token-that-must-stay-in-the-fixture'
  for (const malformed of [true, false]) {
    const fixture = memoryProofFixture('root')
    if (malformed) fixture.row.sandbox_bytes = Buffer.from(`{"private":"${secret}","malformed":`)
    else
      mutateMemoryCheckpoint(fixture, 'sandbox', (value) => {
        value[secret] = secret
      })
    let rejected: Error | undefined
    try {
      checkInstalledMemoryProof(fixture)
    } catch (error) {
      rejected = error as Error
    }
    expect(rejected).toBeInstanceOf(Error)
    expect(rejected!.message).toBe(
      `Installed memory enforcement proof rejected at ${malformed ? 'allocation' : 'prepared-owner'}; inspect the retained private fixture`,
    )
    expect(rejected!.cause).toBeUndefined()
    expect(Object.hasOwn(rejected!, 'actual')).toBe(false)
    expect(Object.hasOwn(rejected!, 'expected')).toBe(false)
    expect(
      JSON.stringify({ message: String(rejected), stack: rejected!.stack, error: rejected }),
    ).not.toContain(secret)
  }
})

const memoryProofStageFailures: readonly [
  string,
  (fixture: ReturnType<typeof memoryProofFixture>) => void,
][] = [
  [
    'run-request',
    (fixture) => {
      fixture.row.candidate_revision = 0
    },
  ],
  [
    'origin-intent',
    (fixture) => {
      fixture.row.origin_digest = 'not-a-digest'
    },
  ],
  [
    'allocation',
    (fixture) => {
      fixture.row.allocation_bytes = null
    },
  ],
  [
    'plan-backing',
    (fixture) => {
      mutateMemoryCheckpoint(fixture, 'plan', (value) => {
        value.effectiveDeadlineUnixMs = 0
      })
    },
  ],
  [
    'prepared-owner',
    (fixture) => {
      mutateMemoryCheckpoint(fixture, 'prepared', (value) => {
        memoryRecord(value.prepared).kind = 'not-a-prepared-owner'
      })
    },
  ],
  [
    'enforcement-fence',
    (fixture) => {
      mutateMemoryCheckpoint(fixture, 'fence', (value) => {
        memoryRecord(memoryRecord(memoryRecord(value.receipt).evidence).memoryEvents).oom_kill = 0
      })
    },
  ],
  [
    'release',
    (fixture) => {
      mutateMemoryCheckpoint(fixture, 'release', (value) => {
        value.packageReleased = false
      })
    },
  ],
  [
    'terminal-record',
    (fixture) => {
      fixture.row.terminal_bytes = Buffer.from('{invalid')
    },
  ],
  [
    'command-stderr',
    (fixture) => {
      fixture.command.stderr = 'unrecognized private text'
    },
  ],
]

for (const [stage, change] of memoryProofStageFailures)
  test(`memory proof rejection identifies only its fixed ${stage} validation stage`, () => {
    const fixture = memoryProofFixture('descendant')
    change(fixture)
    let rejected: Error | undefined
    try {
      checkInstalledMemoryProof(fixture)
    } catch (error) {
      rejected = error as Error
    }
    expect(rejected).toBeInstanceOf(Error)
    expect(rejected!.message).toBe(
      `Installed memory enforcement proof rejected at ${stage}; inspect the retained private fixture`,
    )
    expect(rejected!.cause).toBeUndefined()
    expect(Object.hasOwn(rejected!, 'actual')).toBe(false)
    expect(Object.hasOwn(rejected!, 'expected')).toBe(false)
    expect(String(rejected)).not.toContain('unrecognized private text')
  })

// Retie all downstream checkpoints when substituting a self-consistent intent.
// A negative must fail the target binding, not an unrelated stale envelope hash.
function retieMemoryIntent(
  fixture: ReturnType<typeof memoryProofFixture>,
  change: (intent: MemoryRecord) => void = () => {},
): void {
  const row = fixture.row
  const intent = JSON.parse(Buffer.from(row.intent_bytes as Uint8Array).toString()) as MemoryRecord
  intent.admissionDigest = row.admission_digest
  change(intent)
  row.intent_bytes = Buffer.from(memoryCanonical(intent))
  row.intent_digest = memoryDigest('JIG-Private-Root-Spawn-Intent/1', intent)
  const allocation = JSON.parse(
    Buffer.from(row.allocation_bytes as Uint8Array).toString(),
  ) as MemoryRecord
  allocation.spawnIntentDigest = row.intent_digest
  row.allocation_bytes = Buffer.from(memoryCanonical(allocation))
  row.allocation_digest = memoryDigest('JIG-Private-Root-Execution-Allocation/1', allocation)
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
    const envelope = JSON.parse(
      Buffer.from(row[`${name}_bytes`] as Uint8Array).toString(),
    ) as MemoryRecord
    envelope.allocationDigest = row.allocation_digest
    if (name === 'plan') {
      const plan = memoryRecord(envelope.value)
      plan.requestDigest = intent.requestDigest
      plan.recipeDigest = intent.recipeDigest
      plan.observationDigest = intent.observationDigest
      const packageAllocation = memoryRecord(plan.packageAllocation)
      packageAllocation.ownerToken = row.allocation_digest
    }
    if (name === 'backing') {
      const lease = memoryRecord(memoryRecord(envelope.value).lease)
      memoryRecord(lease.allocation).ownerToken = row.allocation_digest
    }
    if (name === 'release') {
      const release = memoryRecord(envelope.value)
      for (const bound of ['plan', 'backing', 'fence'])
        release[`${bound}Digest`] = row[`${bound}_digest`]
    }
    row[`${name}_bytes`] = Buffer.from(memoryCanonical(envelope))
    row[`${name}_digest`] = memoryDigest(
      `JIG-Private-Root-Execution-${name[0]!.toUpperCase()}${name.slice(1)}/1`,
      envelope,
    )
  }
}

function mutateMemoryActivation(
  fixture: ReturnType<typeof memoryProofFixture>,
  change: (candidate: MemoryRecord, admission: MemoryRecord) => void,
): void {
  const row = fixture.row
  const candidate = JSON.parse(
    Buffer.from(row.candidate_bytes as Uint8Array).toString(),
  ) as MemoryRecord
  const admission = JSON.parse(
    Buffer.from(row.admission_bytes as Uint8Array).toString(),
  ) as MemoryRecord
  change(candidate, admission)
  row.candidate_bytes = Buffer.from(`${memoryCanonical(candidate)}\n`)
  row.candidate_digest = memoryDigest('JIG-Private-Activation-Candidate/5', candidate)
  admission.candidateDigest = row.candidate_digest
  row.admission_bytes = Buffer.from(`${memoryCanonical(admission)}\n`)
  row.admission_digest = memoryDigest('JIG-Private-Activation-Admission/2', admission)
  retieMemoryIntent(fixture)
}

test('memory proof binds the root invocation and admitted activation request in their distinct domains', () => {
  const fixture = memoryProofFixture('descendant')
  const rootRequest = JSON.parse(
    Buffer.from(fixture.row.request_bytes as Uint8Array).toString(),
  ) as MemoryRecord
  const intent = JSON.parse(
    Buffer.from(fixture.row.intent_bytes as Uint8Array).toString(),
  ) as MemoryRecord
  const candidate = JSON.parse(
    Buffer.from(fixture.row.candidate_bytes as Uint8Array).toString(),
  ) as MemoryRecord
  const activation = memoryRecord(memoryRecord((candidate.targets as MemoryRecord[])[0]).request)
  const { digest: activationDigest, ...activationFields } = activation
  expect(intent.requestDigest).toBe(memoryDigest('JIG-Activation-Request/4', activationFields))
  expect(intent.requestDigest).toBe(activationDigest)
  expect(intent.requestDigest).not.toBe(memoryDigest('JIG-Private-Root-Request/1', rootRequest))
  expect(checkInstalledMemoryProof(fixture)).toMatchObject({ fenced: true, released: true })
})

for (const field of ['requestDigest', 'recipeDigest', 'observationDigest'] as const)
  test(`memory proof rejects a self-consistent spawn intent with foreign ${field}`, () => {
    const fixture = memoryProofFixture('root')
    const rootRequest = JSON.parse(
      Buffer.from(fixture.row.request_bytes as Uint8Array).toString(),
    ) as MemoryRecord
    retieMemoryIntent(fixture, (intent) => {
      intent[field] =
        field === 'requestDigest'
          ? memoryDigest('JIG-Private-Root-Request/1', rootRequest)
          : memoryDigest('foreign-activation-meaning', { field })
    })
    expect(() => checkInstalledMemoryProof(fixture)).toThrow('rejected at origin-intent;')
  })

const memoryActivationTampering: readonly [
  string,
  (candidate: MemoryRecord, admission: MemoryRecord) => void,
][] = [
  [
    'foreign project',
    (candidate) => {
      memoryRecord(candidate.projectRoot).inode = '1000'
    },
  ],
  [
    'wrong candidate revision',
    (_candidate, admission) => {
      admission.candidateRevision = 2
    },
  ],
  [
    'foreign lock',
    (_candidate, admission) => {
      admission.lockDigest = memoryDigest('foreign-lock', {})
    },
  ],
  [
    'missing target',
    (candidate) => {
      candidate.targets = []
    },
  ],
  [
    'duplicated target',
    (candidate) => {
      ;(candidate.targets as MemoryRecord[]).push((candidate.targets as MemoryRecord[])[0]!)
    },
  ],
  [
    'neighboring target',
    (candidate) => {
      const request = memoryRecord(memoryRecord((candidate.targets as MemoryRecord[])[0]).request)
      request.target = { kind: 'flow', path: 'flows/isolation-orphan' }
      const { digest: _digest, ...fields } = request
      request.digest = memoryDigest('JIG-Activation-Request/4', fields)
    },
  ],
  [
    'unavailable target',
    (candidate) => {
      memoryRecord((candidate.targets as MemoryRecord[])[0]).disposition = {
        state: 'unavailable',
        code: 'RUNTIME_UNAVAILABLE',
        evidenceDigests: [memoryDigest('failure', {})],
      }
    },
  ],
  [
    'altered request content',
    (candidate) => {
      memoryRecord(memoryRecord((candidate.targets as MemoryRecord[])[0]).request).packagePath =
        'flows/foreign'
    },
  ],
]
for (const [name, change] of memoryActivationTampering)
  test(`memory proof refuses a rehashed admitted generation with ${name}`, () => {
    const fixture = memoryProofFixture('root')
    mutateMemoryActivation(fixture, change)
    expect(() => checkInstalledMemoryProof(fixture)).toThrow('rejected at origin-intent;')
  })

test('memory proof rejects materialization of a different admitted execution package', () => {
  const fixture = memoryProofFixture('root')
  mutateMemoryActivation(fixture, (candidate) => {
    const disposition = memoryRecord((candidate.targets as MemoryRecord[])[0]!.disposition)
    memoryRecord(memoryRecord(disposition.execution).package).digest = memoryDigest(
      'foreign-execution-package',
      {},
    )
  })
  expect(() => checkInstalledMemoryProof(fixture)).toThrow('rejected at plan-backing;')
})

for (const column of ['admission', 'candidate'] as const)
  for (const alteration of ['missing', 'digest', 'without-LF', 'extra-LF'] as const)
    test(`memory proof rejects ${column} ${alteration} before accepting its target`, () => {
      const fixture = memoryProofFixture('root')
      if (alteration === 'missing') fixture.row[`${column}_bytes`] = null
      else if (alteration === 'digest')
        fixture.row[`${column}_digest`] = memoryDigest('foreign-bytes', {})
      else {
        const original = Buffer.from(fixture.row[`${column}_bytes`] as Uint8Array)
        fixture.row[`${column}_bytes`] =
          alteration === 'without-LF'
            ? original.subarray(0, original.byteLength - 1)
            : Buffer.concat([original, Buffer.from('\n')])
      }
      expect(() => checkInstalledMemoryProof(fixture)).toThrow('rejected at origin-intent;')
    })
