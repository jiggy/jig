import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkAcpSetup,
  configuredAcpModel,
  isExpectedAcpRefusal,
  PrivateAcpSetupError,
} from '../src/internal/acp-setup-diagnostics.js'
import {
  createPrivateActivationPlanV2,
  decodePrivateActivationCandidateV5,
  decodePrivateActivationPlanV2,
  encodePrivateActivationPlanV2,
} from '../src/internal/activation-admission.js'
import { createPrivateActivationPlanningObservation } from '../src/internal/activation-planning.js'
import { privateBunExecutionArtifact } from '../src/internal/bun-execution-layout.js'
import { privateDomainDigest } from '../src/internal/identity.js'
import { openPrivateInstalledBunSupport } from '../src/internal/installed-bun-support.js'
import { resolvePrivateNativeAgentExecutable } from '../src/internal/native-agent-executable.js'
import { openPrivateAcpResources } from '../src/internal/private-acp-resources.js'
import {
  FINITE_ACP_CONTRACT_DIGEST,
  FINITE_ACP_CONTRACT_ID,
  FINITE_ACP_CONTRACT_VERSION,
} from '../src/internal/private-finite-acp-contract.js'
import {
  decodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from '../src/internal/project-local-lock.js'
import {
  privateAgentReadinessReport,
  qualifyPrivateProjectAcpResources,
} from '../src/internal/project-resource-qualification.js'
import {
  assertPrivateResourceQualification,
  privateResourceFailureEvidence,
} from '../src/internal/resource-qualification-evidence.js'
import type { JsonValue } from '../src/json.js'
import { canonicalJson } from '../src/json.js'
import type { InvocationSlots } from '../src/project/invocation-slots.js'
import { restorePrivateActivationRequest } from '../src/project/package-resolution.js'
import type { PrivateRetainedPackageProject } from '../src/project/retained-project.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const digest = (s: string) => privateDomainDigest('test-readiness', s)
const native: InvocationSlots = {
  native: {
    kind: 'native',
    native: 'finite-acp',
    grant: { kind: 'acp', client: 'pi' },
    contract: {
      id: FINITE_ACP_CONTRACT_ID,
      version: FINITE_ACP_CONTRACT_VERSION,
      digest: FINITE_ACP_CONTRACT_DIGEST,
    },
  },
}
function request(id: string, slots: InvocationSlots = {}) {
  const value = {
    kind: 'activation-request/4',
    target: { kind: 'binding', id },
    mode: 'run',
    packagePath: `flows/${id}`,
    package: { kind: 'flow-package/0', digest: digest(id) },
    entrypoint: { path: 'FLOW.ts', suffix: 'ts' },
    settings: {},
    attachments: {},
    slots,
  }
  return restorePrivateActivationRequest({
    ...value,
    digest: privateDomainDigest('JIG-Activation-Request/4', value as JsonValue),
  })
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-resource-readiness-')))
  roots.push(root)
  const project = join(root, 'project')
  await mkdir(project)
  const support = await openPrivateInstalledBunSupport(installedBunLocation)
  return { root, project, support }
}
async function qualify(
  requests: ReturnType<typeof request>[],
  f: Awaited<ReturnType<typeof fixture>>,
  opener?: Parameters<typeof openPrivateAcpResources>[3],
  project = f.project,
) {
  return qualifyPrivateProjectAcpResources({
    requests,
    resources: openPrivateAcpResources(f.support, { PATH: '' }, project, opener),
    installedSupport: f.support,
    featureFailures: new Map(),
    signal: new AbortController().signal,
  })
}

test('real missing native executable disables only exact selected dependents, including mixed routes', async () => {
  const f = await fixture(),
    agent = request('agent', native),
    code = request('code')
  const mixed = request('mixed', {
    interpreter: { kind: 'flow', target: agent.target },
    converter: { kind: 'flow', target: code.target },
  })
  const root = request('root', { worker: { kind: 'flow', target: mixed.target } })
  const requests = [root, mixed, code, agent]
  const failed = await qualify(requests, f)
  expect(failed.size).toBe(3)
  expect(failed.has('binding\0code')).toBeFalse()
  expect(failed.get('binding\0agent')?.cause).toEqual({
    kind: 'acp',
    slot: 'native',
    client: 'pi',
    diagnostic: 'PROJECT_ACP_PI_EXECUTABLE',
  })
  expect(failed.get('binding\0mixed')?.cause).toEqual({
    kind: 'dependency',
    slot: 'interpreter',
    target: agent.target,
  })
  expect(failed.get('binding\0root')?.cause).toEqual({
    kind: 'dependency',
    slot: 'worker',
    target: mixed.target,
  })
  const targets = requests.map((request) => ({
    request,
    disposition: failed.get(
      `binding\0${request.target.kind === 'binding' ? request.target.id : ''}`,
    ) ?? { state: 'ready' },
  }))
  expect(() => assertPrivateResourceQualification(targets)).not.toThrow()
  expect(() =>
    assertPrivateResourceQualification(
      targets.map((target) =>
        target.request === mixed ? { ...target, disposition: { state: 'ready' } } : target,
      ),
    ),
  ).toThrow('unavailable dependency')
  const leaf = targets.find((t) => t.request === agent)!
  expect(() =>
    assertPrivateResourceQualification([
      {
        ...leaf,
        disposition: {
          state: 'unavailable',
          code: 'RUNTIME_UNAVAILABLE',
          evidenceDigests: [digest('forged')],
        },
      },
    ]),
  ).toThrow('closed readiness cause')
  expect(() =>
    assertPrivateResourceQualification([
      { ...leaf, disposition: { ...leaf.disposition, evidenceDigests: [digest('forged')] } },
    ]),
  ).toThrow('retained cause')
})

test('constructor/display codes and arbitrary real wrapper failures never mint expected provenance', async () => {
  expect(isExpectedAcpRefusal(new PrivateAcpSetupError('executable'))).toBeFalse()
  for (const raw of [
    new Error('private I/O'),
    Object.assign(new Error('cancel'), { name: 'AbortError' }),
  ]) {
    try {
      await checkAcpSetup('executable', () => {
        throw raw
      })
    } catch (error) {
      expect(isExpectedAcpRefusal(error)).toBeFalse()
    }
  }
  const f = await fixture()
  await expect(
    qualify([request('agent', native)], f, async () =>
      checkAcpSetup('executable', () => {
        throw new Error('private error')
      }),
    ),
  ).rejects.toMatchObject({ code: 'PROJECT_ACP_PI_EXECUTABLE' })
  // Failure to locate the project is owner/input integrity, not an executable absence.
  try {
    await resolvePrivateNativeAgentExecutable('pi', { PATH: '' }, join(f.root, 'absent-project'))
  } catch (error) {
    expect(isExpectedAcpRefusal(error)).toBeFalse()
  }
})

test('unsupported dispatcher and changed executable identity remain fatal through real discovery wrappers', async () => {
  const f = await fixture(),
    bin = join(f.root, 'bin')
  await mkdir(bin)
  const shim = join(f.root, 'volta-shim')
  await writeFile(shim, 'dispatcher', { mode: 0o700 })
  await symlink(shim, join(bin, 'pi'))
  await expect(
    qualify([request('agent', native)], f, async () => {
      await resolvePrivateNativeAgentExecutable('pi', { PATH: bin }, f.project)
      throw new Error('unreachable')
    }),
  ).rejects.toMatchObject({ code: 'PROJECT_ACP_PI_WRAPPER' })
})

test('allowlisted actual selected-executable observations are expected; arbitrary configuration predicates are not inferred', async () => {
  const f = await fixture()
  for (const selected of [join(f.root, 'missing'), 'relative', '']) {
    try {
      await resolvePrivateNativeAgentExecutable('pi', { PI_PATH: selected }, f.project)
    } catch (error) {
      expect(isExpectedAcpRefusal(error)).toBeTrue()
    }
  }
  const signal = AbortSignal.abort(new Error('cancel'))
  await expect(
    qualifyPrivateProjectAcpResources({
      requests: [request('agent', native)],
      resources: undefined,
      installedSupport: f.support,
      featureFailures: new Map(),
      signal,
    }),
  ).rejects.toThrow('cancel')
})

test('private readiness report uses captured custom grant bytes, complete recipient set and independent counts', async () => {
  const f = await fixture(),
    agent = request('agent', native),
    code = request('code'),
    requests = [agent, code]
  const failures = await qualify(requests, f)
  const bytes = new TextEncoder().encode('{ "kind":"acp", "client":"pi", "maxTurns":2 }\n')
  const policy = { kind: 'acp', client: 'pi', maxTurns: 2 } as const
  const aggregate = {
    project: { value: { entrypoint: 'binding:agent' } },
    root: { device: '1', inode: '2' },
    bindings: [
      {
        id: 'agent',
        sourcePath: 'bindings/custom.ts',
        evaluation: { value: { slots: { native: 'grant:chosen' } } },
      },
      {
        id: 'second',
        sourcePath: 'bindings/other.ts',
        evaluation: { value: { slots: { model: 'grant:chosen' } } },
      },
    ],
    grants: { chosen: policy },
    grantFiles: { chosen: { path: 'policy/chosen.json', bytes } },
  } as unknown as PrivateRetainedPackageProject
  const report = await privateAgentReadinessReport({
    aggregate,
    requests,
    failures,
    featureFailures: new Map(),
    alternatives: ['codex'],
  })
  expect(report.entrypoint).toEqual({ target: agent.target, state: 'unavailable' })
  expect(report.projectIdentity).toEqual({ device: '1', inode: '2' })
  expect(report.readyTargets).toBe(1)
  expect(report.unavailableTargets).toBe(1)
  expect(report.complete).toBeTrue()
  expect(report.issues[0]?.grant?.path).toBe('policy/chosen.json')
  expect(report.issues[0]?.grant?.bytes).toEqual(bytes)
  expect(report.issues[0]?.grant?.recipients).toEqual([
    { binding: 'agent', declaration: 'bindings/custom.ts', slot: 'native' },
    { binding: 'second', declaration: 'bindings/other.ts', slot: 'model' },
  ])
  expect(report.issues[0]?.alternatives).toEqual(['codex'])
  expect(report.issues[0]?.grant?.bytes).not.toBe(bytes)
})

test('planning preserves the closed cause while a wrong native client or diagnostic is rejected', () => {
  const agent = request('agent', native),
    cause = {
      kind: 'acp',
      slot: 'native',
      client: 'pi',
      diagnostic: 'PROJECT_ACP_PI_EXECUTABLE',
    } as const
  const disposition = {
    state: 'unavailable',
    code: 'RUNTIME_UNAVAILABLE',
    cause,
    evidenceDigests: [privateResourceFailureEvidence(agent, cause)],
  } as const
  const planning = createPrivateActivationPlanningObservation({
    policyDigest: digest('policy'),
    mechanismDigest: digest('mechanism'),
    entries: [{ target: agent.target, requestDigest: agent.digest, disposition }],
  })
  expect(planning.entries[0]?.disposition).toEqual(disposition)
  expect(() =>
    createPrivateActivationPlanningObservation({
      policyDigest: digest('policy'),
      mechanismDigest: digest('mechanism'),
      entries: [
        {
          target: agent.target,
          requestDigest: agent.digest,
          disposition: {
            ...disposition,
            cause: { ...cause, diagnostic: 'PROJECT_ACP_PI_ARBITRARY' },
          },
        },
      ],
    }),
  ).toThrow('diagnostic')
  expect(() =>
    assertPrivateResourceQualification([
      {
        request: agent,
        disposition: {
          ...disposition,
          cause: { ...cause, client: 'codex', diagnostic: 'PROJECT_ACP_CODEX_EXECUTABLE' },
        },
      },
    ]),
  ).toThrow('ACP route')
})

test('real Codex wrapping preserves absence provenance but never promotes owner/integrity faults', async () => {
  const f = await fixture()
  const codex = request('agent', {
    native: { ...native.native!, grant: { kind: 'acp', client: 'codex' } },
  })
  const missing = await qualify([codex], f)
  expect(missing.get('binding\0agent')?.cause).toMatchObject({
    kind: 'acp',
    client: 'codex',
    diagnostic: 'PROJECT_ACP_CODEX_EXECUTABLE',
  })
  await expect(
    qualify([codex], f, undefined, join(f.root, 'missing-project')),
  ).rejects.toMatchObject({ code: 'PROJECT_ACP_CODEX_EXECUTABLE' })
  await expect(
    qualifyPrivateProjectAcpResources({
      requests: [codex],
      resources: undefined,
      installedSupport: f.support,
      featureFailures: new Map(),
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow('matching private operator owner')
  await expect(
    qualify([codex], f, async () => {
      throw Object.assign(new Error('forged native code'), { code: 'PROJECT_ACP_CODEX_EXECUTABLE' })
    }),
  ).rejects.toMatchObject({ code: 'PROJECT_ACP_UNAVAILABLE' })
  const invalidModel = await qualify([request('agent', native)], f, async () => {
    configuredAcpModel('bad model')
    throw new Error('unreachable')
  })
  expect(invalidModel.get('binding\0agent')?.cause).toMatchObject({
    diagnostic: 'PROJECT_ACP_PI_MODEL',
  })
  await expect(
    qualify([request('agent', native)], f, async () => {
      throw new PrivateAcpSetupError('model')
    }),
  ).rejects.toMatchObject({ code: 'PROJECT_ACP_PI_MODEL' })
})

test('strict retained Candidate and Plan reopen exact refusal causes and reject forged readiness', async () => {
  const f = await fixture(),
    agent = request('agent', native),
    code = request('code')
  const mixed = request('mixed', { child: { kind: 'flow', target: agent.target } })
  const requests = [agent, code, mixed],
    failed = await qualify(requests, f)
  const contract = native.native!.contract
  const lockValue = {
    packages: Object.fromEntries(
      requests.map((r) => [
        r.packagePath,
        {
          digest: r.package.digest,
          directRun: false,
          uses: r === agent ? { native: contract } : {},
        },
      ]),
    ),
    bindings: {
      agent: {
        packagePath: agent.packagePath,
        settings: {},
        slots: { native: { kind: 'grant', policy: { kind: 'acp', client: 'pi' } } },
      },
      code: { packagePath: code.packagePath, settings: {}, slots: {} },
      mixed: { packagePath: mixed.packagePath, settings: {}, slots: { child: agent.target } },
    },
  }
  const framed = (value: JsonValue) => {
    const bytes = canonicalJson(value),
      output = new Uint8Array(bytes.length + 1)
    output.set(bytes)
    output[bytes.length] = 10
    return output
  }
  const lockBytes = framed(lockValue as JsonValue),
    lock = decodePrivateProjectLocalLock(lockBytes)
  const observedSemanticDigest = digest('retained-semantics'),
    captureDigest = digest('capture'),
    planningObservationDigest = digest('planning')
  const value = {
    kind: 'private-activation-candidate/5',
    projectRoot: { device: '1', inode: '2' },
    captureDigest,
    observedSemanticDigest,
    planningObservationDigest,
    resolutionInputDigest: privateDomainDigest('JIG-Package-Project-Resolution-Input/1', {
      captureDigest,
      planningObservationDigest,
    }),
    lockDigest: privateProjectLocalLockDigest(lock),
    declarationArtifact: {
      kind: 'author-closure/1',
      closureDigest: digest('closure'),
      package: { kind: 'flow-package/0', digest: digest('declarations') },
    },
    targets: requests.map((r) => ({
      request: r,
      disposition: failed.get(`binding\0${r.target.kind === 'binding' ? r.target.id : ''}`) ?? {
        state: 'ready',
        recipeDigest: digest('recipe'),
        observationDigest: digest('observation'),
        execution: privateBunExecutionArtifact(r.package),
      },
    })),
  }
  function candidate(v: typeof value) {
    return decodePrivateActivationCandidateV5({
      candidate: framed({
        ...v,
        activationMeaningDigest: privateDomainDigest('JIG-Private-Activation-Meaning/1', {
          observedSemanticDigest: v.observedSemanticDigest,
          targets: v.targets,
        } as unknown as JsonValue),
      } as unknown as JsonValue),
      lock: lockBytes,
    })
  }
  const retained = candidate(value)
  expect(
    retained.candidate.targets.find((t) => t.request.digest === agent.digest)?.disposition,
  ).toEqual(failed.get('binding\0agent'))
  const plan = createPrivateActivationPlanV2({
    candidate: retained,
    candidateRevision: 1,
    baseGeneration: null,
    lockMode: 'update',
    observedLock: { state: 'absent' },
    operation: 'admission',
  })
  expect(
    decodePrivateActivationPlanV2(encodePrivateActivationPlanV2(plan)).proposed.targets,
  ).toEqual(retained.candidate.targets)
  const mutate = (alter: (v: any) => void) => {
    const copy = structuredClone(value)
    alter(copy)
    return () => candidate(copy)
  }
  expect(
    mutate((v) => {
      delete v.targets[0].disposition.cause
    }),
  ).toThrow('closed readiness cause')
  expect(
    mutate((v) => {
      delete v.targets[2].disposition.cause
    }),
  ).toThrow('closed readiness cause')
  expect(
    mutate((v) => {
      v.targets[2].disposition.evidenceDigests = [digest('forged-parent')]
    }),
  ).toThrow('retained cause')
  expect(
    mutate((v) => {
      v.targets[0].disposition.cause.diagnostic = 'PROJECT_ACP_PI_LOGIN'
    }),
  ).toThrow('diagnostic')
  expect(
    mutate((v) => {
      v.targets[0].disposition.evidenceDigests = [digest('forged')]
    }),
  ).toThrow('retained cause')
  expect(
    mutate((v) => {
      v.targets[2].disposition = v.targets[1].disposition
    }),
  ).toThrow('unavailable dependency')
  expect(
    mutate((v) => {
      v.targets[2].disposition.cause.target = code.target
    }),
  ).toThrow('unavailable dependency')
  expect(
    mutate((v) => {
      v.targets[0].disposition.code = 'SANDBOX_UNAVAILABLE'
    }),
  ).toThrow('only runtime refusal')
})

test('readiness report overflow disables all editable source handles instead of showing partial recipients', async () => {
  const f = await fixture(),
    agent = request('agent', native),
    failures = await qualify([agent], f)
  const bindings = Array.from({ length: 4096 }, (_, i) => ({
    id: i === 0 ? 'agent' : `peer-${i}`,
    sourcePath: `bindings/${'x'.repeat(225)}/${'y'.repeat(225)}/${'z'.repeat(225)}/${'w'.repeat(225)}.ts`,
    evaluation: { value: { slots: { native: 'grant:chosen' } } },
  }))
  const aggregate = {
    project: { value: {} },
    root: { device: '1', inode: '2' },
    bindings,
    grants: { chosen: { kind: 'acp', client: 'pi' } },
    grantFiles: {
      chosen: {
        path: 'grants/chosen.json',
        bytes: new TextEncoder().encode('{"kind":"acp","client":"pi"}\n'),
      },
    },
  } as unknown as PrivateRetainedPackageProject
  const report = await privateAgentReadinessReport({
    aggregate,
    requests: [agent],
    failures,
    featureFailures: new Map(),
  })
  expect(report.complete).toBeFalse()
  expect(report.issues).toEqual([])
  expect(report.readyTargets).toBe(0)
  expect(report.entrypoint).toBeUndefined()
})

test('shared dependency diamonds stay bounded and choose one deterministic direct witness', async () => {
  const f = await fixture(),
    leaf = request('leaf', native)
  const requests = [leaf]
  let child = leaf
  for (let i = 1; i < 32; i++) {
    child = request(`stage-${i}`, {
      b: { kind: 'flow', target: child.target },
      a: { kind: 'flow', target: child.target },
    })
    requests.push(child)
  }
  const failed = await qualify([...requests].reverse(), f)
  expect(failed.size).toBe(32)
  for (const r of requests.slice(1))
    expect(
      failed.get(`binding\0${r.target.kind === 'binding' ? r.target.id : ''}`)?.cause,
    ).toMatchObject({ kind: 'dependency', slot: 'a' })
  expect(() =>
    assertPrivateResourceQualification(
      requests.map((r) => ({
        request: r,
        disposition: failed.get(`binding\0${r.target.kind === 'binding' ? r.target.id : ''}`)!,
      })),
    ),
  ).not.toThrow()
})
