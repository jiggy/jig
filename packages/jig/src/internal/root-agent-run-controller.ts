import { join } from 'node:path'
import {
  AgentMethodError,
  finishAgent,
  type PreparedAgent,
  prepareAgent,
} from '@jigging/agent-method'
import { CheckError } from '../diagnostics.js'
import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from '../json.js'
import { inspectCapturedPackage } from '../package/inspect.js'
import { isAgentInvocation, nativeInvocationKind } from '../project/invocation-slots.js'
import {
  type ChannelBroker,
  ChannelOperationError,
  type ChannelParticipant,
} from '../run/channels.js'
import type { RunHostCall, RunHostOperationTerminal, WireFailureCode } from '../run/session.js'
import { RunHostFatalOperationError } from '../run/session.js'
import { SchemaDiagnostic } from '../schema/index.js'
import {
  PrivateAcpProtocolError,
  privateAcpComponentStream,
  runPrivateAcpTurn,
} from './acp-agent-client.js'
import { privateAcpAgentRuntime, revalidatePrivateAcpAgentProvider } from './acp-agent-provider.js'
import {
  allocatePrivateRootChildOwner,
  closePrivateRootChildOwner,
  listPrivateRootChildOwners,
  type PrivateRootChildOwnerLifecycle,
  recordPrivateRootChildCleanup,
  recordPrivateRootChildFence,
  recordPrivateRootChildSandbox,
} from './activation-admission-store.js'
import { type PrivateAgentProvider, requirePrivateAgentProvider } from './agent-provider.js'
import { PRIVATE_AGENT_UPDATE_CHANNELS, PrivateAgentUpdateChannel } from './agent-update-channel.js'
import {
  type PrivateDirectRunInstalledSupport,
  type PrivateDirectRunRecipe,
  planPrivateDirectRun,
} from './direct-run.js'
import type { PrivateHttpGrants } from './http-grants.js'
import { privateDomainDigest } from './identity.js'
import {
  normalizeParentFlow,
  protectedOwnerRoot,
  requireParentFlowOwner,
  requireParentTarget,
  type PrivateInvocationContext,
  type PrivateParentFlow,
} from './invocation-context.js'
import { revalidatePrivateInstalledBunSupport } from './installed-bun-support.js'
import {
  cancelPrivateLinuxOwnerStateAllocation,
  normalizePrivateLinuxConfirmedEnforcementReceipt,
  normalizePrivateLinuxOwnerStateAllocationIdentity,
  normalizePrivateLinuxOwnerStateReleaseReceipt,
  normalizePrivateLinuxSealedOwnerIdentity,
  type PrivateLinuxCgroupBackend,
  type PrivateLinuxComponentProcess,
  type PrivateLinuxConfirmedEnforcementReceipt,
  PrivateLinuxFenceUnconfirmedError,
  type PrivateLinuxLaunchPlan,
  type PrivateLinuxOwnerStateAllocationIdentity,
  type PrivateLinuxOwnerStateReleaseReceipt,
  type PrivateLinuxSealedOwnerIdentity,
  planPrivateLinuxOwnerStateAllocation,
  releasePrivateLinuxOwnerState,
} from './linux-rootless-backend.js'
import { MARKDOWN_AGENT_SLOT, markdownAgentContract } from './markdown-agent-contract.js'
import {
  decodePrivateOpenAIAgentResponse,
  encodePrivateOpenAIAgentRequest,
  PRIVATE_OPENAI_AGENT_PROTOCOL,
  PRIVATE_OPENAI_AGENT_RESPONSE_BYTES,
  type PrivateOpenAIAgentErrorCode,
  type PrivateOpenAIAgentWorkerResponse,
} from './openai-agent-protocol.js'
import {
  type PrivateOpenAIAgentProvider,
  privateOpenAIAgentCredential,
} from './openai-agent-provider.js'
import { captureStoredPackage } from './package-artifact-store.js'
import {
  AgentExchangeValidationError,
  assertAgentExchangeContract,
  assertAgentProviderPrompt,
  parseAgentExchangeInput,
  projectAgentExchangeResult,
} from './private-agent-exchange.js'
import {
  AGENT_RUN_CONTRACT_DIGEST,
  AgentRunValidationError,
  assertAgentRunContract,
  type PreparedAgentRunInput,
  parseAgentRunInput,
  parseAgentRunResult,
  projectAgentRunSkills,
} from './private-agent-run.js'
import { PRIVATE_AGENT_PROVIDER_PIDS } from './root-operation-limits.js'

const ALLOCATION_KIND = 'private-root-agent-owner-allocation/1'
const SANDBOX_KIND = 'private-root-agent-sandbox/1'
const CLEANUP_KIND = 'private-root-agent-cleanup/1'
const CANCELLATION_GRACE_MS = 1_000
const PROVIDER_STDERR_BYTES = 64 * 1024
const DIGEST = /^sha256:[0-9a-f]{64}$/
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

interface AgentAllocation {
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

interface AgentSandbox {
  readonly kind: typeof SANDBOX_KIND
  readonly owner: PrivateLinuxSealedOwnerIdentity
}

interface AgentCleanup {
  readonly kind: typeof CLEANUP_KIND
  readonly ownerRelease: PrivateLinuxOwnerStateReleaseReceipt
}

interface AgentRecoveryInput extends PrivateInvocationContext {
  readonly packageStoreRoot: string
  readonly installedSupport: PrivateDirectRunInstalledSupport
  readonly backend: PrivateLinuxCgroupBackend
  readonly httpGrants?: PrivateHttpGrants | undefined
  readonly agentProvider?: PrivateAgentProvider | undefined
}

interface AgentInput extends AgentRecoveryInput {
  readonly agentProvider: PrivateAgentProvider
}

interface PreparedCall {
  readonly method?: {
    readonly input: PreparedAgentRunInput
    readonly contract: Parameters<typeof parseAgentRunResult>[0]
    readonly prepared: PreparedAgent
  }
  readonly instructions: string
  readonly responseSchema?: JsonObject
  readonly digest: string
}

/** Execute one exact admitted Agent Run effect in its own contained process. */
type AgentCallInput = AgentInput & {
  readonly call: RunHostCall
  readonly parentDeadlineUnixMs: number
  readonly signal: AbortSignal
  readonly channels?: { readonly caller: ChannelParticipant; readonly broker: ChannelBroker }
}

/** Effect IDs are local to their owning Flow, including the root's separate scope. */
export function privateAgentChannelOwnerId(
  parentOperationId: string | undefined,
  operationId: string,
): string {
  return `agent:${JSON.stringify([parentOperationId ?? null, operationId])}`
}

export async function executePrivateRootAgentRun(
  input: AgentCallInput,
): Promise<RunHostOperationTerminal> {
  let participant: ChannelParticipant | undefined
  let updates: PrivateAgentUpdateChannel | undefined
  try {
    const terminal = await executeAgentRun(input, () => {
      if (Object.keys(input.call.channels ?? {}).length === 0) return undefined
      if (input.channels === undefined)
        throw new ChannelOperationError('UNAVAILABLE', 'this invocation has no channel support')
      if (input.agentProvider.kind !== 'private-acp-agent-provider/1')
        throw new ChannelOperationError(
          'UNAVAILABLE',
          'Agent channel "events" requires the ACP public-updates profile, which the selected API client does not implement. Use an operator-configured native ACP client for this Flow, or a Flow that needs only the final Agent result.',
        )
      participant = input.channels.broker.participant(
        privateAgentChannelOwnerId(input.parentFlow?.operationId, input.call.operationId),
      )
      const grants = input.channels.caller.transfer(
        participant,
        input.call.channels!,
        PRIVATE_AGENT_UPDATE_CHANNELS,
      )
      if (grants.events !== undefined)
        updates = new PrivateAgentUpdateChannel(participant, grants.events.endpoint, input.signal)
      return updates
    })
    participant?.finalize(terminal.status === 'succeeded')
    return terminal
  } catch (error) {
    participant?.abort('DISCONNECTED')
    if (error instanceof ChannelOperationError) return failed(error.code, error.message)
    throw error
  } finally {
    updates?.abort()
    await updates?.finish()
  }
}

async function executeAgentRun(
  input: AgentCallInput,
  admitChannels: () => PrivateAgentUpdateChannel | undefined,
): Promise<RunHostOperationTerminal> {
  const selected = selectAgentInvocation(input, input.call)
  if (selected === undefined) {
    return failed('UNAVAILABLE', 'the requested slot has no admitted Agent Run invocation')
  }
  if (input.signal.aborted) return failed('CANCELLED', 'the Agent Run was cancelled')

  let provider: PrivateAgentProvider
  let recipe: PrivateDirectRunRecipe
  try {
    provider = requirePrivateAgentProvider(input.agentProvider)
    if (
      provider.contractDigest !== AGENT_RUN_CONTRACT_DIGEST ||
      (provider.kind === 'private-openai-agent-provider/1' &&
        provider.workerDigest !== input.installedSupport.agentWorkerDigest)
    ) {
      throw new Error('Agent provider identity differs from admitted host support')
    }
    recipe = await reproduceParentRecipe(input)
  } catch {
    return failed('UNAVAILABLE', 'the admitted Agent provider cannot be reproduced')
  }

  let prepared: PreparedCall
  try {
    prepared = await prepareCall(input, provider)
  } catch (error) {
    if (error instanceof AgentExchangeValidationError) return failed(error.code, error.message)
    if (
      (error instanceof AgentMethodError && error.code === 'RESOURCE_EXHAUSTED') ||
      (error instanceof SchemaDiagnostic && error.code === 'SCHEMA_LIMIT_EXCEEDED') ||
      (error instanceof AgentRunValidationError &&
        error.code === 'AGENT_RUN_SKILL_PROJECTION_LIMIT')
    ) {
      return failed('RESOURCE_EXHAUSTED', 'the Agent Run input exceeds its fixed provider bound')
    }
    if (
      error instanceof AgentRunValidationError ||
      error instanceof AgentMethodError ||
      error instanceof CheckError ||
      error instanceof SchemaDiagnostic ||
      error instanceof TypeError
    ) {
      return failed('INVALID_INPUT', 'the Agent Run input or skill selection is invalid')
    }
    throw error
  }

  const effectiveDeadlineUnixMs = Math.min(
    input.parentDeadlineUnixMs,
    input.parent.intent.deadlineUnixMs,
    Date.now() + recipe.wallClockCeilingMs,
  )
  if (Date.now() >= effectiveDeadlineUnixMs) {
    return failed('DEADLINE_EXCEEDED', 'the Agent Run deadline elapsed before dispatch')
  }
  if (input.signal.aborted) return failed('CANCELLED', 'the Agent Run was cancelled')

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
    if (!isPrivateRootAgentRunOwner(existing)) {
      throw new Error('one operation identity names a different durable child owner')
    }
    await recoverPrivateRootAgentRunOwner(input, existing)
    return failed('UNCERTAIN', 'a prior Agent dispatch was fenced without a proved result')
  }
  if (owners.length !== 0) {
    return failed('RESOURCE_EXHAUSTED', 'the parent Run already has an active child operation')
  }

  // Commit endpoint rights only after exact provider/input/capacity admission.
  const updates = admitChannels()

  const ownerParent = await protectedOwnerRoot(input.projectRoot)
  const identity = agentIdentity(
    input.parent.run.runId,
    input.call.operationId,
    input.parentFlow?.operationId,
  )
  const ownerAllocation = await planPrivateLinuxOwnerStateAllocation({
    parent: ownerParent,
    name: `a-${identity.slice(0, 62)}`,
  })
  const allocation: AgentAllocation = Object.freeze({
    kind: ALLOCATION_KIND,
    parentRunId: input.parent.run.runId,
    coordinatorEpoch: input.parent.run.coordinatorEpoch,
    operationId: input.call.operationId,
    parentRequestDigest: requireParentTarget(input).request.digest,
    parentFlow: input.parentFlow ?? null,
    requestDigest: prepared.digest,
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
  try {
    await revalidateProviderSupport(recipe, provider)
    const sealed = await input.backend.seal(
      backendPlan(recipe, provider, effectiveDeadlineUnixMs, identity),
      ownerAllocation,
    )
    const sandbox: AgentSandbox = Object.freeze({ kind: SANDBOX_KIND, owner: sealed.identity })
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
    execution = await interactWithProvider(component, provider, prepared, input.signal, updates)
    await releaseKnownAgent(input, lifecycle, execution.fence)
  } catch (error) {
    try {
      const active = await findLifecycle(input, input.call.operationId)
      if (active !== undefined) await recoverPrivateRootAgentRunOwner(input, active)
    } catch (cleanupError) {
      throw new RunHostFatalOperationError(
        cleanupError instanceof PrivateLinuxFenceUnconfirmedError
          ? 'UNCERTAIN'
          : 'EXECUTION_FAILED',
        {
          cause: new AggregateError(
            [error, cleanupError],
            'Agent Run execution and cleanup failed',
          ),
        },
      )
    }
    if (input.signal.aborted) return failed('CANCELLED', 'the Agent Run was cancelled')
    if (Date.now() >= effectiveDeadlineUnixMs) {
      return failed('DEADLINE_EXCEEDED', 'the Agent Run deadline elapsed')
    }
    return attemptedDispatch
      ? failed('UNCERTAIN', 'Agent dispatch may have occurred but no result was proved')
      : failed('EXECUTION_FAILED', 'Agent Run execution failed before dispatch')
  }

  if (execution.fence.stopReason === 'cancelled' || input.signal.aborted) {
    return failed('CANCELLED', 'the Agent Run was cancelled')
  }
  if (execution.fence.stopReason === 'deadline' || Date.now() >= effectiveDeadlineUnixMs) {
    return failed('DEADLINE_EXCEEDED', 'the Agent Run deadline elapsed')
  }
  if (execution.fence.exitCode !== 0 || execution.fence.signal !== null) {
    return failed('EXECUTION_FAILED', 'the Agent provider process failed')
  }

  if (execution.cancelled) {
    return failed('CANCELLED', 'the Agent Run was cancelled')
  }
  if (execution.failure !== undefined) return providerFailure(execution.failure)
  try {
    const exchange = projectAgentExchangeResult(execution.value)
    const result =
      prepared.method === undefined
        ? exchange
        : parseAgentRunResult(
            prepared.method.contract,
            prepared.method.input,
            finishAgent(prepared.method.prepared, exchange),
          )
    return Object.freeze({
      status: 'succeeded' as const,
      result,
    })
  } catch {
    return failed('INVALID_RESULT', 'the Agent result does not satisfy its admitted invocation')
  }
}

/** Identify Agent rows without interpreting Flow-child allocation formats. */
export function isPrivateRootAgentRunOwner(lifecycle: PrivateRootChildOwnerLifecycle): boolean {
  const value = lifecycle.allocation.value
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === ALLOCATION_KIND
  )
}

/** Fence and release every active Agent provider owned by one parent Run. */
export async function recoverPrivateRootAgentRunOwners(input: AgentRecoveryInput): Promise<void> {
  const owners = await listPrivateRootChildOwners({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  })
  for (const owner of owners) {
    if (
      isPrivateRootAgentRunOwner(owner) &&
      (input.parentFlow === undefined || owner.parentOperationId === input.parentFlow.operationId)
    ) {
      await recoverPrivateRootAgentRunOwner(input, owner)
    }
  }
}

/** Fence and release one already classified Agent provider owner. */
export async function recoverPrivateRootAgentRunOwner(
  input: AgentRecoveryInput,
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
    const cleanup = agentCleanup(ownerRelease)
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

async function prepareCall(
  input: AgentInput & { readonly call: RunHostCall },
  provider: PrivateAgentProvider,
): Promise<PreparedCall> {
  const target = requireParentTarget(input)
  const captured = await captureStoredPackage(input.packageStoreRoot, target.request.package)
  try {
    const inspected = await inspectCapturedPackage(captured)
    const reference =
      inspected.markdown !== undefined && input.call.slot === MARKDOWN_AGENT_SLOT
        ? { contract: markdownAgentContract() }
        : inspected.usedContracts.find(({ slot }) => slot === input.call.slot)
    if (reference === undefined) {
      throw new AgentRunValidationError(
        'AGENT_RUN_CONTRACT_MISMATCH',
        'Agent Run invocation descriptor is absent from the admitted package',
      )
    }
    let method: PreparedCall['method']
    let request: PreparedAgent['request']
    const route = target.request.slots[input.call.slot]
    if (route?.kind === 'native' && route.native === 'agent-exchange') {
      assertAgentExchangeContract(reference.contract)
      request = parseAgentExchangeInput(input.call.input)
    } else {
      assertAgentRunContract(reference.contract)
      const inputValue = parseAgentRunInput(reference.contract, input.call.input)
      const manifest = await projectAgentRunSkills(captured, inputValue.selectedSkills)
      const selectedSkills = manifest.skills.map((skill) => ({
        name: skill.name,
        files: skill.files.map((file) => ({ path: file.path, text: decoder.decode(file.bytes()) })),
      }))
      const prepared = prepareAgent(
        {
          instructions: inputValue.input.instructions,
          ...(inputValue.input.responseSchema === undefined
            ? {}
            : {
                responseSchema: inputValue.input.responseSchema,
              }),
        },
        selectedSkills,
      )
      method = Object.freeze({ input: inputValue, contract: reference.contract, prepared })
      // The trusted bridge and a hostile direct caller face the same lower boundary.
      request = parseAgentExchangeInput(prepared.request)
    }
    const instructions = request.prompt
    const responseSchema = request.responseSchema
    assertAgentProviderPrompt(
      provider.kind === 'private-acp-agent-provider/1' ? provider.client : undefined,
      instructions,
    )
    const requestIdentity = Object.freeze({
      providerDigest: provider.digest,
      instructions,
      ...(responseSchema === undefined ? {} : { responseSchema }),
    })
    return Object.freeze({
      ...(method === undefined ? {} : { method }),
      instructions,
      ...(responseSchema === undefined ? {} : { responseSchema }),
      digest: privateDomainDigest(
        'JIG-Private-Agent-Request/1',
        requestIdentity as unknown as JsonValue,
      ),
    })
  } finally {
    await captured.dispose()
  }
}

function selectAgentInvocation(input: AgentRecoveryInput, call: RunHostCall) {
  const target = requireParentTarget(input)
  const route = target.request.slots[call.slot]
  if (route?.kind !== 'native' || !isAgentInvocation(route.native)) return undefined
  const selected = route.contract
  if (nativeInvocationKind(selected) !== route.native) {
    throw new Error('admitted Agent Run invocation identity is invalid')
  }
  return selected
}

async function reproduceParentRecipe(input: AgentInput): Promise<PrivateDirectRunRecipe> {
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
    agentProvider: input.agentProvider,
  })
  if (
    recipe.digest !== target.disposition.recipeDigest ||
    recipe.observation.digest !== target.disposition.observationDigest ||
    recipe.agentProvider?.digest !== input.agentProvider.digest
  ) {
    throw new Error('parent Agent recipe differs from its admission')
  }
  return recipe
}

async function revalidateProviderSupport(
  recipe: PrivateDirectRunRecipe,
  provider: PrivateAgentProvider,
): Promise<void> {
  const [mechanism] = await Promise.all([
    recipe.backend.observeMechanism(),
    revalidatePrivateInstalledBunSupport(recipe.installedSupport),
    provider.kind === 'private-acp-agent-provider/1'
      ? revalidatePrivateAcpAgentProvider(provider)
      : Promise.resolve(),
  ])
  if (
    mechanism.support.digest !== recipe.mechanismDigest ||
    (provider.kind === 'private-openai-agent-provider/1' &&
      recipe.installedSupport.agentWorkerDigest !== provider.workerDigest) ||
    recipe.agentProvider?.digest !== provider.digest
  ) {
    throw new Error('Agent provider support changed after admission')
  }
}

function backendPlan(
  recipe: PrivateDirectRunRecipe,
  provider: PrivateAgentProvider,
  deadlineUnixMs: number,
  identity: string,
): PrivateLinuxLaunchPlan {
  const acp =
    provider.kind === 'private-acp-agent-provider/1' ? privateAcpAgentRuntime(provider) : undefined
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
      ...(acp === undefined
        ? [
            {
              source: recipe.installedSupport.agentWorkerPath,
              destination: recipe.installedSupport.sandboxAgentWorkerPath,
            },
          ]
        : [
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
    ]),
    command: Object.freeze(
      acp === undefined
        ? [
            recipe.sandboxExecutablePath,
            ...recipe.bunPolicy,
            recipe.installedSupport.sandboxAgentWorkerPath,
          ]
        : [recipe.sandboxExecutablePath, ...recipe.bunPolicy, acp.sandboxAdapterPath],
    ) as readonly [string, ...string[]],
    ...(acp === undefined ? {} : { environment: acp.environment }),
    network: 'inherited',
    ...(acp?.nestedUserNamespaces === true ? { nestedUserNamespaces: true } : {}),
  })
}

interface ProviderExecution {
  readonly fence: PrivateLinuxConfirmedEnforcementReceipt
  readonly value?: unknown
  readonly failure?: PrivateOpenAIAgentErrorCode
  readonly cancelled: boolean
}

async function interactWithProvider(
  component: PrivateLinuxComponentProcess,
  provider: PrivateAgentProvider,
  prepared: PreparedCall,
  signal: AbortSignal,
  updates?: PrivateAgentUpdateChannel,
): Promise<ProviderExecution> {
  if (provider.kind === 'private-acp-agent-provider/1') {
    return await interactWithAcpProvider(component, provider, prepared, signal, updates)
  }
  return await interactWithOpenAIProvider(component, provider, prepared)
}

async function interactWithOpenAIProvider(
  component: PrivateLinuxComponentProcess,
  provider: PrivateOpenAIAgentProvider,
  prepared: PreparedCall,
): Promise<ProviderExecution> {
  const output = collectBounded(component.stdout, PRIVATE_OPENAI_AGENT_RESPONSE_BYTES)
  const stderr = discardBounded(component.stderr, PROVIDER_STDERR_BYTES)
  try {
    await component.write(
      encodePrivateOpenAIAgentRequest({
        protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
        apiKey: privateOpenAIAgentCredential(provider),
        api: provider.api,
        baseURL: provider.baseURL,
        model: provider.model,
        instructions: prepared.instructions,
        ...(prepared.responseSchema === undefined
          ? {}
          : {
              responseSchema: prepared.responseSchema,
            }),
      }),
    )
    await component.closeInput()
    const [bytes, fence] = await Promise.all([output, component.enforcement, stderr]).then(
      ([bytes, fence]) => [bytes, fence] as const,
    )
    let response: PrivateOpenAIAgentWorkerResponse
    try {
      response = decodePrivateOpenAIAgentResponse(bytes)
    } catch {
      return Object.freeze({
        fence,
        failure: 'AGENT_PROVIDER_RESPONSE_INVALID' as const,
        cancelled: false,
      })
    }
    return response.status === 'error'
      ? Object.freeze({ fence, failure: response.code, cancelled: false })
      : Object.freeze({ fence, value: response.value, cancelled: false })
  } catch (error) {
    await component.terminate().catch(() => undefined)
    await Promise.allSettled([output, stderr, component.enforcement])
    throw error
  }
}

async function interactWithAcpProvider(
  component: PrivateLinuxComponentProcess,
  provider: Extract<PrivateAgentProvider, { readonly kind: 'private-acp-agent-provider/1' }>,
  prepared: PreparedCall,
  signal: AbortSignal,
  updates?: PrivateAgentUpdateChannel,
): Promise<ProviderExecution> {
  const runtime = privateAcpAgentRuntime(provider)
  const stderr = discardBounded(component.stderr, PROVIDER_STDERR_BYTES)
  try {
    if (runtime.startupInput !== undefined) {
      await component.write(runtime.startupInput())
    }
    const turn = await runPrivateAcpTurn(privateAcpComponentStream(component), {
      cwd: '/work',
      instructions: prepared.instructions,
      signal,
      ...(updates === undefined
        ? {}
        : { onPublicUpdate: (value: JsonValue) => updates.offer(value) }),
      configuration: runtime.configuration,
      ...(runtime.modeId === undefined ? {} : { modeId: runtime.modeId }),
      ...(runtime.sessionMeta === undefined ? {} : { sessionMeta: runtime.sessionMeta }),
      ...(runtime.authentication === undefined
        ? {}
        : {
            authentication: {
              request: runtime.authentication.request,
              ...(runtime.authentication.clientAuthCapabilities === undefined
                ? {}
                : {
                    clientAuthCapabilities: runtime.authentication.clientAuthCapabilities,
                  }),
            },
          }),
    })
    await component.closeInput()
    await updates?.finish()
    const [fence] = await Promise.all([component.enforcement, stderr])
    if (turn.stopReason === 'cancelled') {
      return Object.freeze({ fence, cancelled: true })
    }
    try {
      return Object.freeze({
        fence,
        value: {
          text: turn.text,
          stop:
            turn.stopReason === 'end_turn'
              ? 'end-turn'
              : turn.stopReason === 'refusal'
                ? 'refusal'
                : 'limit',
        },
        cancelled: false,
      })
    } catch {
      return Object.freeze({
        fence,
        failure: 'AGENT_PROVIDER_RESPONSE_INVALID' as const,
        cancelled: false,
      })
    }
  } catch (error) {
    await component.terminate().catch(() => undefined)
    await Promise.allSettled([stderr, component.enforcement])
    if (error instanceof PrivateAcpProtocolError) {
      throw error
    }
    throw error
  }
}

async function releaseKnownAgent(
  input: AgentRecoveryInput,
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
  const cleanup = agentCleanup(ownerRelease)
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
  input: AgentInput,
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

function parseAllocation(lifecycle: PrivateRootChildOwnerLifecycle): AgentAllocation {
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

function parseSandbox(lifecycle: PrivateRootChildOwnerLifecycle): AgentSandbox {
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

function agentCleanup(ownerRelease: PrivateLinuxOwnerStateReleaseReceipt): AgentCleanup {
  return Object.freeze({ kind: CLEANUP_KIND, ownerRelease })
}

function parseCleanup(lifecycle: PrivateRootChildOwnerLifecycle): AgentCleanup {
  if (lifecycle.cleanup === undefined) throw new TypeError('Agent cleanup is absent')
  const value = exactObject(lifecycle.cleanup.value, ['kind', 'ownerRelease'], 'Agent cleanup')
  if (value.kind !== CLEANUP_KIND) throw new TypeError('Agent cleanup kind is invalid')
  return agentCleanup(normalizePrivateLinuxOwnerStateReleaseReceipt(value.ownerRelease))
}

function requireCleanupMatches(
  lifecycle: PrivateRootChildOwnerLifecycle,
  expected: AgentCleanup,
): void {
  const actual = parseCleanup(lifecycle)
  if (actual.ownerRelease.digest !== expected.ownerRelease.digest) {
    throw new Error('durable Agent cleanup differs from the released owner')
  }
}

async function requireAllocationMatchesParent(
  input: AgentRecoveryInput,
  lifecycle: PrivateRootChildOwnerLifecycle,
  allocation: AgentAllocation,
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
        isAgentInvocation(route.native) &&
        nativeInvocationKind(route.contract) === route.native,
    )
  ) {
    throw new Error('durable Agent allocation differs from its admitted parent or provider')
  }
  if (parentFlow !== null) {
    await requireParentFlowOwner(input, parentFlow, allocation.effectiveDeadlineUnixMs)
  }
  const ownerParent = await protectedOwnerRoot(input.projectRoot)
  const identity = agentIdentity(
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

function providerFailure(code: PrivateOpenAIAgentErrorCode): RunHostOperationTerminal {
  if (code === 'AGENT_PROVIDER_OUTPUT_LIMIT') {
    return failed('RESOURCE_EXHAUSTED', 'the Agent provider result exceeded its fixed bound')
  }
  if (code === 'AGENT_PROVIDER_RESPONSE_INVALID') {
    return failed('INVALID_RESULT', 'the Agent provider returned an invalid result')
  }
  return failed('EXECUTION_FAILED', 'the Agent provider request failed')
}

async function collectBounded(
  source: AsyncIterable<Uint8Array>,
  maximum: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of source) {
    total += chunk.byteLength
    if (total > maximum) throw new Error('Agent provider output exceeds its byte bound')
    chunks.push(Uint8Array.from(chunk))
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function discardBounded(source: AsyncIterable<Uint8Array>, maximum: number): Promise<void> {
  let total = 0
  for await (const chunk of source) {
    total += chunk.byteLength
    if (total > maximum) throw new Error('Agent provider diagnostics exceed their byte bound')
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

function agentIdentity(
  parentRunId: string,
  operationId: string,
  parentOperationId?: string,
): string {
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
