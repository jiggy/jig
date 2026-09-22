import { join } from 'node:path'
import type { FileHandle } from 'node:fs/promises'
import { CheckError } from '../diagnostics.js'
import { PrivateFiniteAcpPolicyError } from './finite-acp-policy.js'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import { nativeInvocationKind } from '../project/invocation-slots.js'
import {
  type ChannelBroker,
  ChannelOperationError,
  type ChannelParticipant,
} from '../run/channels.js'
import type { RunHostCall, RunHostOperationTerminal, WireFailureCode } from '../run/session.js'
import { RunHostFatalOperationError } from '../run/session.js'
import {
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
  requirePrivateAcpAgentProvider,
  type PrivateAcpAgentProvider,
} from './acp-agent-provider.js'
import {
  allocatePrivateRootChildOwner,
  closePrivateRootChildOwner,
  listPrivateRootChildOwners,
  type PrivateRootChildOwnerLifecycle,
  recordPrivateRootChildCleanup,
  recordPrivateRootChildFence,
  recordPrivateRootChildSandbox,
  claimPrivateNativeSession,
  savePrivateNativeSession,
} from './activation-admission-store.js'
import {
  collectPrivateCodexSession,
  parsePrivateNativeSessionRequest,
  privateCodexSessionBootstrap,
  privateCodexSessionSecrets,
  PrivateNativeHistoryUnavailable,
  validatePrivateCodexSession,
  type PrivateCodexSessionState,
  type PrivateNativeSessionRequest,
} from './codex-session-state.js'
import {
  type PrivateDirectRunInstalledSupport,
  type PrivateDirectRunRecipe,
  planPrivateDirectRun,
} from './direct-run.js'
import type { PrivateHttpGrants } from './http-grants.js'
import { privateDomainDigest } from './identity.js'
import { revalidatePrivateInstalledBunSupport } from './installed-bun-support.js'
import {
  normalizeParentFlow,
  type PrivateInvocationContext,
  type PrivateParentFlow,
  protectedOwnerRoot,
  requireParentFlowOwner,
  requireParentTarget,
} from './invocation-context.js'
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
import { PRIVATE_AGENT_PROVIDER_PIDS } from './root-operation-limits.js'
import type { PrivateAcpResources } from './private-acp-resources.js'
import {
  PRIVATE_FINITE_ACP_CHANNELS,
  type PrivateFiniteAcpEndpoints,
  runPrivateFiniteAcpResource,
} from './finite-acp-resource.js'

const ALLOCATION_KIND = 'private-root-agent-owner-allocation/1'
const SANDBOX_KIND = 'private-root-agent-sandbox/1'
const CLEANUP_KIND = 'private-root-agent-cleanup/1'
const CANCELLATION_GRACE_MS = 1_000
const DIGEST = /^sha256:[0-9a-f]{64}$/

interface AcpAllocation {
  readonly kind: typeof ALLOCATION_KIND
  readonly parentRunId: string
  readonly coordinatorEpoch: number
  readonly operationId: string
  readonly parentRequestDigest: string
  readonly parentFlow: PrivateParentFlow | null
  /** Digest of the transient provider request; its bytes are never retained. */
  readonly requestDigest: string
  readonly providerDigest: string
  readonly effectiveDeadlineUnixMs: number
  readonly ownerAllocation: PrivateLinuxOwnerStateAllocationIdentity
}

interface AcpSandbox {
  readonly kind: typeof SANDBOX_KIND
  readonly owner: PrivateLinuxSealedOwnerIdentity
}

interface AcpCleanup {
  readonly kind: typeof CLEANUP_KIND
  readonly ownerRelease: PrivateLinuxOwnerStateReleaseReceipt
}

interface AcpRecoveryInput extends PrivateInvocationContext {
  readonly packageStoreRoot: string
  readonly installedSupport: PrivateDirectRunInstalledSupport
  readonly backend: PrivateLinuxCgroupBackend
  readonly httpGrants?: PrivateHttpGrants | undefined
  readonly acpResources?: PrivateAcpResources | undefined
}

/** Execute one exact admitted finite ACP resource in its own contained process. */
type ProviderCallInput = AcpRecoveryInput & {
  readonly call: RunHostCall
  readonly parentDeadlineUnixMs: number
  readonly signal: AbortSignal
  readonly channels?: { readonly caller: ChannelParticipant; readonly broker: ChannelBroker }
}

/** Effect IDs are local to their owning Flow, including the root's separate scope. */
export function privateFiniteAcpChannelOwnerId(
  parentOperationId: string | undefined,
  operationId: string,
): string {
  return `agent:${JSON.stringify([parentOperationId ?? null, operationId])}`
}

/** Execute the exact granted finite transport; ordinary Flow code owns ACP dialogue. */
export async function executePrivateRootFiniteAcp(
  input: ProviderCallInput & { readonly provider: PrivateAcpAgentProvider },
): Promise<RunHostOperationTerminal> {
  const route = requireParentTarget(input).request.slots[input.call.slot]
  if (
    route?.kind !== 'native' ||
    route.native !== 'finite-acp' ||
    route.grant?.kind !== 'acp' ||
    nativeInvocationKind(route.contract) !== 'finite-acp'
  )
    return failed('UNAVAILABLE', 'the requested slot has no admitted finite ACP grant')
  let session: PrivateNativeSessionRequest | undefined
  try {
    session = parsePrivateNativeSessionRequest(input.call.input)
  } catch {
    return failed('INVALID_INPUT', 'finite ACP accepts null or an exact session request')
  }
  if (session !== undefined && route.grant.retainSessions !== true)
    return failed('UNAVAILABLE', 'finite ACP session retention requires a reviewed grant')
  if (input.signal.aborted) return failed('CANCELLED', 'the finite ACP operation was cancelled')
  let provider: PrivateAcpAgentProvider
  let recipe: PrivateDirectRunRecipe
  try {
    provider = requirePrivateAcpAgentProvider(input.provider)
    // The reproduced slot selects the authenticated client for this exact grant.
    recipe = await reproduceParentRecipe(input, provider)
    if (session !== undefined && provider.client !== 'openai-codex')
      return failed('UNAVAILABLE', 'this native client does not support retained sessions')
  } catch {
    return failed('UNAVAILABLE', 'the admitted finite ACP client cannot be reproduced')
  }
  let participant: ChannelParticipant | undefined
  try {
    const terminal = await executeOwnedProvider(input, provider, recipe, {
      maxTurns: route.grant.maxTurns ?? 1,
      ...(session === undefined ? {} : { session }),
      digest: privateDomainDigest('JIG-Private-Finite-ACP-Request/1', {
        providerDigest: provider.digest,
        grant: route.grant as unknown as JsonValue,
        session: (session as unknown as JsonValue) ?? null,
      }),
      admit() {
        if (input.channels === undefined)
          throw new ChannelOperationError('UNAVAILABLE', 'finite ACP requires channel support')
        participant = input.channels.broker.participant(
          privateFiniteAcpChannelOwnerId(input.parentFlow?.operationId, input.call.operationId),
        )
        const grants = input.channels.caller.transfer(
          participant,
          input.call.channels ?? {},
          PRIVATE_FINITE_ACP_CHANNELS,
        )
        return {
          owner: participant,
          requests: grants.requests!.endpoint,
          responses: grants.responses!.endpoint,
        }
      },
    })
    participant?.finalize(terminal.status === 'succeeded')
    return terminal
  } catch (error) {
    participant?.abort('DISCONNECTED')
    if (error instanceof ChannelOperationError) return failed(error.code, error.message)
    throw error
  }
}

async function executeOwnedProvider(
  input: ProviderCallInput,
  provider: PrivateAcpAgentProvider,
  recipe: PrivateDirectRunRecipe,
  operation: {
    readonly digest: string
    readonly maxTurns: number
    readonly session?: PrivateNativeSessionRequest
    admit(): PrivateFiniteAcpEndpoints
  },
): Promise<RunHostOperationTerminal> {
  const effectiveDeadlineUnixMs = Math.min(
    input.parentDeadlineUnixMs,
    input.parent.intent.deadlineUnixMs,
    Date.now() + recipe.wallClockCeilingMs,
  )
  if (Date.now() >= effectiveDeadlineUnixMs) {
    return failed('DEADLINE_EXCEEDED', 'the finite ACP operation deadline elapsed before dispatch')
  }
  if (input.signal.aborted) return failed('CANCELLED', 'the finite ACP operation was cancelled')

  if (input.parentFlow !== undefined) {
    await requireParentFlowOwner(input, input.parentFlow, effectiveDeadlineUnixMs)
  }
  const owners = (
    await listPrivateRootChildOwners({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      parentRunId: input.parent.run.runId,
    })
  ).filter((owner) => owner.parentOperationId === input.parentFlow?.operationId)
  const existing = owners.find(({ operationId }) => operationId === input.call.operationId)
  if (existing !== undefined) {
    if (!isPrivateRootFiniteAcpOwner(existing)) {
      throw new Error('one operation identity names a different durable child owner')
    }
    await recoverPrivateRootFiniteAcpOwner(input, existing)
    return failed('UNCERTAIN', 'a prior finite ACP dispatch was fenced without a proved result')
  }
  if (owners.length !== 0) {
    return failed('RESOURCE_EXHAUSTED', 'the parent Run already has an active child operation')
  }

  // Commit endpoint rights only after exact provider/input/capacity admission.
  const endpoints = operation.admit()

  const ownerParent = await protectedOwnerRoot(input.projectRoot)
  const identity = acpIdentity(
    input.parent.run.runId,
    input.call.operationId,
    input.parentFlow?.operationId,
  )
  const ownerAllocation = await planPrivateLinuxOwnerStateAllocation({
    parent: ownerParent,
    name: `a-${identity.slice(0, 62)}`,
  })
  const allocation: AcpAllocation = Object.freeze({
    kind: ALLOCATION_KIND,
    parentRunId: input.parent.run.runId,
    coordinatorEpoch: input.parent.run.coordinatorEpoch,
    operationId: input.call.operationId,
    parentRequestDigest: requireParentTarget(input).request.digest,
    parentFlow: input.parentFlow ?? null,
    requestDigest: operation.digest,
    providerDigest: provider.digest,
    effectiveDeadlineUnixMs,
    ownerAllocation,
  })
  let lifecycle: PrivateRootChildOwnerLifecycle
  try {
    lifecycle = await allocatePrivateRootChildOwner({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      parentRunId: input.parent.run.runId,
      ...(input.parentFlow === undefined
        ? {}
        : { parentOperationId: input.parentFlow.operationId }),
      operationId: input.call.operationId,
      allocation: allocation as unknown as JsonValue,
    })
  } catch (error) {
    try {
      await cancelUnusedAllocation(ownerAllocation)
    } catch (cleanupError) {
      throw new RunHostFatalOperationError(
        cleanupError instanceof PrivateLinuxFenceUnconfirmedError
          ? 'UNCERTAIN'
          : 'EXECUTION_FAILED',
        { cause: new AggregateError([error, cleanupError], 'operation cleanup failed') },
      )
    }
    if (error instanceof CheckError && error.code === 'RUN_CHILD_CAPACITY') {
      return failed('RESOURCE_EXHAUSTED', 'the parent Run already has an active child operation')
    }
    throw error
  }

  let attemptedDispatch = false
  let execution: ProviderExecution
  let output: FileHandle | undefined
  let retained: PrivateCodexSessionState | undefined
  let lifetime =
    operation.session !== undefined && 'retain' in operation.session
      ? operation.session.lifetime
      : undefined
  let unavailableReason = 'not-cleanly-closed'
  let credentialBootstrap: Uint8Array | undefined
  const runtime = privateAcpAgentRuntime(provider)
  const scopeDigest = nativeSessionScope(input, provider)
  try {
    await revalidateProviderSupport(recipe, provider, input)
    let restored: PrivateCodexSessionState | undefined
    if (operation.session !== undefined && 'restore' in operation.session) {
      const snapshot = await claimPrivateNativeSession({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        parentRunId: input.parent.run.runId,
        scopeDigest,
        reference: operation.session.restore,
      })
      restored = snapshot
      lifetime = snapshot?.lifetime === 'run' ? 'run' : undefined
      if (restored === undefined) throw new NativeSessionUnavailable()
      try {
        validatePrivateCodexSession(restored)
      } catch (error) {
        if (error instanceof PrivateNativeHistoryUnavailable) throw new NativeSessionUnavailable()
        throw error
      }
    }
    if (operation.session !== undefined) credentialBootstrap = runtime.startupInput?.()
    const secrets =
      operation.session === undefined
        ? []
        : privateCodexSessionSecrets(runtime, credentialBootstrap)
    const sealed = await input.backend.seal(
      backendPlan(
        recipe,
        provider,
        effectiveDeadlineUnixMs,
        identity,
        operation.session !== undefined,
      ),
      ownerAllocation,
    )
    const sandbox: AcpSandbox = Object.freeze({ kind: SANDBOX_KIND, owner: sealed.identity })
    lifecycle = await recordPrivateRootChildSandbox({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      parentRunId: input.parent.run.runId,
      ...(input.parentFlow === undefined
        ? {}
        : { parentOperationId: input.parentFlow.operationId }),
      operationId: input.call.operationId,
      allocationDigest: lifecycle.allocation.digest,
      sandbox: sandbox as unknown as JsonValue,
    })
    attemptedDispatch = true
    const component = await sealed.admit(input.signal)
    output = component.outputDirectory
    execution = await runPrivateFiniteAcpResource(
      component,
      runtime,
      endpoints,
      input.signal,
      operation.maxTurns,
      ...(operation.session === undefined
        ? []
        : [
            {
              bootstrap: privateCodexSessionBootstrap(restored),
              ...(restored === undefined ? {} : { restoreSessionId: restored.nativeId }),
              ...(credentialBootstrap === undefined ? {} : { credentialBootstrap }),
            },
          ]),
    )
    if (
      operation.session !== undefined &&
      !execution.closed &&
      execution.fence.stopReason === 'payload_exit' &&
      execution.fence.exitCode === 0 &&
      execution.fence.signal === null &&
      !input.signal.aborted
    ) {
      if (output === undefined || execution.sessionId === undefined)
        throw new Error('Clean native retention lacks owned output or session identity')
      try {
        retained = collectPrivateCodexSession(output, execution.sessionId, secrets)
      } catch (error) {
        if (!(error instanceof PrivateNativeHistoryUnavailable)) throw error
        unavailableReason = error.reason
      }
    }
    await releaseKnownAcp(input, lifecycle, execution.fence)
  } catch (error) {
    try {
      const active = await findLifecycle(input, input.call.operationId)
      if (active !== undefined) await recoverPrivateRootFiniteAcpOwner(input, active)
    } catch (cleanupError) {
      throw new RunHostFatalOperationError(
        cleanupError instanceof PrivateLinuxFenceUnconfirmedError
          ? 'UNCERTAIN'
          : 'EXECUTION_FAILED',
        {
          cause: new AggregateError(
            [error, cleanupError],
            'finite ACP execution and cleanup failed',
          ),
        },
      )
    }
    if (input.signal.aborted) return failed('CANCELLED', 'the finite ACP operation was cancelled')
    if (Date.now() >= effectiveDeadlineUnixMs) {
      return failed('DEADLINE_EXCEEDED', 'the finite ACP operation deadline elapsed')
    }
    if (error instanceof NativeSessionUnavailable)
      return failed('UNAVAILABLE', 'the retained session is unavailable for this admitted caller')
    const explanation =
      error instanceof PrivateFiniteAcpPolicyError
        ? error.reason === 'native-session'
          ? ' The native client reported a session failure; private details were withheld.'
          : ' The finite ACP exchange violated its validated protocol.'
        : ''
    return attemptedDispatch
      ? failed(
          'UNCERTAIN',
          `Finite ACP dispatch may have occurred but no result was proved.${explanation}`,
        )
      : failed('EXECUTION_FAILED', 'finite ACP execution failed before dispatch')
  } finally {
    credentialBootstrap?.fill(0)
    try {
      await output?.close()
    } catch (error) {
      // Descriptor release is owned cleanup. A failure here must not mask a
      // fatal fence failure with an ordinary, catchable operation exception.
      throw new RunHostFatalOperationError('UNCERTAIN', { cause: error })
    }
  }

  if ((execution.fence.stopReason === 'cancelled' && !execution.closed) || input.signal.aborted) {
    return failed('CANCELLED', 'the finite ACP operation was cancelled')
  }
  if (execution.fence.stopReason === 'deadline' || Date.now() >= effectiveDeadlineUnixMs) {
    return failed('DEADLINE_EXCEEDED', 'the finite ACP operation deadline elapsed')
  }
  if (
    execution.fence.stopReason !== 'payload_exit' &&
    !(execution.fence.stopReason === 'cancelled' && execution.closed)
  )
    return failed(
      'UNCERTAIN',
      'the native provider did not prove an ordinary or controlled terminal',
    )

  let sessionReceipt: JsonValue | undefined
  if (operation.session !== undefined) {
    const saved =
      retained === undefined
        ? undefined
        : await savePrivateNativeSession({
            coordinator: input.coordinator,
            projectRoot: input.projectRoot,
            parentRunId: input.parent.run.runId,
            scopeDigest,
            ...retained,
            ...(lifetime === undefined ? {} : { lifetime }),
          })
    input.signal.throwIfAborted()
    sessionReceipt =
      saved === undefined
        ? { status: 'unavailable', reason: retained === undefined ? unavailableReason : 'capacity' }
        : { status: 'retained', reference: saved.reference }
  }
  return {
    status: 'succeeded',
    result: {
      outcome: 'done',
      output: {
        exitCode: execution.fence.exitCode,
        signal: execution.fence.signal,
        cleanup: 'complete',
        stopReason: execution.closed ? 'closed' : 'exited',
        ...(sessionReceipt === undefined ? {} : { session: sessionReceipt }),
      },
    },
  }
}

class NativeSessionUnavailable extends Error {}

function nativeSessionScope(input: ProviderCallInput, provider: PrivateAcpAgentProvider): string {
  const ancestors = []
  for (let parent = input.parentFlow; parent; parent = parent.parent ?? undefined)
    ancestors.unshift({ target: parent.target, requestDigest: parent.requestDigest })
  return privateDomainDigest('JIG-Private-Native-Session-Scope/1', {
    root: { target: input.parent.run.target, requestDigest: input.parent.intent.requestDigest },
    ancestors,
    slot: input.call.slot,
    providerDigest: provider.digest,
  } as unknown as JsonValue)
}

/** Identify finite ACP rows without interpreting Flow-child allocation formats. */
export function isPrivateRootFiniteAcpOwner(lifecycle: PrivateRootChildOwnerLifecycle): boolean {
  const value = lifecycle.allocation.value
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === ALLOCATION_KIND
  )
}

/** Fence and release every active Agent provider owned by one parent Run. */
export async function recoverPrivateRootFiniteAcpOwners(input: AcpRecoveryInput): Promise<void> {
  const owners = await listPrivateRootChildOwners({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  })
  for (const owner of owners) {
    if (
      isPrivateRootFiniteAcpOwner(owner) &&
      (input.parentFlow === undefined || owner.parentOperationId === input.parentFlow.operationId)
    ) {
      await recoverPrivateRootFiniteAcpOwner(input, owner)
    }
  }
}

/** Fence and release one already classified Agent provider owner. */
export async function recoverPrivateRootFiniteAcpOwner(
  input: AcpRecoveryInput,
  lifecycleValue: PrivateRootChildOwnerLifecycle,
): Promise<void> {
  let lifecycle = lifecycleValue
  const allocation = parseAllocation(lifecycle)
  await requireAllocationMatchesParent(input, lifecycle, allocation)
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
        ...(lifecycle.parentOperationId === undefined
          ? {}
          : { parentOperationId: lifecycle.parentOperationId }),
        operationId: lifecycle.operationId,
        allocationDigest: lifecycle.allocation.digest,
        sandboxDigest: lifecycle.sandbox!.digest,
        fence: fence as unknown as JsonValue,
      })
    } else {
      fence = parseFence(lifecycle)
    }
    const ownerRelease = await releasePrivateLinuxOwnerState(sandbox.owner, fence)
    const cleanup = acpCleanup(ownerRelease)
    if (lifecycle.cleanup === undefined) {
      lifecycle = await recordPrivateRootChildCleanup({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        parentRunId: lifecycle.parentRunId,
        ...(lifecycle.parentOperationId === undefined
          ? {}
          : { parentOperationId: lifecycle.parentOperationId }),
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
  await closePrivateRootChildOwner({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: lifecycle.parentRunId,
    ...(lifecycle.parentOperationId === undefined
      ? {}
      : { parentOperationId: lifecycle.parentOperationId }),
    operationId: lifecycle.operationId,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox?.digest ?? null,
    fenceDigest: lifecycle.fence?.digest ?? null,
    cleanupDigest: lifecycle.cleanup?.digest ?? null,
  })
}

async function reproduceParentRecipe(
  input: ProviderCallInput,
  provider: PrivateAcpAgentProvider,
): Promise<PrivateDirectRunRecipe> {
  const target = requireParentTarget(input)
  if (target.disposition.state !== 'ready') {
    throw new Error('parent Run target is unavailable')
  }
  const recipe = await planPrivateDirectRun({
    request: target.request,
    execution: target.disposition.execution,
    installedSupport: input.installedSupport,
    backend: input.backend,
    httpGrants: input.httpGrants,
    acpResources: input.acpResources,
  })
  if (
    recipe.digest !== target.disposition.recipeDigest ||
    recipe.observation.digest !== target.disposition.observationDigest ||
    selectedRecipeProvider(recipe, input)?.digest !== provider.digest
  ) {
    throw new Error('parent Agent recipe differs from its admission')
  }
  return recipe
}

async function revalidateProviderSupport(
  recipe: PrivateDirectRunRecipe,
  provider: PrivateAcpAgentProvider,
  input: ProviderCallInput,
): Promise<void> {
  const [mechanism] = await Promise.all([
    recipe.backend.observeMechanism(),
    revalidatePrivateInstalledBunSupport(recipe.installedSupport),
    revalidatePrivateAcpAgentProvider(provider),
  ])
  if (
    mechanism.support.digest !== recipe.mechanismDigest ||
    selectedRecipeProvider(recipe, input)?.digest !== provider.digest
  ) {
    throw new Error('Agent provider support changed after admission')
  }
}

function selectedRecipeProvider(
  recipe: PrivateDirectRunRecipe,
  input: ProviderCallInput,
): PrivateAcpAgentProvider | undefined {
  return recipe.acp[input.call.slot]
}

function backendPlan(
  recipe: PrivateDirectRunRecipe,
  provider: PrivateAcpAgentProvider,
  deadlineUnixMs: number,
  identity: string,
  retainSession = false,
): PrivateLinuxLaunchPlan {
  const acp = privateAcpAgentRuntime(provider)
  return Object.freeze({
    runId: `agent-${identity.slice(0, 42)}`,
    limits: Object.freeze({
      ...recipe.resourceCeilings,
      pids: PRIVATE_AGENT_PROVIDER_PIDS,
      deadlineUnixMs,
      cancellationGraceMs: CANCELLATION_GRACE_MS,
    }),
    readOnlyMounts: Object.freeze([
      ...recipe.installedSupport.runtimeMounts,
      { source: '/etc/resolv.conf', destination: '/etc/resolv.conf' },
      { source: acp.adapterPath, destination: acp.sandboxAdapterPath },
      { source: acp.executablePath, destination: acp.sandboxExecutablePath },
      ...acp.readOnlyMounts.filter((mount) => {
        const runtime = recipe.installedSupport.runtimeMounts.find(
          (existing) => existing.destination === mount.destination,
        )
        // One exact system loader can support both Bun and the client.
        // Conflicting bytes remain a duplicate and fail plan validation.
        return runtime === undefined || runtime.source !== mount.source
      }),
    ]),
    command: Object.freeze([
      recipe.sandboxExecutablePath,
      ...recipe.bunPolicy,
      acp.sandboxAdapterPath,
    ]) as readonly [string, ...string[]],
    environment: retainSession
      ? { ...acp.environment, JIG_CODEX_SESSION_STATE: '1' }
      : acp.environment,
    ...(retainSession ? { output: true } : {}),
    network: 'inherited',
    ...(acp.nestedUserNamespaces ? { nestedUserNamespaces: true } : {}),
  })
}

type ProviderExecution = Awaited<ReturnType<typeof runPrivateFiniteAcpResource>>

async function releaseKnownAcp(
  input: AcpRecoveryInput,
  lifecycleValue: PrivateRootChildOwnerLifecycle,
  fence: PrivateLinuxConfirmedEnforcementReceipt,
): Promise<void> {
  let lifecycle = lifecycleValue
  const sandbox = parseSandbox(lifecycle)
  lifecycle = await recordPrivateRootChildFence({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: lifecycle.parentRunId,
    ...(lifecycle.parentOperationId === undefined
      ? {}
      : { parentOperationId: lifecycle.parentOperationId }),
    operationId: lifecycle.operationId,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox!.digest,
    fence: fence as unknown as JsonValue,
  })
  const ownerRelease = await releasePrivateLinuxOwnerState(sandbox.owner, fence)
  const cleanup = acpCleanup(ownerRelease)
  lifecycle = await recordPrivateRootChildCleanup({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: lifecycle.parentRunId,
    ...(lifecycle.parentOperationId === undefined
      ? {}
      : { parentOperationId: lifecycle.parentOperationId }),
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
    ...(lifecycle.parentOperationId === undefined
      ? {}
      : { parentOperationId: lifecycle.parentOperationId }),
    operationId: lifecycle.operationId,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox!.digest,
    fenceDigest: lifecycle.fence!.digest,
    cleanupDigest: lifecycle.cleanup!.digest,
  })
}

async function findLifecycle(
  input: AcpRecoveryInput,
  operationId: string,
): Promise<PrivateRootChildOwnerLifecycle | undefined> {
  return (
    await listPrivateRootChildOwners({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      parentRunId: input.parent.run.runId,
    })
  ).find(
    (item) =>
      item.operationId === operationId && item.parentOperationId === input.parentFlow?.operationId,
  )
}

function parseAllocation(lifecycle: PrivateRootChildOwnerLifecycle): AcpAllocation {
  const value = exactObject(
    lifecycle.allocation.value,
    [
      'kind',
      'parentRunId',
      'coordinatorEpoch',
      'operationId',
      'parentRequestDigest',
      'parentFlow',
      'requestDigest',
      'providerDigest',
      'effectiveDeadlineUnixMs',
      'ownerAllocation',
    ],
    'Agent allocation',
  )
  if (
    value.kind !== ALLOCATION_KIND ||
    value.parentRunId !== lifecycle.parentRunId ||
    value.operationId !== lifecycle.operationId ||
    typeof value.coordinatorEpoch !== 'number' ||
    !Number.isSafeInteger(value.coordinatorEpoch) ||
    value.coordinatorEpoch < 1 ||
    !isDigest(value.parentRequestDigest) ||
    !isDigest(value.requestDigest) ||
    !isDigest(value.providerDigest) ||
    typeof value.effectiveDeadlineUnixMs !== 'number' ||
    !Number.isSafeInteger(value.effectiveDeadlineUnixMs) ||
    value.effectiveDeadlineUnixMs < 0
  ) {
    throw new TypeError('Agent allocation is invalid')
  }
  return Object.freeze({
    kind: ALLOCATION_KIND,
    parentRunId: value.parentRunId as string,
    coordinatorEpoch: value.coordinatorEpoch,
    operationId: value.operationId as string,
    parentRequestDigest: value.parentRequestDigest,
    parentFlow: normalizeParentFlow(value.parentFlow, lifecycle.parentOperationId),
    requestDigest: value.requestDigest,
    providerDigest: value.providerDigest,
    effectiveDeadlineUnixMs: value.effectiveDeadlineUnixMs,
    ownerAllocation: normalizePrivateLinuxOwnerStateAllocationIdentity(value.ownerAllocation),
  })
}

function parseSandbox(lifecycle: PrivateRootChildOwnerLifecycle): AcpSandbox {
  if (lifecycle.sandbox === undefined) throw new TypeError('Agent sandbox owner is absent')
  const value = exactObject(lifecycle.sandbox.value, ['kind', 'owner'], 'Agent sandbox')
  if (value.kind !== SANDBOX_KIND) throw new TypeError('Agent sandbox kind is invalid')
  return Object.freeze({
    kind: SANDBOX_KIND,
    owner: normalizePrivateLinuxSealedOwnerIdentity(value.owner),
  })
}

function parseFence(
  lifecycle: PrivateRootChildOwnerLifecycle,
): PrivateLinuxConfirmedEnforcementReceipt {
  if (lifecycle.fence === undefined) throw new TypeError('Agent fence is absent')
  return normalizePrivateLinuxConfirmedEnforcementReceipt(lifecycle.fence.value)
}

function acpCleanup(ownerRelease: PrivateLinuxOwnerStateReleaseReceipt): AcpCleanup {
  return Object.freeze({ kind: CLEANUP_KIND, ownerRelease })
}

function parseCleanup(lifecycle: PrivateRootChildOwnerLifecycle): AcpCleanup {
  if (lifecycle.cleanup === undefined) throw new TypeError('Agent cleanup is absent')
  const value = exactObject(lifecycle.cleanup.value, ['kind', 'ownerRelease'], 'Agent cleanup')
  if (value.kind !== CLEANUP_KIND) throw new TypeError('Agent cleanup kind is invalid')
  return acpCleanup(normalizePrivateLinuxOwnerStateReleaseReceipt(value.ownerRelease))
}

function requireCleanupMatches(
  lifecycle: PrivateRootChildOwnerLifecycle,
  expected: AcpCleanup,
): void {
  const actual = parseCleanup(lifecycle)
  if (actual.ownerRelease.digest !== expected.ownerRelease.digest) {
    throw new Error('durable Agent cleanup differs from the released owner')
  }
}

async function requireAllocationMatchesParent(
  input: AcpRecoveryInput,
  lifecycle: PrivateRootChildOwnerLifecycle,
  allocation: AcpAllocation,
): Promise<void> {
  const { parentFlow: requestedParentFlow, ...rootInput } = input
  const parentFlow = allocation.parentFlow
  if (
    requestedParentFlow !== undefined &&
    (parentFlow === null ||
      requestedParentFlow.operationId !== parentFlow.operationId ||
      requestedParentFlow.requestDigest !== parentFlow.requestDigest)
  ) {
    throw new Error('durable Agent allocation differs from the requested parent Flow')
  }
  const target = requireParentTarget({
    ...rootInput,
    ...(parentFlow === null ? {} : { parentFlow }),
  })
  if (
    allocation.parentRunId !== input.parent.run.runId ||
    allocation.coordinatorEpoch !== input.parent.run.coordinatorEpoch ||
    allocation.operationId !== lifecycle.operationId ||
    allocation.parentRequestDigest !== target.request.digest ||
    allocation.effectiveDeadlineUnixMs > input.parent.intent.deadlineUnixMs ||
    !Object.values(target.request.slots).some(
      (route) =>
        route.kind === 'native' &&
        route.native === 'finite-acp' &&
        route.grant?.kind === 'acp' &&
        nativeInvocationKind(route.contract) === route.native,
    )
  ) {
    throw new Error('durable Agent allocation differs from its admitted parent or provider')
  }
  if (parentFlow !== null) {
    await requireParentFlowOwner(input, parentFlow, allocation.effectiveDeadlineUnixMs)
  }
  const ownerParent = await protectedOwnerRoot(input.projectRoot)
  const identity = acpIdentity(
    lifecycle.parentRunId,
    lifecycle.operationId,
    lifecycle.parentOperationId,
  )
  if (
    allocation.ownerAllocation.parent !== ownerParent ||
    allocation.ownerAllocation.name !== `a-${identity.slice(0, 62)}`
  ) {
    throw new Error('durable Agent allocation differs from its admitted owner resource')
  }
}

async function cancelUnusedAllocation(
  allocation: PrivateLinuxOwnerStateAllocationIdentity,
): Promise<void> {
  const cancelled = await cancelPrivateLinuxOwnerStateAllocation(allocation)
  await releasePrivateLinuxOwnerState(allocation, cancelled)
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

function acpIdentity(parentRunId: string, operationId: string, parentOperationId?: string): string {
  return privateDomainDigest('JIG-Private-Root-Agent-Identity/1', {
    parentRunId,
    parentOperationId: parentOperationId ?? null,
    operationId,
  }).slice('sha256:'.length)
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value)
}

function failed(
  code: WireFailureCode,
  message: string,
  details?: JsonValue,
): RunHostOperationTerminal {
  return Object.freeze({
    status: 'failed' as const,
    code,
    message,
    ...(details === undefined ? {} : { details }),
  })
}
