import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { CheckError } from '../diagnostics.js'
import type { JsonValue } from '../json.js'
import { type InspectedPackage, inspectCapturedPackage } from '../package/inspect.js'
import {
  type ChannelBroker,
  type ChannelDeclaration,
  ChannelOperationError,
  type ChannelParticipant,
} from '../run/channels.js'
import {
  type RunHostFlowCall,
  type RunHostFlowOperationTerminal,
  type RunHostOperationDispatcher,
  type RunHostOperationFailure,
  RunHostSession,
  type RunHostTerminal,
  type WireFailureCode,
} from '../run/session.js'
import { SchemaDiagnostic } from '../schema/index.js'
import { findPrivateActivationCandidateTargetV5 } from './activation-admission.js'
import {
  allocatePrivateRootChildOwner,
  closePrivateRootChildOwner,
  listPrivateRootChildOwners,
  type PrivateProjectCoordinator,
  type PrivateReacquiredRootExecutionWork,
  type PrivateRootChildOwnerLifecycle,
  recordPrivateRootChildCleanup,
  recordPrivateRootChildFence,
  recordPrivateRootChildSandbox,
} from './activation-admission-store.js'
import type { PrivateAgentProvider } from './agent-provider.js'
import { privateBunExecutionMaterialization } from './bun-execution-layout.js'
import {
  type PrivateDirectRunInstalledSupport,
  type PrivateDirectRunRecipe,
  planPrivateDirectRun,
} from './direct-run.js'
import { privateDomainDigest } from './identity.js'
import { revalidatePrivateInstalledBunSupport } from './installed-bun-support.js'
import {
  cancelPrivateLinuxOwnerStateAllocation,
  normalizePrivateLinuxConfirmedEnforcementReceipt,
  normalizePrivateLinuxOwnerStateAllocationIdentity,
  normalizePrivateLinuxOwnerStateReleaseReceipt,
  normalizePrivateLinuxSealedOwnerIdentity,
  type PrivateLinuxCgroupBackend,
  type PrivateLinuxConfirmedEnforcementReceipt,
  PrivateLinuxFenceUnconfirmedError,
  type PrivateLinuxLaunchPlan,
  type PrivateLinuxOwnerStateAllocationIdentity,
  type PrivateLinuxOwnerStateReleaseReceipt,
  type PrivateLinuxSealedOwnerIdentity,
  planPrivateLinuxOwnerStateAllocation,
  releasePrivateLinuxOwnerState,
} from './linux-rootless-backend.js'
import { captureStoredPackage } from './package-artifact-store.js'
import {
  allocatePrivatePackageMaterialization,
  disposePrivatePackageMaterializationLease,
  materializePrivatePackageLease,
  normalizePrivatePackageMaterializationAllocationIdentity,
  type PrivatePackageMaterializationAllocationIdentity,
  type PrivatePackageMaterializationLease,
  privatePackageMaterializationMatches,
  recoverPrivatePackageMaterializationAllocation,
} from './package-materialization.js'
import { admitPrivatePackageResult } from './package-result-admission.js'
import { PROJECT_COMMAND_CONTRACT_DIGEST } from './private-project-command.js'
import {
  executePrivateRootAgentRun,
  recoverPrivateRootAgentRunOwners,
} from './root-agent-run-controller.js'
import {
  executePrivateProjectCommand,
  recoverPrivateProjectCommandOwners,
} from './root-project-command-controller.js'
import {
  channelContractResolver,
  type PrivateChannelContractCache,
  resolveChannelDeclarations,
} from './run-channels.js'

const ALLOCATION_KIND = 'private-root-child-owner-allocation/1'
const SANDBOX_KIND = 'private-root-child-sandbox/1'
const CLEANUP_KIND = 'private-root-child-cleanup/1'
const CANCELLATION_GRACE_MS = 1_000

interface ChildAllocation {
  readonly kind: typeof ALLOCATION_KIND
  readonly parentRunId: string
  readonly coordinatorEpoch: number
  readonly operationId: string
  readonly requestDigest: string
  readonly effectiveDeadlineUnixMs: number
  readonly packageAllocation: PrivatePackageMaterializationAllocationIdentity
  readonly ownerAllocation: PrivateLinuxOwnerStateAllocationIdentity
}

interface ChildSandbox {
  readonly kind: typeof SANDBOX_KIND
  readonly owner: PrivateLinuxSealedOwnerIdentity
}

interface ChildCleanup {
  readonly kind: typeof CLEANUP_KIND
  readonly packageReleased: true
  readonly ownerRelease: PrivateLinuxOwnerStateReleaseReceipt
}

interface ChildInput {
  readonly projectRoot: string
  readonly packageStoreRoot: string
  readonly parent: PrivateReacquiredRootExecutionWork
  readonly coordinator: PrivateProjectCoordinator
  readonly installedSupport: PrivateDirectRunInstalledSupport
  readonly backend: PrivateLinuxCgroupBackend
  readonly agentProvider?: PrivateAgentProvider | undefined
  readonly channels?: {
    readonly caller: ChannelParticipant
    readonly broker: ChannelBroker
    readonly contracts?: PrivateChannelContractCache
  }
  readonly onDiagnostic?: (bytes: Uint8Array) => void
}

type ChildCallInput = ChildInput & {
  readonly call: RunHostFlowCall
  readonly parentDeadlineUnixMs: number
  readonly signal: AbortSignal
}

/** Execute one exact admitted Flow slot without creating child history. */
export async function executePrivateRootFlowCall(
  input: ChildCallInput,
): Promise<RunHostFlowOperationTerminal> {
  const selected = selectChild(input.parent, input.call.slot)
  if (selected === undefined) {
    return failed('UNAVAILABLE', 'the requested slot has no admitted child Flow')
  }
  if (selected.disposition.state !== 'ready') {
    return failed('UNAVAILABLE', 'the admitted child Flow is unavailable on this host')
  }
  if (input.signal.aborted) return failed('CANCELLED', 'the child Flow call was cancelled')

  const captured = await captureStoredPackage(input.packageStoreRoot, selected.request.package)
  let participant: ChannelParticipant | undefined
  try {
    const inspected = await inspectCapturedPackage(captured)
    try {
      inspected.schemas.input?.validate(input.call.input, 'INVALID_INPUT')
    } catch (error) {
      if (!(error instanceof SchemaDiagnostic)) throw error
      return failed('INVALID_INPUT', 'child Flow input does not satisfy its declared schema')
    }
    const resolveContract = channelContractResolver(captured, input.channels?.contracts)
    const declarations = await resolveChannelDeclarations(
      inspected.metadata.channels ?? {},
      resolveContract,
    )
    if (
      input.channels === undefined &&
      (Object.keys(input.call.channels ?? {}).length !== 0 ||
        Object.values(declarations).some((declaration) => declaration.required !== false))
    )
      return failed('UNAVAILABLE', 'the child channel owner is unavailable')
    participant = input.channels?.broker.participant(`flow:${input.call.operationId}`, {
      resolveContract,
    })
    return await executePreparedChild(input, selected, inspected, participant, declarations)
  } catch (error) {
    if (error instanceof ChannelOperationError)
      return failed(error.code, error.message, error.details)
    throw error
  } finally {
    // The capture also owns any dynamically resolved package-local channel contracts.
    // A failed preflight has no moved rights; a dispatched child retains its own duties.
    participant?.finalize(false)
    await captured.dispose()
  }
}

async function executePreparedChild(
  input: ChildCallInput,
  selected: NonNullable<ReturnType<typeof selectChild>>,
  inspected: InspectedPackage,
  participant: ChannelParticipant | undefined,
  declarations: Readonly<Record<string, ChannelDeclaration>>,
): Promise<RunHostFlowOperationTerminal> {
  if (selected.disposition.state !== 'ready')
    return failed('UNAVAILABLE', 'the admitted child Flow is unavailable on this host')
  let recipe: PrivateDirectRunRecipe
  try {
    recipe = await planPrivateDirectRun({
      request: selected.request,
      execution: selected.disposition.execution,
      installedSupport: input.installedSupport,
      backend: input.backend,
      agentProvider: input.agentProvider,
    })
  } catch {
    return failed('UNAVAILABLE', 'the admitted child recipe cannot be reproduced')
  }
  if (
    recipe.digest !== selected.disposition.recipeDigest ||
    recipe.observation.digest !== selected.disposition.observationDigest
  ) {
    return failed('UNAVAILABLE', 'the admitted child recipe cannot be reproduced')
  }
  const effectiveDeadlineUnixMs = Math.min(
    input.parentDeadlineUnixMs,
    input.parent.intent.deadlineUnixMs,
    Date.now() + recipe.wallClockCeilingMs,
  )
  if (Date.now() >= effectiveDeadlineUnixMs) {
    return failed('DEADLINE_EXCEEDED', 'the child Flow deadline elapsed before dispatch')
  }

  const existing = (
    await listPrivateRootChildOwners({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      parentRunId: input.parent.run.runId,
    })
  ).find(
    ({ operationId, parentOperationId }) =>
      parentOperationId === undefined && operationId === input.call.operationId,
  )
  if (existing !== undefined) {
    await recoverOne(input, existing)
    return failed('UNCERTAIN', 'a prior child dispatch was fenced without a proved result')
  }

  const roots = await protectedWorkRoots(input.projectRoot)
  const identity = childIdentity(input.parent.run.runId, input.call.operationId)
  const [packageAllocation, ownerAllocation] = await Promise.all([
    allocatePrivatePackageMaterialization({
      protectedParent: roots.materializations,
      name: `child-${identity.slice(0, 48)}`,
      ...privateBunExecutionMaterialization(recipe.execution),
      ownerToken: `sha256:${identity}`,
    }),
    planPrivateLinuxOwnerStateAllocation({
      parent: roots.owners,
      name: `c-${identity.slice(0, 47)}`,
    }),
  ])
  const allocation: ChildAllocation = Object.freeze({
    kind: ALLOCATION_KIND,
    parentRunId: input.parent.run.runId,
    coordinatorEpoch: input.parent.run.coordinatorEpoch,
    operationId: input.call.operationId,
    requestDigest: selected.request.digest,
    effectiveDeadlineUnixMs,
    packageAllocation,
    ownerAllocation,
  })
  let lifecycle: PrivateRootChildOwnerLifecycle
  try {
    lifecycle = await allocatePrivateRootChildOwner({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      parentRunId: input.parent.run.runId,
      operationId: input.call.operationId,
      allocation: allocation as unknown as JsonValue,
    })
  } catch (error) {
    if (error instanceof CheckError && error.code === 'RUN_CHILD_CAPACITY') {
      return failed('RESOURCE_EXHAUSTED', 'the parent Run already has an active child operation')
    }
    throw error
  }

  let attemptedDispatch = false
  try {
    const lease = await materializeChild(input.packageStoreRoot, recipe, packageAllocation)
    await revalidateRecipe(recipe)
    const sealed = await input.backend.seal(
      backendPlan(recipe, lease.root, identity, effectiveDeadlineUnixMs),
      ownerAllocation,
    )
    const sandbox: ChildSandbox = Object.freeze({ kind: SANDBOX_KIND, owner: sealed.identity })
    lifecycle = await recordPrivateRootChildSandbox({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      parentRunId: input.parent.run.runId,
      operationId: input.call.operationId,
      allocationDigest: lifecycle.allocation.digest,
      sandbox: sandbox as unknown as JsonValue,
    })

    if (input.signal.aborted)
      throw new ChannelOperationError('CANCELLED', 'the child Flow call was cancelled')
    if (Date.now() >= effectiveDeadlineUnixMs)
      throw new ChannelOperationError(
        'DEADLINE_EXCEEDED',
        'the child Flow deadline elapsed before dispatch',
      )
    // All target, input, recipe, resource and owner checks precede the atomic move.
    // No package bytes execute between this transfer and the sealed admission.
    const grants =
      participant === undefined
        ? undefined
        : input.channels!.caller.transfer(participant, input.call.channels ?? {}, declarations)
    const startup = startupSignal(input.signal)
    let component
    try {
      attemptedDispatch = true
      component = await sealed.admit(startup.signal)
    } finally {
      startup.dispose()
    }
    const provisional = await new RunHostSession(
      component,
      {
        input: input.call.input,
        settings: selected.request.settings,
        attachments: Object.freeze({}),
        ...(grants === undefined ? {} : { channels: grants }),
        scratch: recipe.scratch,
        deadlineUnixMs: effectiveDeadlineUnixMs,
        signal: input.signal,
      },
      { cancellationGraceMs: CANCELLATION_GRACE_MS },
      specialistDispatcher(input, selected, effectiveDeadlineUnixMs, inspected, participant),
    ).run()
    const fence = await component.enforcement
    await releaseKnownChild(input, lifecycle, lease, fence)
    return await admitOperationResult(input.packageStoreRoot, selected.request.package, provisional)
  } catch (error) {
    try {
      const active = await findLifecycle(input, input.call.operationId)
      if (active !== undefined) await recoverOne(input, active)
    } catch (cleanupError) {
      if (attemptedDispatch && cleanupError instanceof PrivateLinuxFenceUnconfirmedError) {
        return failed(
          'UNCERTAIN',
          'child dispatch may have occurred but its fence is not yet confirmed',
        )
      }
      throw new AggregateError([error, cleanupError], 'child Flow execution and cleanup failed')
    }
    if (input.signal.aborted) return failed('CANCELLED', 'the child Flow call was cancelled')
    if (Date.now() >= effectiveDeadlineUnixMs) {
      return failed('DEADLINE_EXCEEDED', 'the child Flow deadline elapsed')
    }
    if (!attemptedDispatch && error instanceof ChannelOperationError)
      return failed(error.code, error.message, error.details)
    return attemptedDispatch
      ? failed('UNCERTAIN', 'child dispatch may have occurred but no result was proved')
      : failed('EXECUTION_FAILED', 'child Flow execution failed before dispatch')
  }
}

/** Fence and release every child owner before the parent may close. */
export async function recoverPrivateRootFlowCallOwners(input: ChildInput): Promise<void> {
  const owners = await listPrivateRootChildOwners({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  })
  for (const owner of owners) {
    if (isPrivateRootFlowCallOwner(owner)) await recoverOne(input, owner)
  }
}

/** Distinguish Flow cleanup rows from other invocation-local child work. */
export function isPrivateRootFlowCallOwner(lifecycle: PrivateRootChildOwnerLifecycle): boolean {
  const value = lifecycle.allocation.value
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    lifecycle.parentOperationId === undefined &&
    (value as Record<string, JsonValue>).kind === ALLOCATION_KIND
  )
}

function selectChild(parent: PrivateReacquiredRootExecutionWork, slot: string) {
  const parentTarget = findPrivateActivationCandidateTargetV5(parent.candidate, parent.run.target)
  if (parentTarget === undefined || parentTarget.request.digest !== parent.intent.requestDigest) {
    throw new Error('parent Run differs from its admitted target')
  }
  const target = parentTarget.request.flowSlots[slot]
  if (target === undefined) return undefined
  const child = findPrivateActivationCandidateTargetV5(parent.candidate, target)
  if (child === undefined || Object.keys(child.request.flowSlots).length !== 0) {
    throw new Error('admitted Flow slot does not name one leaf child target')
  }
  return child
}

function specialistDispatcher(
  input: ChildInput & { readonly call: RunHostFlowCall },
  selected: NonNullable<ReturnType<typeof selectChild>>,
  parentDeadlineUnixMs: number,
  inspected: InspectedPackage,
  participant: ChannelParticipant | undefined,
): RunHostOperationDispatcher {
  let active = false
  return {
    ...(participant === undefined ? {} : { channels: participant }),
    ...(input.onDiagnostic === undefined ? {} : { onDiagnostic: input.onDiagnostic }),
    validateResult(result) {
      const admitted = admitPrivatePackageResult(inspected, {
        status: 'succeeded',
        result,
        diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
      })
      if (admitted.status === 'failed')
        throw new ChannelOperationError('INVALID_RESULT', admitted.message, admitted.details)
    },
    async callCapability(call, signal) {
      if (active)
        return failed('RESOURCE_EXHAUSTED', 'the specialist already has an active operation')
      active = true
      try {
        if (selected.request.capabilities[call.slot]?.digest === PROJECT_COMMAND_CONTRACT_DIGEST) {
          if (Object.keys(call.channels ?? {}).length !== 0)
            return failed('UNAVAILABLE', 'this capability has no supported channels')
          return await executePrivateProjectCommand({
            ...input,
            parentFlow: {
              operationId: input.call.operationId,
              target: selected.request.target,
              requestDigest: selected.request.digest,
            },
            call,
            parentDeadlineUnixMs,
            signal,
          })
        }
        if (input.agentProvider === undefined)
          return failed('UNAVAILABLE', 'the admitted Agent provider is unavailable')
        return await executePrivateRootAgentRun({
          ...input,
          agentProvider: input.agentProvider,
          ...(participant === undefined || input.channels === undefined
            ? {}
            : { channels: { caller: participant, broker: input.channels.broker } }),
          parentFlow: {
            operationId: input.call.operationId,
            target: selected.request.target,
            requestDigest: selected.request.digest,
          },
          call,
          parentDeadlineUnixMs,
          signal,
        })
      } finally {
        active = false
      }
    },
  }
}

async function admitOperationResult(
  store: string,
  reference: Parameters<typeof captureStoredPackage>[1],
  provisional: RunHostTerminal,
): Promise<RunHostFlowOperationTerminal> {
  let admitted = provisional
  if (provisional.status === 'succeeded') {
    const captured = await captureStoredPackage(store, reference)
    try {
      admitted = admitPrivatePackageResult(await inspectCapturedPackage(captured), provisional)
    } finally {
      await captured.dispose()
    }
  }
  if (admitted.status === 'succeeded') {
    return Object.freeze({ status: 'succeeded' as const, result: admitted.result })
  }
  if (admitted.code === 'PROTOCOL_ERROR' || admitted.code === 'CHANNEL_LOST') {
    return failed('EXECUTION_FAILED', 'the child Flow execution channel failed')
  }
  return failed(admitted.code, admitted.message, admitted.details)
}

async function materializeChild(
  store: string,
  recipe: PrivateDirectRunRecipe,
  allocation: PrivatePackageMaterializationAllocationIdentity,
): Promise<PrivatePackageMaterializationLease> {
  const captured = await captureStoredPackage(store, recipe.execution.package)
  try {
    return await materializePrivatePackageLease(captured, allocation)
  } finally {
    await captured.dispose()
  }
}

async function revalidateRecipe(recipe: PrivateDirectRunRecipe): Promise<void> {
  const [mechanism] = await Promise.all([
    recipe.backend.observeMechanism(),
    revalidatePrivateInstalledBunSupport(recipe.installedSupport),
  ])
  if (mechanism.support.digest !== recipe.mechanismDigest) {
    throw new Error('child recipe no longer matches retained host support')
  }
}

function backendPlan(
  recipe: PrivateDirectRunRecipe,
  packageRoot: string,
  identity: string,
  deadlineUnixMs: number,
): PrivateLinuxLaunchPlan {
  return Object.freeze({
    runId: `child-${identity.slice(0, 42)}`,
    limits: Object.freeze({
      ...recipe.resourceCeilings,
      deadlineUnixMs,
      cancellationGraceMs: CANCELLATION_GRACE_MS,
    }),
    readOnlyMounts: Object.freeze([
      ...recipe.installedSupport.runtimeMounts,
      { source: packageRoot, destination: recipe.packageDestination },
    ]),
    command: recipe.command,
  })
}

async function releaseKnownChild(
  input: ChildInput,
  lifecycleValue: PrivateRootChildOwnerLifecycle,
  lease: PrivatePackageMaterializationLease,
  fence: PrivateLinuxConfirmedEnforcementReceipt,
): Promise<void> {
  let lifecycle = lifecycleValue
  const selected = await requireAllocationMatchesParent(
    input,
    lifecycle,
    parseAllocation(lifecycle),
  )
  const sandbox = parseSandbox(lifecycle)
  lifecycle = await recordPrivateRootChildFence({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: lifecycle.parentRunId,
    operationId: lifecycle.operationId,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox!.digest,
    fence: fence as unknown as JsonValue,
  })
  await recoverPrivateRootAgentRunOwners({
    ...input,
    parentFlow: {
      operationId: lifecycle.operationId,
      target: selected.request.target,
      requestDigest: selected.request.digest,
    },
  })
  await recoverPrivateProjectCommandOwners({
    ...input,
    parentFlow: {
      operationId: lifecycle.operationId,
      target: selected.request.target,
      requestDigest: selected.request.digest,
    },
  })
  await disposePrivatePackageMaterializationLease(
    lease.identity.allocation.parent.path,
    lease.identity,
  )
  const ownerRelease = await releasePrivateLinuxOwnerState(sandbox.owner, fence)
  const cleanup = childCleanup(ownerRelease)
  lifecycle = await recordPrivateRootChildCleanup({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: lifecycle.parentRunId,
    operationId: lifecycle.operationId,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox!.digest,
    fenceDigest: lifecycle.fence!.digest,
    cleanup: cleanup as unknown as JsonValue,
  })
  await closePrivateRootChildOwner({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: lifecycle.parentRunId,
    operationId: lifecycle.operationId,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox!.digest,
    fenceDigest: lifecycle.fence!.digest,
    cleanupDigest: lifecycle.cleanup!.digest,
  })
}

async function recoverOne(
  input: ChildInput,
  lifecycle: PrivateRootChildOwnerLifecycle,
): Promise<void> {
  const allocation = parseAllocation(lifecycle)
  const selected = await requireAllocationMatchesParent(input, lifecycle, allocation)
  if (lifecycle.sandbox === undefined) {
    const cancelled = await cancelPrivateLinuxOwnerStateAllocation(allocation.ownerAllocation)
    await releasePrivateLinuxOwnerState(allocation.ownerAllocation, cancelled)
  } else {
    const sandbox = parseSandbox(lifecycle)
    let fence: PrivateLinuxConfirmedEnforcementReceipt
    if (lifecycle.fence === undefined) {
      fence = await input.backend.recoverFence(sandbox.owner)
      lifecycle = await recordPrivateRootChildFence({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        parentRunId: lifecycle.parentRunId,
        operationId: lifecycle.operationId,
        allocationDigest: lifecycle.allocation.digest,
        sandboxDigest: lifecycle.sandbox!.digest,
        fence: fence as unknown as JsonValue,
      })
    } else {
      fence = parseFence(lifecycle)
    }
    await recoverPrivateRootAgentRunOwners({
      ...input,
      parentFlow: {
        operationId: lifecycle.operationId,
        target: selected.request.target,
        requestDigest: selected.request.digest,
      },
    })
    await recoverPrivateProjectCommandOwners({
      ...input,
      parentFlow: {
        operationId: lifecycle.operationId,
        target: selected.request.target,
        requestDigest: selected.request.digest,
      },
    })
    const recovered = await recoverPrivatePackageMaterializationAllocation(
      allocation.packageAllocation.parent.path,
      allocation.packageAllocation,
    )
    if (recovered.state === 'complete') await recovered.lease.dispose()
    const ownerRelease = await releasePrivateLinuxOwnerState(sandbox.owner, fence)
    const cleanup = childCleanup(ownerRelease)
    if (lifecycle.cleanup === undefined) {
      lifecycle = await recordPrivateRootChildCleanup({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        parentRunId: lifecycle.parentRunId,
        operationId: lifecycle.operationId,
        allocationDigest: lifecycle.allocation.digest,
        sandboxDigest: lifecycle.sandbox!.digest,
        fenceDigest: lifecycle.fence!.digest,
        cleanup: cleanup as unknown as JsonValue,
      })
    } else {
      requireCleanupMatches(lifecycle, cleanup)
    }
  }
  if (lifecycle.sandbox === undefined) {
    const recovered = await recoverPrivatePackageMaterializationAllocation(
      allocation.packageAllocation.parent.path,
      allocation.packageAllocation,
    )
    if (recovered.state === 'complete') await recovered.lease.dispose()
  }
  await closePrivateRootChildOwner({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: lifecycle.parentRunId,
    operationId: lifecycle.operationId,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox?.digest ?? null,
    fenceDigest: lifecycle.fence?.digest ?? null,
    cleanupDigest: lifecycle.cleanup?.digest ?? null,
  })
}

async function findLifecycle(
  input: ChildInput,
  operationId: string,
): Promise<PrivateRootChildOwnerLifecycle | undefined> {
  return (
    await listPrivateRootChildOwners({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      parentRunId: input.parent.run.runId,
    })
  ).find((item) => item.parentOperationId === undefined && item.operationId === operationId)
}

function parseAllocation(lifecycle: PrivateRootChildOwnerLifecycle): ChildAllocation {
  const value = exactObject(
    lifecycle.allocation.value,
    [
      'kind',
      'parentRunId',
      'coordinatorEpoch',
      'operationId',
      'requestDigest',
      'effectiveDeadlineUnixMs',
      'packageAllocation',
      'ownerAllocation',
    ],
    'child allocation',
  )
  if (
    value.kind !== ALLOCATION_KIND ||
    lifecycle.parentOperationId !== undefined ||
    value.parentRunId !== lifecycle.parentRunId ||
    value.operationId !== lifecycle.operationId ||
    typeof value.coordinatorEpoch !== 'number' ||
    !Number.isSafeInteger(value.coordinatorEpoch) ||
    value.coordinatorEpoch < 1 ||
    typeof value.requestDigest !== 'string' ||
    typeof value.effectiveDeadlineUnixMs !== 'number' ||
    !Number.isSafeInteger(value.effectiveDeadlineUnixMs) ||
    value.effectiveDeadlineUnixMs < 0
  ) {
    throw new TypeError('child allocation is invalid')
  }
  return Object.freeze({
    kind: ALLOCATION_KIND,
    parentRunId: value.parentRunId as string,
    coordinatorEpoch: value.coordinatorEpoch,
    operationId: value.operationId as string,
    requestDigest: value.requestDigest,
    effectiveDeadlineUnixMs: value.effectiveDeadlineUnixMs,
    packageAllocation: normalizePrivatePackageMaterializationAllocationIdentity(
      value.packageAllocation,
    ),
    ownerAllocation: normalizePrivateLinuxOwnerStateAllocationIdentity(value.ownerAllocation),
  })
}

function parseSandbox(lifecycle: PrivateRootChildOwnerLifecycle): ChildSandbox {
  if (lifecycle.sandbox === undefined) throw new TypeError('child sandbox owner is absent')
  const value = exactObject(lifecycle.sandbox.value, ['kind', 'owner'], 'child sandbox')
  if (value.kind !== SANDBOX_KIND) throw new TypeError('child sandbox kind is invalid')
  return Object.freeze({
    kind: SANDBOX_KIND,
    owner: normalizePrivateLinuxSealedOwnerIdentity(value.owner),
  })
}

function parseFence(
  lifecycle: PrivateRootChildOwnerLifecycle,
): PrivateLinuxConfirmedEnforcementReceipt {
  if (lifecycle.fence === undefined) throw new TypeError('child fence is absent')
  return normalizePrivateLinuxConfirmedEnforcementReceipt(lifecycle.fence.value)
}

function childCleanup(ownerRelease: PrivateLinuxOwnerStateReleaseReceipt): ChildCleanup {
  return Object.freeze({
    kind: CLEANUP_KIND,
    packageReleased: true,
    ownerRelease,
  })
}

function parseCleanup(lifecycle: PrivateRootChildOwnerLifecycle): ChildCleanup {
  if (lifecycle.cleanup === undefined) throw new TypeError('child cleanup is absent')
  const value = exactObject(
    lifecycle.cleanup.value,
    ['kind', 'ownerRelease', 'packageReleased'],
    'child cleanup',
  )
  if (value.kind !== CLEANUP_KIND || value.packageReleased !== true) {
    throw new TypeError('child cleanup is invalid')
  }
  return childCleanup(normalizePrivateLinuxOwnerStateReleaseReceipt(value.ownerRelease))
}

function requireCleanupMatches(
  lifecycle: PrivateRootChildOwnerLifecycle,
  expected: ChildCleanup,
): void {
  const actual = parseCleanup(lifecycle)
  if (actual.ownerRelease.digest !== expected.ownerRelease.digest) {
    throw new Error('durable child cleanup differs from the released owner')
  }
}

async function requireAllocationMatchesParent(
  input: ChildInput,
  lifecycle: PrivateRootChildOwnerLifecycle,
  allocation: ChildAllocation,
): Promise<NonNullable<ReturnType<typeof selectChild>>> {
  const parentTarget = findPrivateActivationCandidateTargetV5(
    input.parent.candidate,
    input.parent.run.target,
  )
  if (
    parentTarget === undefined ||
    parentTarget.request.digest !== input.parent.intent.requestDigest ||
    allocation.parentRunId !== input.parent.run.runId ||
    allocation.coordinatorEpoch !== input.parent.run.coordinatorEpoch ||
    allocation.operationId !== lifecycle.operationId ||
    allocation.effectiveDeadlineUnixMs > input.parent.intent.deadlineUnixMs
  ) {
    throw new Error('durable child allocation differs from its parent Run')
  }
  const selected = Object.values(parentTarget.request.flowSlots)
    .map((target) => findPrivateActivationCandidateTargetV5(input.parent.candidate, target))
    .find((target) => target?.request.digest === allocation.requestDigest)
  if (
    selected === undefined ||
    selected.disposition.state !== 'ready' ||
    Object.keys(selected.request.flowSlots).length !== 0
  ) {
    throw new Error('durable child allocation is not an admitted leaf Flow')
  }
  const roots = await protectedWorkRoots(input.projectRoot)
  const identity = childIdentity(lifecycle.parentRunId, lifecycle.operationId)
  if (
    allocation.packageAllocation.parent.path !== roots.materializations ||
    allocation.packageAllocation.name !== `child-${identity.slice(0, 48)}` ||
    !privatePackageMaterializationMatches(
      allocation.packageAllocation,
      privateBunExecutionMaterialization(selected.disposition.execution),
    ) ||
    allocation.packageAllocation.ownerToken !== `sha256:${identity}` ||
    allocation.ownerAllocation.parent !== roots.owners ||
    allocation.ownerAllocation.name !== `c-${identity.slice(0, 47)}`
  ) {
    throw new Error('durable child allocation differs from its admitted resources')
  }
  return selected
}

function exactObject(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const record = value as Record<string, unknown>
  const actual = Object.keys(record).sort()
  const expected = [...fields].sort()
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(`${label} must contain exactly ${expected.join(', ')}`)
  }
  return record
}

function childIdentity(parentRunId: string, operationId: string): string {
  return privateDomainDigest('JIG-Private-Root-Child-Identity/1', {
    parentRunId,
    operationId,
  }).slice('sha256:'.length)
}

async function protectedWorkRoots(projectRoot: string): Promise<{
  readonly materializations: string
  readonly owners: string
}> {
  const state = await realpath(join(projectRoot, '.jig'))
  const materializations = join(state, 'private-root-materializations')
  const owners = join(state, 'private-root-linux-owners')
  await Promise.all([ensureProtectedDirectory(materializations), ensureProtectedDirectory(owners)])
  return Object.freeze({ materializations, owners })
}

async function ensureProtectedDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700 }).catch((error) => {
    if (!hasCode(error, 'EEXIST')) throw error
  })
  const information = await lstat(path)
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1
  if (
    !information.isDirectory() ||
    information.isSymbolicLink() ||
    information.uid !== uid ||
    (information.mode & 0o077) !== 0 ||
    (await realpath(path)) !== path
  ) {
    throw new Error('child execution owner directory is not protected')
  }
}

function startupSignal(signal: AbortSignal): {
  readonly signal: AbortSignal
  dispose(): void
} {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  return Object.freeze({
    signal: controller.signal,
    dispose(): void {
      signal.removeEventListener('abort', abort)
    },
  })
}

function failed(
  code: WireFailureCode,
  message: string,
  details?: JsonValue,
): RunHostOperationFailure {
  return Object.freeze({
    status: 'failed' as const,
    code,
    message,
    ...(details === undefined ? {} : { details }),
  })
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error !== null && typeof error === 'object' && (error as NodeJS.ErrnoException).code === code
  )
}
