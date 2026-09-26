import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { invalid, unavailable } from '../diagnostics.js'
import {
  launchPrivateExecution,
  type PrivateAutomaticExecutionLaunchPlan,
  type PrivateExecutionBackend,
  privateExecutionBackendKind,
} from '../internal/execution-backend.js'
import {
  type PrivateInstalledBunSupport,
  requirePrivateInstalledBunSupport,
  revalidatePrivateInstalledBunSupport,
} from '../internal/installed-bun-support.js'
import {
  canonicalJson,
  decodeJson1,
  JSON_1_LIMITS,
  Json1Error,
  type JsonObject,
  type JsonValue,
} from '../json.js'
import { compileEmbeddedSchema } from '../schema/index.js'
import {
  type BindingDefinition,
  type JigDefinition,
  normalizeJigDefinition,
  normalizePackageBindingDefinition,
} from './author.js'
import { type CapturedAuthorClosure, isCapturedAuthorClosure } from './author-module.js'

const PROTOCOL = 'jig-author-evaluator/1'
const MAX_STDERR_BYTES = 64 * 1024
const MAX_STDOUT_BYTES = JSON_1_LIMITS.bytes + 16 * 1024
const EVALUATOR_LIMIT_POLICY = Object.freeze({
  memoryBytes: 256 * 1024 * 1024,
  pids: 64,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  wallClockCeilingMs: 3_000,
  cancellationGraceMs: 1_000,
  cleanupTimeoutMs: 5_000,
})
const MACOS_EVALUATOR_WALL_CLOCK_CEILING_MS = 10_000
type EvaluatorLimitPolicy = Readonly<{
  memoryBytes: number
  pids: number
  cpuQuotaMicros: number
  cpuPeriodMicros: number
  wallClockCeilingMs: number
  cancellationGraceMs: number
  cleanupTimeoutMs: number
}>
const EVALUATION_CODES = new Set([
  'PROJECT_AUTHORING_VALUE',
  'PROJECT_DEFAULT_EXPORT',
  'PROJECT_EVALUATION_FAILED',
  'PROJECT_EVALUATION_LIMIT',
  'PROJECT_EVALUATOR_COMPILE',
  'PROJECT_EVALUATOR_IMPORT',
  'PROJECT_EVALUATOR_PROTOCOL',
])
const decoder = new TextDecoder('utf-8', { fatal: true })
let evaluationSequence = 0

export type AuthorEvaluationExpectation = 'project' | 'binding'

type AuthoringProfile = 'project-authoring/1'

export interface PrivateAuthorEvaluatorOptions {
  readonly backend: PrivateExecutionBackend
  readonly installedSupport: PrivateInstalledBunSupport
}

export interface EvaluatorProfile {
  readonly protocol: typeof PROTOCOL
  readonly authoringProfile: AuthoringProfile
  readonly evaluatorDigest: string
  readonly authoringSdkDigest: string
  readonly schemaDigest: string
  readonly evaluatorPackageDigest: string
  readonly runtimeExecutable: string
  readonly runtimeDigest: string
  readonly runtimeMounts: readonly string[]
  readonly runtimeSupport: {
    readonly kind: 'private-installed-bun-support/1'
    readonly digest: string
  }
  readonly buildOptions: 'bun-cjs-closed-static-closure/1'
  readonly sandbox:
    | {
        readonly kind: 'linux-rootless-cgroup-v2-bubblewrap/1'
        readonly mechanismDigest: string
        readonly sealedPlanDigest: string
        readonly bubblewrapPath: string
        readonly bubblewrapDigest: string
        readonly coordinatorRuntimePath: string
        readonly coordinatorRuntimeDigest: string
        readonly supervisorPath: string
        readonly supervisorDigest: string
        readonly payloadUid: number
        readonly payloadGid: number
        /** Stable policy only; invocation-local absolute deadlines are enforcement evidence. */
        readonly limits: EvaluatorLimitPolicy
        readonly privateProcessFilesystem: true
        readonly privateRuntimeDevices: true
      }
    | {
        readonly kind: 'macos-supervised-seatbelt/1'
        readonly mechanismDigest: string
        readonly sealedPlanDigest: string
        readonly supervisorPath: string
        readonly supervisorDigest: string
        readonly launcherPath: string
        readonly launcherDigest: string
        readonly limits: EvaluatorLimitPolicy
        readonly resourceAccounting: 'supervised-sampled-with-termination'
        readonly resourceOvershoot: true
      }
}

export interface EvaluatedAuthorDeclaration<
  Value extends JigDefinition | BindingDefinition = JigDefinition | BindingDefinition,
> {
  readonly expected: AuthorEvaluationExpectation
  readonly source: {
    readonly entryProjectPath: string
    readonly bytes: number
    readonly digest: string
    readonly modules: readonly {
      readonly projectPath: string
      readonly bytes: number
      readonly digest: string
      readonly imports: readonly {
        readonly specifier: string
        readonly projectPath: string
      }[]
    }[]
  }
  readonly profile: EvaluatorProfile
  readonly outputDigest: string
  readonly value: Value
  readonly enforcement: {
    readonly owner:
      | {
          readonly kind: 'linux-cgroup'
          readonly runCgroup: string
          readonly payloadPid: number
          readonly supervisorPid: number
        }
      | { readonly kind: 'macos-process'; readonly pid: number; readonly version: number }
    readonly terminal: {
      readonly reason: 'payload_exit'
      readonly exitCode: 0
      readonly signal: null
      readonly fenced: true
    }
    readonly evidence: Readonly<Record<string, number | string>>
  }
}

/** Evaluate one entry from an authentic captured closure in the enforced envelope. */
export async function evaluateAuthorClosure(
  options: PrivateAuthorEvaluatorOptions,
  captured: CapturedAuthorClosure,
  entryProjectPath: string,
  expected: AuthorEvaluationExpectation,
  signal?: AbortSignal,
): Promise<EvaluatedAuthorDeclaration> {
  if (!isCapturedAuthorClosure(captured)) {
    invalid('PROJECT_AUTHOR_CAPTURE', 'author closure was not produced by the capture boundary')
  }
  if (!captured.entries.includes(entryProjectPath)) {
    invalid(
      'PROJECT_AUTHOR_CAPTURE',
      'selected entry is outside the author closure',
      entryProjectPath,
    )
  }
  const installedSupport = requirePrivateInstalledBunSupport(options.installedSupport)
  await revalidatePrivateInstalledBunSupport(installedSupport).catch((error) =>
    unavailable(
      'PROJECT_EVALUATOR_SUPPORT',
      `installed evaluator support is unavailable: ${errorText(error)}`,
      entryProjectPath,
    ),
  )
  const runtimeMounts = installedSupport.runtimeMounts
  const [workerBytes, sdkBytes, schemaBytes] = await Promise.all([
    readFile(join(installedSupport.evaluatorSupportPath, 'project-evaluator-worker.js')),
    readFile(join(installedSupport.evaluatorSupportPath, 'project-evaluator-sdk.bundle.js')),
    readFile(join(installedSupport.evaluatorSupportPath, 'project-authoring-1.schema.json')),
  ]).catch((error) =>
    unavailable(
      'PROJECT_EVALUATOR_SUPPORT',
      `cannot seal evaluator toolchain: ${errorText(error)}`,
      entryProjectPath,
    ),
  )
  const authoringProfile = 'project-authoring/1' as const
  const profileBase = Object.freeze({
    protocol: PROTOCOL,
    authoringProfile,
    evaluatorDigest: digestBytes(workerBytes),
    authoringSdkDigest: digestBytes(sdkBytes),
    schemaDigest: digestBytes(schemaBytes),
    evaluatorPackageDigest: installedSupport.evaluatorSupportDigest,
    runtimeExecutable: installedSupport.sandboxExecutablePath,
    runtimeDigest: installedSupport.executableDigest,
    runtimeMounts: Object.freeze(runtimeMounts.map(({ destination }) => destination)),
    runtimeSupport: Object.freeze({
      kind: installedSupport.kind,
      digest: installedSupport.digest,
    }),
    buildOptions: 'bun-cjs-closed-static-closure/1' as const,
  })
  const modules = captured.modules.map((module) => ({
    projectPath: module.projectPath,
    source: decoder.decode(captured.read(module.projectPath)),
    imports: module.imports.map(({ specifier, projectPath }) => ({ specifier, projectPath })),
  }))
  const request = canonicalJson({
    protocol: PROTOCOL,
    authoringProfile,
    entryProjectPath,
    modules,
  })
  const runId = `config-${process.pid.toString(36)}-${(++evaluationSequence).toString(36)}`
  const policy = evaluatorLimitPolicy(options.backend)
  const limits = evaluatorLimits(policy)
  const component = await launchPrivateExecution(
    options.backend,
    evaluatorLaunchPlan(options.backend, installedSupport, runId, limits),
    signal,
  ).catch((error) => {
    return unavailable(
      'PROJECT_EVALUATOR_LAUNCH',
      `cannot launch evaluator envelope: ${errorText(error)}`,
      entryProjectPath,
    )
  })
  const validEnvelope =
    component.envelope.kind === 'linux-rootless-cgroup-v2-bubblewrap/1'
      ? component.envelope.privateProcessFilesystem &&
        component.envelope.privateRuntimeDevices &&
        sameEvaluatorLimits(component.envelope.limits, limits) &&
        component.envelope.trustedCoordinatorBunDigest === installedSupport.executableDigest
      : component.envelope.resourceAccounting === 'supervised-sampled-with-termination' &&
        component.envelope.resourceOvershoot === true &&
        sameEvaluatorLimits(component.envelope.limits, limits)
  if (!validEnvelope) {
    await component.terminate().catch(() => undefined)
    const completion = await component.completion.catch((error) =>
      unavailable(
        'PROJECT_EVALUATOR_CLEANUP',
        `evaluator envelope lost while rejecting its predicates: ${errorText(error)}`,
        entryProjectPath,
      ),
    )
    if (!completion.fenced || completion.cleanupError !== undefined) {
      unavailable(
        'PROJECT_EVALUATOR_CLEANUP',
        'evaluator envelope predicates were absent and cleanup was not proven',
        entryProjectPath,
      )
    }
    unavailable(
      'PROJECT_EVALUATOR_ENVELOPE',
      'evaluator envelope did not preserve its sealed runtime or root-only predicates',
      entryProjectPath,
    )
  }
  const profile: EvaluatorProfile = Object.freeze({
    ...profileBase,
    sandbox:
      component.envelope.kind === 'linux-rootless-cgroup-v2-bubblewrap/1'
        ? Object.freeze({
            kind: component.envelope.kind,
            mechanismDigest: component.envelope.mechanismDigest,
            sealedPlanDigest: component.envelope.sealedPlanDigest,
            bubblewrapPath: component.envelope.trustedBubblewrapPath,
            bubblewrapDigest: component.envelope.trustedBubblewrapDigest,
            coordinatorRuntimePath: component.envelope.trustedCoordinatorBunPath,
            coordinatorRuntimeDigest: component.envelope.trustedCoordinatorBunDigest,
            supervisorPath: component.envelope.trustedSupervisorPath,
            supervisorDigest: component.envelope.trustedSupervisorDigest,
            payloadUid: component.envelope.payloadUid,
            payloadGid: component.envelope.payloadGid,
            limits: policy,
            privateProcessFilesystem: component.envelope.privateProcessFilesystem,
            privateRuntimeDevices: component.envelope.privateRuntimeDevices,
          })
        : Object.freeze({
            kind: component.envelope.kind,
            mechanismDigest: component.envelope.mechanismDigest,
            sealedPlanDigest: component.envelope.sealedPlanDigest,
            supervisorPath: installedSupport.supervisorPath,
            supervisorDigest: installedSupport.supervisorDigest,
            launcherPath: installedSupport.launcherPath!,
            launcherDigest: installedSupport.launcherDigest!,
            limits: policy,
            resourceAccounting: component.envelope.resourceAccounting,
            resourceOvershoot: component.envelope.resourceOvershoot,
          }),
  })

  const stdout = collectBounded(component.stdout, MAX_STDOUT_BYTES, component.terminate)
  const stderr = collectBounded(component.stderr, MAX_STDERR_BYTES, component.terminate)
  try {
    await component.write(request)
    await component.closeInput()
    const [output, diagnostics, exit, evidence, terminationReason] = await Promise.all([
      stdout,
      stderr,
      component.completion,
      component.evidence,
      component.terminationReason,
    ])
    if (exit.cleanupError !== undefined || !exit.fenced) {
      unavailable(
        'PROJECT_EVALUATOR_CLEANUP',
        `evaluator cleanup was not proven: ${exit.cleanupError ?? 'not fenced'}`,
        entryProjectPath,
      )
    }
    if (
      ('memoryEvents' in evidence && (evidence.memoryEvents.max ?? 0) > 0) ||
      terminationReason === 'memory_limit'
    ) {
      invalid(
        'PROJECT_EVALUATION_LIMIT',
        'evaluator reached its hard memory limit',
        entryProjectPath,
      )
    }
    if (
      ('pidsEvents' in evidence && (evidence.pidsEvents.max ?? 0) > 0) ||
      terminationReason === 'process_limit'
    ) {
      invalid(
        'PROJECT_EVALUATION_LIMIT',
        'evaluator reached its hard process limit',
        entryProjectPath,
      )
    }
    if (terminationReason === 'deadline') {
      invalid(
        'PROJECT_EVALUATION_LIMIT',
        'evaluator reached its hard wall deadline',
        entryProjectPath,
      )
    }
    if (terminationReason !== 'payload_exit') {
      unavailable(
        'PROJECT_EVALUATOR_INTERRUPTED',
        `evaluator ended for an unexpected reason: ${terminationReason}`,
        entryProjectPath,
      )
    }
    if (exit.exitCode !== 0 || exit.signal !== null) {
      invalid(
        'PROJECT_EVALUATION_FAILED',
        `evaluator exited ${exit.exitCode ?? exit.signal}${diagnostics.length === 0 ? '' : `: ${safeText(diagnostics)}`}`,
        entryProjectPath,
      )
    }
    let response: JsonValue
    try {
      response = decodeJson1(output)
    } catch (error) {
      if (error instanceof Json1Error) {
        unavailable('PROJECT_EVALUATOR_PROTOCOL', error.message, entryProjectPath)
      }
      throw error
    }
    const value = checkedResponse(response, entryProjectPath)
    contextualAuthorSchema(schemaBytes, expected, entryProjectPath).validate(
      value,
      'PROJECT_AUTHORING_SCHEMA_INVALID',
    )
    let normalized: JigDefinition | BindingDefinition
    try {
      normalized =
        expected === 'project'
          ? normalizeJigDefinition(value)
          : normalizePackageBindingDefinition(value)
    } catch (error) {
      invalid('PROJECT_DECLARATION_INVALID', errorText(error), entryProjectPath)
    }
    const outputBytes = canonicalJson(normalized as unknown as JsonValue)
    return Object.freeze({
      expected,
      source: Object.freeze({
        entryProjectPath,
        bytes: captured.sourceBytes,
        digest: captured.closureDigest,
        modules: Object.freeze(
          captured.modules.map((module) =>
            Object.freeze({
              projectPath: module.projectPath,
              bytes: module.sourceBytes,
              digest: module.sourceDigest,
              imports: Object.freeze(module.imports.map((edge) => Object.freeze({ ...edge }))),
            }),
          ),
        ),
      }),
      profile,
      outputDigest: digestBytes(outputBytes),
      value: normalized,
      enforcement: Object.freeze({
        owner:
          'cgroup' in component
            ? Object.freeze({ kind: 'linux-cgroup' as const, ...component.cgroup })
            : Object.freeze({ kind: 'macos-process' as const, ...component.process }),
        terminal: Object.freeze({
          reason: terminationReason,
          exitCode: exit.exitCode,
          signal: exit.signal,
          fenced: exit.fenced,
        }) as EvaluatedAuthorDeclaration['enforcement']['terminal'],
        evidence:
          'cpuStat' in evidence
            ? Object.freeze({
                ...prefixNumbers('cpu', evidence.cpuStat),
                ...prefixNumbers('memory', evidence.memoryEvents),
                ...prefixNumbers('pids', evidence.pidsEvents),
              })
            : Object.freeze({ ...evidence }),
      }),
    })
  } catch (error) {
    await component.terminate().catch(() => undefined)
    const settled = await Promise.allSettled([
      stdout,
      stderr,
      component.completion,
      component.evidence,
    ])
    const cleanup = settled[2]
    if (cleanup.status === 'rejected') {
      throw new AggregateError(
        [error, cleanup.reason],
        'evaluator failed and cleanup was not confirmed',
      )
    }
    if (!cleanup.value.fenced || cleanup.value.cleanupError !== undefined) {
      throw new AggregateError([error, cleanup.value], 'evaluator failed without a clean fence')
    }
    throw error
  }
}

function checkedResponse(response: JsonValue, projectPath: string): JsonValue {
  if (
    !isRecord(response) ||
    response.protocol !== PROTOCOL ||
    (response.status !== 'ok' && response.status !== 'error')
  ) {
    unavailable('PROJECT_EVALUATOR_PROTOCOL', 'evaluator returned an invalid envelope', projectPath)
  }
  if (response.status === 'error') {
    if (
      !exactKeys(response, ['code', 'message', 'protocol', 'status']) ||
      typeof response.code !== 'string' ||
      typeof response.message !== 'string'
    ) {
      unavailable('PROJECT_EVALUATOR_PROTOCOL', 'evaluator error has an invalid shape', projectPath)
    }
    if (!EVALUATION_CODES.has(response.code)) {
      unavailable(
        'PROJECT_EVALUATOR_PROTOCOL',
        'evaluator returned an unknown error code',
        projectPath,
      )
    }
    const code = response.code
    if (code === 'PROJECT_EVALUATOR_PROTOCOL') {
      unavailable(code, response.message, projectPath)
    }
    const message = response.message
    invalid(code, message, projectPath)
  }
  if (!exactKeys(response, ['protocol', 'status', 'value'])) {
    unavailable('PROJECT_EVALUATOR_PROTOCOL', 'evaluator success has an invalid shape', projectPath)
  }
  return response.value!
}

function contextualAuthorSchema(
  bytes: Uint8Array,
  expected: AuthorEvaluationExpectation,
  projectPath: string,
) {
  let document: JsonValue
  try {
    document = decodeJson1(bytes)
  } catch (error) {
    unavailable(
      'PROJECT_EVALUATOR_SUPPORT',
      `captured authoring schema is invalid: ${errorText(error)}`,
      projectPath,
    )
  }
  if (!isRecord(document) || !isRecord(document.$defs)) {
    unavailable(
      'PROJECT_EVALUATOR_SUPPORT',
      'captured authoring schema has no definitions',
      projectPath,
    )
  }
  const definition = expected === 'project' ? 'project' : 'bindingDefinition'
  try {
    return compileEmbeddedSchema(Object.freeze({ $ref: `#/$defs/${definition}` }), {
      path: 'project-authoring-1.schema.json',
      rootDefs: document.$defs as JsonObject,
    })
  } catch (error) {
    unavailable(
      'PROJECT_EVALUATOR_SUPPORT',
      `captured authoring schema cannot compile: ${errorText(error)}`,
      projectPath,
    )
  }
}

function evaluatorLaunchPlan(
  backend: PrivateExecutionBackend,
  support: PrivateInstalledBunSupport,
  runId: string,
  limits: ReturnType<typeof evaluatorLimits>,
): PrivateAutomaticExecutionLaunchPlan {
  if (privateExecutionBackendKind(backend) === 'linux') {
    return Object.freeze({
      kind: 'linux',
      plan: Object.freeze({
        runId,
        limits,
        readOnlyMounts: [
          ...support.runtimeMounts,
          { source: support.evaluatorSupportPath, destination: '/jig-evaluator' },
        ],
        command: [
          support.sandboxExecutablePath,
          '/jig-evaluator/project-evaluator-worker.js',
        ] as readonly [string, ...string[]],
      }),
    })
  }
  return Object.freeze({
    kind: 'macos',
    plan: (allocation) =>
      Object.freeze({
        runId,
        limits: {
          memoryBytes: limits.memoryBytes,
          pids: limits.pids,
          cpuQuotaMicros: limits.cpuQuotaMicros,
          cpuPeriodMicros: limits.cpuPeriodMicros,
          deadlineUnixMs: limits.deadlineUnixMs,
          cleanupTimeoutMs: limits.cleanupTimeoutMs,
        },
        command: [
          support.executablePath,
          join(support.evaluatorSupportPath, 'project-evaluator-worker.js'),
        ] as readonly [string, ...string[]],
        cwd: support.evaluatorSupportPath,
        environment: {
          JIG_EVALUATOR_SDK: join(support.evaluatorSupportPath, 'project-evaluator-sdk.bundle.js'),
        },
        files: {
          readOnlyFiles: [support.executablePath],
          readOnlyTrees: [support.evaluatorSupportPath],
          writableTrees: [],
          protectedRoots: [join(allocation.directory, 'control')],
          network: 'isolated' as const,
        },
        maxOutputBytes: MAX_STDOUT_BYTES + MAX_STDERR_BYTES,
      }),
  })
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function evaluatorLimitPolicy(backend: PrivateExecutionBackend): EvaluatorLimitPolicy {
  return privateExecutionBackendKind(backend) === 'macos'
    ? Object.freeze({
        ...EVALUATOR_LIMIT_POLICY,
        wallClockCeilingMs: MACOS_EVALUATOR_WALL_CLOCK_CEILING_MS,
      })
    : EVALUATOR_LIMIT_POLICY
}

function evaluatorLimits(policy: EvaluatorLimitPolicy) {
  return Object.freeze({
    memoryBytes: policy.memoryBytes,
    pids: policy.pids,
    cpuQuotaMicros: policy.cpuQuotaMicros,
    cpuPeriodMicros: policy.cpuPeriodMicros,
    deadlineUnixMs: Date.now() + policy.wallClockCeilingMs,
    cancellationGraceMs: policy.cancellationGraceMs,
    cleanupTimeoutMs: policy.cleanupTimeoutMs,
  })
}

function sameEvaluatorLimits(
  actual: {
    readonly memoryBytes: number
    readonly pids: number
    readonly cpuQuotaMicros: number
    readonly cpuPeriodMicros: number
    readonly deadlineUnixMs: number
    readonly cleanupTimeoutMs?: number
    readonly cancellationGraceMs?: number
  },
  expected: ReturnType<typeof evaluatorLimits>,
): boolean {
  return (
    actual.memoryBytes === expected.memoryBytes &&
    actual.pids === expected.pids &&
    actual.cpuQuotaMicros === expected.cpuQuotaMicros &&
    actual.cpuPeriodMicros === expected.cpuPeriodMicros &&
    actual.deadlineUnixMs === expected.deadlineUnixMs &&
    (actual.cancellationGraceMs === undefined ||
      actual.cancellationGraceMs === expected.cancellationGraceMs) &&
    actual.cleanupTimeoutMs === expected.cleanupTimeoutMs
  )
}

async function collectBounded(
  stream: AsyncIterable<Uint8Array>,
  maximum: number,
  terminate: () => Promise<void>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.byteLength
    if (total > maximum) {
      await terminate()
      invalid('PROJECT_EVALUATION_LIMIT', `evaluator channel exceeds ${maximum} bytes`)
    }
    chunks.push(chunk.slice())
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function prefixNumbers(
  prefix: string,
  value: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([name, amount]) => [`${prefix}.${name}`, amount]),
    ),
  )
}

function safeText(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes).slice(0, 4_096)
  } catch {
    return 'non-UTF-8 diagnostics'
  }
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
