import { CheckError } from '../diagnostics.js'
import type { JsonObject, JsonValue } from '../json.js'
import type { CapturedPackage } from '../package/capture.js'
import type { ProjectEvaluation } from '../project/evaluation.js'
import type { RunHostCall, RunHostOperationTerminal } from '../run/session.js'
import { RunHostFatalOperationError } from '../run/session.js'
import {
  allocatePrivateRootChildOwner,
  closePrivateRootChildOwner,
  listPrivateRootChildOwners,
  type PrivateRootChildOwnerLifecycle,
  recordPrivateRootChildPhase,
} from './activation-admission-store.js'
import { normalizePrivateBunExecutionLayout } from './bun-execution-layout.js'
import {
  capturePrivateOutput,
  capturePrivateOutputSelection,
  type PrivateCapturedOutput,
  privateCapturedOutputManifestDigest,
} from './captured-output.js'
import type { PrivateFileLocation } from './descriptor-files.js'
import type { PrivateDirectRunInstalledSupport, PrivateDirectRunRecipe } from './direct-run.js'
import { planPrivateDirectRun } from './direct-run.js'
import {
  admitPrivateExecutionOwner,
  cancelPrivateExecutionOwnerStateAllocation,
  isPrivateExecutionFenceUnconfirmed,
  normalizePrivateExecutionConfirmedEnforcementReceipt,
  normalizePrivateExecutionOwnerStateAllocationIdentity,
  normalizePrivateExecutionOwnerStateCancellation,
  normalizePrivateExecutionOwnerStateReleaseReceipt,
  normalizePrivateExecutionSealedOwnerIdentity,
  type PrivateExecutionBackend,
  type PrivateExecutionConfirmedEnforcementReceipt,
  type PrivateExecutionOwnerStateAllocationIdentity,
  planPrivateExecutionOwnerStateAllocation,
  privateExecutionOwnerAllocationDigest,
  privateExecutionPreparedOwnerDigest,
  recoverPrivateExecutionFence,
  releasePrivateExecutionOwnerState,
  sealPrivateExecutionOwner,
} from './execution-backend.js'
import {
  type PrivateExecutionIntent,
  privateExecutionFileProjections,
  privateExecutionPath,
} from './execution-intent.js'
import { closePrivateExecutionOutput } from './execution-output.js'
import {
  capturePrivateFlowArtifact,
  commitPrivateFlowArtifact,
  type PrivateFlowFileContext,
  resolvePrivateFlowArtifact,
} from './flow-file-context.js'
import { privateDomainDigest } from './identity.js'
import { revalidatePrivateInstalledBunSupport } from './installed-bun-support.js'
import {
  normalizeParentFlow,
  type PrivateInvocationContext,
  protectedOwnerRoot,
  requireParentFlowOwner,
  requireParentTarget,
} from './invocation-context.js'
import { captureStoredPackage } from './package-artifact-store.js'
import {
  allocatePrivatePackageMaterialization,
  materializePrivatePackageLease,
  normalizePrivatePackageMaterializationAllocationIdentity,
  type PrivatePackageMaterializationAllocationIdentity,
  recoverPrivatePackageMaterializationAllocation,
} from './package-materialization.js'
import { PROJECT_EVALUATION_CONTRACT_DIGEST } from './private-project-evaluation.js'
import {
  executePrivateProjectEvaluationPhases,
  PrivateProjectEvaluationDeadlineError,
  type PrivateProjectEvaluationPhase,
  type PrivateProjectEvaluationPhaseEvidence,
  type PrivateProjectEvaluationPhaseRequest,
  privateProjectEvaluationEnvironmentDigest,
  privateProjectEvaluationPhaseIdentity,
  requirePrivateProjectEvaluationOutputFiles,
} from './project-evaluation-execution.js'
import {
  capturePrivateProjectEvaluationWorkspace,
  PrivateProjectEvaluationReviewRequiredError,
  requirePrivateProjectEvaluationCandidate,
} from './project-evaluation-input.js'
import {
  PROJECT_EVALUATION_LIMITS,
  requirePrivateProjectEvaluationInput,
} from './project-evaluation-policy.js'
import {
  type PrivateRetainedProjectEvaluation,
  verifyPrivateRetainedProjectEvaluation,
} from './project-evaluation-retention.js'
import {
  collectProjectCommandStream,
  type PrivateContainedEffectFailurePhase,
} from './root-contained-effect-controller.js'

const KIND = 'private-contained-effect-owner/1'
interface Context extends PrivateInvocationContext {
  readonly installedSupport: PrivateDirectRunInstalledSupport
  readonly backend: PrivateExecutionBackend
  readonly packageStoreRoot?: PrivateFileLocation
  readonly files?: PrivateFlowFileContext
  readonly onFailure?:
    | ((phase: PrivateContainedEffectFailurePhase, error: unknown) => void)
    | undefined
}

import { privateInvocationBootDeadline } from './invocation-context.js'
import {
  normalizePrivateBootDeadline,
  type PrivateBootDeadline,
  privateBootRemaining,
} from './native-clock.js'

interface PhasePlan {
  readonly index: 0 | 1 | 2
  readonly deadlineUnixMs: number
  readonly bootDeadline: PrivateBootDeadline
  readonly ownerAllocation: PrivateExecutionOwnerStateAllocationIdentity
  readonly packageAllocation: PrivatePackageMaterializationAllocationIdentity
}
interface Allocation {
  readonly kind: typeof KIND
  readonly effect: 'project-evaluation'
  readonly effectMemoryBytes: number
  readonly parentRunId: string
  readonly coordinatorEpoch: number
  readonly operationId: string
  readonly parentRequestDigest: string
  readonly parentFlow: NonNullable<Context['parentFlow']> | null
  readonly requestDigest: string
  readonly deadlineUnixMs: number
  readonly effectiveBootDeadline: PrivateBootDeadline
}

export async function executePrivateProjectEvaluation(
  input: Context & {
    readonly call: RunHostCall
    readonly parentDeadlineUnixMs: number
    readonly signal: AbortSignal
  },
): Promise<RunHostOperationTerminal> {
  const target = requireParentTarget(input)
  const route = target.request.slots[input.call.slot]
  if (
    route?.kind !== 'native' ||
    route.native !== 'project-evaluation' ||
    route.grant?.kind !== 'evaluation' ||
    route.contract.digest !== PROJECT_EVALUATION_CONTRACT_DIGEST ||
    input.files === undefined ||
    input.packageStoreRoot === undefined
  )
    return failed(
      'UNAVAILABLE',
      'the evaluation slot requires a retained reviewed recipe and held artifacts',
    )
  const retained = route.evaluation
  if (retained === undefined)
    return failed(
      'UNAVAILABLE',
      'review the evaluation recipe and locked development dependencies before running',
    )
  let candidate: PrivateCapturedOutput
  try {
    requirePrivateProjectEvaluationInput(input.call.input)
    const attachments = input.call.attachments
    if (
      attachments === undefined ||
      Object.keys(attachments).sort().join() !== 'candidate,deliverables' ||
      !('read' in attachments.candidate!) ||
      !('create' in attachments.deliverables!) ||
      attachments.deliverables.create !== true
    )
      throw new TypeError('evaluation requires exactly its two artifact mappings')
    candidate = resolvePrivateFlowArtifact(input.files, attachments.candidate.read)
  } catch {
    return failed(
      'INVALID_INPUT',
      'supply empty input, a held candidate read and operation-created deliverables',
    )
  }
  const effectiveBootDeadline = await privateInvocationBootDeadline(
    input,
    PROJECT_EVALUATION_LIMITS.timeoutMs,
  )
  const deadlineUnixMs = Math.min(
    input.parentDeadlineUnixMs,
    input.parent.intent.deadlineUnixMs,
    Date.now() + PROJECT_EVALUATION_LIMITS.timeoutMs,
  )
  const key = operationKey(input, input.call.operationId)
  const prior = (await owners(input)).find(
    (row) =>
      row.operationId === input.call.operationId &&
      row.parentOperationId === input.parentFlow?.operationId,
  )
  if (prior !== undefined) {
    if (!isEvaluation(prior)) throw new Error('operation identity names a different effect')
    await releaseEvaluation(input, prior)
    return failed('UNCERTAIN', 'the prior evaluation was fenced without replaying its program')
  }
  if (input.signal.aborted)
    return failed('CANCELLED', 'the evaluation was cancelled before dispatch')
  if (privateBootRemaining(effectiveBootDeadline) <= 0)
    return failed('DEADLINE_EXCEEDED', 'the evaluation did not start before its enclosing deadline')
  const snapshots: PrivateCapturedOutput[] = []
  let reviewed: CapturedPackage | undefined
  let dependencies: CapturedPackage | undefined
  let lifecycle: PrivateRootChildOwnerLifecycle | undefined
  let attempted = false
  let terminalProved = false
  let activePhase: PrivateContainedEffectFailurePhase = 'preparation'
  const packageStoreRoot = input.packageStoreRoot
  const files = input.files
  const grant = route.grant
  let operationFailure: { readonly error: unknown } | undefined
  const execute = async (): Promise<RunHostOperationTerminal> => {
    try {
      reviewed = await captureStoredPackage(packageStoreRoot, retained.recipe)
      dependencies = await captureStoredPackage(packageStoreRoot, retained.dependencies)
      await requirePrivateProjectEvaluationCandidate(candidate, reviewed)
      const configuration = await verifyReview(retained, grant, reviewed, dependencies)
      if (target.disposition.state !== 'ready') throw new Error('evaluation parent is unavailable')
      const recipe = await planPrivateDirectRun({
        ...input,
        request: target.request,
        execution: target.disposition.execution,
      })
      if (
        target.disposition.state !== 'ready' ||
        recipe.digest !== target.disposition.recipeDigest ||
        recipe.observation.digest !== target.disposition.observationDigest
      )
        throw new Error('evaluation parent runtime differs from its approval')
      await revalidatePrivateInstalledBunSupport(input.installedSupport)
      if (input.parentFlow !== undefined)
        await requireParentFlowOwner(input, input.parentFlow, deadlineUnixMs)
      const candidateDigest = privateCapturedOutputManifestDigest(candidate)
      const allocation: Allocation = {
        kind: KIND,
        effect: 'project-evaluation',
        effectMemoryBytes: PROJECT_EVALUATION_LIMITS.memoryBytes,
        parentRunId: input.parent.run.runId,
        coordinatorEpoch: input.parent.run.coordinatorEpoch,
        operationId: input.call.operationId,
        parentRequestDigest: target.request.digest,
        parentFlow: input.parentFlow ?? null,
        deadlineUnixMs,
        effectiveBootDeadline,
        requestDigest: privateDomainDigest('JIG-Project-Evaluation-Operation/1', {
          parent: target.request.digest,
          slot: input.call.slot,
          grant,
          candidateDigest,
          recipeDigest: retained.recipeDigest,
          dependencyDigest: retained.dependencyDigest,
          input: {},
          deliverables: 'operation-create',
        } as unknown as JsonValue),
      }
      lifecycle = await allocatePrivateRootChildOwner({
        ...key,
        allocation: allocation as unknown as JsonValue,
      })
      const phases = await executePrivateProjectEvaluationPhases({
        recipe: configuration.recipe,
        deadlineUnixMs,
        bootDeadline: effectiveBootDeadline,
        signal: input.signal,
        executePhase: async (request) => {
          activePhase = 'preparation'
          const workspace = await capturePrivateProjectEvaluationWorkspace({
            candidate,
            reviewed: reviewed!,
            dependencies: dependencies!,
            compiler: configuration.compiler,
            phase: request.phase,
            prior: snapshots,
            signal: input.signal,
          })
          try {
            const identity = phaseIdentity(input, input.call.operationId, request.index).slice(7)
            const protectedParent = await protectedOwnerRoot(input.projectRoot)
            const ownerAllocation = await planPrivateExecutionOwnerStateAllocation(input.backend, {
              parent: protectedParent,
              name: `e-${identity.slice(0, 62)}`,
            })
            let packageAllocation: PrivatePackageMaterializationAllocationIdentity
            // Native allocation may own private state. If planning/persistence fails,
            // cancel and release that exact state rather than losing it between phases.
            try {
              packageAllocation = await allocatePrivatePackageMaterialization({
                protectedParent,
                name: `p-${identity.slice(0, 62)}`,
                packageDigest: workspace.digest,
                ownerToken: ownerAllocation.ownerToken,
              })
              const plan: PhasePlan = {
                index: request.index,
                deadlineUnixMs: request.deadlineUnixMs,
                bootDeadline: normalizePrivateBootDeadline(request.bootDeadline),
                ownerAllocation,
                packageAllocation,
              }
              lifecycle = await recordPrivateRootChildPhase({
                ...key,
                allocationDigest: lifecycle!.allocation.digest,
                phase: request.phase,
                checkpoint: 'plan',
                value: plan as unknown as JsonValue,
              })
            } catch (error) {
              try {
                const cancelled = await cancelPrivateExecutionOwnerStateAllocation(ownerAllocation)
                await releasePrivateExecutionOwnerState(ownerAllocation, cancelled)
              } catch (cleanupError) {
                throw new RunHostFatalOperationError('UNCERTAIN', {
                  cause: new AggregateError(
                    [error, cleanupError],
                    'phase allocation cleanup is unconfirmed',
                  ),
                })
              }
              throw error
            }
            const lease = await materializePrivatePackageLease(workspace, packageAllocation)
            activePhase = 'sealing'
            const sealed = await sealPrivateExecutionOwner(
              input.backend,
              phaseIntent(recipe, request, lease.root, identity, workspace.emptyDirectories),
              ownerAllocation,
            )
            lifecycle = await recordPrivateRootChildPhase({
              ...key,
              allocationDigest: lifecycle!.allocation.digest,
              phase: request.phase,
              checkpoint: 'sandbox',
              value: sealed.identity as unknown as JsonValue,
            })
            activePhase = 'admission'
            input.signal.throwIfAborted()
            const started = performance.now()
            attempted = true
            terminalProved = false
            const component = await admitPrivateExecutionOwner(sealed, input.signal)
            activePhase = 'collection'
            for (const promise of [
              component.completion,
              component.evidence,
              component.terminationReason,
            ])
              void promise.catch(() => undefined)
            let drainedBytes = 0
            const bounded = async function* (stream: AsyncIterable<Uint8Array>) {
              for await (const bytes of stream) {
                drainedBytes += bytes.length
                if (drainedBytes > PROJECT_EVALUATION_LIMITS.drainBytes)
                  throw new TypeError('evaluation streams exceed their aggregate drain profile')
                yield bytes
              }
            }
            const stdout = collectProjectCommandStream(
              bounded(component.stdout),
              PROJECT_EVALUATION_LIMITS.retainedStreamBytes,
            )
            const stderr = collectProjectCommandStream(
              bounded(component.stderr),
              PROJECT_EVALUATION_LIMITS.retainedStreamBytes,
            )
            const send = component.closeInput()
            let observed: PrivateProjectEvaluationPhaseEvidence
            try {
              const [out, err, fence, completion] = await Promise.all([
                stdout,
                stderr,
                component.enforcement,
                component.completion,
                send,
              ])
              if (!['payload_exit', 'cancelled', 'deadline'].includes(fence.stopReason))
                throw new Error('evaluation has no proved process terminal')
              terminalProved = true
              if (component.output === undefined)
                throw new Error('evaluation output capture is unavailable')
              const snapshot =
                component.output.kind === 'linux-directory'
                  ? capturePrivateOutput(component.output.directory.fd, input.signal)
                  : await component.output.ready
              snapshots.push(snapshot)
              requirePrivateProjectEvaluationOutputFiles(snapshot.files, request.writableRoots)
              const emitted = snapshots.flatMap((item) => item.files)
              if (
                emitted.length > PROJECT_EVALUATION_LIMITS.outputFiles ||
                emitted.reduce((sum, file) => sum + file.bytes, 0) >
                  PROJECT_EVALUATION_LIMITS.outputBytes
              )
                throw new TypeError('combined evaluation outputs exceed their finite profile')
              // Snapshot ownership has transferred; only Linux's original directory loan closes here.
              if (component.output.kind === 'linux-directory')
                await closePrivateExecutionOutput(component.output)
              activePhase = 'settlement'
              lifecycle = await settlePhase(input, lifecycle!, request.phase, fence)
              observed = {
                phase: request.phase,
                status:
                  fence.stopReason === 'payload_exit' &&
                  fence.exitCode === 0 &&
                  completion.signal === null
                    ? 'completed'
                    : 'failed',
                invocation: request.invocation,
                exitCode: fence.exitCode,
                signal: completion.signal,
                stopReason:
                  fence.stopReason === 'payload_exit'
                    ? 'exited'
                    : (fence.stopReason as 'deadline' | 'cancelled'),
                durationMs: Math.max(0, performance.now() - started),
                stdout: logicalStream(out, ownerAllocation, lease.root, recipe),
                stderr: logicalStream(err, ownerAllocation, lease.root, recipe),
                files: snapshot.files.map(({ path, bytes, digest }) => ({ path, bytes, digest })),
              }
            } catch (error) {
              await component.terminate().catch(() => undefined)
              await Promise.allSettled([
                stdout,
                stderr,
                send,
                component.enforcement,
                component.completion,
              ])
              if (component.output?.kind === 'linux-directory')
                await closePrivateExecutionOutput(component.output)
              throw error
            }
            return observed
          } finally {
            await workspace.dispose()
          }
        },
      })
      activePhase = 'settlement'
      await releaseEvaluation(input, lifecycle)
      lifecycle = undefined
      input.signal.throwIfAborted()
      const output = capturePrivateOutputSelection(
        snapshots,
        configuration.recipe.collect,
        input.signal,
      )
      try {
        requirePrivateProjectEvaluationOutputFiles(output.files, configuration.recipe.collect)
        await capturePrivateFlowArtifact(
          files,
          { kind: 'snapshot', ready: Promise.resolve(output) },
          input.signal,
        )
      } catch (error) {
        output.close()
        throw error
      }
      const reference = commitPrivateFlowArtifact(files, output)
      return {
        status: 'succeeded',
        result: {
          outcome: 'done',
          output: {
            candidateDigest,
            recipeDigest: retained.recipeDigest,
            dependencyDigest: retained.dependencyDigest,
            environmentDigest: privateProjectEvaluationEnvironmentDigest({
              recipeDigest: retained.recipeDigest,
              dependencyDigest: retained.dependencyDigest,
              installedSupportDigest: recipe.installedSupport.digest,
              mechanismDigest: recipe.mechanismDigest,
            }),
            phases,
            cleanup: 'complete',
          } as unknown as JsonValue,
          artifacts: { deliverables: reference },
        },
      }
    } catch (error) {
      operationFailure = { error }
      try {
        input.onFailure?.(activePhase, error)
      } catch {}
      if (lifecycle !== undefined) {
        try {
          const row = (await owners(input)).find(
            (item) =>
              item.operationId === input.call.operationId &&
              item.parentOperationId === input.parentFlow?.operationId,
          )
          if (row !== undefined) await releaseEvaluation(input, row)
        } catch (cleanupError) {
          throw new RunHostFatalOperationError(
            isPrivateExecutionFenceUnconfirmed(cleanupError) ? 'UNCERTAIN' : 'EXECUTION_FAILED',
            {
              cause: new AggregateError([error, cleanupError], 'evaluation cleanup is unconfirmed'),
            },
          )
        }
      }
      if (error instanceof RunHostFatalOperationError) throw error
      if (input.signal.aborted)
        return failed('CANCELLED', 'evaluation cancelled after owned work was fenced')
      if (
        error instanceof PrivateProjectEvaluationDeadlineError ||
        privateBootRemaining(effectiveBootDeadline) <= 0
      )
        return failed(
          'DEADLINE_EXCEEDED',
          'evaluation stopped at its effective phase or enclosing deadline',
        )
      if (error instanceof PrivateProjectEvaluationReviewRequiredError)
        return failed(
          'UNAVAILABLE',
          'candidate manifest or lock changed; review the evaluation recipe again',
        )
      if (error instanceof CheckError && error.code === 'RUN_CHILD_CAPACITY')
        return failed('RESOURCE_EXHAUSTED', 'the parent has no available evaluation reservation')
      return failed(
        attempted && !terminalProved ? 'UNCERTAIN' : 'EXECUTION_FAILED',
        attempted && !terminalProved
          ? 'evaluation was fenced without complete process evidence; it was not retried'
          : 'evaluation evidence or setup failed; no later phase was started',
      )
    }
  }
  // Settle the operation before retiring its inputs. Cleanup cannot mask either
  // a thrown primary failure or the cause already projected into a failed terminal.
  const outcome = await execute().then(
    (terminal) => ({ status: 'fulfilled' as const, terminal }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  )
  const primaryFailure = outcome.status === 'rejected' ? { error: outcome.error } : operationFailure
  const closing = await Promise.allSettled([
    ...snapshots.map((snapshot) =>
      closePrivateExecutionOutput({ kind: 'snapshot', ready: Promise.resolve(snapshot) }),
    ),
    ...(dependencies === undefined ? [] : [dependencies.dispose()]),
    ...(reviewed === undefined ? [] : [reviewed.dispose()]),
  ])
  const failures = closing.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  )
  if (failures.length !== 0)
    throw new RunHostFatalOperationError(
      primaryFailure?.error instanceof RunHostFatalOperationError &&
        primaryFailure.error.code === 'UNCERTAIN'
        ? 'UNCERTAIN'
        : 'EXECUTION_FAILED',
      {
        cause: new AggregateError(
          [...(primaryFailure === undefined ? [] : [primaryFailure.error]), ...failures],
          'evaluation input or snapshot retirement is unconfirmed',
        ),
      },
    )
  if (outcome.status === 'rejected') throw outcome.error
  return outcome.terminal
}

function phaseIntent(
  recipe: PrivateDirectRunRecipe,
  request: PrivateProjectEvaluationPhaseRequest,
  source: string,
  identity: string,
  emptyDirectories: readonly string[],
): PrivateExecutionIntent {
  const args = request.invocation
    .slice(1)
    .map((value) =>
      value === '--project' || value === 'test' ? value : privateExecutionPath(`/work/${value}`),
    )
  return {
    runId: `eval-${identity.slice(0, 40)}`,
    limits: {
      memoryBytes: PROJECT_EVALUATION_LIMITS.memoryBytes,
      pids: PROJECT_EVALUATION_LIMITS.pids,
      cpuQuotaMicros: PROJECT_EVALUATION_LIMITS.cpuQuotaMicros,
      cpuPeriodMicros: PROJECT_EVALUATION_LIMITS.cpuPeriodMicros,
      cancellationGraceMs: PROJECT_EVALUATION_LIMITS.cancellationGraceMs,
      cleanupTimeoutMs: PROJECT_EVALUATION_LIMITS.cleanupTimeoutMs,
      deadlineUnixMs: request.deadlineUnixMs,
      bootDeadline: normalizePrivateBootDeadline(request.bootDeadline),
    },
    command: [
      privateExecutionPath(recipe.sandboxExecutablePath),
      ...(request.phase === 'test' ? ['test'] : []),
      ...recipe.bunPolicy,
      '--tsconfig-override',
      privateExecutionPath('/work/.jig-evaluation.json'),
      ...(request.phase === 'test' ? args.slice(1) : args),
    ],
    projections: [
      ...privateExecutionFileProjections(recipe.installedSupport.runtimeMounts),
      { source, destination: '/jig-evaluation', kind: 'tree' },
    ],
    evaluationWorkspace: { phase: request.phase, emptyDirectories },
    environment: {
      TMPDIR: '/tmp',
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
      BUN_CONFIG_NO_CLEAR_TERMINAL: '1',
    },
    relocatedEnvironment: { TMPDIR: '/tmp' },
    network: 'isolated',
    output: true,
    storageBytes: PROJECT_EVALUATION_LIMITS.scratchBytes,
    maxOutputBytes: PROJECT_EVALUATION_LIMITS.drainBytes,
  }
}

function logicalStream(
  log: PrivateProjectEvaluationPhaseEvidence['stdout'],
  owner: PrivateExecutionOwnerStateAllocationIdentity,
  source: string,
  recipe: PrivateDirectRunRecipe,
): PrivateProjectEvaluationPhaseEvidence['stdout'] {
  const replacements = [
    [source, '/work'],
    [`${owner.directory}/data/evaluation`, '/work'],
    [`${owner.directory}/data/tmp`, '/tmp'],
    ...recipe.installedSupport.runtimeMounts.map(({ source, destination }) => [
      source,
      destination,
    ]),
    [owner.directory, '[private evaluation owner]'],
  ].sort((a, b) => b[0]!.length - a[0]!.length)
  // One pass: replacement text cannot itself become a second physical match.
  const pattern = new RegExp(
    replacements.map(([path]) => path!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  )
  const values = new Map(replacements.map(([path, logical]) => [path!, logical!]))
  return Object.freeze({
    text: log.text.replace(pattern, (path) => values.get(path)!),
    truncated: log.truncated,
  })
}

async function verifyReview(
  retained: PrivateRetainedProjectEvaluation,
  grant: ProjectEvaluation,
  reviewed: CapturedPackage,
  dependencies: CapturedPackage,
) {
  await verifyPrivateRetainedProjectEvaluation(retained, grant, reviewed, dependencies)
  const layout = normalizePrivateBunExecutionLayout(retained.layout)
  if (layout.flowRoot !== '' || layout.members.length !== 0 || layout.aliases.length !== 0)
    throw new TypeError('evaluation requires its closed single-package dependency layout')
  return retained.configuration
}

async function settlePhase(
  input: Context,
  row: PrivateRootChildOwnerLifecycle,
  phase: PrivateProjectEvaluationPhase,
  knownFence?: PrivateExecutionConfirmedEnforcementReceipt,
): Promise<PrivateRootChildOwnerLifecycle> {
  let lifecycle = row
  const facts = row.phaseHistory.filter((fact) => fact.phase === phase)
  const plan = facts.find((fact) => fact.checkpoint === 'plan')!.value as unknown as PhasePlan
  const bootDeadline = normalizePrivateBootDeadline(plan.bootDeadline)
  const enclosing = normalizePrivateBootDeadline(
    (row.allocation.value as unknown as Allocation).effectiveBootDeadline,
  )
  const allocation = normalizePrivateExecutionOwnerStateAllocationIdentity(plan.ownerAllocation)
  const packageAllocation = normalizePrivatePackageMaterializationAllocationIdentity(
    plan.packageAllocation,
  )
  const identity = phaseIdentity(input, row.operationId, plan.index).slice(7)
  const parent = await protectedOwnerRoot(input.projectRoot)
  if (
    bootDeadline.bootId !== enclosing.bootId ||
    bootDeadline.monotonicMs > enclosing.monotonicMs ||
    allocation.parent !== parent ||
    allocation.name !== `e-${identity.slice(0, 62)}` ||
    packageAllocation.parent.path !== parent ||
    packageAllocation.name !== `p-${identity.slice(0, 62)}` ||
    packageAllocation.ownerToken !== allocation.ownerToken ||
    plan.index !== ['generate', 'compile', 'test'].indexOf(phase) ||
    !Number.isSafeInteger(plan.deadlineUnixMs) ||
    plan.deadlineUnixMs < 0 ||
    plan.deadlineUnixMs > (row.allocation.value as unknown as Allocation).deadlineUnixMs
  )
    throw new Error('evaluation phase owner differs from its logical operation')
  const cleanup = facts.find((fact) => fact.checkpoint === 'cleanup')
  if (cleanup !== undefined) {
    const value = cleanup.value as JsonObject
    if (
      value.workspace !== 'released' ||
      normalizePrivateExecutionOwnerStateReleaseReceipt(value.ownerRelease).allocationDigest !==
        allocation.digest
    )
      throw new Error('evaluation phase cleanup differs from its allocation')
    return lifecycle
  }
  const sandbox = facts.find((fact) => fact.checkpoint === 'sandbox')
  let fence: JsonValue
  let release: unknown
  if (sandbox === undefined) {
    const previousFence = facts.find((fact) => fact.checkpoint === 'fence')
    const cancelled =
      previousFence === undefined
        ? await cancelPrivateExecutionOwnerStateAllocation(allocation)
        : normalizePrivateExecutionOwnerStateCancellation(previousFence.value)
    fence = cancelled as unknown as JsonValue
    lifecycle = await recordPrivateRootChildPhase({
      ...operationKey(input, row.operationId),
      allocationDigest: row.allocation.digest,
      phase,
      checkpoint: 'fence',
      value: fence,
    })
    release = await releasePrivateExecutionOwnerState(allocation, cancelled)
  } else {
    const owner = normalizePrivateExecutionSealedOwnerIdentity(sandbox.value)
    if (
      privateExecutionOwnerAllocationDigest(owner) !== allocation.digest ||
      owner.runId !== `eval-${identity.slice(0, 40)}`
    )
      throw new Error('evaluation phase sandbox differs from its allocation')
    const previousFence = facts.find((fact) => fact.checkpoint === 'fence')
    const receipt =
      previousFence === undefined
        ? (knownFence ?? (await recoverPrivateExecutionFence(input.backend, owner)))
        : normalizePrivateExecutionConfirmedEnforcementReceipt(previousFence.value)
    if (receipt.ownerDigest !== privateExecutionPreparedOwnerDigest(owner))
      throw new Error('evaluation fence belongs to another phase')
    fence = receipt as unknown as JsonValue
    lifecycle = await recordPrivateRootChildPhase({
      ...operationKey(input, row.operationId),
      allocationDigest: row.allocation.digest,
      phase,
      checkpoint: 'fence',
      value: fence,
    })
    release = await releasePrivateExecutionOwnerState(owner, receipt)
  }
  const recovered = await recoverPrivatePackageMaterializationAllocation(parent, packageAllocation)
  if (recovered.state === 'complete') await recovered.lease.dispose()
  return recordPrivateRootChildPhase({
    ...operationKey(input, row.operationId),
    allocationDigest: lifecycle.allocation.digest,
    phase,
    checkpoint: 'cleanup',
    value: { ownerRelease: release, workspace: 'released' } as unknown as JsonValue,
  })
}

async function releaseEvaluation(
  input: Context,
  row: PrivateRootChildOwnerLifecycle,
): Promise<void> {
  const value = row.allocation.value as unknown as Allocation
  normalizePrivateBootDeadline(value.effectiveBootDeadline)
  const parentFlow = normalizeParentFlow(value.parentFlow, row.parentOperationId)
  const context = { ...input, parentFlow: parentFlow ?? undefined }
  if (
    !isEvaluation(row) ||
    value.effect !== 'project-evaluation' ||
    value.effectMemoryBytes !== PROJECT_EVALUATION_LIMITS.memoryBytes ||
    !/^sha256:[0-9a-f]{64}$/.test(value.requestDigest) ||
    !Number.isSafeInteger(value.deadlineUnixMs) ||
    value.deadlineUnixMs < 0 ||
    value.parentRunId !== input.parent.run.runId ||
    value.operationId !== row.operationId ||
    value.coordinatorEpoch !== input.parent.run.coordinatorEpoch ||
    value.parentRequestDigest !== requireParentTarget(context).request.digest ||
    value.deadlineUnixMs > input.parent.intent.deadlineUnixMs
  )
    throw new Error('evaluation logical owner differs from its admitted parent')
  let lifecycle = row
  for (const phase of ['generate', 'compile', 'test'] as const)
    if (lifecycle.phaseHistory.some((fact) => fact.phase === phase))
      lifecycle = await settlePhase(context, lifecycle, phase)
  await closePrivateRootChildOwner({
    ...operationKey(context, row.operationId),
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: null,
    fenceDigest: null,
    cleanupDigest: null,
    phaseHistoryDigest: lifecycle.phaseHistoryDigest,
  })
}

export async function recoverPrivateProjectEvaluationOwners(input: Context): Promise<void> {
  for (const row of await owners(input))
    if (
      isEvaluation(row) &&
      (input.parentFlow === undefined || row.parentOperationId === input.parentFlow.operationId)
    )
      await releaseEvaluation(input, row)
}
function isEvaluation(row: PrivateRootChildOwnerLifecycle) {
  const value = row.allocation.value as JsonObject | null
  return value?.kind === KIND && value.effect === 'project-evaluation'
}
function phaseIdentity(input: Context, operationId: string, index: 0 | 1 | 2) {
  return privateProjectEvaluationPhaseIdentity({
    parentRunId: input.parent.run.runId,
    operationId,
    index,
    ...(input.parentFlow === undefined ? {} : { parentOperationId: input.parentFlow.operationId }),
  })
}
function operationKey(input: Context, operationId: string) {
  return {
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
    operationId,
    ...(input.parentFlow === undefined ? {} : { parentOperationId: input.parentFlow.operationId }),
  }
}
function owners(input: Context) {
  return listPrivateRootChildOwners({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  })
}
function failed(
  code: Extract<RunHostOperationTerminal, { status: 'failed' }>['code'],
  message: string,
): RunHostOperationTerminal {
  return { status: 'failed', code, message }
}
