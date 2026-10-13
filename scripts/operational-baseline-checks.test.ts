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
    files: { attachments: [], output: null },
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
  const intent = {
    kind: 'private-root-spawn-intent/1',
    runId: row.run_id,
    admissionDigest: row.admission_digest,
    candidateRevision: 1,
    coordinatorEpoch: 1,
    requestDigest,
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
    requestDigest,
    recipeDigest: intent.recipeDigest,
    observationDigest: intent.observationDigest,
    activationStartedUnixMs: 10_000,
    effectiveDeadlineUnixMs: 15_000,
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
      'Installed memory enforcement proof rejected; inspect the retained private fixture',
    )
    expect(rejected!.cause).toBeUndefined()
    expect(Object.hasOwn(rejected!, 'actual')).toBe(false)
    expect(Object.hasOwn(rejected!, 'expected')).toBe(false)
    expect(
      JSON.stringify({ message: String(rejected), stack: rejected!.stack, error: rejected }),
    ).not.toContain(secret)
  }
})
