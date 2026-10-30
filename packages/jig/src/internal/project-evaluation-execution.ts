import type { JsonValue } from '../json.js'
import { privateDomainDigest } from './identity.js'
import {
  normalizePrivateBootDeadline,
  type PrivateBootDeadline,
  privateBootRemaining,
  readPrivateNativeClock,
} from './native-clock.js'
import {
  type EvaluationOutputRoot,
  PROJECT_EVALUATION_LIMITS,
  type PrivateProjectEvaluationRecipe,
} from './project-evaluation-policy.js'

export type PrivateProjectEvaluationPhase = 'generate' | 'compile' | 'test'
export type PrivateProjectEvaluationDeadlineLimit = 'phase' | 'evaluation' | 'enclosing' | 'unknown'
export interface PrivateProjectEvaluationFile {
  readonly path: string
  readonly bytes: number
  readonly digest: string
}
export interface PrivateProjectEvaluationPhaseEvidence {
  readonly phase: PrivateProjectEvaluationPhase
  readonly status: 'completed' | 'failed' | 'skipped'
  readonly invocation: readonly string[]
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stopReason: 'exited' | 'deadline' | 'cancelled' | 'prior-phase-failed' | 'not-configured'
  readonly durationMs: number
  readonly stdout: { readonly text: string; readonly truncated: boolean }
  readonly stderr: { readonly text: string; readonly truncated: boolean }
  readonly files: readonly PrivateProjectEvaluationFile[]
}
export interface PrivateProjectEvaluationPhaseRequest {
  /** Closed position, independent of whether optional generation is configured. */
  readonly index: 0 | 1 | 2
  readonly phase: PrivateProjectEvaluationPhase
  readonly invocation: readonly string[]
  readonly deadlineUnixMs: number
  readonly timeoutMs: number
  readonly bootDeadline?: PrivateBootDeadline
  readonly deadlineLimit: PrivateProjectEvaluationDeadlineLimit
  readonly writableRoots: readonly EvaluationOutputRoot[]
}

/** Native owner names derive from the logical call, never from a new operation. */
export function privateProjectEvaluationPhaseIdentity(input: {
  readonly parentRunId: string
  readonly operationId: string
  readonly parentOperationId?: string
  readonly index: 0 | 1 | 2
}): string {
  if (![0, 1, 2].includes(input.index)) throw new TypeError('invalid evaluation phase index')
  return privateDomainDigest('JIG-Project-Evaluation-Phase-Owner/1', {
    parentRunId: input.parentRunId,
    parentOperationId: input.parentOperationId ?? null,
    operationId: input.operationId,
    index: input.index,
  })
}

export function privateProjectEvaluationInvocation(
  recipe: PrivateProjectEvaluationRecipe,
  phase: PrivateProjectEvaluationPhase,
): readonly string[] {
  switch (phase) {
    case 'generate':
      return recipe.generate === undefined ? [] : ['bun', recipe.generate]
    case 'compile':
      return ['bun', 'node_modules/typescript/lib/tsc.js', '--project', '.jig-evaluation.json']
    case 'test':
      return ['bun', 'test', ...recipe.test]
  }
}

export function privateProjectEvaluationWritableRoots(
  phase: PrivateProjectEvaluationPhase,
): readonly EvaluationOutputRoot[] {
  return phase === 'generate'
    ? ['generated', 'reports']
    : phase === 'compile'
      ? ['dist']
      : ['reports']
}

/**
 * Fixed finite advancement inside ONE already reserved logical operation.
 * executePhase must persist intent/owner before admission and return only after
 * collection, whole-owner fencing and release. Rejection never advances.
 * Recovery does not call this function: it settles retained owners only.
 */
export async function executePrivateProjectEvaluationPhases(input: {
  readonly recipe: PrivateProjectEvaluationRecipe
  readonly deadlineUnixMs: number
  readonly signal: AbortSignal
  readonly bootDeadline?: PrivateBootDeadline
  readonly deadlineLimit: Exclude<PrivateProjectEvaluationDeadlineLimit, 'phase'>
  readonly onPhase: (request: PrivateProjectEvaluationPhaseRequest | undefined) => void
  readonly onEvidence: (evidence: PrivateProjectEvaluationPhaseEvidence) => void
  readonly executePhase: (
    request: PrivateProjectEvaluationPhaseRequest,
  ) => Promise<PrivateProjectEvaluationPhaseEvidence>
}): Promise<readonly PrivateProjectEvaluationPhaseEvidence[]> {
  const end = Math.min(input.deadlineUnixMs, Date.now() + PROJECT_EVALUATION_LIMITS.timeoutMs)
  const started = input.bootDeadline === undefined ? undefined : readPrivateNativeClock()
  const endBoot =
    started === undefined
      ? undefined
      : normalizePrivateBootDeadline({
          bootId: input.bootDeadline!.bootId,
          monotonicMs:
            started.bootId === input.bootDeadline!.bootId
              ? Math.min(
                  input.bootDeadline!.monotonicMs,
                  started.monotonicMs + PROJECT_EVALUATION_LIMITS.timeoutMs,
                )
              : 0,
        })
  const phases = ['generate', 'compile', 'test'] as const
  const evidence: PrivateProjectEvaluationPhaseEvidence[] = []
  let blocked = false
  for (const [index, phase] of phases.entries()) {
    const invocation = privateProjectEvaluationInvocation(input.recipe, phase)
    if (blocked || invocation.length === 0) {
      const observed = skipped(phase, invocation, blocked ? 'prior-phase-failed' : 'not-configured')
      evidence.push(observed)
      input.onEvidence(observed)
      continue
    }
    // Selection/setup of the next phase is separate from executing its program.
    input.onPhase(undefined)
    input.signal.throwIfAborted()
    const timeoutMs = PROJECT_EVALUATION_LIMITS[`${phase}Ms`]
    const deadlineUnixMs = Math.min(end, Date.now() + timeoutMs)
    const clock = endBoot === undefined ? undefined : readPrivateNativeClock()
    const bootDeadline =
      clock === undefined
        ? undefined
        : normalizePrivateBootDeadline({
            bootId: endBoot!.bootId,
            monotonicMs:
              clock.bootId === endBoot!.bootId
                ? Math.min(endBoot!.monotonicMs, clock.monotonicMs + timeoutMs)
                : 0,
          })
    const remaining =
      endBoot === undefined ? end - Date.now() : privateBootRemaining(endBoot, clock!)
    const deadlineLimit =
      remaining > timeoutMs ? 'phase' : remaining < timeoutMs ? input.deadlineLimit : 'unknown'
    if (
      bootDeadline === undefined
        ? deadlineUnixMs <= Date.now()
        : privateBootRemaining(bootDeadline, clock!) <= 0
    )
      throw new PrivateProjectEvaluationDeadlineError(input.deadlineLimit)
    const request: PrivateProjectEvaluationPhaseRequest = Object.freeze({
      index: index as 0 | 1 | 2,
      phase,
      invocation: Object.freeze([...invocation]),
      timeoutMs,
      deadlineLimit,
      deadlineUnixMs,
      ...(bootDeadline === undefined ? {} : { bootDeadline }),
      writableRoots: Object.freeze([...privateProjectEvaluationWritableRoots(phase)]),
    })
    input.onPhase(request)
    const observed = await input.executePhase(request)
    if (
      observed.phase !== phase ||
      observed.status === 'skipped' ||
      observed.invocation.length !== invocation.length ||
      observed.invocation.some((part, position) => part !== invocation[position]) ||
      !Number.isFinite(observed.durationMs) ||
      observed.durationMs < 0 ||
      !['exited', 'cancelled', 'deadline'].includes(observed.stopReason) ||
      (observed.status === 'completed') !==
        (observed.stopReason === 'exited' && observed.exitCode === 0 && observed.signal === null)
    )
      throw new TypeError('evaluation phase returned inconsistent process evidence')
    requirePrivateProjectEvaluationOutputFiles(observed.files, request.writableRoots)
    evidence.push(observed)
    input.onEvidence(observed)
    blocked = observed.status !== 'completed'
    // Native stop evidence must not become ordinary done evidence.
    input.signal.throwIfAborted()
    if (observed.stopReason === 'deadline')
      throw new PrivateProjectEvaluationDeadlineError(request.deadlineLimit)
    if (observed.stopReason === 'cancelled')
      throw new DOMException('evaluation cancelled', 'AbortError')
  }
  return Object.freeze(evidence)
}

export class PrivateProjectEvaluationDeadlineError extends Error {
  constructor(readonly limit: PrivateProjectEvaluationDeadlineLimit) {
    super('evaluation reached its effective phase or enclosing deadline')
  }
}

/** Apply the evaluator's smaller output profile after common native capture. */
export function requirePrivateProjectEvaluationOutputFiles(
  files: readonly PrivateProjectEvaluationFile[],
  roots: readonly EvaluationOutputRoot[],
): void {
  let bytes = 0
  const paths = new Set<string>()
  if (files.length > PROJECT_EVALUATION_LIMITS.outputFiles)
    throw new TypeError('evaluation outputs exceed their finite profile')
  for (const file of files) {
    const root = file.path.split('/')[0]
    if (
      !roots.includes(root as EvaluationOutputRoot) ||
      !/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)+$/.test(file.path) ||
      file.path.split('/').some((part) => part === '.' || part === '..') ||
      Buffer.byteLength(file.path) > 256 ||
      file.path.split('/').length > 16 ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > PROJECT_EVALUATION_LIMITS.outputFileBytes ||
      !/^sha256:[0-9a-f]{64}$/.test(file.digest) ||
      paths.has(file.path)
    )
      throw new TypeError('evaluation outputs exceed their finite profile')
    bytes += file.bytes
    if (bytes > PROJECT_EVALUATION_LIMITS.outputBytes)
      throw new TypeError('evaluation outputs exceed their finite profile')
    paths.add(file.path)
  }
  if (
    [...paths].some((path) =>
      path
        .split('/')
        .slice(0, -1)
        .some((_part, index, parts) => paths.has(parts.slice(0, index + 1).join('/'))),
    )
  )
    throw new TypeError('evaluation output file shadows a directory')
}

function skipped(
  phase: PrivateProjectEvaluationPhase,
  invocation: readonly string[],
  stopReason: 'prior-phase-failed' | 'not-configured',
): PrivateProjectEvaluationPhaseEvidence {
  return Object.freeze({
    phase,
    status: 'skipped',
    invocation: Object.freeze([...invocation]),
    exitCode: null,
    signal: null,
    stopReason,
    durationMs: 0,
    stdout: Object.freeze({ text: '', truncated: false }),
    stderr: Object.freeze({ text: '', truncated: false }),
    files: Object.freeze([]),
  })
}

export function privateProjectEvaluationEnvironmentDigest(value: {
  readonly recipeDigest: string
  readonly dependencyDigest: string
  readonly installedSupportDigest: string
  readonly mechanismDigest: string
}): string {
  return privateDomainDigest('JIG-Project-Evaluation-Environment/1', {
    ...value,
    evaluator: 'bun-typescript/1',
    limits: PROJECT_EVALUATION_LIMITS,
  } as unknown as JsonValue)
}
