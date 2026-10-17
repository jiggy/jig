import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { main, privateCliPrepareArguments } from '../../src/cli.js'
import {
  createPrivateActivationPlanV2,
  decodePrivateActivationCandidateV5,
  encodePrivateActivationCandidateV5,
  encodePrivateActivationPlanV2,
  type PrivateActivationCandidateArtifactV5,
  privateActivationCandidateDigestV5,
  privateActivationPlanDigestV2,
} from '../../src/internal/activation-admission.js'
import {
  allocatePrivateRootChildOwner,
  applyPrivateActivationReviewPlan,
  cancelPrivateAttempt,
  capturePrivateActivationPlanningBase,
  claimPrivateNativeSession,
  closePrivateRootChildOwner,
  closePrivateRootExecution,
  initializePrivateActivationState,
  inspectPrivateApprovedProject,
  inspectPrivateAttempt,
  listPrivateRootChildOwners,
  listPrivateRootExecutionWork,
  loadPrivateRootRunForCoordinator,
  openPrivateProjectCoordinator,
  type PrivateProjectCoordinator,
  type PrivateRootChildOwnerLifecycle,
  type PrivateRootRunTerminal,
  preparePrivateAttempt,
  reacquirePrivateRootExecutionWork,
  readPrivateAdmittedExecutionReuse,
  readPrivateBunPreparationOwner,
  readPrivateRootRun,
  recordPrivateRootChildCleanup,
  recordPrivateRootChildFence,
  recordPrivateRootChildPhase,
  recordPrivateRootChildSandbox,
  recordPrivateRootExecutionCheckpoint,
  replacePrivateBunPreparationOwner,
  savePrivateNativeSession,
  submitPrivateAttempt,
  submitPrivateRootRun,
} from '../../src/internal/activation-admission-store.js'
import { privateDomainDigest } from '../../src/internal/identity.js'
import {
  normalizePackageArtifactRef,
  type PackageArtifactRef,
  publishCapturedPackage,
} from '../../src/internal/package-artifact-store.js'
import {
  decodePrivateProjectLocalLock,
  encodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from '../../src/internal/project-local-lock.js'
import { canonicalJson, type JsonValue } from '../../src/json.js'
import { capturePackageDirectory } from '../../src/package/capture.js'
import { restorePrivateActivationRequest } from '../../src/project/package-resolution.js'
import { parseRun } from '../../src/run-arguments.js'

// These are SQLite and decoder tests, not execution qualifications. Manually
// recorded checkpoint values below are inert store inputs: they establish CAS,
// ordering, retention and rollback only, never actual native admission, fencing,
// cleanup, session creation, or successful execution. No controller executes them.
const TABLES = [
  'admission_head',
  'admissions',
  'attempt_blobs',
  'attempt_domain',
  'attempt_export_deliveries',
  'attempt_export_owners',
  'attempt_export_pins',
  'attempt_reservations',
  'candidate_head',
  'candidates',
  'coordinator_head',
  'native_sessions',
  'prepared_attempts',
  'review_plans',
  'root_child_owners',
  'root_execution_lifecycles',
  'root_runs',
  'root_spawn_intents',
  'root_terminals',
] as const

test('stored phase packets are append-only, sequential, conflict-safe and durable across reopen', async () => {
  const fixture = await createFixture('ready')
  let coordinator: PrivateProjectCoordinator | undefined
  try {
    await admit(fixture)
    coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
    const submitted = await submitReadyRun(fixture, coordinator, 'phase-custody')
    const identity = {
      projectRoot: fixture.root,
      parentRunId: submitted.run.runId,
      operationId: 'evaluation:one',
    }
    const allocation = await allocatePrivateRootChildOwner({
      ...identity,
      coordinator,
      allocation: {
        kind: 'private-contained-effect-owner/1',
        effect: 'project-evaluation',
        effectMemoryBytes: 512 * 1024 * 1024,
        intent: 'original',
      },
    })
    const base = { ...identity, coordinator, allocationDigest: allocation.allocation.digest }
    const record = (
      phase: 'generate' | 'compile' | 'test',
      checkpoint: 'plan' | 'sandbox' | 'fence' | 'cleanup',
      value: JsonValue = {},
    ) => recordPrivateRootChildPhase({ ...base, phase, checkpoint, value })
    await expect(record('test', 'plan')).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
    await expect(record('generate', 'sandbox')).rejects.toMatchObject({
      code: 'RUN_CHILD_OWNER_CONFLICT',
    })
    const plans = await Promise.all([
      record('generate', 'plan', { native: 'allocation', intent: 1 }),
      record('generate', 'plan', { native: 'allocation', intent: 1 }),
    ])
    expect(plans[0]).toEqual(plans[1])
    expect(plans[0]!.phaseHistory).toHaveLength(1)
    await expect(record('generate', 'plan', { intent: 2 })).rejects.toMatchObject({
      code: 'RUN_CHILD_OWNER_CONFLICT',
    })
    await expect(record('compile', 'plan')).rejects.toMatchObject({
      code: 'RUN_CHILD_OWNER_CONFLICT',
    })
    await expect(
      closePrivateRootChildOwner({
        ...base,
        sandboxDigest: null,
        fenceDigest: null,
        cleanupDigest: null,
      }),
    ).rejects.toMatchObject({ code: 'RUN_EXECUTION_INCOMPLETE' })
    await expect(record('generate', 'cleanup')).rejects.toMatchObject({
      code: 'RUN_CHILD_OWNER_CONFLICT',
    })
    // Stored phase ordering requires fence and cleanup packets even without sealing.
    await record('generate', 'fence')
    await record('generate', 'cleanup')
    await expect(record('generate', 'sandbox')).rejects.toMatchObject({
      code: 'RUN_CHILD_OWNER_CONFLICT',
    })
    for (const phase of ['compile', 'test'] as const) {
      await record(phase, 'plan', { native: phase })
      await record(phase, 'sandbox')
      const sandbox = await recordPrivateRootChildSandbox({ ...base, sandbox: { aggregate: true } })
      await expect(
        recordPrivateRootChildFence({
          ...base,
          sandboxDigest: sandbox.sandbox!.digest,
          fence: {},
        }),
      ).rejects.toMatchObject({ code: 'RUN_EXECUTION_INCOMPLETE' })
      await record(phase, 'fence')
      await record(phase, 'cleanup')
    }
    const history = (await listPrivateRootChildOwners(base))[0]!
    expect(history.phaseHistory).toHaveLength(11)
    expect(history.allocation).toEqual(allocation.allocation)
    expect(history.phaseHistoryDigest).toBe(history.phaseHistory.at(-1)!.digest)
    await expect(record('generate', 'sandbox')).rejects.toMatchObject({
      code: 'RUN_CHILD_OWNER_CONFLICT',
    })
    await expect(
      recordPrivateRootChildPhase({
        ...base,
        allocationDigest: digest('wrong-allocation'),
        phase: 'test',
        checkpoint: 'plan',
        value: { native: 'test' },
      }),
    ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
    await coordinator.dispose()
    coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
    expect(await listPrivateRootChildOwners({ ...identity, coordinator })).toEqual([history])
    expect(
      await recordPrivateRootChildPhase({
        ...base,
        coordinator,
        phase: 'test',
        checkpoint: 'plan',
        value: { native: 'test' },
      }),
    ).toEqual(history)
    await expect(
      recordPrivateRootChildPhase({
        ...base,
        coordinator,
        phase: 'test',
        checkpoint: 'cleanup',
        value: { changed: true },
      }),
    ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
  } finally {
    await coordinator?.dispose()
    await fixture.dispose()
  }
}, 60_000)

test('replacement coordinator accepts exact old phase packets but refuses new-work packets', async () => {
  const fixture = await createFixture('ready')
  let coordinator: PrivateProjectCoordinator | undefined
  try {
    await admit(fixture)
    coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
    const submitted = await submitReadyRun(fixture, coordinator, 'phase-recovery')
    const identity = {
      projectRoot: fixture.root,
      parentRunId: submitted.run.runId,
      operationId: 'evaluation:recovery',
    }
    const allocation = await allocatePrivateRootChildOwner({
      ...identity,
      coordinator,
      allocation: {
        kind: 'private-contained-effect-owner/1',
        effect: 'project-evaluation',
        effectMemoryBytes: 512 * 1024 * 1024,
        intent: 'native-plan',
      },
    })
    const base = { ...identity, allocationDigest: allocation.allocation.digest }
    const planned = await recordPrivateRootChildPhase({
      ...base,
      coordinator,
      phase: 'compile',
      checkpoint: 'plan',
      value: { native: 'retained' },
    })
    await coordinator.dispose()
    coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
    await expect(
      recordPrivateRootChildPhase({
        ...base,
        coordinator,
        phase: 'compile',
        checkpoint: 'sandbox',
        value: {},
      }),
    ).rejects.toMatchObject({ code: 'RUN_OWNER_CHANGED' })
    expect(
      await recordPrivateRootChildPhase({
        ...base,
        coordinator,
        phase: 'compile',
        checkpoint: 'plan',
        value: { native: 'retained' },
      }),
    ).toEqual(planned)
    const close = {
      ...base,
      coordinator,
      sandboxDigest: null,
      fenceDigest: null,
      cleanupDigest: null,
    }
    await expect(
      closePrivateRootChildOwner({
        ...close,
        phaseHistoryDigest: planned.phaseHistoryDigest,
      }),
    ).rejects.toMatchObject({ code: 'RUN_EXECUTION_INCOMPLETE' })
    await recordPrivateRootChildPhase({
      ...base,
      coordinator,
      phase: 'compile',
      checkpoint: 'fence',
      value: { stopped: true },
    })
    const settled = await recordPrivateRootChildPhase({
      ...base,
      coordinator,
      phase: 'compile',
      checkpoint: 'cleanup',
      value: { absent: true },
    })
    await expect(
      recordPrivateRootChildPhase({
        ...base,
        coordinator,
        phase: 'test',
        checkpoint: 'plan',
        value: {},
      }),
    ).rejects.toMatchObject({ code: 'RUN_OWNER_CHANGED' })
    await expect(closePrivateRootChildOwner(close)).rejects.toMatchObject({
      code: 'RUN_CHILD_OWNER_CONFLICT',
    })
    await expect(
      closePrivateRootChildOwner({
        ...close,
        phaseHistoryDigest: planned.phaseHistoryDigest,
      }),
    ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
    expect(settled.sandbox).toBeUndefined()
    expect(settled.fence).toBeUndefined()
    expect(settled.cleanup).toBeUndefined()
    await closePrivateRootChildOwner({ ...close, phaseHistoryDigest: settled.phaseHistoryDigest })
    expect(await listPrivateRootChildOwners({ ...identity, coordinator })).toEqual([])
  } finally {
    await coordinator?.dispose()
    await fixture.dispose()
  }
}, 60_000)

test('phase history decoding refuses malformed pairs, bytes, bounds, chain and order', async () => {
  const fixture = await createFixture('ready')
  let coordinator: PrivateProjectCoordinator | undefined
  try {
    await admit(fixture)
    coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
    const submitted = await submitReadyRun(fixture, coordinator, 'phase-corruption')
    const identity = {
      projectRoot: fixture.root,
      parentRunId: submitted.run.runId,
      operationId: 'evaluation:corruption',
    }
    const allocation = await allocatePrivateRootChildOwner({
      ...identity,
      coordinator,
      allocation: {
        kind: 'private-contained-effect-owner/1',
        effect: 'project-evaluation',
        effectMemoryBytes: 512 * 1024 * 1024,
      },
    })
    const planned = await recordPrivateRootChildPhase({
      ...identity,
      coordinator,
      allocationDigest: allocation.allocation.digest,
      phase: 'compile',
      checkpoint: 'plan',
      value: { intent: 'exact' },
    })
    const entry = { ...planned.phaseHistory[0]! }
    const invalidOrder = { ...entry, checkpoint: 'cleanup' as const }
    invalidOrder.digest = privateDomainDigest('JIG-Private-Root-Child-Phase/1', {
      parentRunId: identity.parentRunId,
      parentOperationId: '',
      operationId: identity.operationId,
      allocationDigest: allocation.allocation.digest,
      previous: null,
      phase: invalidOrder.phase,
      checkpoint: invalidOrder.checkpoint,
      value: invalidOrder.value,
    })
    const cases = [
      { bytes: null, digest: entry.digest },
      { bytes: new TextEncoder().encode('['), digest: entry.digest },
      { bytes: new TextEncoder().encode(JSON.stringify([entry], null, 2)), digest: entry.digest },
      { bytes: canonicalJson([]), digest: entry.digest },
      { bytes: canonicalJson(Array.from({ length: 13 }, () => entry)), digest: entry.digest },
      { bytes: canonicalJson([{ ...entry, extra: true }]), digest: entry.digest },
      { bytes: canonicalJson([{ ...entry, value: { changed: true } }]), digest: entry.digest },
      { bytes: canonicalJson([{ ...entry, digest: digest('forged') }]), digest: entry.digest },
      { bytes: canonicalJson([entry]), digest: digest('wrong-tail') },
      { bytes: canonicalJson([invalidOrder]), digest: invalidOrder.digest },
    ]
    for (const corruptValue of cases) {
      const database = openSqlite(fixture.database, 'readwrite')
      database.exec('PRAGMA ignore_check_constraints=ON')
      database
        .query('UPDATE root_child_owners SET phase_history_bytes = ?1, phase_history_digest = ?2')
        .run(corruptValue.bytes, corruptValue.digest)
      database.close(true)
      await expect(listPrivateRootChildOwners({ ...identity, coordinator })).rejects.toMatchObject({
        code: 'ADMISSION_STATE_CORRUPT',
      })
    }
  } finally {
    await coordinator?.dispose()
    await fixture.dispose()
  }
}, 60_000)

test('prepared ticket acceptance is atomic with one original root and binds requested duration', async () => {
  const fixture = await createFixture()
  let coordinator: PrivateProjectCoordinator | undefined
  try {
    const approval = await admit(fixture)
    const request = {
      expectedApproval: approval,
      target: 'flow:flows/run',
      input: { value: 'frozen' },
      files: [],
      constraints: { durationMs: 30_000, resultBytes: 1024, artifactBytes: 0 },
      outputIntent: { packet: false, receive: [] },
    }
    const prepared = await preparePrivateAttempt({
      projectRoot: fixture.root,
      request,
      captured: [],
    })
    expect(
      (await inspectPrivateAttempt({ projectRoot: fixture.root, ticket: prepared.ticket }))
        .observation.identity,
    ).toBe('prepared')
    coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
    const submission = {
      projectRoot: fixture.root,
      ticket: prepared.ticket,
      request,
      coordinator,
      packageStoreRoot: fixture.store,
      target: { kind: 'flow' as const, path: 'flows/run' },
    }
    const first = await submitPrivateAttempt(submission)
    expect(first.role).toBe('owner')
    const duplicate = await submitPrivateAttempt(submission)
    expect(duplicate.role).toBe('observer')
    expect(duplicate.receipt.runId).toBe(first.receipt.runId)
    expect(duplicate.run.deadlineUnixMs).toBe(first.run.deadlineUnixMs)
    await expect(
      submitPrivateAttempt({
        ...submission,
        request: {
          ...request,
          constraints: { ...request.constraints, durationMs: 30_001 },
        },
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' })
    const reader = openSqlite(fixture.database, 'readonly')
    try {
      expect(reader.query('SELECT count(*) AS count FROM root_runs').get().count).toBe(1)
      expect(
        reader
          .query('SELECT count(*) AS count FROM prepared_attempts WHERE run_id IS NOT NULL')
          .get().count,
      ).toBe(1)
    } finally {
      reader.close(true)
    }
  } finally {
    await coordinator?.dispose()
    await fixture.dispose()
  }
})

test('cancelled prepared ticket and missing prepared record never allocate a root', async () => {
  const fixture = await createFixture()
  let coordinator: PrivateProjectCoordinator | undefined
  try {
    const approval = await admit(fixture)
    const request = {
      expectedApproval: approval,
      target: 'flow:flows/run',
      input: { value: 'frozen' },
      files: [],
      constraints: { durationMs: 30_000, resultBytes: 1024, artifactBytes: 0 },
      outputIntent: { packet: false, receive: [] },
    }
    const prepared = await preparePrivateAttempt({
      projectRoot: fixture.root,
      request,
      captured: [],
    })
    expect(
      (await cancelPrivateAttempt({ projectRoot: fixture.root, ticket: prepared.ticket }))
        .acknowledged,
    ).toBeTrue()
    coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
    const submission = {
      projectRoot: fixture.root,
      ticket: prepared.ticket,
      request,
      coordinator,
      packageStoreRoot: fixture.store,
      target: { kind: 'flow' as const, path: 'flows/run' },
    }
    await expect(submitPrivateAttempt(submission)).rejects.toMatchObject({ code: 'TICKET_EXPIRED' })
    const writer = openSqlite(fixture.database, 'readwrite')
    try {
      writer.query('DELETE FROM prepared_attempts').run()
    } finally {
      writer.close(true)
    }
    await expect(submitPrivateAttempt(submission)).rejects.toMatchObject({
      code: 'IDENTITY_UNAVAILABLE',
    })
    const reader = openSqlite(fixture.database, 'readonly')
    try {
      expect(reader.query('SELECT count(*) AS count FROM root_runs').get().count).toBe(0)
    } finally {
      reader.close(true)
    }
  } finally {
    await coordinator?.dispose()
    await fixture.dispose()
  }
})

interface EmptyFixture {
  readonly base: string
  readonly root: string
  readonly store: string
  readonly database: string
  dispose(): Promise<void>
}
interface Fixture extends EmptyFixture {
  readonly candidate: PrivateActivationCandidateArtifactV5
  readonly flow: PackageArtifactRef
  readonly declaration: PackageArtifactRef
}
async function createEmptyFixture(): Promise<EmptyFixture> {
  const base = await mkdtemp(join(tmpdir(), 'jig-alpha-store-'))
  const root = join(base, 'project')
  const store = join(base, 'store')
  try {
    await mkdir(root, { mode: 0o700 })
    await mkdir(store, { mode: 0o700 })
    await initializePrivateActivationState({ projectRoot: root })
    return Object.freeze({
      base,
      root,
      store,
      database: join(root, '.jig', 'jig.sqlite3'),
      async dispose(): Promise<void> {
        await rm(base, { recursive: true, force: true })
      },
    })
  } catch (error) {
    await rm(base, { recursive: true, force: true })
    throw error
  }
}
async function createFixture(
  disposition: 'ready' | 'unavailable' = 'unavailable',
  entrypoint?: string,
  attachments: Readonly<Record<string, 'read' | 'read-write'>> = {},
): Promise<Fixture> {
  const empty = await createEmptyFixture()
  const flowSource = join(empty.base, 'run-flow')
  const declarationSource = join(empty.base, 'declaration')
  try {
    await mkdir(flowSource)
    await mkdir(declarationSource)
    await writeFile(
      join(flowSource, 'FLOW.meta.json'),
      JSON.stringify({ name: 'run', description: 'Direct alpha store fixture.' }),
    )
    await writeFile(join(flowSource, 'FLOW.ts'), '#!/usr/bin/env bun\nexport {};\n')
    await writeFile(
      join(flowSource, 'FLOW.contract.json'),
      JSON.stringify({
        $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
        ...(Object.keys(attachments).length ? { attachments } : {}),
        input: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            nested: { type: 'object' },
          },
          required: ['value'],
          additionalProperties: false,
        },
      }),
    )
    await writeFile(join(declarationSource, 'jig.ts'), 'export default {};\n')

    const flow = await retainPackage(empty.store, flowSource)
    const declaration = await retainPackage(empty.store, declarationSource)
    const information = await stat(empty.root, { bigint: true })
    const lockBytes = json1({
      ...(entrypoint === undefined ? {} : { entrypoint }),
      packages: {
        'flows/run': {
          digest: flow.digest,
          directRun: true,
          uses: {},
        },
      },
      bindings: {},
    })
    const lock = decodePrivateProjectLocalLock(lockBytes)
    const request = activationRequest({
      target: { kind: 'flow', path: 'flows/run' },
      mode: 'run',
      packagePath: 'flows/run',
      package: flow,
      entrypoint: { path: 'FLOW.ts', suffix: 'ts' },
      settings: {},
      attachments,
    })
    const targets = [
      {
        request,
        disposition:
          disposition === 'ready'
            ? {
                state: 'ready',
                recipeDigest: digest('direct-recipe'),
                observationDigest: digest('direct-observation'),
                execution: { package: flow, layout: { flowRoot: '', members: [], aliases: [] } },
              }
            : {
                state: 'unavailable',
                code: 'RUNTIME_UNAVAILABLE',
                evidenceDigests: [digest('runtime-unavailable')],
              },
      },
    ]
    const captureDigest = digest('capture-1')
    const planningObservationDigest = digest('planning-1')
    const observedSemanticDigest = digest('meaning-1')
    const candidate = decodePrivateActivationCandidateV5({
      candidate: json1({
        kind: 'private-activation-candidate/5',
        projectRoot: {
          device: information.dev.toString(),
          inode: information.ino.toString(),
        },
        captureDigest,
        observedSemanticDigest,
        activationMeaningDigest: activationMeaning(observedSemanticDigest, targets),
        resolutionInputDigest: privateDomainDigest('JIG-Package-Project-Resolution-Input/1', {
          captureDigest,
          planningObservationDigest,
        }),
        planningObservationDigest,
        lockDigest: privateProjectLocalLockDigest(lock),
        declarationArtifact: {
          kind: 'author-closure/1',
          closureDigest: digest('declaration-closure'),
          package: declaration,
        },
        targets,
      }),
      lock: lockBytes,
    })
    insertCandidateRow(empty.database, 1, candidate, true)
    return Object.freeze({ ...empty, candidate, flow, declaration })
  } catch (error) {
    await empty.dispose()
    throw error
  }
}
function insertCandidate(
  fixture: Fixture,
  label: string,
  equivalent: boolean,
): PrivateActivationCandidateArtifactV5 {
  const database = openSqlite(fixture.database, 'readonly')
  const revision = database.query('SELECT revision FROM candidate_head WHERE singleton = 1').get()
    .revision as number
  database.close(true)
  const next = revision + 1
  const captureDigest = digest(`capture-${label}`)
  const planningObservationDigest = digest(`planning-${label}`)
  const observedSemanticDigest = equivalent
    ? fixture.candidate.candidate.observedSemanticDigest
    : digest(`meaning-${label}`)
  const targets = fixture.candidate.candidate.targets
  const candidate = decodePrivateActivationCandidateV5({
    candidate: json1({
      ...fixture.candidate.candidate,
      captureDigest,
      observedSemanticDigest,
      activationMeaningDigest: activationMeaning(observedSemanticDigest, targets),
      resolutionInputDigest: privateDomainDigest('JIG-Package-Project-Resolution-Input/1', {
        captureDigest,
        planningObservationDigest,
      }),
      planningObservationDigest,
    } as unknown as JsonValue),
    lock: encodePrivateProjectLocalLock(fixture.candidate.lock),
  })
  insertCandidateRow(fixture.database, next, candidate, true)
  return candidate
}
function insertExecutionCandidate(
  fixture: Fixture,
  executionPackage: PackageArtifactRef,
  label: string,
  dependencies?: PackageArtifactRef,
): PrivateActivationCandidateArtifactV5 {
  const database = openSqlite(fixture.database, 'readonly')
  const revision = database.query('SELECT revision FROM candidate_head WHERE singleton = 1').get()
    .revision as number
  database.close(true)
  const target = fixture.candidate.candidate.targets[0]!
  if (target.disposition.state !== 'ready') throw new Error('test fixture target is not ready')
  const targets = [
    {
      request: target.request,
      disposition: {
        ...target.disposition,
        recipeDigest: digest(`direct-recipe:${label}`),
        observationDigest: digest(`direct-observation:${label}`),
        execution: {
          ...target.disposition.execution,
          package: executionPackage,
          ...(dependencies === undefined
            ? {}
            : {
                preparation: { inputDigest: digest('preparation-inputs'), package: dependencies },
              }),
        },
      },
    },
  ]
  const captureDigest = digest(`capture-execution:${label}`)
  const planningObservationDigest = digest(`planning-execution:${label}`)
  const candidate = decodePrivateActivationCandidateV5({
    candidate: json1({
      ...fixture.candidate.candidate,
      captureDigest,
      activationMeaningDigest: activationMeaning(
        fixture.candidate.candidate.observedSemanticDigest,
        targets,
      ),
      resolutionInputDigest: privateDomainDigest('JIG-Package-Project-Resolution-Input/1', {
        captureDigest,
        planningObservationDigest,
      }),
      planningObservationDigest,
      targets,
    } as unknown as JsonValue),
    lock: encodePrivateProjectLocalLock(fixture.candidate.lock),
  })
  insertCandidateRow(fixture.database, revision + 1, candidate, true)
  return candidate
}
async function insertSlottedCandidate(
  fixture: Fixture,
): Promise<PrivateActivationCandidateArtifactV5> {
  const child = await retainDistinctExecutionPackage(fixture, 'slotted-child')
  const lockBytes = json1({
    packages: {
      'flows/child': { digest: child.digest, directRun: true, uses: {} },
      'flows/run': { digest: fixture.flow.digest, directRun: true, uses: {} },
    },
    bindings: {
      router: {
        packagePath: 'flows/run',
        settings: {},
        slots: { child: { kind: 'flow', path: 'flows/child' } },
      },
    },
  })
  const lock = decodePrivateProjectLocalLock(lockBytes)
  const parent = fixture.candidate.candidate.targets[0]!
  if (parent.disposition.state !== 'ready') throw new Error('test fixture target is not ready')
  const { kind: _kind, digest: _requestDigest, ...parentContent } = parent.request
  const targets = [
    {
      request: activationRequest({
        ...parentContent,
        target: { kind: 'binding', id: 'router' },
        slots: { child: { kind: 'flow', target: { kind: 'flow', path: 'flows/child' } } },
      }),
      disposition: {
        ...parent.disposition,
        recipeDigest: digest('slotted-parent-recipe'),
        observationDigest: digest('slotted-parent-observation'),
      },
    },
    {
      request: activationRequest({
        target: { kind: 'flow', path: 'flows/child' },
        mode: 'run',
        packagePath: 'flows/child',
        package: child,
        entrypoint: { path: 'FLOW.ts', suffix: 'ts' },
        settings: {},
        attachments: {},
      }),
      disposition: {
        state: 'ready',
        recipeDigest: digest('slotted-child-recipe'),
        observationDigest: digest('slotted-child-observation'),
        execution: { package: child, layout: { flowRoot: '', members: [], aliases: [] } },
      },
    },
    parent,
  ]
  const captureDigest = digest('slotted-capture')
  const planningObservationDigest = digest('slotted-planning')
  const observedSemanticDigest = digest('slotted-meaning')
  const candidate = decodePrivateActivationCandidateV5({
    candidate: json1({
      ...fixture.candidate.candidate,
      captureDigest,
      observedSemanticDigest,
      activationMeaningDigest: activationMeaning(observedSemanticDigest, targets),
      resolutionInputDigest: privateDomainDigest('JIG-Package-Project-Resolution-Input/1', {
        captureDigest,
        planningObservationDigest,
      }),
      planningObservationDigest,
      lockDigest: privateProjectLocalLockDigest(lock),
      targets,
    } as unknown as JsonValue),
    lock: lockBytes,
  })
  const database = openSqlite(fixture.database, 'readonly')
  const revision = database.query('SELECT revision FROM candidate_head WHERE singleton = 1').get()
    .revision as number
  database.close(true)
  insertCandidateRow(fixture.database, revision + 1, candidate, true)
  return candidate
}
function insertCandidateRow(
  databasePath: string,
  revision: number,
  candidate: PrivateActivationCandidateArtifactV5,
  advanceHead: boolean,
): void {
  const encoded = encodePrivateActivationCandidateV5(candidate)
  const database = openSqlite(databasePath, 'readwrite')
  try {
    database.exec('BEGIN IMMEDIATE')
    database
      .query(
        'INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (?1, ?2, ?3, ?4)',
      )
      .run(revision, privateActivationCandidateDigestV5(candidate), encoded.candidate, encoded.lock)
    if (advanceHead) {
      database.query('UPDATE candidate_head SET revision = ?1 WHERE singleton = 1').run(revision)
    }
    database.exec('COMMIT')
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK')
    throw error
  } finally {
    database.close(true)
  }
}
function seedPlan(
  fixture: Fixture,
  candidate: PrivateActivationCandidateArtifactV5,
  input: {
    readonly baseGeneration: string | null
    readonly observedLock: 'absent' | 'present'
    readonly operation: 'admission' | 'lock-repair'
  },
): string {
  const database = openSqlite(fixture.database, 'readonly')
  const candidateDigest = privateActivationCandidateDigestV5(candidate)
  const row = database
    .query(
      'SELECT revision FROM candidates WHERE candidate_digest = ?1 ORDER BY revision DESC LIMIT 1',
    )
    .get(candidateDigest) as { readonly revision: number } | null
  database.close(true)
  if (row === null) throw new Error('test candidate was not retained')
  const plan = createPrivateActivationPlanV2({
    candidate,
    candidateRevision: row.revision,
    baseGeneration: input.baseGeneration,
    lockMode: 'update',
    observedLock:
      input.observedLock === 'absent'
        ? { state: 'absent' }
        : { state: 'present', lock: candidate.lock },
    operation: input.operation,
  })
  const bytes = encodePrivateActivationPlanV2(plan)
  const planDigest = privateActivationPlanDigestV2(plan)
  const writer = openSqlite(fixture.database, 'readwrite')
  try {
    writer
      .query(
        'INSERT INTO review_plans(plan_digest, candidate_revision, plan_bytes) VALUES (?1, ?2, ?3)',
      )
      .run(planDigest, row.revision, bytes)
  } finally {
    writer.close(true)
  }
  return planDigest
}
async function admit(fixture: Fixture): Promise<string> {
  const receipt = requireAdmission(
    await applyPlan(
      fixture,
      seedPlan(fixture, fixture.candidate, {
        baseGeneration: null,
        observedLock: 'absent',
        operation: 'admission',
      }),
    ),
  )
  return receipt.admissionDigest
}
function applyPlan(fixture: Fixture, planDigest: string) {
  return applyPrivateActivationReviewPlan({
    projectRoot: fixture.root,
    packageStoreRoot: fixture.store,
    planDigest,
  })
}
function requireAdmission<T>(value: T): Extract<T, { readonly operation: 'admission' }> {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('operation' in value) ||
    value.operation !== 'admission'
  ) {
    throw new Error('test expected an admission receipt')
  }
  return value as Extract<T, { readonly operation: 'admission' }>
}
async function submitReadyRun(
  fixture: Fixture,
  coordinator: PrivateProjectCoordinator,
  submissionId: string,
  deadlineUnixMs = Date.now() + 60_000,
) {
  return await submitPrivateRootRun({
    coordinator,
    projectRoot: fixture.root,
    packageStoreRoot: fixture.store,
    submissionId,
    target: { kind: 'flow', path: 'flows/run' },
    input: { value: submissionId },
    deadlineUnixMs,
  })
}
// Raw UTF-8 session-store inputs, not a native client restoration receipt.
function nativeSession() {
  const nativeId = '0194b66c-1800-7403-a21b-7ac00d721b0a'
  return {
    nativeId,
    rolloutPath: `sessions/2026/09/14/rollout-2026-09-14T17-31-09-${nativeId}.jsonl`,
  }
}
async function prepareNativeSessionParent(
  fixture: Fixture,
  coordinator: PrivateProjectCoordinator,
  submissionId: string,
): Promise<string> {
  const { run } = await submitReadyRun(fixture, coordinator, submissionId)
  await prepareNativeSessionLifecycle(fixture, coordinator, run.runId)
  return run.runId
}
// Satisfy the store's packet-order prerequisites only. No native owner exists.
async function prepareNativeSessionLifecycle(
  fixture: Fixture,
  coordinator: PrivateProjectCoordinator,
  runId: string,
): Promise<void> {
  await checkpoint(fixture, coordinator, runId, 'plan', { recipe: 'exact' })
  await checkpoint(fixture, coordinator, runId, 'backing', { package: 'retained' })
  await checkpoint(fixture, coordinator, runId, 'sandbox', { owner: 'sandbox' })
  await checkpoint(fixture, coordinator, runId, 'prepared', { ready: true })
}
function checkpoint(
  fixture: Fixture,
  coordinator: PrivateProjectCoordinator,
  runId: string,
  name: Parameters<typeof recordPrivateRootExecutionCheckpoint>[0]['checkpoint'],
  value: JsonValue,
) {
  return recordPrivateRootExecutionCheckpoint({
    coordinator,
    projectRoot: fixture.root,
    runId,
    checkpoint: name,
    value,
  })
}
// Exercise durable terminal packet storage, never execute or settle native work.
async function recordTerminalPackets(
  fixture: Fixture,
  coordinator: PrivateProjectCoordinator,
  runId: string,
  terminal: PrivateRootRunTerminal,
): Promise<void> {
  await checkpoint(fixture, coordinator, runId, 'plan', { recipe: 'exact' })
  await checkpoint(fixture, coordinator, runId, 'backing', { package: 'retained' })
  await checkpoint(fixture, coordinator, runId, 'sandbox', { owner: 'sandbox' })
  await checkpoint(fixture, coordinator, runId, 'prepared', { ready: true })
  await checkpoint(fixture, coordinator, runId, 'provisional', terminal as unknown as JsonValue)
  await checkpoint(fixture, coordinator, runId, 'fence', { populated: false })
  await checkpoint(fixture, coordinator, runId, 'release', { released: true })
  await checkpoint(fixture, coordinator, runId, 'admitted', terminal as unknown as JsonValue)
}
function successTerminal(output: JsonValue): PrivateRootRunTerminal {
  return Object.freeze({
    status: 'succeeded' as const,
    result: Object.freeze({ outcome: 'done', output }),
    diagnostics: Object.freeze({ stderr: '', stderrBytes: 0, stderrTruncated: false }),
  })
}
function activationRequest(content: Record<string, unknown>): Record<string, unknown> {
  const request = { kind: 'activation-request/4', slots: {}, ...content }
  return {
    ...request,
    digest: privateDomainDigest('JIG-Activation-Request/4', request as unknown as JsonValue),
  }
}
function activationMeaning(observedSemanticDigest: string, targets: unknown): string {
  return privateDomainDigest('JIG-Private-Activation-Meaning/1', {
    observedSemanticDigest,
    targets,
  } as JsonValue)
}
async function retainPackage(store: string, source: string): Promise<PackageArtifactRef> {
  const captured = await capturePackageDirectory(source)
  try {
    return await publishCapturedPackage(store, captured)
  } finally {
    await captured.dispose()
  }
}
async function retainDistinctExecutionPackage(
  fixture: Fixture,
  label: string,
): Promise<PackageArtifactRef> {
  const source = join(fixture.base, `execution-${label}`)
  await mkdir(join(source, 'node_modules', 'dependency'), { recursive: true })
  await writeFile(
    join(source, 'FLOW.meta.json'),
    JSON.stringify({ name: 'run', description: 'Prepared direct alpha store fixture.' }),
  )
  await writeFile(join(source, 'FLOW.ts'), "#!/usr/bin/env bun\nimport 'dependency';\nexport {};\n")
  await writeFile(join(source, 'node_modules', 'dependency', 'index.js'), 'export {};\n')
  return await retainPackage(fixture.store, source)
}
function packageArtifactPath(store: string, reference: PackageArtifactRef): string {
  const hexadecimal = reference.digest.slice('sha256:'.length)
  return join(
    store,
    'packages',
    'v1',
    'sha256',
    hexadecimal.slice(0, 2),
    `${hexadecimal.slice(2)}.pkg`,
  )
}
function activationAuthoritySnapshot(databasePath: string): Readonly<Record<string, unknown>> {
  const database = openSqlite(databasePath, 'readonly')
  try {
    return Object.freeze({
      candidateHead: database
        .query('SELECT singleton, revision FROM candidate_head ORDER BY singleton')
        .all(),
      candidates: database
        .query(
          [
            'SELECT revision, candidate_digest, hex(candidate_bytes) AS candidate_bytes,',
            'hex(lock_bytes) AS lock_bytes FROM candidates ORDER BY revision',
          ].join(' '),
        )
        .all(),
      plans: database
        .query(
          [
            'SELECT plan_digest, candidate_revision, hex(plan_bytes) AS plan_bytes',
            'FROM review_plans ORDER BY plan_digest',
          ].join(' '),
        )
        .all(),
      admissionHead: database
        .query('SELECT singleton, revision FROM admission_head ORDER BY singleton')
        .all(),
      admissions: database
        .query(
          [
            'SELECT revision, admission_digest, base_generation, plan_digest,',
            'hex(admission_bytes) AS admission_bytes FROM admissions ORDER BY revision',
          ].join(' '),
        )
        .all(),
    })
  } finally {
    database.close(true)
  }
}
function tableNames(database: any): readonly string[] {
  return database
    .query(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map(({ name }: { readonly name: string }) => name)
}
function indexNames(database: any): readonly string[] {
  return database
    .query(
      "SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map(({ name }: { readonly name: string }) => name)
}
function openSqlite(path: string, mode: 'readonly' | 'readwrite'): any {
  const sqlite = createRequire(import.meta.url)('bun:sqlite') as any
  const access =
    mode === 'readonly'
      ? sqlite.constants.SQLITE_OPEN_READONLY
      : sqlite.constants.SQLITE_OPEN_READWRITE
  const visible = join(realpathSync(dirname(path)), basename(path))
  return sqlite.Database.open(visible, access | sqlite.constants.SQLITE_OPEN_NOFOLLOW)
}
function json1(value: JsonValue): Uint8Array {
  const body = canonicalJson(value)
  const bytes = new Uint8Array(body.byteLength + 1)
  bytes.set(body)
  bytes[body.byteLength] = 0x0a
  return bytes
}
function digest(label: string): string {
  return `sha256:${createHash('sha256').update(label).digest('hex')}`
}
setDefaultTimeout(60_000)
describe.serial('direct alpha activation store', () => {
  test('a competing SQLite writer prevents terminal storage and session deletion until retry', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const runId = await prepareNativeSessionParent(fixture, coordinator, 'delete-failure')
      await savePrivateNativeSession({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: runId,
        scopeDigest: digest('a'),
        ...nativeSession(),
        bytes: Buffer.from('{}\n'),
        lifetime: 'run',
      })
      const terminal = successTerminal(null)
      await recordTerminalPackets(fixture, coordinator, runId, terminal)
      const writer = openSqlite(fixture.database, 'readwrite')
      try {
        writer.exec('BEGIN IMMEDIATE')
        await expect(
          closePrivateRootExecution({ coordinator, projectRoot: fixture.root, runId, terminal }),
        ).rejects.toMatchObject({ code: 'ADMISSION_STATE_BUSY' })
      } finally {
        writer.exec('ROLLBACK')
        writer.close(true)
      }
      const database = openSqlite(fixture.database, 'readonly')
      try {
        expect(database.query('SELECT count(*) AS count FROM native_sessions').get().count).toBe(1)
        expect(database.query('SELECT count(*) AS count FROM root_terminals').get().count).toBe(0)
      } finally {
        database.close(true)
      }
      await closePrivateRootExecution({ coordinator, projectRoot: fixture.root, runId, terminal })
      const completed = openSqlite(fixture.database, 'readonly')
      try {
        expect(completed.query('SELECT count(*) AS count FROM native_sessions').get().count).toBe(0)
        expect(completed.query('SELECT count(*) AS count FROM root_terminals').get().count).toBe(1)
      } finally {
        completed.close(true)
      }
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('replacement coordinator retains session rows until required close packets are stored', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const runId = await prepareNativeSessionParent(fixture, coordinator, 'temporary-lost')
      await savePrivateNativeSession({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: runId,
        scopeDigest: digest('a'),
        ...nativeSession(),
        bytes: Buffer.from('{}\n'),
        lifetime: 'run',
      })
      await coordinator.dispose()
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const terminal = {
        status: 'lost',
        code: 'COORDINATOR_LOST',
        message: 'prior owner lost',
      } as const
      await checkpoint(fixture, coordinator, runId, 'provisional', terminal)
      await expect(
        closePrivateRootExecution({ coordinator, projectRoot: fixture.root, runId, terminal }),
      ).rejects.toBeDefined()
      const pending = openSqlite(fixture.database, 'readonly')
      try {
        expect(pending.query('SELECT count(*) AS count FROM native_sessions').get().count).toBe(1)
      } finally {
        pending.close(true)
      }
      await checkpoint(fixture, coordinator, runId, 'fence', { populated: false })
      await checkpoint(fixture, coordinator, runId, 'release', { released: true })
      await checkpoint(fixture, coordinator, runId, 'admitted', terminal)
      await closePrivateRootExecution({ coordinator, projectRoot: fixture.root, runId, terminal })
      const completed = openSqlite(fixture.database, 'readonly')
      try {
        expect(completed.query('SELECT count(*) AS count FROM native_sessions').get().count).toBe(0)
      } finally {
        completed.close(true)
      }
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('Run-owned session rows are claimable only by their active root and deleted by terminal storage', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const foreignRoot = await prepareNativeSessionParent(fixture, coordinator, 'other-root')
      const persistent = await savePrivateNativeSession({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: foreignRoot,
        scopeDigest: digest('a'),
        ...nativeSession(),
        bytes: Buffer.from('{}\n'),
      })
      if (!persistent) throw new Error('missing persistent receipt')
      // More roots than the global capacity; each final correction receipt must be reclaimed.
      for (let index = 0; index < 18; index++) {
        const parentRunId = await prepareNativeSessionParent(
          fixture,
          coordinator,
          `temporary-${index}`,
        )
        const access = {
          coordinator,
          projectRoot: fixture.root,
          parentRunId,
          scopeDigest: digest('a'),
        }
        const receipt = await savePrivateNativeSession({
          ...access,
          ...nativeSession(),
          bytes: Buffer.from('{}\n'),
          lifetime: 'run',
        })
        if (!receipt) throw new Error('temporary receipts accumulated')
        if (index === 0) {
          expect(
            await claimPrivateNativeSession({
              ...access,
              parentRunId: foreignRoot,
              reference: receipt.reference,
            }),
          ).toBeUndefined()
        }
        expect(
          await claimPrivateNativeSession({
            ...access,
            scopeDigest: digest('b'),
            reference: receipt.reference,
          }),
        ).toBeUndefined()
        const restored = await claimPrivateNativeSession({
          ...access,
          reference: receipt.reference,
        })
        expect(restored?.lifetime).toBe('run')
        expect(
          await claimPrivateNativeSession({ ...access, reference: receipt.reference }),
        ).toBeUndefined()
        const successor = await savePrivateNativeSession({
          ...access,
          ...nativeSession(),
          bytes: Buffer.from('{}\n'),
          lifetime: 'run',
        })
        if (!successor) throw new Error('missing successor')
        const terminal =
          index % 2 === 0
            ? successTerminal(null)
            : ({
                status: 'failed',
                code: 'CANCELLED',
                message: 'cancelled',
                diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
              } as const)
        await recordTerminalPackets(fixture, coordinator, parentRunId, terminal)
        await closePrivateRootExecution({
          coordinator,
          projectRoot: fixture.root,
          runId: parentRunId,
          terminal,
        })
        await expect(
          claimPrivateNativeSession({ ...access, reference: successor.reference }),
        ).rejects.toMatchObject({ code: 'RUN_ALREADY_TERMINAL' })
        const database = openSqlite(fixture.database, 'readonly')
        try {
          expect(
            database
              .query('SELECT count(*) AS count FROM native_sessions WHERE root_run_id IS NOT NULL')
              .get().count,
          ).toBe(0)
          expect(database.query('SELECT count(*) AS count FROM native_sessions').get().count).toBe(
            1,
          )
        } finally {
          database.close(true)
        }
      }
      const nextRoot = await prepareNativeSessionParent(
        fixture,
        coordinator,
        'persistent-continuation',
      )
      expect(
        await claimPrivateNativeSession({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: nextRoot,
          scopeDigest: digest('a'),
          reference: persistent.reference,
        }),
      ).toMatchObject({ lifetime: 'project' })
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  }, 180_000)
  test('native sessions are immutable UTF-8 snapshots claimed once across root Runs', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const parentRunId = await prepareNativeSessionParent(fixture, coordinator, 'native-first')
      const access = {
        coordinator,
        projectRoot: fixture.root,
        parentRunId,
        scopeDigest: digest('a'),
      }
      const bytes = Buffer.from('{"message":"retained 🧵"}\n')
      const expected = Uint8Array.from(bytes)
      const startedAt = Date.now()
      const saving = savePrivateNativeSession({ ...access, ...nativeSession(), bytes })
      bytes.fill(0)
      const receipt = await saving
      expect(receipt?.reference).toMatch(/^[0-9a-f-]{36}$/)
      expect(receipt!.expiresAtUnixMs).toBeGreaterThanOrEqual(startedAt + 86_400_000)
      expect(receipt!.expiresAtUnixMs).toBeLessThanOrEqual(Date.now() + 86_400_000)
      expect(
        await claimPrivateNativeSession({
          ...access,
          scopeDigest: digest('b'),
          reference: receipt!.reference,
        }),
      ).toBeUndefined()
      const nextRunId = await prepareNativeSessionParent(fixture, coordinator, 'native-next')
      const results = await Promise.all([
        claimPrivateNativeSession({
          ...access,
          parentRunId: nextRunId,
          reference: receipt!.reference,
        }),
        claimPrivateNativeSession({
          ...access,
          parentRunId: nextRunId,
          reference: receipt!.reference,
        }),
      ])
      const claimed = results.find((result) => result !== undefined)!
      expect(results.filter((result) => result !== undefined)).toHaveLength(1)
      expect(claimed).toMatchObject({
        ...nativeSession(),
        ...receipt,
        digest: `sha256:${createHash('sha256').update(expected).digest('hex')}`,
      })
      expect(claimed.bytes).toEqual(expected)
      expect(
        await claimPrivateNativeSession({ ...access, reference: receipt!.reference }),
      ).toBeUndefined()
      const database = openSqlite(fixture.database, 'readonly')
      try {
        expect(database.query('SELECT count(*) AS count FROM native_sessions').get().count).toBe(0)
      } finally {
        database.close(true)
      }
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('native sessions survive coordinator replacement but require its current active root', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const parentRunId = await prepareNativeSessionParent(fixture, coordinator, 'native-old-owner')
      const access = { projectRoot: fixture.root, parentRunId, scopeDigest: digest('a') }
      const receipt = (await savePrivateNativeSession({
        ...access,
        coordinator,
        ...nativeSession(),
        bytes: Buffer.from('{}\n'),
      }))!
      await coordinator.dispose()
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      await expect(
        claimPrivateNativeSession({ ...access, coordinator, reference: receipt.reference }),
      ).rejects.toMatchObject({ code: 'RUN_OWNER_CHANGED' })
      const nextRunId = await prepareNativeSessionParent(
        fixture,
        coordinator,
        'native-current-owner',
      )
      expect(
        await claimPrivateNativeSession({
          ...access,
          coordinator,
          parentRunId: nextRunId,
          reference: receipt.reference,
        }),
      ).toMatchObject(nativeSession())
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('native session access rejects forged and foreign coordinators and inactive roots', async () => {
    const fixture = await createFixture('ready')
    const foreign = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const { run } = await submitReadyRun(fixture, coordinator, 'native-inactive')
      const input = {
        coordinator,
        projectRoot: fixture.root,
        parentRunId: run.runId,
        scopeDigest: digest('a'),
        ...nativeSession(),
        bytes: Buffer.from('{}\n'),
      }
      await expect(
        savePrivateNativeSession({ ...input, coordinator: { ...coordinator } }),
      ).rejects.toThrow('private lease boundary')
      await expect(
        savePrivateNativeSession({ ...input, projectRoot: foreign.root }),
      ).rejects.toMatchObject({ code: 'COORDINATOR_PROJECT_MISMATCH' })
      await expect(savePrivateNativeSession(input)).rejects.toMatchObject({
        code: 'RUN_CHILD_PARENT_INACTIVE',
      })
      await prepareNativeSessionLifecycle(fixture, coordinator, run.runId)
      const receipt = (await savePrivateNativeSession(input))!
      await checkpoint(fixture, coordinator, run.runId, 'fence', { populated: false })
      await expect(
        claimPrivateNativeSession({ ...input, reference: receipt.reference }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_PARENT_INACTIVE' })
      await expect(savePrivateNativeSession(input)).rejects.toMatchObject({
        code: 'RUN_CHILD_PARENT_INACTIVE',
      })
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
      await foreign.dispose()
    }
  })
  test('native sessions enforce sixteen available records and prune expired bytes on access', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const parentRunId = await prepareNativeSessionParent(fixture, coordinator, 'native-capacity')
      const input = {
        coordinator,
        projectRoot: fixture.root,
        parentRunId,
        scopeDigest: digest('a'),
        ...nativeSession(),
        bytes: Buffer.from('{}\n'),
      }
      const saved = []
      for (let i = 0; i < 16; i++) saved.push((await savePrivateNativeSession(input))!)
      expect(await savePrivateNativeSession(input)).toBeUndefined()
      expect(
        await claimPrivateNativeSession({ ...input, reference: saved[0]!.reference }),
      ).toBeDefined()
      expect(await savePrivateNativeSession(input)).toBeDefined()
      expect(await savePrivateNativeSession(input)).toBeUndefined()
      const database = openSqlite(fixture.database, 'readwrite')
      try {
        const expired = Date.now() - 1
        database
          .query('UPDATE native_sessions SET created_at = ?1, expires_at = ?2 WHERE reference = ?3')
          .run(expired - 86_400_000, expired, saved[1]!.reference)
      } finally {
        database.close(true)
      }
      expect(
        await claimPrivateNativeSession({ ...input, reference: saved[1]!.reference }),
      ).toBeUndefined()
      expect(await savePrivateNativeSession(input)).toBeDefined()
      const check = openSqlite(fixture.database, 'readonly')
      try {
        expect(check.query('SELECT count(*) AS count FROM native_sessions').get().count).toBe(16)
        expect(
          check
            .query('SELECT reference FROM native_sessions WHERE reference = ?1')
            .get(saved[1]!.reference),
        ).toBeNull()
      } finally {
        check.close(true)
      }
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('native session storage bounds input, paths and byte identity without consuming corruption', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const parentRunId = await prepareNativeSessionParent(
        fixture,
        coordinator,
        'native-validation',
      )
      const input = {
        coordinator,
        projectRoot: fixture.root,
        parentRunId,
        scopeDigest: digest('a'),
        ...nativeSession(),
        bytes: Buffer.from('{}\n'),
      }
      for (const bytes of [
        new Uint8Array(),
        new Uint8Array(8 * 1024 * 1024 + 1),
        new Uint8Array([0xc0, 0xaf]),
      ])
        await expect(savePrivateNativeSession({ ...input, bytes })).rejects.toThrow()
      for (const rolloutPath of [
        '../auth.json',
        '/sessions/owned.jsonl',
        input.rolloutPath.replace(input.nativeId, '00000000-0000-0000-0000-000000000000'),
      ])
        await expect(savePrivateNativeSession({ ...input, rolloutPath })).rejects.toThrow(
          'owned UUID',
        )
      await expect(
        savePrivateNativeSession({ ...input, scopeDigest: 'not-a-digest' }),
      ).rejects.toThrow('digest')
      for (const reference of ['../native', `${input.nativeId}\n`])
        await expect(claimPrivateNativeSession({ ...input, reference })).rejects.toThrow('UUID')
      const largest = new Uint8Array(8 * 1024 * 1024).fill(32)
      const receipt = (await savePrivateNativeSession({ ...input, bytes: largest }))!
      expect(
        (await claimPrivateNativeSession({ ...input, reference: receipt.reference }))!.bytes,
      ).toEqual(largest)
      const corruptReceipt = (await savePrivateNativeSession(input))!
      const database = openSqlite(fixture.database, 'readwrite')
      try {
        database
          .query('UPDATE native_sessions SET content_digest = ?1 WHERE reference = ?2')
          .run(digest('f'), corruptReceipt.reference)
      } finally {
        database.close(true)
      }
      await expect(
        claimPrivateNativeSession({ ...input, reference: corruptReceipt.reference }),
      ).rejects.toThrow('bounded identity')
      const check = openSqlite(fixture.database, 'readonly')
      try {
        expect(
          check
            .query('SELECT reference FROM native_sessions WHERE reference = ?1')
            .get(corruptReceipt.reference),
        ).toBeDefined()
      } finally {
        check.close(true)
      }
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  for (const [suiteCaseIndex, suiteCaseValue] of (['ready', 'unavailable'] as const).entries()) {
    test(
      'omitted writable output selects one temporary packet from the retained %s interface' +
        ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
          async (state) => {
            const original = await createFixture(state, 'flow:flows/run', {
              deliverables: 'read-write',
            })
            const fixture = {
              ...original,
              store: join(original.root, '.jig/private-package-store'),
            }
            try {
              const approved = await admit(original)
              await rename(original.store, fixture.store)
              let inventory: readonly string[] = []
              await inspectPrivateApprovedProject(
                fixture.root,
                undefined,
                undefined,
                false,
                (digest, writable) => {
                  expect(digest).toBe(approved)
                  inventory = writable
                },
              )
              expect(inventory).toEqual(['flow:flows/run'])
              expect(Object.isFrozen(inventory)).toBe(true)
              const defaults = await privateCliPrepareArguments(['run'], {
                currentDirectory: fixture.root,
              })
              // Explicit output lookup uses retained request modes, without package recapture.
              await rm(fixture.store, { recursive: true })
              const explicit = await privateCliPrepareArguments(['run', 'flow:./flows/run'], {
                currentDirectory: fixture.root,
              })
              if ('exitCode' in defaults || 'exitCode' in explicit)
                throw new Error('selection refused')
              const first = parseRun(defaults.arguments).output!,
                second = parseRun(explicit.arguments).output!
              expect(dirname(first)).toBe(realpathSync(tmpdir()))
              expect(basename(first)).toMatch(/^jig-result-[a-f0-9]{32}$/)
              expect(second).not.toBe(first)
              expect(defaults.admissionDigest).toBe(approved)
              expect(explicit.admissionDigest).toBe(approved)
              await expect(stat(first)).rejects.toMatchObject({ code: 'ENOENT' })
              expect(
                await privateCliPrepareArguments(defaults.arguments, {
                  currentDirectory: fixture.root,
                  runArgumentsPrepared: true,
                  expectedAdmissionDigest: approved,
                }),
              ).toEqual({ arguments: defaults.arguments })
              const chosen = ['run', 'flow:flows/run', '--out', './chosen']
              expect(
                await privateCliPrepareArguments(chosen, { currentDirectory: fixture.root }),
              ).toEqual({
                arguments: chosen,
              })
              const unknown = ['run', 'binding:missing']
              expect(
                await privateCliPrepareArguments(unknown, { currentDirectory: fixture.root }),
              ).toEqual({
                arguments: unknown,
                admissionDigest: approved,
              })
            } finally {
              await fixture.dispose()
            }
          },
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
    )
  }
  test('a completed no-output decision survives later approval without a late file owner', async () => {
    const original = await createFixture('ready', undefined, { deliverables: 'read-write' })
    const fixture = { ...original, store: join(original.root, '.jig/private-package-store') }
    try {
      const args = ['run', 'flow:flows/run']
      expect(await privateCliPrepareArguments(args, { currentDirectory: fixture.root })).toEqual({
        arguments: args,
      })
      await admit(original)
      await rename(original.store, fixture.store)
      expect(
        await privateCliPrepareArguments(args, {
          currentDirectory: fixture.root,
          runArgumentsPrepared: true,
        }),
      ).toEqual({ arguments: args })
      expect(
        await privateCliPrepareArguments(['run'], {
          currentDirectory: fixture.root,
          runArgumentsPrepared: true,
          writeError: () => {},
        }),
      ).toEqual({ exitCode: 2 })
    } finally {
      await fixture.dispose()
    }
  })
  for (const [suiteCaseIndex, suiteCaseValue] of (['ready', 'unavailable'] as const).entries()) {
    test(
      'an inaccessible temporary parent refuses before dispatch for a retained %s writable target' +
        ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
          async (state) => {
            const original = await createFixture(state, undefined, { deliverables: 'read-write' })
            const fixture = {
              ...original,
              store: join(original.root, '.jig/private-package-store'),
            }
            const prior = process.env.TMPDIR
            try {
              await admit(original)
              await rename(original.store, fixture.store)
              process.env.TMPDIR = join(fixture.root, 'missing-temp')
              let diagnostic = ''
              expect(
                await privateCliPrepareArguments(['run', 'flow:flows/run'], {
                  currentDirectory: fixture.root,
                  writeError: (text) => {
                    diagnostic += text
                  },
                }),
              ).toEqual({ exitCode: 1 })
              expect(diagnostic).toContain('Temporary output storage is unavailable')
              expect(diagnostic).toContain('No Flow was started')
              expect(diagnostic).toMatch(/Add --out\s+\.\/result-packet to the same invocation/)
              const fallback = ['run', 'flow:flows/run', '--out', 'chosen']
              expect(
                await privateCliPrepareArguments(fallback, { currentDirectory: fixture.root }),
              ).toEqual({
                arguments: fallback,
              })
            } finally {
              if (prior === undefined) delete process.env.TMPDIR
              else process.env.TMPDIR = prior
              await fixture.dispose()
            }
          },
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
    )
  }
  test('entrypoint selection uses approval, survives explicit overrides, and refuses a newer admission', async () => {
    const original = await createFixture('ready', 'flow:flows/run --input @job.json --timeout 8m')
    let coordinator: PrivateProjectCoordinator | undefined
    const fixture = { ...original, store: join(original.root, '.jig/private-package-store') }
    try {
      const approved = await admit(original)
      await rename(original.store, fixture.store)
      await writeFile(join(fixture.root, 'jig.ts'), 'throw new Error("unreviewed source")')
      // A missing job file is okay during selection; Run captures it later.
      const prepared = await privateCliPrepareArguments(['run', '--timeout', '12m'], {
        currentDirectory: fixture.root,
        interactive: false,
        answer: async () => {
          throw new Error('entrypoint must never prompt')
        },
      })
      expect(prepared).toEqual({
        arguments: [
          'run',
          'flow:flows/run',
          '--input',
          '@' + join(fixture.root, 'job.json'),
          '--timeout',
          '12m',
        ],
        admissionDigest: approved,
      })
      expect(await inspectPrivateApprovedProject(fixture.root)).toMatchObject({
        entrypoint: original.candidate.lock.entrypoint,
      })
      const direct = ['run', 'flow:flows/run', '--input', '{"value":"direct"}']
      expect(await privateCliPrepareArguments(direct, { currentDirectory: fixture.root })).toEqual({
        arguments: direct,
        admissionDigest: approved,
      })
      const newer = insertCandidate(fixture, 'entrypoint-race', false)
      const next = requireAdmission(
        await applyPlan(
          fixture,
          seedPlan(fixture, newer, {
            baseGeneration: approved,
            observedLock: 'present',
            operation: 'admission',
          }),
        ),
      )
      expect(
        await privateCliPrepareArguments(direct, {
          currentDirectory: fixture.root,
          runArgumentsPrepared: true,
          expectedAdmissionDigest: approved,
        }),
      ).toEqual({ arguments: direct })
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      await expect(
        submitPrivateRootRun({
          coordinator,
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          submissionId: 'entrypoint-race',
          expectedAdmissionDigest: approved,
          target: { kind: 'flow', path: 'flows/run' },
          input: { value: 'test' },
          deadlineUnixMs: Date.now() + 1000,
        }),
      ).rejects.toMatchObject({ code: 'RUN_APPROVAL_CHANGED' })
      expect(next.admissionDigest).not.toBe(approved)
      expect(
        await listPrivateRootExecutionWork({
          coordinator,
          projectRoot: fixture.root,
          epoch: 'current',
        }),
      ).toEqual([])
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('inspection reads only approved retained meaning without state writes or coordinator acquisition', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      expect(await inspectPrivateApprovedProject(fixture.root)).toEqual({
        state: 'unreviewed',
        targets: [],
      })
      const approved = await admit(fixture)
      // A newer proposal is not the approved target set.
      const pending = await insertSlottedCandidate(fixture)
      seedPlan(fixture, pending, {
        baseGeneration: approved,
        observedLock: 'present',
        operation: 'admission',
      })
      await rename(fixture.store, join(fixture.root, '.jig/private-package-store'))
      // Inspection must neither evaluate these live bytes nor need the coordinator lock.
      await writeFile(join(fixture.root, 'jig.ts'), 'throw new Error("must not evaluate")')
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const before = await readFile(fixture.database)
      const information = await stat(fixture.database)
      const entries = await readdir(join(fixture.root, '.jig'))
      expect(await inspectPrivateApprovedProject(fixture.root)).toMatchObject({
        state: 'unchecked',
        targets: [{ target: 'flow:flows/run', package: 'flows/run' }],
      })
      expect(await inspectPrivateApprovedProject(fixture.root, 'flow:flows/run')).toMatchObject({
        state: 'unchecked',
        name: 'run',
        description: 'Direct alpha store fixture.',
        contract: { input: { type: 'object', required: ['value'] } },
        attachments: {},
        slots: {},
        settings: {},
      })
      let menu = ''
      const selection = await privateCliPrepareArguments(['run', '--input', '{"value":1}'], {
        currentDirectory: fixture.root,
        interactive: true,
        answer: async () => '1',
        writeOutput: () => {
          throw new Error('selection must not contaminate result stdout')
        },
        writeError: (text) => {
          menu += text
        },
      })
      expect(selection).toEqual({
        arguments: ['run', 'flow:flows/run', '--input', '{"value":1}'],
        admissionDigest: approved,
      })
      expect(menu).toContain('Direct alpha store fixture.')
      expect(menu).not.toContain('binding:router') // pending source is not approval
      for (const answer of ['', '99', '1;exit']) {
        const rejected = await privateCliPrepareArguments(['run'], {
          currentDirectory: fixture.root,
          interactive: true,
          answer: async () => answer,
          writeOutput: () => {},
          writeError: () => {},
        })
        expect('exitCode' in rejected).toBe(true)
      }
      const cancelled = new AbortController()
      expect(
        await privateCliPrepareArguments(['run'], {
          currentDirectory: fixture.root,
          interactive: true,
          signal: cancelled.signal,
          answer: async () => {
            cancelled.abort()
            return '1'
          },
          writeOutput: () => {},
          writeError: () => {},
        }),
      ).toEqual({ exitCode: 2 })
      let completions = ''
      expect(
        await main(['completion', 'targets', 'flow:'], {
          currentDirectory: fixture.root,
          writeRecord: async (text) => {
            completions += text
          },
        }),
      ).toBe(0)
      expect(completions).toBe('flow:flows/run\n')
      await expect(
        inspectPrivateApprovedProject(fixture.root, 'binding:missing'),
      ).rejects.toMatchObject({ code: 'INSPECTION_TARGET_MISSING' })
      for (const [state, heading] of [
        ['environment-matches', 'Approval environment matches'],
        ['review-required', 'Review required'],
        ['unchecked', 'Approval validity not checked'],
      ] as const) {
        for (const json of [false, true]) {
          let output = ''
          expect(
            await main(['inspect', ...(json ? ['--json'] : [])], {
              currentDirectory: fixture.root,
              terminalOutput: true,
              inspectEnvironment: async (target) => {
                expect(target.request.packagePath).toBe('flows/run')
                if (state === 'unchecked') throw new Error('PRIVATE_ENVIRONMENT_SECRET')
                return state
              },
              host: {
                acquire: async () => {
                  throw new Error('must not acquire')
                },
              },
              writeOutput: (text) => {
                output += text
              },
              writeRecord: async (text) => {
                output += text
              },
            }),
          ).toBe(0)
          if (json) expect(JSON.parse(output)).toMatchObject({ state, targets: [{ state }] })
          else {
            expect(output).toContain(heading)
            expect(output).toMatch(/Visible source\s+changes are not checked/)
            if (state !== 'environment-matches') {
              expect(stripVTControlCharacters(output)).toContain('jig review')
              expect(output).not.toContain('Next: jig run')
            }
          }
          expect(output).not.toContain('PRIVATE_ENVIRONMENT_SECRET')
        }
      }
      const interrupted = new AbortController()
      let interruptedOutput = ''
      let interruptedError = ''
      expect(
        await main(['inspect'], {
          currentDirectory: fixture.root,
          signal: interrupted.signal,
          inspectEnvironment: async () => {
            interrupted.abort()
            return 'environment-matches'
          },
          writeOutput: (text) => {
            interruptedOutput += text
          },
          writeError: (text) => {
            interruptedError += text
          },
        }),
      ).toBe(2)
      expect(interruptedOutput).toBe('')
      expect(interruptedError).toContain('JIG_COMMAND_INTERRUPTED')
      expect(await readFile(fixture.database)).toEqual(before)
      expect((await stat(fixture.database)).mtimeMs).toBe(information.mtimeMs)
      expect(await readdir(join(fixture.root, '.jig'))).toEqual(entries)
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('stored ancestor fence packets block descendant allocations but preserve sibling capacity', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const submitted = await submitReadyRun(fixture, coordinator, 'deep-branch')
      const context = { coordinator, projectRoot: fixture.root, parentRunId: submitted.run.runId }
      const branch = await allocatePrivateRootChildOwner({
        ...context,
        operationId: 'specialist',
        allocation: { kind: 'private-root-child-owner-allocation/1', flowDepth: 2 },
      })
      const branchSandbox = await recordPrivateRootChildSandbox({
        ...context,
        operationId: branch.operationId,
        allocationDigest: branch.allocation.digest,
        sandbox: { kind: 'test-flow-sandbox' },
      })
      const sibling = await allocatePrivateRootChildOwner({
        ...context,
        operationId: 'sibling',
        allocation: {
          kind: 'private-root-child-owner-allocation/1',
          flowDepth: 2,
          owner: 'sibling',
        },
      })
      await recordPrivateRootChildSandbox({
        ...context,
        operationId: sibling.operationId,
        allocationDigest: sibling.allocation.digest,
        sandbox: { kind: 'test-flow-sandbox', owner: 'sibling' },
      })
      await expect(
        allocatePrivateRootChildOwner({
          ...context,
          operationId: 'exclusive-http',
          allocation: { kind: 'private-contained-effect-owner/1' },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_CAPACITY' })
      const childInput = {
        ...context,
        parentOperationId: branch.operationId,
        operationId: 'agent-flow',
        allocation: { kind: 'private-root-child-owner-allocation/1', flowDepth: 1 },
      }
      const child = await allocatePrivateRootChildOwner(childInput)
      await recordPrivateRootChildSandbox({
        ...context,
        parentOperationId: branch.operationId,
        operationId: child.operationId,
        allocationDigest: child.allocation.digest,
        sandbox: { kind: 'test-flow-sandbox', owner: 'agent-flow' },
      })
      const effectInput = {
        ...context,
        parentOperationId: child.operationId,
        operationId: 'http',
        allocation: { kind: 'private-contained-effect-owner/1' },
      }
      const effect = await allocatePrivateRootChildOwner(effectInput)
      const siblingChild = await allocatePrivateRootChildOwner({
        ...childInput,
        parentOperationId: sibling.operationId,
        operationId: 'sibling-agent-flow',
        allocation: {
          kind: 'private-root-child-owner-allocation/1',
          flowDepth: 1,
          owner: 'sibling-agent-flow',
        },
      })
      await recordPrivateRootChildSandbox({
        ...context,
        parentOperationId: sibling.operationId,
        operationId: siblingChild.operationId,
        allocationDigest: siblingChild.allocation.digest,
        sandbox: { kind: 'test-flow-sandbox', owner: 'sibling-agent-flow' },
      })
      const siblingEffectInput = {
        ...effectInput,
        parentOperationId: siblingChild.operationId,
        allocation: { kind: 'private-contained-effect-owner/1', owner: 'sibling-agent-flow' },
      }
      const siblingEffect = await allocatePrivateRootChildOwner(siblingEffectInput)
      expect((await listPrivateRootChildOwners(context)).length).toBe(6)
      await expect(
        allocatePrivateRootChildOwner({ ...effectInput, operationId: 'overlapping-http' }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_CAPACITY' })
      await expect(
        allocatePrivateRootChildOwner({ ...childInput, operationId: 'overlapping-flow' }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_CAPACITY' })
      await expect(
        closePrivateRootChildOwner({
          ...context,
          parentOperationId: branch.operationId,
          operationId: child.operationId,
          allocationDigest: child.allocation.digest,
          sandboxDigest: null,
          fenceDigest: null,
          cleanupDigest: null,
        }),
      ).rejects.toMatchObject({ code: 'RUN_EXECUTION_INCOMPLETE' })
      await closePrivateRootChildOwner({
        ...context,
        parentOperationId: child.operationId,
        operationId: effect.operationId,
        allocationDigest: effect.allocation.digest,
        sandboxDigest: null,
        fenceDigest: null,
        cleanupDigest: null,
      })
      await expect(
        allocatePrivateRootChildOwner({
          ...effectInput,
          operationId: 'too-deep',
          allocation: { kind: 'private-root-child-owner-allocation/1', flowDepth: 1 },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
      await recordPrivateRootChildFence({
        ...context,
        operationId: branch.operationId,
        allocationDigest: branch.allocation.digest,
        sandboxDigest: branchSandbox.sandbox!.digest,
        fence: { kind: 'test-fence' },
      })
      await expect(
        allocatePrivateRootChildOwner({ ...effectInput, operationId: 'late-http' }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_PARENT_INACTIVE' })
      await closePrivateRootChildOwner({
        ...context,
        parentOperationId: siblingChild.operationId,
        operationId: siblingEffect.operationId,
        allocationDigest: siblingEffect.allocation.digest,
        sandboxDigest: null,
        fenceDigest: null,
        cleanupDigest: null,
      })
      await expect(
        allocatePrivateRootChildOwner({ ...siblingEffectInput, operationId: 'next-http' }),
      ).resolves.toMatchObject({
        allocation: { value: { kind: 'private-contained-effect-owner/1' } },
      })
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('inspection includes selected children but does not let unrelated targets stale a selected target', async () => {
    const fixture = await createFixture('ready')
    try {
      const slotted = await insertSlottedCandidate(fixture)
      await applyPlan(
        fixture,
        seedPlan(fixture, slotted, {
          baseGeneration: null,
          observedLock: 'absent',
          operation: 'admission',
        }),
      )
      await rename(fixture.store, join(fixture.root, '.jig/private-package-store'))
      const check: import('../src/internal/activation-admission-store.js').PrivateInspectionEnvironmentCheck =
        async (target) =>
          target.request.packagePath === 'flows/child' ? 'review-required' : 'environment-matches'
      expect(
        await inspectPrivateApprovedProject(fixture.root, 'binding:router', check),
      ).toMatchObject({ state: 'review-required' })
      expect(
        await inspectPrivateApprovedProject(fixture.root, 'flow:flows/run', check),
      ).toMatchObject({ state: 'environment-matches' })
      expect(await inspectPrivateApprovedProject(fixture.root, undefined, check)).toMatchObject({
        state: 'review-required',
      })
    } finally {
      await fixture.dispose()
    }
  })
  test('inspection does not create state or initialize an empty database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-inspect-empty-'))
    try {
      expect(await inspectPrivateApprovedProject(root)).toEqual({
        state: 'unreviewed',
        targets: [],
      })
      expect(await readdir(root)).toEqual([])
      await writeFile(join(root, 'jig.lock'), '{}\n')
      expect(await inspectPrivateApprovedProject(root)).toEqual({
        state: 'unreviewed',
        targets: [],
      })
      await mkdir(join(root, '.jig'), { mode: 0o700 })
      const database = join(root, '.jig/jig.sqlite3')
      await writeFile(database, '', { mode: 0o600 })
      await expect(inspectPrivateApprovedProject(root)).rejects.toMatchObject({
        code: 'ADMISSION_SCHEMA_VERSION',
      })
      expect((await readFile(database)).length).toBe(0)
      expect(await readdir(join(root, '.jig'))).toEqual(['jig.sqlite3'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  test('inspection fails closed on unsafe state and a held SQLite writer without recovery', async () => {
    const fixture = await createFixture('ready')
    try {
      await admit(fixture)
      const writer = openSqlite(fixture.database, 'readwrite')
      try {
        writer.exec('BEGIN EXCLUSIVE')
        await expect(inspectPrivateApprovedProject(fixture.root)).rejects.toMatchObject({
          code: 'ADMISSION_STATE_BUSY',
        })
      } finally {
        writer.exec('ROLLBACK')
        writer.close(true)
      }
      const before = await readFile(fixture.database)
      await rename(fixture.database, `${fixture.database}.saved`)
      await symlink(`${fixture.database}.saved`, fixture.database)
      await expect(inspectPrivateApprovedProject(fixture.root)).rejects.toBeDefined()
      expect(await readFile(`${fixture.database}.saved`)).toEqual(before)
    } finally {
      await fixture.dispose()
    }
  })
  test('reserves two deep branches atomically until their cleanup packets are stored', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const submitted = await submitReadyRun(fixture, coordinator, 'two-branches')
      const context = { coordinator, projectRoot: fixture.root, parentRunId: submitted.run.runId }
      const allocate = (operationId: string) =>
        allocatePrivateRootChildOwner({
          ...context,
          operationId,
          allocation: { kind: 'private-root-child-owner-allocation/1', flowDepth: 2, operationId },
        })
      const raced = await Promise.allSettled([
        allocate('worker:a'),
        allocate('worker:b'),
        allocate('worker:c'),
      ])
      expect(
        raced
          .map((r) => (r.status === 'fulfilled' ? 'reserved' : String(r.reason?.code ?? r.reason)))
          .sort(),
      ).toEqual(['RUN_CHILD_CAPACITY', 'reserved', 'reserved'].sort())
      expect(raced.filter((r) => r.status === 'rejected').map((r) => r.reason.code)).toEqual([
        'RUN_CHILD_CAPACITY',
      ])
      const rows = await listPrivateRootChildOwners(context)
      const first = rows[0]!
      const key = {
        ...context,
        operationId: first.operationId,
        allocationDigest: first.allocation.digest,
      }
      const sealed = await recordPrivateRootChildSandbox({
        ...key,
        sandbox: { kind: 'test-sandbox' },
      })
      const fenced = await recordPrivateRootChildFence({
        ...key,
        sandboxDigest: sealed.sandbox!.digest,
        fence: { kind: 'test-fence' },
      })
      await expect(allocate('worker:late')).rejects.toMatchObject({ code: 'RUN_CHILD_CAPACITY' })
      const cleaned = await recordPrivateRootChildCleanup({
        ...key,
        sandboxDigest: sealed.sandbox!.digest,
        fenceDigest: fenced.fence!.digest,
        cleanup: { kind: 'test-cleanup' },
      })
      await expect(allocate('worker:late')).rejects.toMatchObject({ code: 'RUN_CHILD_CAPACITY' })
      await closePrivateRootChildOwner({
        ...key,
        sandboxDigest: sealed.sandbox!.digest,
        fenceDigest: fenced.fence!.digest,
        cleanupDigest: cleaned.cleanup!.digest,
      })
      await expect(allocate('worker:late')).resolves.toMatchObject({ operationId: 'worker:late' })
      for (const row of await listPrivateRootChildOwners(context))
        await closePrivateRootChildOwner({
          ...context,
          operationId: row.operationId,
          allocationDigest: row.allocation.digest,
          sandboxDigest: null,
          fenceDigest: null,
          cleanupDigest: null,
        })
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('creates only the current exact protected schema', async () => {
    const fixture = await createEmptyFixture()
    try {
      const database = openSqlite(fixture.database, 'readonly')
      try {
        expect(tableNames(database)).toEqual(TABLES)
        expect(indexNames(database)).toEqual([])
        expect(database.query('PRAGMA application_id').get().application_id).toBe(0x4a494731)
        expect(database.query('PRAGMA user_version').get().user_version).toBe(1)
        expect(database.query('PRAGMA foreign_key_check').all()).toEqual([])
      } finally {
        database.close(true)
      }

      await expect(stat(join(fixture.root, '.jig', 'coordinator.sqlite3'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await fixture.dispose()
    }
  })
  test('retains only active child cleanup owner rows', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const submitted = await submitReadyRun(fixture, coordinator, 'child-owner')
      const allocation = await allocatePrivateRootChildOwner({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:1',
        allocation: { kind: 'test-child-allocation', value: 1 },
      })
      expect(
        await listPrivateRootChildOwners({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
        }),
      ).toEqual([allocation])
      const sandbox = await recordPrivateRootChildSandbox({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:1',
        allocationDigest: allocation.allocation.digest,
        sandbox: { kind: 'test-child-sandbox', value: 2 },
      })
      expect(sandbox.sandbox?.digest).toMatch(/^sha256:/)

      await expect(
        allocatePrivateRootChildOwner({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:2',
          allocation: { kind: 'test-child-allocation', value: 2 },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_CAPACITY' })

      const terminal = successTerminal({ ok: true })
      await recordTerminalPackets(fixture, coordinator, submitted.run.runId, terminal)
      await expect(
        closePrivateRootExecution({
          coordinator,
          projectRoot: fixture.root,
          runId: submitted.run.runId,
          terminal,
        }),
      ).rejects.toMatchObject({ code: 'RUN_EXECUTION_INCOMPLETE' })

      await expect(
        closePrivateRootChildOwner({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:1',
          allocationDigest: sandbox.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fenceDigest: null,
          cleanupDigest: null,
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
      const fenced = await recordPrivateRootChildFence({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:1',
        allocationDigest: sandbox.allocation.digest,
        sandboxDigest: sandbox.sandbox!.digest,
        fence: { kind: 'test-child-fence', value: 3 },
      })
      await expect(
        closePrivateRootChildOwner({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:1',
          allocationDigest: fenced.allocation.digest,
          sandboxDigest: fenced.sandbox!.digest,
          fenceDigest: fenced.fence!.digest,
          cleanupDigest: null,
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
      const cleaned = await recordPrivateRootChildCleanup({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:1',
        allocationDigest: fenced.allocation.digest,
        sandboxDigest: fenced.sandbox!.digest,
        fenceDigest: fenced.fence!.digest,
        cleanup: { kind: 'test-child-cleanup', value: 4 },
      })
      await closePrivateRootChildOwner({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:1',
        allocationDigest: cleaned.allocation.digest,
        sandboxDigest: cleaned.sandbox!.digest,
        fenceDigest: cleaned.fence!.digest,
        cleanupDigest: cleaned.cleanup!.digest,
      })
      expect(
        await listPrivateRootChildOwners({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
        }),
      ).toEqual([])
      expect(
        await closePrivateRootExecution({
          coordinator,
          projectRoot: fixture.root,
          runId: submitted.run.runId,
          terminal,
        }),
      ).toMatchObject({ state: 'terminal' })
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('scopes a nested Agent row to its parent Flow packets and retains rows across coordinator replacement', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const submitted = await submitReadyRun(fixture, coordinator, 'nested-agent-owner')
      const context = { coordinator, projectRoot: fixture.root, parentRunId: submitted.run.runId }
      const flow = await allocatePrivateRootChildOwner({
        ...context,
        operationId: 'shared:1',
        allocation: { kind: 'private-root-child-owner-allocation/1', flowDepth: 1, value: 1 },
      })
      const agentInput = {
        ...context,
        parentOperationId: 'shared:1',
        operationId: 'shared:1',
        allocation: { kind: 'private-root-agent-owner-allocation/1', value: 2 },
      }
      await expect(allocatePrivateRootChildOwner(agentInput)).rejects.toMatchObject({
        code: 'RUN_CHILD_PARENT_INACTIVE',
      })
      const flowSandbox = await recordPrivateRootChildSandbox({
        ...context,
        operationId: flow.operationId,
        allocationDigest: flow.allocation.digest,
        sandbox: { kind: 'test-flow-sandbox' },
      })
      await expect(
        allocatePrivateRootChildOwner({
          ...agentInput,
          allocation: { kind: 'private-root-child-owner-allocation/1', flowDepth: 1 },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
      await expect(
        allocatePrivateRootChildOwner({
          ...agentInput,
          parentOperationId: 'unknown-parent',
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_PARENT_INACTIVE' })
      const agent = await allocatePrivateRootChildOwner(agentInput)
      expect(agent.parentOperationId).toBe(flow.operationId)
      expect(agent.operationId).toBe(flow.operationId)
      expect(await allocatePrivateRootChildOwner(agentInput)).toEqual(agent)
      await expect(
        allocatePrivateRootChildOwner({
          ...agentInput,
          operationId: 'agent:2',
          allocation: { ...agentInput.allocation, value: 3 },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_CAPACITY' })
      await expect(
        allocatePrivateRootChildOwner({
          ...context,
          operationId: 'root:2',
          allocation: { kind: 'test-root-child' },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_CAPACITY' })
      await expect(
        recordPrivateRootChildSandbox({
          ...context,
          operationId: agent.operationId,
          allocationDigest: agent.allocation.digest,
          sandbox: { kind: 'test-agent-sandbox' },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
      const agentSandbox = await recordPrivateRootChildSandbox({
        ...context,
        parentOperationId: flow.operationId,
        operationId: agent.operationId,
        allocationDigest: agent.allocation.digest,
        sandbox: { kind: 'test-agent-sandbox' },
      })
      expect(await listPrivateRootChildOwners(context)).toEqual([agentSandbox, flowSandbox])
      await coordinator.dispose()
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const recovery = { ...context, coordinator }
      expect(await listPrivateRootChildOwners(recovery)).toEqual([agentSandbox, flowSandbox])
      await expect(
        allocatePrivateRootChildOwner({ ...agentInput, coordinator }),
      ).rejects.toMatchObject({ code: 'RUN_OWNER_CHANGED' })

      const fencedFlow = await recordPrivateRootChildFence({
        ...recovery,
        operationId: flow.operationId,
        allocationDigest: flow.allocation.digest,
        sandboxDigest: flowSandbox.sandbox!.digest,
        fence: { kind: 'test-flow-fence' },
      })
      const cleanedFlow = await recordPrivateRootChildCleanup({
        ...recovery,
        operationId: flow.operationId,
        allocationDigest: flow.allocation.digest,
        sandboxDigest: flowSandbox.sandbox!.digest,
        fenceDigest: fencedFlow.fence!.digest,
        cleanup: { kind: 'test-flow-cleanup' },
      })
      const closeFlow = {
        ...recovery,
        operationId: flow.operationId,
        allocationDigest: flow.allocation.digest,
        sandboxDigest: flowSandbox.sandbox!.digest,
        fenceDigest: fencedFlow.fence!.digest,
        cleanupDigest: cleanedFlow.cleanup!.digest,
      }
      await expect(closePrivateRootChildOwner(closeFlow)).rejects.toMatchObject({
        code: 'RUN_EXECUTION_INCOMPLETE',
      })
      const nestedRecovery = {
        ...recovery,
        parentOperationId: flow.operationId,
        operationId: agent.operationId,
      }
      const fencedAgent = await recordPrivateRootChildFence({
        ...nestedRecovery,
        allocationDigest: agent.allocation.digest,
        sandboxDigest: agentSandbox.sandbox!.digest,
        fence: { kind: 'test-agent-fence' },
      })
      const cleanedAgent = await recordPrivateRootChildCleanup({
        ...nestedRecovery,
        allocationDigest: agent.allocation.digest,
        sandboxDigest: agentSandbox.sandbox!.digest,
        fenceDigest: fencedAgent.fence!.digest,
        cleanup: { kind: 'test-agent-cleanup' },
      })
      await closePrivateRootChildOwner({
        ...nestedRecovery,
        allocationDigest: agent.allocation.digest,
        sandboxDigest: agentSandbox.sandbox!.digest,
        fenceDigest: fencedAgent.fence!.digest,
        cleanupDigest: cleanedAgent.cleanup!.digest,
      })
      expect(await listPrivateRootChildOwners(recovery)).toEqual([cleanedFlow])
      await closePrivateRootChildOwner(closeFlow)
      expect(await listPrivateRootChildOwners(recovery)).toEqual([])
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('deep branches reserve capacity and stored ancestor fence packets reject descendant allocations', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const submitted = await submitReadyRun(fixture, coordinator, 'deep-ancestor-fence')
      const context = { coordinator, projectRoot: fixture.root, parentRunId: submitted.run.runId }
      const rows: PrivateRootChildOwnerLifecycle[] = []
      let parentOperationId: string | undefined
      for (let depth = 5; depth >= 1; depth--) {
        const row = await allocatePrivateRootChildOwner({
          ...context,
          parentOperationId,
          operationId: `level-${depth}`,
          allocation: { kind: 'private-root-child-owner-allocation/1', flowDepth: depth },
        })
        const sealed = await recordPrivateRootChildSandbox({
          ...context,
          parentOperationId,
          operationId: row.operationId,
          allocationDigest: row.allocation.digest,
          sandbox: { kind: 'test-flow-sandbox', depth },
        })
        rows.push(sealed)
        parentOperationId = row.operationId
      }
      await expect(
        allocatePrivateRootChildOwner({
          ...context,
          operationId: 'sibling',
          allocation: { kind: 'private-root-child-owner-allocation/1', flowDepth: 1 },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_CAPACITY' })
      const effect = {
        ...context,
        parentOperationId,
        operationId: 'effect',
        allocation: { kind: 'private-contained-effect-owner/1' },
      }
      const allocated = await allocatePrivateRootChildOwner(effect)
      await closePrivateRootChildOwner({
        ...effect,
        allocationDigest: allocated.allocation.digest,
        sandboxDigest: null,
        fenceDigest: null,
        cleanupDigest: null,
      })
      const outer = rows[0]!
      await recordPrivateRootChildFence({
        ...context,
        operationId: outer.operationId,
        allocationDigest: outer.allocation.digest,
        sandboxDigest: outer.sandbox!.digest,
        fence: { kind: 'test-fence' },
      })
      await expect(allocatePrivateRootChildOwner(effect)).rejects.toMatchObject({
        code: 'RUN_CHILD_PARENT_INACTIVE',
      })
      expect(await listPrivateRootChildOwners(context)).toHaveLength(5)
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('rejects nested allocations after parent fence storage and rejects Agent parents', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const submitted = await submitReadyRun(fixture, coordinator, 'nested-owner-fencing')
      const context = { coordinator, projectRoot: fixture.root, parentRunId: submitted.run.runId }
      const flow = await allocatePrivateRootChildOwner({
        ...context,
        operationId: 'flow:1',
        allocation: { kind: 'private-root-child-owner-allocation/1', flowDepth: 1 },
      })
      const sandbox = await recordPrivateRootChildSandbox({
        ...context,
        operationId: flow.operationId,
        allocationDigest: flow.allocation.digest,
        sandbox: { kind: 'test-flow-sandbox' },
      })
      const nested = {
        ...context,
        parentOperationId: flow.operationId,
        operationId: 'agent:1',
        allocation: { kind: 'private-root-agent-owner-allocation/1' },
      }
      const agent = await allocatePrivateRootChildOwner(nested)
      await expect(
        allocatePrivateRootChildOwner({ ...nested, parentOperationId: agent.operationId }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_PARENT_INACTIVE' })
      await recordPrivateRootChildFence({
        ...context,
        operationId: flow.operationId,
        allocationDigest: flow.allocation.digest,
        sandboxDigest: sandbox.sandbox!.digest,
        fence: { kind: 'test-flow-fence' },
      })
      await expect(
        recordPrivateRootChildSandbox({
          ...context,
          parentOperationId: flow.operationId,
          operationId: agent.operationId,
          allocationDigest: agent.allocation.digest,
          sandbox: { kind: 'test-agent-sandbox' },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_PARENT_INACTIVE' })
      await closePrivateRootChildOwner({
        ...context,
        parentOperationId: flow.operationId,
        operationId: agent.operationId,
        allocationDigest: agent.allocation.digest,
        sandboxDigest: null,
        fenceDigest: null,
        cleanupDigest: null,
      })
      await expect(allocatePrivateRootChildOwner(nested)).rejects.toMatchObject({
        code: 'RUN_CHILD_PARENT_INACTIVE',
      })
      const directRun = await submitReadyRun(fixture, coordinator, 'direct-agent-parent')
      const directContext = { ...context, parentRunId: directRun.run.runId }
      const directAgent = await allocatePrivateRootChildOwner({
        ...directContext,
        operationId: 'direct:agent',
        allocation: { kind: 'private-root-agent-owner-allocation/1', direct: true },
      })
      await recordPrivateRootChildSandbox({
        ...directContext,
        operationId: directAgent.operationId,
        allocationDigest: directAgent.allocation.digest,
        sandbox: { kind: 'test-direct-agent-sandbox' },
      })
      await expect(
        allocatePrivateRootChildOwner({
          ...nested,
          ...directContext,
          parentOperationId: directAgent.operationId,
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_PARENT_INACTIVE' })
      const fencedRoot = await submitReadyRun(fixture, coordinator, 'fenced-root-child')
      await recordTerminalPackets(
        fixture,
        coordinator,
        fencedRoot.run.runId,
        successTerminal({ ok: true }),
      )
      await expect(
        allocatePrivateRootChildOwner({
          ...context,
          parentRunId: fencedRoot.run.runId,
          operationId: 'late:child',
          allocation: { kind: 'private-root-child-owner-allocation/1', flowDepth: 1, late: true },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_PARENT_INACTIVE' })
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('compare-and-sets every child cleanup packet and exact row close', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const submitted = await submitReadyRun(fixture, coordinator, 'child-owner-cas')
      const allocationValue = { kind: 'test-child-allocation', value: 1 } as const
      const allocation = await allocatePrivateRootChildOwner({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:cas',
        allocation: allocationValue,
      })
      expect(
        await allocatePrivateRootChildOwner({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocation: allocationValue,
        }),
      ).toEqual(allocation)
      await expect(
        allocatePrivateRootChildOwner({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocation: { ...allocationValue, value: 2 },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })

      const sandboxValue = { kind: 'test-child-sandbox', value: 2 } as const
      await expect(
        recordPrivateRootChildSandbox({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocationDigest: digest('wrong-child-allocation'),
          sandbox: sandboxValue,
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
      const sandbox = await recordPrivateRootChildSandbox({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:cas',
        allocationDigest: allocation.allocation.digest,
        sandbox: sandboxValue,
      })
      expect(
        await recordPrivateRootChildSandbox({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocationDigest: allocation.allocation.digest,
          sandbox: sandboxValue,
        }),
      ).toEqual(sandbox)
      await expect(
        recordPrivateRootChildSandbox({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocationDigest: allocation.allocation.digest,
          sandbox: { ...sandboxValue, value: 3 },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
      await expect(
        closePrivateRootChildOwner({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fenceDigest: null,
          cleanupDigest: null,
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })

      const fenceValue = { kind: 'test-child-fence', value: 3 } as const
      await expect(
        recordPrivateRootChildFence({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: digest('wrong-child-sandbox'),
          fence: fenceValue,
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
      const fence = await recordPrivateRootChildFence({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:cas',
        allocationDigest: allocation.allocation.digest,
        sandboxDigest: sandbox.sandbox!.digest,
        fence: fenceValue,
      })
      expect(
        await recordPrivateRootChildFence({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fence: fenceValue,
        }),
      ).toEqual(fence)
      await expect(
        recordPrivateRootChildFence({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fence: { ...fenceValue, value: 4 },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })

      const cleanupValue = { kind: 'test-child-cleanup', value: 4 } as const
      await expect(
        recordPrivateRootChildCleanup({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fenceDigest: digest('wrong-child-fence'),
          cleanup: cleanupValue,
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
      const cleanup = await recordPrivateRootChildCleanup({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:cas',
        allocationDigest: allocation.allocation.digest,
        sandboxDigest: sandbox.sandbox!.digest,
        fenceDigest: fence.fence!.digest,
        cleanup: cleanupValue,
      })
      expect(
        await recordPrivateRootChildCleanup({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fenceDigest: fence.fence!.digest,
          cleanup: cleanupValue,
        }),
      ).toEqual(cleanup)
      await expect(
        recordPrivateRootChildCleanup({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fenceDigest: fence.fence!.digest,
          cleanup: { ...cleanupValue, value: 5 },
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })

      await expect(
        closePrivateRootChildOwner({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:cas',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fenceDigest: fence.fence!.digest,
          cleanupDigest: digest('wrong-child-cleanup'),
        }),
      ).rejects.toMatchObject({ code: 'RUN_CHILD_OWNER_CONFLICT' })
      const close = {
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:cas',
        allocationDigest: allocation.allocation.digest,
        sandboxDigest: sandbox.sandbox!.digest,
        fenceDigest: fence.fence!.digest,
        cleanupDigest: cleanup.cleanup!.digest,
      } as const
      await closePrivateRootChildOwner(close)
      await closePrivateRootChildOwner(close)
      expect(
        await listPrivateRootChildOwners({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
        }),
      ).toEqual([])
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('lets a replacement replay child packets but rejects new sandbox packets for old rows', async () => {
    const replayFixture = await createFixture('ready')
    let first: PrivateProjectCoordinator | undefined
    let replacement: PrivateProjectCoordinator | undefined
    try {
      await admit(replayFixture)
      first = await openPrivateProjectCoordinator({ projectRoot: replayFixture.root })
      const submitted = await submitReadyRun(replayFixture, first, 'child-owner-replay')
      const allocationValue = { kind: 'test-child-allocation', value: 1 } as const
      const sandboxValue = { kind: 'test-child-sandbox', value: 2 } as const
      const fenceValue = { kind: 'test-child-fence', value: 3 } as const
      const cleanupValue = { kind: 'test-child-cleanup', value: 4 } as const
      const allocation = await allocatePrivateRootChildOwner({
        coordinator: first,
        projectRoot: replayFixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:replay',
        allocation: allocationValue,
      })
      const sandbox = await recordPrivateRootChildSandbox({
        coordinator: first,
        projectRoot: replayFixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:replay',
        allocationDigest: allocation.allocation.digest,
        sandbox: sandboxValue,
      })
      const fence = await recordPrivateRootChildFence({
        coordinator: first,
        projectRoot: replayFixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:replay',
        allocationDigest: allocation.allocation.digest,
        sandboxDigest: sandbox.sandbox!.digest,
        fence: fenceValue,
      })
      const cleanup = await recordPrivateRootChildCleanup({
        coordinator: first,
        projectRoot: replayFixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:replay',
        allocationDigest: allocation.allocation.digest,
        sandboxDigest: sandbox.sandbox!.digest,
        fenceDigest: fence.fence!.digest,
        cleanup: cleanupValue,
      })
      await first.dispose()
      first = undefined
      replacement = await openPrivateProjectCoordinator({ projectRoot: replayFixture.root })

      await expect(
        allocatePrivateRootChildOwner({
          coordinator: replacement,
          projectRoot: replayFixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:replay',
          allocation: allocationValue,
        }),
      ).rejects.toMatchObject({ code: 'RUN_OWNER_CHANGED' })
      expect(
        await listPrivateRootChildOwners({
          coordinator: replacement,
          projectRoot: replayFixture.root,
          parentRunId: submitted.run.runId,
        }),
      ).toEqual([cleanup])
      expect(
        await recordPrivateRootChildSandbox({
          coordinator: replacement,
          projectRoot: replayFixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:replay',
          allocationDigest: allocation.allocation.digest,
          sandbox: sandboxValue,
        }),
      ).toEqual(cleanup)
      expect(
        await recordPrivateRootChildFence({
          coordinator: replacement,
          projectRoot: replayFixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:replay',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fence: fenceValue,
        }),
      ).toEqual(cleanup)
      expect(
        await recordPrivateRootChildCleanup({
          coordinator: replacement,
          projectRoot: replayFixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:replay',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fenceDigest: fence.fence!.digest,
          cleanup: cleanupValue,
        }),
      ).toEqual(cleanup)
    } finally {
      await replacement?.dispose()
      await first?.dispose()
      await replayFixture.dispose()
    }

    const transitionFixture = await createFixture('ready')
    first = undefined
    replacement = undefined
    try {
      await admit(transitionFixture)
      first = await openPrivateProjectCoordinator({ projectRoot: transitionFixture.root })
      const submitted = await submitReadyRun(transitionFixture, first, 'child-owner-transition')
      const allocation = await allocatePrivateRootChildOwner({
        coordinator: first,
        projectRoot: transitionFixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:unsealed',
        allocation: { kind: 'test-child-allocation', value: 1 },
      })
      await first.dispose()
      first = undefined
      replacement = await openPrivateProjectCoordinator({ projectRoot: transitionFixture.root })
      await expect(
        recordPrivateRootChildSandbox({
          coordinator: replacement,
          projectRoot: transitionFixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:unsealed',
          allocationDigest: allocation.allocation.digest,
          sandbox: { kind: 'test-child-sandbox', value: 2 },
        }),
      ).rejects.toMatchObject({ code: 'RUN_OWNER_CHANGED' })
      await closePrivateRootChildOwner({
        coordinator: replacement,
        projectRoot: transitionFixture.root,
        parentRunId: submitted.run.runId,
        operationId: 'dispatch:unsealed',
        allocationDigest: allocation.allocation.digest,
        sandboxDigest: null,
        fenceDigest: null,
        cleanupDigest: null,
      })
    } finally {
      await replacement?.dispose()
      await first?.dispose()
      await transitionFixture.dispose()
    }
  })
  test('fails closed on incomplete retained child fact pairs', async () => {
    for (const corruptStage of ['sandbox', 'fence', 'cleanup'] as const) {
      const fixture = await createFixture('ready')
      let coordinator: PrivateProjectCoordinator | undefined
      try {
        await admit(fixture)
        coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
        const submitted = await submitReadyRun(fixture, coordinator, `child-pair-${corruptStage}`)
        const allocation = await allocatePrivateRootChildOwner({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:corrupt',
          allocation: { kind: 'test-child-allocation', value: 1 },
        })
        const sandbox = await recordPrivateRootChildSandbox({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:corrupt',
          allocationDigest: allocation.allocation.digest,
          sandbox: { kind: 'test-child-sandbox', value: 2 },
        })
        const fence = await recordPrivateRootChildFence({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:corrupt',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fence: { kind: 'test-child-fence', value: 3 },
        })
        await recordPrivateRootChildCleanup({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submitted.run.runId,
          operationId: 'dispatch:corrupt',
          allocationDigest: allocation.allocation.digest,
          sandboxDigest: sandbox.sandbox!.digest,
          fenceDigest: fence.fence!.digest,
          cleanup: { kind: 'test-child-cleanup', value: 4 },
        })

        const database = openSqlite(fixture.database, 'readwrite')
        database.exec('PRAGMA ignore_check_constraints=ON')
        database.query(`UPDATE root_child_owners SET ${corruptStage}_bytes = NULL`).run()
        database.close(true)
        await expect(
          listPrivateRootChildOwners({
            coordinator,
            projectRoot: fixture.root,
            parentRunId: submitted.run.runId,
          }),
        ).rejects.toMatchObject({ code: 'ADMISSION_STATE_CORRUPT' })
      } finally {
        await coordinator?.dispose()
        await fixture.dispose()
      }
    }
  })
  test('compare-and-sets one cumulative preparation cleanup packet', async () => {
    const fixture = await createEmptyFixture()
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      expect(
        await readPrivateBunPreparationOwner({
          projectRoot: fixture.root,
          coordinator,
        }),
      ).toBeNull()
      const allocation = { kind: 'test-preparation-owner', stage: 'allocation' } as const
      const first = await replacePrivateBunPreparationOwner({
        projectRoot: fixture.root,
        coordinator,
        expectedDigest: null,
        value: allocation,
      })
      expect(first?.value).toEqual(allocation)
      await expect(
        replacePrivateBunPreparationOwner({
          projectRoot: fixture.root,
          coordinator,
          expectedDigest: null,
          value: allocation,
        }),
      ).rejects.toMatchObject({ code: 'PREPARATION_OWNER_CONFLICT' })
      const sealed = { ...allocation, stage: 'sealed' } as const
      const second = await replacePrivateBunPreparationOwner({
        projectRoot: fixture.root,
        coordinator,
        expectedDigest: first!.digest,
        value: sealed,
      })
      expect(
        (
          await readPrivateBunPreparationOwner({
            projectRoot: fixture.root,
            coordinator,
          })
        )?.value,
      ).toEqual(sealed)
      await replacePrivateBunPreparationOwner({
        projectRoot: fixture.root,
        coordinator,
        expectedDigest: second!.digest,
        value: null,
      })
      expect(
        await readPrivateBunPreparationOwner({
          projectRoot: fixture.root,
          coordinator,
        }),
      ).toBeNull()
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('applies and exactly replays sequential admission generations', async () => {
    const fixture = await createFixture()
    try {
      const firstPlan = seedPlan(fixture, fixture.candidate, {
        baseGeneration: null,
        observedLock: 'absent',
        operation: 'admission',
      })
      const first = requireAdmission(await applyPlan(fixture, firstPlan))
      expect(new Uint8Array(await readFile(join(fixture.root, 'jig.lock')))).toEqual(
        encodePrivateProjectLocalLock(fixture.candidate.lock),
      )
      expect(await applyPlan(fixture, firstPlan)).toEqual(first)

      const secondCandidate = insertCandidate(fixture, 'second-meaning', false)
      const secondPlan = seedPlan(fixture, secondCandidate, {
        baseGeneration: first.admissionDigest,
        observedLock: 'present',
        operation: 'admission',
      })
      const second = requireAdmission(await applyPlan(fixture, secondPlan))
      expect(second.admission.baseGeneration).toBe(first.admissionDigest)
      expect(second.admissionDigest).not.toBe(first.admissionDigest)
      expect(await applyPlan(fixture, firstPlan)).toEqual(first)

      const database = openSqlite(fixture.database, 'readonly')
      try {
        expect(database.query('SELECT count(*) AS count FROM admissions').get()).toEqual({
          count: 2,
        })
        expect(
          database
            .query(
              'SELECT admissions.admission_digest FROM admission_head JOIN admissions USING (revision) WHERE singleton = 1',
            )
            .get().admission_digest,
        ).toBe(second.admissionDigest)
        expect(tableNames(database)).toEqual(TABLES)
      } finally {
        database.close(true)
      }
    } finally {
      await fixture.dispose()
    }
  })
  test('admits a retained execution Package distinct from the source Package', async () => {
    const fixture = await createFixture('ready')
    try {
      const executionPackage = await retainDistinctExecutionPackage(fixture, 'retained')
      const candidate = insertExecutionCandidate(fixture, executionPackage, 'retained')
      const plan = seedPlan(fixture, candidate, {
        baseGeneration: null,
        observedLock: 'absent',
        operation: 'admission',
      })

      const admitted = requireAdmission(await applyPlan(fixture, plan))
      expect(admitted.admission.candidateRevision).toBe(2)
      expect(candidate.candidate.targets[0]!.request.package).toEqual(fixture.flow)
      expect(candidate.candidate.targets[0]!.disposition).toMatchObject({
        state: 'ready',
        execution: { package: executionPackage },
      })
      expect(executionPackage).not.toEqual(fixture.flow)
      expect(
        decodePrivateProjectLocalLock(
          new Uint8Array(await readFile(join(fixture.root, 'jig.lock'))),
        ).packages['flows/run']!.digest,
      ).toBe(fixture.flow.digest)
    } finally {
      await fixture.dispose()
    }
  })
  test('reopens prepared execution bytes only from the captured active admission', async () => {
    const fixture = await createFixture('ready')
    try {
      const request = fixture.candidate.candidate.targets[0]!.request
      const before = await capturePrivateActivationPlanningBase({ projectRoot: fixture.root })
      expect(readPrivateAdmittedExecutionReuse({ planningBase: before, request })).toBeUndefined()

      await admit(fixture)
      const after = await capturePrivateActivationPlanningBase({ projectRoot: fixture.root })
      expect(readPrivateAdmittedExecutionReuse({ planningBase: after, request })).toEqual({
        execution: { package: fixture.flow, layout: { flowRoot: '', members: [], aliases: [] } },
      })
      const changed = (changes: Record<string, unknown>) => {
        const { digest: _, ...fields } = request
        return restorePrivateActivationRequest(activationRequest({ ...fields, ...changes }))
      }
      // Dependency reuse does not carry the old request's source/settings approval.
      expect(
        readPrivateAdmittedExecutionReuse({
          planningBase: after,
          request: changed({
            settings: { changed: true },
            package: { ...request.package, digest: digest('new-source') },
          }),
        })?.execution.package,
      ).toEqual(fixture.flow)
      expect(
        readPrivateAdmittedExecutionReuse({
          planningBase: after,
          request: changed({ packagePath: 'flows/other' }),
        }),
      ).toBeUndefined()
      expect(
        readPrivateAdmittedExecutionReuse({
          planningBase: after,
          request: changed({ target: { kind: 'binding', id: 'other' } }),
        }),
      ).toBeUndefined()
    } finally {
      await fixture.dispose()
    }
  })
  test('reopens the exact Binding slot map from its admitted Candidate', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      const candidate = await insertSlottedCandidate(fixture)
      const plan = seedPlan(fixture, candidate, {
        baseGeneration: null,
        observedLock: 'absent',
        operation: 'admission',
      })
      requireAdmission(await applyPlan(fixture, plan))
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const submitted = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: 'slotted-admission',
        target: { kind: 'binding', id: 'router' },
        input: { value: 'slotted' },
        deadlineUnixMs: Date.now() + 60_000,
      })
      const reopened = await reacquirePrivateRootExecutionWork({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runId: submitted.run.runId,
      })
      const request = reopened.candidate.candidate.targets.find(
        ({ request }) => request.target.kind === 'binding',
      )!.request
      expect(request.slots).toEqual({
        child: { kind: 'flow', target: { kind: 'flow', path: 'flows/child' } },
      })
      expect(Object.isFrozen(request.slots)).toBeTrue()
      expect(reopened.candidate.lock.bindings.router!.slots).toEqual({
        child: { kind: 'flow', path: 'flows/child' },
      })
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('invented retained attachment declarations refuse admission before lock or authority mutation', async () => {
    const fixture = await createFixture('ready')
    try {
      const { digest: _requestDigest, ...request } = fixture.candidate.candidate.targets[0]!.request
      const targets = [
        {
          ...fixture.candidate.candidate.targets[0]!,
          request: activationRequest({ ...request, attachments: { invented: 'read' } }),
        },
      ]
      const candidate = decodePrivateActivationCandidateV5({
        candidate: json1({
          ...fixture.candidate.candidate,
          targets,
          activationMeaningDigest: activationMeaning(
            fixture.candidate.candidate.observedSemanticDigest,
            targets,
          ),
        } as unknown as JsonValue),
        lock: encodePrivateProjectLocalLock(fixture.candidate.lock),
      })
      insertCandidateRow(fixture.database, 2, candidate, true)
      const plan = seedPlan(fixture, candidate, {
        baseGeneration: null,
        observedLock: 'absent',
        operation: 'admission',
      })
      const before = activationAuthoritySnapshot(fixture.database)
      await expect(applyPlan(fixture, plan)).rejects.toMatchObject({
        code: 'ADMISSION_ARTIFACT_MISMATCH',
      })
      expect(activationAuthoritySnapshot(fixture.database)).toEqual(before)
      await expect(stat(join(fixture.root, 'jig.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fixture.dispose()
    }
  })
  test('missing execution Package fails before Candidate, Plan, or admission mutation', async () => {
    const fixture = await createFixture('ready')
    try {
      const missing = normalizePackageArtifactRef({
        kind: 'flow-package/0',
        digest: digest('missing-execution-package'),
      })
      const candidate = insertExecutionCandidate(fixture, missing, 'missing')
      const plan = seedPlan(fixture, candidate, {
        baseGeneration: null,
        observedLock: 'absent',
        operation: 'admission',
      })
      const before = activationAuthoritySnapshot(fixture.database)

      await expect(applyPlan(fixture, plan)).rejects.toMatchObject({
        code: 'PACKAGE_ARTIFACT_MISSING',
      })
      expect(activationAuthoritySnapshot(fixture.database)).toEqual(before)
      await expect(stat(join(fixture.root, 'jig.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fixture.dispose()
    }
  })
  for (const [suiteCaseIndex, suiteCaseValue] of (
    ['execution', 'dependencies'] as const
  ).entries()) {
    test(
      'corrupt %s Package fails before Candidate, Plan, or admission mutation' +
        ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
          async (kind) => {
            const fixture = await createFixture('ready')
            try {
              const executionPackage = await retainDistinctExecutionPackage(fixture, 'corrupt')
              const dependencies =
                kind === 'dependencies'
                  ? await retainDistinctExecutionPackage(fixture, 'dependencies')
                  : undefined
              const candidate = insertExecutionCandidate(
                fixture,
                executionPackage,
                'corrupt',
                dependencies,
              )
              const plan = seedPlan(fixture, candidate, {
                baseGeneration: null,
                observedLock: 'absent',
                operation: 'admission',
              })
              const artifact = packageArtifactPath(fixture.store, dependencies ?? executionPackage)
              await chmod(artifact, 0o600)
              await writeFile(artifact, 'corrupt\n')
              await chmod(artifact, 0o400)
              const before = activationAuthoritySnapshot(fixture.database)

              await expect(applyPlan(fixture, plan)).rejects.toMatchObject({
                code: 'PACKAGE_ARTIFACT_CORRUPT',
              })
              expect(activationAuthoritySnapshot(fixture.database)).toEqual(before)
              await expect(stat(join(fixture.root, 'jig.lock'))).rejects.toMatchObject({
                code: 'ENOENT',
              })
            } finally {
              await fixture.dispose()
            }
          },
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
    )
  }
  test('repairs the visible lock without creating another authority record', async () => {
    const fixture = await createFixture()
    try {
      const admitted = requireAdmission(
        await applyPlan(
          fixture,
          seedPlan(fixture, fixture.candidate, {
            baseGeneration: null,
            observedLock: 'absent',
            operation: 'admission',
          }),
        ),
      )
      const lockPath = join(fixture.root, 'jig.lock')
      await rm(lockPath)
      const repairCandidate = insertCandidate(fixture, 'equivalent-capture', true)
      const repairPlan = seedPlan(fixture, repairCandidate, {
        baseGeneration: admitted.admissionDigest,
        observedLock: 'absent',
        operation: 'lock-repair',
      })

      expect(await applyPlan(fixture, repairPlan)).toEqual({
        operation: 'lock-repair',
        planDigest: repairPlan,
      })
      expect(new Uint8Array(await readFile(lockPath))).toEqual(
        encodePrivateProjectLocalLock(fixture.candidate.lock),
      )

      await rm(lockPath)
      expect(await applyPlan(fixture, repairPlan)).toEqual({
        operation: 'lock-repair',
        planDigest: repairPlan,
      })
      const database = openSqlite(fixture.database, 'readonly')
      try {
        expect(database.query('SELECT count(*) AS count FROM admissions').get()).toEqual({
          count: 1,
        })
        expect(
          database.query('SELECT revision FROM admission_head WHERE singleton = 1').get(),
        ).toEqual({ revision: 1 })
        expect(tableNames(database)).toEqual(TABLES)
      } finally {
        database.close(true)
      }
      await expect(stat(join(fixture.root, '.jig', 'jig-lock.stage'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await fixture.dispose()
    }
  })
  test('rejects a stale competing admission plan', async () => {
    const fixture = await createFixture()
    try {
      const first = requireAdmission(
        await applyPlan(
          fixture,
          seedPlan(fixture, fixture.candidate, {
            baseGeneration: null,
            observedLock: 'absent',
            operation: 'admission',
          }),
        ),
      )
      const staleCandidate = insertCandidate(fixture, 'stale-meaning', false)
      const stalePlan = seedPlan(fixture, staleCandidate, {
        baseGeneration: first.admissionDigest,
        observedLock: 'present',
        operation: 'admission',
      })
      const currentCandidate = insertCandidate(fixture, 'current-meaning', false)
      const currentPlan = seedPlan(fixture, currentCandidate, {
        baseGeneration: first.admissionDigest,
        observedLock: 'present',
        operation: 'admission',
      })

      await expect(applyPlan(fixture, stalePlan)).rejects.toMatchObject({ code: 'STALE_PLAN' })
      const current = requireAdmission(await applyPlan(fixture, currentPlan))
      expect(current.admission.candidateRevision).toBe(3)
      const database = openSqlite(fixture.database, 'readonly')
      try {
        expect(database.query('SELECT count(*) AS count FROM admissions').get()).toEqual({
          count: 2,
        })
      } finally {
        database.close(true)
      }
    } finally {
      await fixture.dispose()
    }
  })
  test('converges a lock-first crash without replacing exact visible bytes', async () => {
    const fixture = await createFixture()
    try {
      const plan = seedPlan(fixture, fixture.candidate, {
        baseGeneration: null,
        observedLock: 'absent',
        operation: 'admission',
      })
      const lockPath = join(fixture.root, 'jig.lock')
      const stagePath = join(fixture.root, '.jig', 'jig-lock.stage')
      const lock = encodePrivateProjectLocalLock(fixture.candidate.lock)
      await writeFile(lockPath, lock, { mode: 0o644 })
      await writeFile(stagePath, 'abandoned stage', { mode: 0o600 })
      const before = await stat(lockPath)

      requireAdmission(await applyPlan(fixture, plan))
      expect((await stat(lockPath)).ino).toBe(before.ino)
      expect(new Uint8Array(await readFile(lockPath))).toEqual(lock)
      await expect(stat(stagePath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fixture.dispose()
    }
  })
  test('root observation reads pending facts without acquiring a coordinator or changing state', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const { run } = await submitReadyRun(fixture, coordinator, 'root-observation')
      await writeFile(join(fixture.root, 'jig.ts'), 'throw new Error("must not evaluate")')
      const before = await readFile(fixture.database)
      const information = await stat(fixture.database)
      const coordinatorDatabase = join(fixture.root, '.jig/coordinator.sqlite3')
      const coordinatorBytes = await readFile(coordinatorDatabase)
      const entries = (await readdir(join(fixture.root, '.jig'))).sort()

      expect(await readPrivateRootRun({ projectRoot: fixture.root, runId: run.runId })).toEqual(run)
      await expect(
        readPrivateRootRun({ projectRoot: fixture.root, runId: digest('absent-root') }),
      ).rejects.toMatchObject({ code: 'RUN_MISSING' })
      await expect(
        readPrivateRootRun({ projectRoot: fixture.root, runId: 'invalid' }),
      ).rejects.toThrow()

      expect(await readFile(fixture.database)).toEqual(before)
      expect((await stat(fixture.database)).mtimeMs).toBe(information.mtimeMs)
      expect(await readFile(coordinatorDatabase)).toEqual(coordinatorBytes)
      expect((await readdir(join(fixture.root, '.jig'))).sort()).toEqual(entries)
      await coordinator.verify()
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('root observation preserves terminal facts after coordinator closure without recovery', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const { run } = await submitReadyRun(fixture, coordinator, 'terminal-observation')
      const terminal = successTerminal({ checked: true })
      await recordTerminalPackets(fixture, coordinator, run.runId, terminal)
      await closePrivateRootExecution({
        coordinator,
        projectRoot: fixture.root,
        runId: run.runId,
        terminal,
      })
      await coordinator.dispose()
      coordinator = undefined
      const before = await readFile(fixture.database)
      const information = await stat(fixture.database)
      const entries = (await readdir(join(fixture.root, '.jig'))).sort()

      expect(await readPrivateRootRun({ projectRoot: fixture.root, runId: run.runId })).toEqual({
        ...run,
        state: 'terminal',
        terminal,
      })
      expect(await readFile(fixture.database)).toEqual(before)
      expect((await stat(fixture.database)).mtimeMs).toBe(information.mtimeMs)
      expect((await readdir(join(fixture.root, '.jig'))).sort()).toEqual(entries)
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('root observation never creates missing state or repairs an empty database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-root-observation-empty-'))
    const runId = digest('unknown-root')
    try {
      await expect(readPrivateRootRun({ projectRoot: root, runId })).rejects.toMatchObject({
        code: 'ADMISSION_STATE_MISSING',
      })
      expect(await readdir(root)).toEqual([])
      await mkdir(join(root, '.jig'), { mode: 0o700 })
      await expect(readPrivateRootRun({ projectRoot: root, runId })).rejects.toMatchObject({
        code: 'ADMISSION_STATE_MISSING',
      })
      expect(await readdir(join(root, '.jig'))).toEqual([])
      const database = join(root, '.jig/jig.sqlite3')
      await writeFile(database, '', { mode: 0o600 })
      await expect(readPrivateRootRun({ projectRoot: root, runId })).rejects.toMatchObject({
        code: 'ADMISSION_SCHEMA_VERSION',
      })
      expect((await readFile(database)).length).toBe(0)
      expect(await readdir(join(root, '.jig'))).toEqual(['jig.sqlite3'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  test('allocates an idempotent root submission and rejects changed reuse', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const deadlineUnixMs = Date.now() + 60_000
      const input = { value: 'first', nested: { a: 1, b: 2 } } as const
      const created = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: 'ticket-1',
        target: { kind: 'flow', path: 'flows/run' },
        input,
        deadlineUnixMs,
      })
      expect(created.run).toMatchObject({ state: 'spawn-intent', coordinatorEpoch: 1 })
      expect(
        (
          await listPrivateRootExecutionWork({
            coordinator,
            projectRoot: fixture.root,
            epoch: 'current',
          })
        ).map(({ run }) => run.runId),
      ).toEqual([created.run.runId])

      const replay = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: 'ticket-1',
        target: { kind: 'flow', path: './flows/run' },
        input: { nested: { b: 2, a: 1 }, value: 'first' },
        deadlineUnixMs,
      })
      expect(replay.run).toEqual(created.run)

      await expect(
        submitPrivateRootRun({
          coordinator,
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          submissionId: 'ticket-1',
          target: { kind: 'flow', path: 'flows/run' },
          input: { value: 'changed' },
          deadlineUnixMs,
        }),
      ).rejects.toMatchObject({ code: 'SUBMISSION_CONFLICT' })

      const invalid = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: 'invalid-input',
        target: { kind: 'flow', path: 'flows/run' },
        input: { unexpected: true },
        deadlineUnixMs,
      })
      expect(invalid.run).toMatchObject({
        state: 'terminal',
        terminal: { status: 'failed', code: 'INVALID_INPUT' },
      })
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('inspection exposes retained availability separately from approval freshness and refuses its root before dispatch', async () => {
    const fixture = await createFixture('unavailable')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      const store = join(fixture.root, '.jig/private-package-store')
      await rename(fixture.store, store)
      const list = await inspectPrivateApprovedProject(fixture.root)
      expect(list).toMatchObject({
        state: 'unchecked',
        targets: [
          {
            target: 'flow:flows/run',
            availability: {
              state: 'unavailable',
              code: 'RUNTIME_UNAVAILABLE',
              evidenceDigests: [digest('runtime-unavailable')],
            },
          },
        ],
      })
      expect(await inspectPrivateApprovedProject(fixture.root, 'flow:flows/run')).toMatchObject({
        state: 'unchecked',
        availability: { state: 'unavailable', code: 'RUNTIME_UNAVAILABLE' },
      })
      expect(
        await inspectPrivateApprovedProject(
          fixture.root,
          'flow:flows/run',
          async () => 'environment-matches',
        ),
      ).toMatchObject({
        state: 'environment-matches',
        availability: { state: 'unavailable', code: 'RUNTIME_UNAVAILABLE' },
      })
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const refused = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: store,
        submissionId: 'retained-unavailable',
        target: { kind: 'flow', path: 'flows/run' },
        input: { value: 'unused' },
        deadlineUnixMs: Date.now() + 60_000,
      })
      expect(refused.run).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'failed',
          code: 'UNAVAILABLE',
          details: {
            code: 'RUN_TARGET_UNAVAILABLE',
            availability: {
              state: 'unavailable',
              code: 'RUNTIME_UNAVAILABLE',
              evidenceDigests: [digest('runtime-unavailable')],
            },
          },
        },
      })
      expect(
        await listPrivateRootExecutionWork({
          coordinator,
          projectRoot: fixture.root,
          epoch: 'current',
        }),
      ).toEqual([])
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('missing root targets suggest only admitted targets without dispatch', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      await mkdir(join(fixture.root, 'flows', 'unreviewed'), { recursive: true })
      await writeFile(join(fixture.root, 'flows', 'unreviewed', 'FLOW.md'), 'unreviewed source')
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const missing = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: 'unknown-target',
        target: { kind: 'flow', path: 'flows/unreviewed' },
        input: {},
        deadlineUnixMs: Date.now() + 60_000,
      })
      expect(missing.run).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'failed',
          code: 'UNAVAILABLE',
          details: {
            code: 'RUN_TARGET_NOT_FOUND',
            availableTargets: ['flow:flows/run'],
            remainingTargets: 0,
          },
        },
      })
      expect(
        await listPrivateRootExecutionWork({
          coordinator,
          projectRoot: fixture.root,
          epoch: 'current',
        }),
      ).toEqual([])
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('enforces ordered write-once root checkpoint packets and one matching terminal row', async () => {
    const fixture = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      const submission = await submitReadyRun(fixture, coordinator, 'lifecycle')
      const runId = submission.run.runId
      const terminal = successTerminal({ accepted: true })

      await expect(
        checkpoint(fixture, coordinator, runId, 'sandbox', { owner: 'early' }),
      ).rejects.toMatchObject({ code: 'RUN_EXECUTION_ORDER' })
      const planned = await checkpoint(fixture, coordinator, runId, 'plan', { recipe: 'exact' })
      expect(await checkpoint(fixture, coordinator, runId, 'plan', { recipe: 'exact' })).toEqual(
        planned,
      )
      await expect(
        checkpoint(fixture, coordinator, runId, 'plan', { recipe: 'changed' }),
      ).rejects.toMatchObject({ code: 'RUN_EXECUTION_CHECKPOINT_CONFLICT' })

      await checkpoint(fixture, coordinator, runId, 'backing', { package: 'retained' })
      await checkpoint(fixture, coordinator, runId, 'sandbox', { owner: 'sandbox-1' })
      await checkpoint(fixture, coordinator, runId, 'prepared', { ready: true })
      await checkpoint(fixture, coordinator, runId, 'provisional', terminal as unknown as JsonValue)
      await expect(
        closePrivateRootExecution({
          coordinator,
          projectRoot: fixture.root,
          runId,
          terminal,
        }),
      ).rejects.toMatchObject({ code: 'RUN_EXECUTION_INCOMPLETE' })
      await expect(
        checkpoint(fixture, coordinator, runId, 'release', { released: true }),
      ).rejects.toMatchObject({ code: 'RUN_EXECUTION_ORDER' })
      await checkpoint(fixture, coordinator, runId, 'fence', { populated: false })
      await checkpoint(fixture, coordinator, runId, 'release', { released: true })
      await expect(
        checkpoint(
          fixture,
          coordinator,
          runId,
          'admitted',
          successTerminal({ accepted: false }) as unknown as JsonValue,
        ),
      ).rejects.toMatchObject({ code: 'RUN_TERMINAL_CONFLICT' })
      const admitted = await checkpoint(
        fixture,
        coordinator,
        runId,
        'admitted',
        terminal as unknown as JsonValue,
      )
      expect(
        (
          await reacquirePrivateRootExecutionWork({
            coordinator,
            projectRoot: fixture.root,
            packageStoreRoot: fixture.store,
            runId,
          })
        ).lifecycle,
      ).toEqual(admitted)

      const completed = await closePrivateRootExecution({
        coordinator,
        projectRoot: fixture.root,
        runId,
        terminal,
      })
      expect(completed).toMatchObject({ state: 'terminal', terminal: { status: 'succeeded' } })
      expect(
        await closePrivateRootExecution({
          coordinator,
          projectRoot: fixture.root,
          runId,
          terminal,
        }),
      ).toEqual(completed)
      expect(
        await loadPrivateRootRunForCoordinator({
          coordinator,
          projectRoot: fixture.root,
          runId,
        }),
      ).toEqual(completed)

      const database = openSqlite(fixture.database, 'readonly')
      try {
        expect(database.query('SELECT count(*) AS count FROM root_terminals').get()).toEqual({
          count: 1,
        })
        expect(tableNames(database)).toEqual(TABLES)
      } finally {
        database.close(true)
      }
    } finally {
      await coordinator?.dispose()
      await fixture.dispose()
    }
  })
  test('reacquires older stored work without allocating another root or allowing new plan packets', async () => {
    const fixture = await createFixture('ready')
    let first: PrivateProjectCoordinator | undefined
    let replacement: PrivateProjectCoordinator | undefined
    try {
      await admit(fixture)
      first = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      await expect(
        openPrivateProjectCoordinator({ projectRoot: fixture.root }),
      ).rejects.toMatchObject({ code: 'COORDINATOR_BUSY' })
      const deadlineUnixMs = Date.now() + 60_000
      const created = await submitReadyRun(fixture, first, 'recover', deadlineUnixMs)
      const beforeRestart = await reacquirePrivateRootExecutionWork({
        coordinator: first,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runId: created.run.runId,
      })
      await first.dispose()
      first = undefined

      replacement = await openPrivateProjectCoordinator({ projectRoot: fixture.root })
      expect(replacement.epoch).toBe(2)
      expect(replacement.recoveredRootRuns).toEqual([
        expect.objectContaining({ runId: created.run.runId, coordinatorEpoch: 1 }),
      ])
      expect(
        await listPrivateRootExecutionWork({
          coordinator: replacement,
          projectRoot: fixture.root,
          epoch: 'current',
        }),
      ).toEqual([])
      expect(
        (
          await listPrivateRootExecutionWork({
            coordinator: replacement,
            projectRoot: fixture.root,
            epoch: 'older',
          })
        ).map(({ run }) => run.runId),
      ).toEqual([created.run.runId])
      const recovered = await reacquirePrivateRootExecutionWork({
        coordinator: replacement,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runId: created.run.runId,
      })
      expect(recovered.run).toEqual(created.run)
      expect(recovered.lifecycle).toEqual(beforeRestart.lifecycle)

      const replay = await submitPrivateRootRun({
        coordinator: replacement,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: 'recover',
        target: { kind: 'flow', path: 'flows/run' },
        input: { value: 'recover' },
        deadlineUnixMs,
      })
      const database = openSqlite(fixture.database, 'readonly')
      try {
        expect(database.query('SELECT count(*) AS count FROM root_runs').get()).toEqual({
          count: 1,
        })
      } finally {
        database.close(true)
      }
      await expect(
        checkpoint(fixture, replacement, created.run.runId, 'plan', { recipe: 'must-not-restart' }),
      ).rejects.toMatchObject({ code: 'RUN_COORDINATOR_STALE' })

      const lost = {
        status: 'lost' as const,
        code: 'COORDINATOR_LOST' as const,
        message: 'the prior coordinator disappeared before a proved result',
      }
      await checkpoint(
        fixture,
        replacement,
        created.run.runId,
        'provisional',
        lost as unknown as JsonValue,
      )
      await checkpoint(fixture, replacement, created.run.runId, 'release', { released: true })
      await checkpoint(
        fixture,
        replacement,
        created.run.runId,
        'admitted',
        lost as unknown as JsonValue,
      )
      expect(
        await closePrivateRootExecution({
          coordinator: replacement,
          projectRoot: fixture.root,
          runId: created.run.runId,
          terminal: lost,
        }),
      ).toMatchObject({ state: 'terminal', terminal: lost })
    } finally {
      await replacement?.dispose()
      await first?.dispose()
      await fixture.dispose()
    }
  })
  test('fails closed on current Candidate, Plan, admission, and terminal corruption', async () => {
    const candidate = await createFixture()
    try {
      const plan = seedPlan(candidate, candidate.candidate, {
        baseGeneration: null,
        observedLock: 'absent',
        operation: 'admission',
      })
      const database = openSqlite(candidate.database, 'readwrite')
      database
        .query('UPDATE candidates SET candidate_digest = ?1 WHERE revision = 1')
        .run(digest('forged-candidate'))
      database.close(true)
      await expect(applyPlan(candidate, plan)).rejects.toMatchObject({
        code: 'ADMISSION_STATE_CORRUPT',
      })
    } finally {
      await candidate.dispose()
    }

    const plan = await createFixture()
    try {
      const planDigest = seedPlan(plan, plan.candidate, {
        baseGeneration: null,
        observedLock: 'absent',
        operation: 'admission',
      })
      const database = openSqlite(plan.database, 'readwrite')
      database
        .query('UPDATE review_plans SET plan_bytes = ?1 WHERE plan_digest = ?2')
        .run(json1({ kind: 'not-a-plan' }), planDigest)
      database.close(true)
      await expect(applyPlan(plan, planDigest)).rejects.toMatchObject({
        code: 'ADMISSION_STATE_CORRUPT',
      })
    } finally {
      await plan.dispose()
    }

    const admission = await createFixture('ready')
    let coordinator: PrivateProjectCoordinator | undefined
    try {
      await admit(admission)
      const database = openSqlite(admission.database, 'readwrite')
      database
        .query('UPDATE admissions SET admission_bytes = ?1 WHERE revision = 1')
        .run(json1({ kind: 'not-an-admission' }))
      database.close(true)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: admission.root })
      await expect(
        submitReadyRun(admission, coordinator, 'corrupt-admission'),
      ).rejects.toMatchObject({ code: 'ADMISSION_STATE_CORRUPT' })
    } finally {
      await coordinator?.dispose()
      await admission.dispose()
    }

    const terminal = await createFixture('ready')
    coordinator = undefined
    try {
      await admit(terminal)
      coordinator = await openPrivateProjectCoordinator({ projectRoot: terminal.root })
      const submitted = await submitReadyRun(terminal, coordinator, 'corrupt-terminal')
      const value = successTerminal({ ok: true })
      await recordTerminalPackets(terminal, coordinator, submitted.run.runId, value)
      await closePrivateRootExecution({
        coordinator,
        projectRoot: terminal.root,
        runId: submitted.run.runId,
        terminal: value,
      })
      const database = openSqlite(terminal.database, 'readwrite')
      database
        .query('UPDATE root_terminals SET terminal_digest = ?1 WHERE run_id = ?2')
        .run(digest('forged-terminal'), submitted.run.runId)
      database.close(true)
      await expect(
        loadPrivateRootRunForCoordinator({
          coordinator,
          projectRoot: terminal.root,
          runId: submitted.run.runId,
        }),
      ).rejects.toMatchObject({ code: 'ADMISSION_STATE_CORRUPT' })
      const corruptBytes = await readFile(terminal.database)
      await expect(
        readPrivateRootRun({ projectRoot: terminal.root, runId: submitted.run.runId }),
      ).rejects.toMatchObject({ code: 'ADMISSION_STATE_CORRUPT' })
      expect(await readFile(terminal.database)).toEqual(corruptBytes)
    } finally {
      await coordinator?.dispose()
      await terminal.dispose()
    }
  }, 60_000)
  test('rejects schema drift, weak permissions, and unsafe SQLite sidecars', async () => {
    const schema = await createEmptyFixture()
    try {
      const database = openSqlite(schema.database, 'readwrite')
      database.exec('PRAGMA user_version=2')
      database.close(true)
      await expect(
        openPrivateProjectCoordinator({ projectRoot: schema.root }),
      ).rejects.toMatchObject({ code: 'ADMISSION_SCHEMA_VERSION' })
    } finally {
      await schema.dispose()
    }

    const permissions = await createEmptyFixture()
    try {
      await chmod(permissions.database, 0o644)
      await expect(
        openPrivateProjectCoordinator({ projectRoot: permissions.root }),
      ).rejects.toMatchObject({ code: 'ADMISSION_DATABASE_PERMISSIONS' })
    } finally {
      await permissions.dispose()
    }

    const sidecar = await createEmptyFixture()
    try {
      await writeFile(`${sidecar.database}-wal`, new Uint8Array(), { mode: 0o600 })
      await expect(
        openPrivateProjectCoordinator({ projectRoot: sidecar.root }),
      ).rejects.toMatchObject({ code: 'ADMISSION_SQLITE_SIDECAR' })
    } finally {
      await sidecar.dispose()
    }
  })
})
