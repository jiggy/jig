import { createHash } from 'node:crypto'
import { closeSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { invalid, unavailable } from '../diagnostics.js'
import { privateDomainDigest } from '../internal/identity.js'
import {
  type PrivateInstalledBunSupport,
  requirePrivateInstalledBunSupport,
  revalidatePrivateInstalledBunSupport,
} from '../internal/installed-bun-support.js'
import { privateSealedBytes } from '../internal/linux-file-input.js'
import {
  type PrivateLinuxCapturedInput,
  PrivateLinuxCgroupBackend,
  type PrivateLinuxCgroupLimits,
} from '../internal/linux-rootless-backend.js'
import { privateProfileSpan } from '../internal/private-profile.js'
import {
  PRIVATE_AUTHOR_EVALUATOR_DIRECTORY,
  PRIVATE_AUTHOR_EVALUATOR_ENTRY_MS,
  PRIVATE_AUTHOR_EVALUATOR_LIMITS,
  PRIVATE_AUTHOR_EVALUATOR_MAX_ENTRIES,
  PRIVATE_AUTHOR_EVALUATOR_PROTOCOL,
  PRIVATE_AUTHOR_EVALUATOR_WORKER,
  privateAuthorEvaluatorWallClockCeilingMs,
} from '../internal/project-evaluator-policy.js'
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

const PROTOCOL = PRIVATE_AUTHOR_EVALUATOR_PROTOCOL
const MAX_STDERR_BYTES = 64 * 1024
const MAX_STDOUT_BYTES = JSON_1_LIMITS.bytes + 16 * 1024
const EVALUATOR_LIMIT_POLICY = PRIVATE_AUTHOR_EVALUATOR_LIMITS
const EVALUATION_CODES = new Set([
  'PROJECT_AUTHORING_VALUE',
  'PROJECT_DEFAULT_EXPORT',
  'PROJECT_EVALUATION_FAILED',
  'PROJECT_EVALUATION_LIMIT',
  'PROJECT_EVALUATOR_COMPILE',
  'PROJECT_EVALUATOR_IMPORT',
  'PROJECT_EVALUATOR_PROTOCOL',
  'PROJECT_EVALUATOR_DEADLINE',
])
const decoder = new TextDecoder('utf-8', { fatal: true })
let evaluationSequence = 0

export type AuthorEvaluationExpectation = 'project' | 'binding'

type AuthoringProfile = 'project-authoring/1'

export interface PrivateAuthorEvaluatorOptions {
  readonly backend: PrivateLinuxCgroupBackend
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
  readonly evaluation: {
    readonly kind: 'finite-isolated-declarations/1'
    readonly entries: number
    readonly entryWallClockCeilingMs: number
  }
  readonly sandbox: {
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
    readonly limits: typeof EVALUATOR_LIMIT_POLICY
    readonly privateProcessFilesystem: true
    readonly privateRuntimeDevices: true
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
    readonly cgroup: {
      readonly runCgroup: string
      readonly payloadPid: number
      readonly supervisorPid: number
    }
    readonly terminal: {
      readonly reason: 'payload_exit'
      readonly exitCode: 0
      readonly signal: null
      readonly fenced: true
    }
    readonly cpuStat: Readonly<Record<string, number>>
    readonly memoryEvents: Readonly<Record<string, number>>
    readonly pidsEvents: Readonly<Record<string, number>>
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
  const results = await evaluateAuthorClosureBatch(
    options,
    captured,
    [{ entryProjectPath, expected }],
    signal,
  )
  return results[0]!
}

/** Share finite envelope setup, never guest state or declaration results. */
export async function evaluateAuthorClosureBatch(
  options: PrivateAuthorEvaluatorOptions,
  captured: CapturedAuthorClosure,
  requestedEntries: readonly {
    readonly entryProjectPath: string
    readonly expected: AuthorEvaluationExpectation
  }[],
  signal?: AbortSignal,
): Promise<readonly EvaluatedAuthorDeclaration[]> {
  const entries = Object.freeze(
    requestedEntries.map(({ entryProjectPath, expected }) =>
      Object.freeze({ entryProjectPath, expected }),
    ),
  )
  if (!isCapturedAuthorClosure(captured)) {
    invalid('PROJECT_AUTHOR_CAPTURE', 'author closure was not produced by the capture boundary')
  }
  if (entries.length === 0 || entries.length > PRIVATE_AUTHOR_EVALUATOR_MAX_ENTRIES) {
    invalid('PROJECT_AUTHOR_CAPTURE', 'evaluator batch has an invalid declaration count')
  }
  const selected = new Set<string>()
  for (const { entryProjectPath } of entries) {
    if (!captured.entries.includes(entryProjectPath) || selected.has(entryProjectPath)) {
      invalid('PROJECT_AUTHOR_CAPTURE', 'selected entry is absent or repeated', entryProjectPath)
    }
    selected.add(entryProjectPath)
  }
  const entryProjectPath = entries[0]!.entryProjectPath
  const limitPolicy = Object.freeze({
    ...EVALUATOR_LIMIT_POLICY,
    wallClockCeilingMs: privateAuthorEvaluatorWallClockCeilingMs(entries.length),
  })
  const installedSupport = requirePrivateInstalledBunSupport(options.installedSupport)
  await privateProfileSpan('author-support-verification', () =>
    revalidatePrivateInstalledBunSupport(installedSupport),
  ).catch((error) =>
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
  const capturedSupportDigest = privateDomainDigest('JIG-Installed-Evaluator-Support/1', [
    { name: 'project-evaluator-worker.js', digest: digestBytes(workerBytes) },
    { name: 'project-evaluator-sdk.bundle.js', digest: digestBytes(sdkBytes) },
    { name: 'project-authoring-1.schema.json', digest: digestBytes(schemaBytes) },
  ])
  if (capturedSupportDigest !== installedSupport.evaluatorSupportDigest) {
    unavailable(
      'PROJECT_EVALUATOR_SUPPORT',
      'evaluator support changed during capture',
      entryProjectPath,
    )
  }
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
    evaluation: Object.freeze({
      kind: 'finite-isolated-declarations/1' as const,
      entries: entries.length,
      entryWallClockCeilingMs: PRIVATE_AUTHOR_EVALUATOR_ENTRY_MS,
    }),
  })
  const modules = captured.modules.map((module) => ({
    projectPath: module.projectPath,
    source: decoder.decode(captured.read(module.projectPath)),
    imports: module.imports.map(({ specifier, projectPath }) => ({ specifier, projectPath })),
  }))
  const request = canonicalJson({
    protocol: PROTOCOL,
    authoringProfile,
    entries: entries.map(({ entryProjectPath }) => entryProjectPath),
    modules,
  })
  const runId = `config-${process.pid.toString(36)}-${(++evaluationSequence).toString(36)}`
  const limits = evaluatorLimits(limitPolicy)
  // Children must reuse these exact verified bytes, not reopen live installed
  // support during a longer batch. Existing sealed file projection pins them.
  const inputs: PrivateLinuxCapturedInput[] = []
  let operationFailure: unknown
  try {
    try {
      for (const [name, bytes] of [
        ['project-evaluator-worker.js', workerBytes],
        ['project-evaluator-sdk.bundle.js', sdkBytes],
      ] as const) {
        inputs.push({
          fd: privateSealedBytes(bytes),
          destination: `${PRIVATE_AUTHOR_EVALUATOR_DIRECTORY}/${name}`,
          bytes: bytes.byteLength,
          digest: digestBytes(bytes),
        })
      }
    } catch {
      unavailable('PROJECT_EVALUATOR_SUPPORT', 'cannot seal evaluator support', entryProjectPath)
    }
    const component = await privateProfileSpan('author-envelope-startup', () =>
      options.backend.launch(
        {
          runId,
          limits,
          readOnlyMounts: runtimeMounts,
          capturedInputs: inputs,
          inputDirectories: [PRIVATE_AUTHOR_EVALUATOR_DIRECTORY],
          command: [installedSupport.sandboxExecutablePath, PRIVATE_AUTHOR_EVALUATOR_WORKER],
        },
        signal,
      ),
    ).catch((error) =>
      unavailable(
        'PROJECT_EVALUATOR_LAUNCH',
        `cannot launch evaluator envelope: ${errorText(error)}`,
        entryProjectPath,
      ),
    )
    if (
      !component.envelope.privateProcessFilesystem ||
      !component.envelope.privateRuntimeDevices ||
      !sameEvaluatorLimits(component.envelope.limits, limits) ||
      component.envelope.trustedCoordinatorBunDigest !== installedSupport.executableDigest
    ) {
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
      sandbox: Object.freeze({
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
        limits: limitPolicy,
        privateProcessFilesystem: component.envelope.privateProcessFilesystem,
        privateRuntimeDevices: component.envelope.privateRuntimeDevices,
      }),
    })

    const stdout = collectBounded(component.stdout, MAX_STDOUT_BYTES, component.terminate)
    const stderr = collectBounded(component.stderr, MAX_STDERR_BYTES, component.terminate)
    try {
      await component.write(request)
      await component.closeInput()
      const [output, diagnostics, exit, evidence, terminationReason] = await privateProfileSpan(
        'author-execution-settlement',
        () =>
          Promise.all([
            stdout,
            stderr,
            component.completion,
            component.evidence,
            component.terminationReason,
          ]),
      )
      if (exit.cleanupError !== undefined || !exit.fenced) {
        unavailable(
          'PROJECT_EVALUATOR_CLEANUP',
          `evaluator cleanup was not proven: ${exit.cleanupError ?? 'not fenced'}`,
          entryProjectPath,
        )
      }
      if ((evidence.memoryEvents.max ?? 0) > 0) {
        invalid(
          'PROJECT_EVALUATOR_MEMORY_LIMIT',
          'evaluator reached its hard memory limit',
          entryProjectPath,
        )
      }
      if ((evidence.pidsEvents.max ?? 0) > 0) {
        invalid(
          'PROJECT_EVALUATOR_PROCESS_LIMIT',
          'evaluator reached its hard process limit',
          entryProjectPath,
        )
      }
      if (terminationReason === 'deadline') {
        invalid(
          'PROJECT_EVALUATOR_DEADLINE',
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
      const values = checkedResponse(response, entries)
      return Object.freeze(
        entries.map(({ entryProjectPath, expected }, index) => {
          const value = values[index]!
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
                    imports: Object.freeze(
                      module.imports.map((edge) => Object.freeze({ ...edge })),
                    ),
                  }),
                ),
              ),
            }),
            profile,
            outputDigest: digestBytes(outputBytes),
            value: normalized,
            enforcement: Object.freeze({
              cgroup: Object.freeze({ ...component.cgroup }),
              terminal: Object.freeze({
                reason: terminationReason,
                exitCode: exit.exitCode,
                signal: exit.signal,
                fenced: exit.fenced,
              }) as EvaluatedAuthorDeclaration['enforcement']['terminal'],
              cpuStat: frozenNumbers(evidence.cpuStat),
              memoryEvents: frozenNumbers(evidence.memoryEvents),
              pidsEvents: frozenNumbers(evidence.pidsEvents),
            }),
          })
        }),
      )
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
  } catch (error) {
    operationFailure = error
    throw error
  } finally {
    const failures: unknown[] = []
    for (const { fd } of inputs) {
      try {
        closeSync(fd)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      // biome-ignore lint/correctness/noUnsafeFinally: All work is already settled; descriptor cleanup must also succeed.
      throw new AggregateError(
        operationFailure === undefined ? failures : [operationFailure, ...failures],
        'evaluator input cleanup failed',
      )
    }
  }
}

function checkedResponse(
  response: JsonValue,
  entries: readonly { readonly entryProjectPath: string }[],
): readonly JsonValue[] {
  const projectPath = entries[0]!.entryProjectPath
  if (
    !isRecord(response) ||
    response.protocol !== PROTOCOL ||
    (response.status !== 'ok' && response.status !== 'error')
  ) {
    unavailable('PROJECT_EVALUATOR_PROTOCOL', 'evaluator returned an invalid envelope', projectPath)
  }
  if (response.status === 'error') {
    if (
      !exactKeys(response, ['code', 'entryIndex', 'message', 'protocol', 'status']) ||
      typeof response.code !== 'string' ||
      typeof response.message !== 'string' ||
      !(
        response.entryIndex === null ||
        (typeof response.entryIndex === 'number' &&
          Number.isInteger(response.entryIndex) &&
          response.entryIndex >= 0 &&
          response.entryIndex < entries.length)
      )
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
    const location =
      response.entryIndex === null
        ? projectPath
        : entries[response.entryIndex as number]!.entryProjectPath
    if (code === 'PROJECT_EVALUATOR_PROTOCOL') {
      unavailable(code, response.message, location)
    }
    const message = response.message
    invalid(code, message, location)
  }
  if (
    !exactKeys(response, ['protocol', 'status', 'values']) ||
    !Array.isArray(response.values) ||
    response.values.length !== entries.length
  ) {
    unavailable('PROJECT_EVALUATOR_PROTOCOL', 'evaluator success has an invalid shape', projectPath)
  }
  return response.values
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
      path: projectPath,
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

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function evaluatorLimits(policy: typeof EVALUATOR_LIMIT_POLICY) {
  return Object.freeze({
    memoryBytes: EVALUATOR_LIMIT_POLICY.memoryBytes,
    pids: EVALUATOR_LIMIT_POLICY.pids,
    cpuQuotaMicros: EVALUATOR_LIMIT_POLICY.cpuQuotaMicros,
    cpuPeriodMicros: EVALUATOR_LIMIT_POLICY.cpuPeriodMicros,
    deadlineUnixMs: Date.now() + policy.wallClockCeilingMs,
    cancellationGraceMs: EVALUATOR_LIMIT_POLICY.cancellationGraceMs,
    cleanupTimeoutMs: EVALUATOR_LIMIT_POLICY.cleanupTimeoutMs,
  })
}

function sameEvaluatorLimits(
  actual: PrivateLinuxCgroupLimits,
  expected: ReturnType<typeof evaluatorLimits>,
): boolean {
  return (
    actual.memoryBytes === expected.memoryBytes &&
    actual.pids === expected.pids &&
    actual.cpuQuotaMicros === expected.cpuQuotaMicros &&
    actual.cpuPeriodMicros === expected.cpuPeriodMicros &&
    actual.deadlineUnixMs === expected.deadlineUnixMs &&
    actual.cancellationGraceMs === expected.cancellationGraceMs &&
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

function frozenNumbers(value: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
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
