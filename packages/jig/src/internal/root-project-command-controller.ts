import { closeSync } from 'node:fs'
import { CheckError } from '../diagnostics.js'
import { canonicalJson, type JsonObject, type JsonValue } from '../json.js'
import type {
  RunHostEffectCall,
  RunHostEffectOperationTerminal,
  WireFailureCode,
} from '../run/session.js'
import {
  allocatePrivateRootChildOwner,
  closePrivateRootChildOwner,
  listPrivateRootChildOwners,
  type PrivateRootChildOwnerLifecycle,
  recordPrivateRootChildCleanup,
  recordPrivateRootChildFence,
  recordPrivateRootChildSandbox,
} from './activation-admission-store.js'
import { type PrivateDirectRunRecipe, planPrivateDirectRun } from './direct-run.js'
import { privateDomainDigest } from './identity.js'
import { revalidatePrivateInstalledBunSupport } from './installed-bun-support.js'
import { privateSealedBytes, sha256 } from './linux-file-input.js'
import {
  cancelPrivateLinuxOwnerStateAllocation,
  normalizePrivateLinuxConfirmedEnforcementReceipt,
  normalizePrivateLinuxOwnerStateAllocationIdentity,
  normalizePrivateLinuxOwnerStateReleaseReceipt,
  normalizePrivateLinuxPreparedOwnerIdentity,
  normalizePrivateLinuxSealedOwnerIdentity,
  type PrivateLinuxCapturedInput,
  type PrivateLinuxComponentProcess,
  type PrivateLinuxConfirmedEnforcementReceipt,
  PrivateLinuxFenceUnconfirmedError,
  type PrivateLinuxLaunchPlan,
  type PrivateLinuxOwnerStateAllocationIdentity,
  planPrivateLinuxOwnerStateAllocation,
  releasePrivateLinuxOwnerState,
} from './linux-rootless-backend.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'
import {
  isProjectCommandContract,
  PROJECT_COMMAND_LIMITS,
  type PreparedProjectCommand,
  type ProjectCommandResult,
  parseProjectCommandInput,
} from './private-project-command.js'
import {
  normalizeParentFlow,
  protectedOwnerRoot,
  requireParentFlowOwner,
  requireParentTarget,
} from './root-agent-run-controller.js'

const KIND = 'private-project-command-owner/1'
const ROOT = '/jig-input/project'
type Context = Parameters<typeof requireParentTarget>[0]
interface Allocation {
  readonly kind: typeof KIND
  readonly parentRunId: string
  readonly coordinatorEpoch: number
  readonly operationId: string
  readonly parentRequestDigest: string
  readonly parentFlow: NonNullable<Context['parentFlow']> | null
  readonly requestDigest: string
  readonly deadlineUnixMs: number
  readonly ownerAllocation: PrivateLinuxOwnerStateAllocationIdentity
}

/** One keyless command owner, independent of the Flow and the candidate process. */
export async function executePrivateProjectCommand(
  input: Context & {
    readonly call: RunHostEffectCall
    readonly parentDeadlineUnixMs: number
    readonly signal: AbortSignal
  },
): Promise<RunHostEffectOperationTerminal> {
  const target = requireParentTarget(input)
  const capability = target.request.capabilities[input.call.slot]
  if (
    capability === undefined ||
    !isProjectCommandContract(capability) ||
    input.call.method !== 'run'
  )
    return failed('UNAVAILABLE', 'the requested slot has no admitted Project Command run method')
  if (input.signal.aborted) return failed('CANCELLED', 'the project command was cancelled')
  let prepared: PreparedProjectCommand
  try {
    prepared = parseProjectCommandInput(input.call.input, target.request.commands ?? {})
  } catch {
    return failed(
      'INVALID_INPUT',
      'select a reviewed command and supply bounded candidate files, arguments, and stdin',
    )
  }

  let recipe: PrivateDirectRunRecipe
  try {
    if (target.disposition.state !== 'ready') throw new Error('target unavailable')
    recipe = await planPrivateDirectRun({
      ...input,
      request: target.request,
      execution: target.disposition.execution,
    })
    if (
      recipe.digest !== target.disposition.recipeDigest ||
      recipe.observation.digest !== target.disposition.observationDigest
    )
      throw new Error('command parent recipe changed')
    await revalidatePrivateInstalledBunSupport(input.installedSupport)
  } catch {
    return failed('UNAVAILABLE', 'the admitted project-command runtime cannot be reproduced')
  }
  const deadlineUnixMs = Math.min(
    input.parentDeadlineUnixMs,
    input.parent.intent.deadlineUnixMs,
    Date.now() + PROJECT_COMMAND_LIMITS.timeoutMs,
  )
  if (deadlineUnixMs <= Date.now())
    return failed('DEADLINE_EXCEEDED', 'the command deadline elapsed before dispatch')
  if (input.parentFlow !== undefined)
    await requireParentFlowOwner(input, input.parentFlow, deadlineUnixMs)
  const rows = (await owners(input)).filter(
    (row) => row.parentOperationId === input.parentFlow?.operationId,
  )
  const prior = rows.find((row) => row.operationId === input.call.operationId)
  if (prior !== undefined) {
    if (!isCommandOwner(prior)) throw new Error('command identity names a different operation')
    await releaseCommand(input, prior)
    return failed('UNCERTAIN', 'a prior command dispatch was fenced without a proved result')
  }
  if (rows.length !== 0)
    return failed('RESOURCE_EXHAUSTED', 'the parent already has an active operation')
  const identity = commandIdentity(
    input.parent.run.runId,
    input.call.operationId,
    input.parentFlow?.operationId,
  )
  const ownerAllocation = await planPrivateLinuxOwnerStateAllocation({
    parent: await protectedOwnerRoot(input.projectRoot),
    name: `x-${identity.slice(0, 62)}`,
  })
  const allocation: Allocation = {
    kind: KIND,
    parentRunId: input.parent.run.runId,
    coordinatorEpoch: input.parent.run.coordinatorEpoch,
    operationId: input.call.operationId,
    parentRequestDigest: target.request.digest,
    parentFlow: input.parentFlow ?? null,
    deadlineUnixMs,
    ownerAllocation,
    requestDigest: privateDomainDigest(
      'JIG-Project-Command-Request/1',
      prepared as unknown as JsonValue,
    ),
  }
  const key = operationKey(input, input.call.operationId, input.parentFlow?.operationId)
  let lifecycle: PrivateRootChildOwnerLifecycle
  try {
    lifecycle = await allocatePrivateRootChildOwner({
      ...key,
      allocation: allocation as unknown as JsonValue,
    })
  } catch (error) {
    const cancelled = await cancelPrivateLinuxOwnerStateAllocation(ownerAllocation)
    await releasePrivateLinuxOwnerState(ownerAllocation, cancelled)
    if (error instanceof CheckError && error.code === 'RUN_CHILD_CAPACITY')
      return failed('RESOURCE_EXHAUSTED', 'the parent already has an active operation')
    throw error
  }
  const files: PrivateLinuxCapturedInput[] = []
  let attempted = false
  try {
    for (const [path, source] of Object.entries(prepared.input.files)) {
      const bytes = Buffer.from(source)
      files.push({
        fd: privateSealedBytes(bytes),
        destination: `${ROOT}/${path}`,
        bytes: bytes.length,
        digest: sha256(bytes),
      })
    }
    const sealed = await input.backend.seal(
      commandPlan(recipe, prepared, files, identity, deadlineUnixMs),
      ownerAllocation,
    )
    lifecycle = await recordPrivateRootChildSandbox({
      ...key,
      allocationDigest: lifecycle.allocation.digest,
      sandbox: sealed.identity as unknown as JsonValue,
    })
    attempted = true
    const component = await sealed.admit(input.signal)
    const observed = await collectCommand(component, prepared.input.stdin ?? '')
    await releaseCommand(input, lifecycle, observed.fence)
    const reason = observed.fence.stopReason
    if (!['payload_exit', 'cancelled', 'deadline'].includes(reason))
      return failed('UNCERTAIN', 'the command was fenced without a proved command terminal')
    const value: ProjectCommandResult = Object.freeze({
      candidateDigest: prepared.candidateDigest,
      command: prepared.input.command,
      invocation: prepared.invocation,
      stdinDigest: prepared.stdinDigest,
      stdout: observed.stdout,
      stderr: observed.stderr,
      exitCode: observed.fence.exitCode,
      signal: observed.fence.signal,
      stopReason: reason === 'payload_exit' ? 'exited' : (reason as 'cancelled' | 'deadline'),
      cleanup: 'complete',
    })
    const details = { command: value } as unknown as JsonValue
    if (input.signal.aborted || reason === 'cancelled')
      return failed('CANCELLED', 'the project command was cancelled', details)
    if (reason === 'deadline')
      return failed('DEADLINE_EXCEEDED', 'the project command exceeded its deadline', details)
    return { status: 'succeeded', result: { value: value as unknown as JsonValue } }
  } catch (error) {
    try {
      const row = (await owners(input)).find(
        (row) =>
          row.operationId === input.call.operationId &&
          row.parentOperationId === input.parentFlow?.operationId,
      )
      if (row !== undefined) await releaseCommand(input, row)
    } catch (cleanupError) {
      if (attempted && cleanupError instanceof PrivateLinuxFenceUnconfirmedError)
        return failed('UNCERTAIN', 'command dispatch may have occurred but fencing is unconfirmed')
      throw new AggregateError(
        [error, cleanupError],
        'project command execution and cleanup failed',
      )
    }
    if (input.signal.aborted) return failed('CANCELLED', 'the project command was cancelled')
    if (Date.now() >= deadlineUnixMs)
      return failed('DEADLINE_EXCEEDED', 'the project command deadline elapsed')
    return failed(
      attempted ? 'UNCERTAIN' : 'EXECUTION_FAILED',
      attempted
        ? 'command dispatch may have occurred but no result was proved'
        : 'project command setup failed before dispatch',
    )
  } finally {
    for (const file of files) closeSync(file.fd)
  }
}

function commandPlan(
  recipe: PrivateDirectRunRecipe,
  prepared: PreparedProjectCommand,
  files: readonly PrivateLinuxCapturedInput[],
  identity: string,
  deadlineUnixMs: number,
): PrivateLinuxLaunchPlan {
  const policy = recipe.request.commands![prepared.input.command]!
  const args =
    'run' in policy
      ? [
          ...recipe.bunPolicy,
          '--cwd',
          ROOT,
          `${ROOT}/${policy.run}`,
          ...(prepared.input.args ?? []),
        ]
      : [
          'test',
          ...recipe.bunPolicy,
          '--cwd',
          ROOT,
          ...policy.test.map((path) => `${ROOT}/${path}`),
        ]
  return {
    runId: `command-${identity.slice(0, 40)}`,
    limits: { ...recipe.resourceCeilings, deadlineUnixMs, cancellationGraceMs: 1000 },
    readOnlyMounts: recipe.installedSupport.runtimeMounts,
    capturedInputs: files,
    inputDirectories: [ROOT],
    command: [recipe.sandboxExecutablePath, ...args],
    network: 'isolated',
  }
}

/** Drains both pipes concurrently while retaining only their bounded prefixes. */
export async function collectProjectCommandStream(
  source: AsyncIterable<Uint8Array>,
): Promise<ProjectCommandResult['stdout']> {
  const chunks: Uint8Array[] = []
  let retained = 0
  let truncated = false
  for await (const chunk of source) {
    const keep = Math.min(chunk.length, PROJECT_COMMAND_LIMITS.streamBytes - retained)
    if (keep > 0) {
      chunks.push(Uint8Array.from(chunk.subarray(0, keep)))
      retained += keep
    }
    if (keep < chunk.length) truncated = true
  }
  return Object.freeze({ text: new TextDecoder().decode(Buffer.concat(chunks)), truncated })
}

async function collectCommand(component: PrivateLinuxComponentProcess, stdin: string) {
  // Observe every backend settlement promise, including exceptional enforcement.
  for (const promise of [component.completion, component.evidence, component.terminationReason])
    void promise.catch(() => undefined)
  const stdout = collectProjectCommandStream(component.stdout)
  const stderr = collectProjectCommandStream(component.stderr)
  const send = (async () => {
    try {
      if (stdin.length > 0) await component.write(Buffer.from(stdin))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EPIPE')) throw error
    }
    await component.closeInput()
  })()
  try {
    const [out, err, fence] = await Promise.all([stdout, stderr, component.enforcement, send])
    return { stdout: out, stderr: err, fence }
  } catch (error) {
    await component.terminate().catch(() => undefined)
    await Promise.allSettled([stdout, stderr, send, component.enforcement])
    throw error
  }
}

export async function recoverPrivateProjectCommandOwners(input: Context): Promise<void> {
  for (const owner of await owners(input)) {
    if (
      isCommandOwner(owner) &&
      (input.parentFlow === undefined || owner.parentOperationId === input.parentFlow.operationId)
    )
      await releaseCommand(input, owner)
  }
}

function isCommandOwner(row: PrivateRootChildOwnerLifecycle): boolean {
  const value = row.allocation.value
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as JsonObject).kind === KIND
  )
}

async function releaseCommand(
  input: Context,
  row: PrivateRootChildOwnerLifecycle,
  knownFence?: PrivateLinuxConfirmedEnforcementReceipt,
): Promise<void> {
  let lifecycle = row
  const allocation = parseAllocation(row)
  const parentFlow = allocation.parentFlow
  const { parentFlow: _requestedParentFlow, ...rootInput } = input
  const context = { ...rootInput, ...(parentFlow === null ? {} : { parentFlow }) }
  const target = requireParentTarget(context)
  const identity = commandIdentity(
    lifecycle.parentRunId,
    lifecycle.operationId,
    lifecycle.parentOperationId,
  )
  if (
    allocation.parentRunId !== input.parent.run.runId ||
    allocation.coordinatorEpoch !== input.parent.run.coordinatorEpoch ||
    allocation.parentRequestDigest !== target.request.digest ||
    allocation.deadlineUnixMs > input.parent.intent.deadlineUnixMs ||
    !Object.values(target.request.capabilities).some(isProjectCommandContract) ||
    allocation.ownerAllocation.parent !== (await protectedOwnerRoot(input.projectRoot)) ||
    allocation.ownerAllocation.name !== `x-${identity.slice(0, 62)}` ||
    (input.parentFlow !== undefined && input.parentFlow.operationId !== parentFlow?.operationId)
  )
    throw new Error('command owner differs from its admitted parent')
  if (parentFlow !== null)
    await requireParentFlowOwner(context, parentFlow, allocation.deadlineUnixMs)
  const key = operationKey(input, lifecycle.operationId, lifecycle.parentOperationId)
  if (lifecycle.sandbox === undefined) {
    if (lifecycle.fence !== undefined || lifecycle.cleanup !== undefined)
      throw new Error('command fence precedes sandbox')
    const cancelled = await cancelPrivateLinuxOwnerStateAllocation(allocation.ownerAllocation)
    await releasePrivateLinuxOwnerState(allocation.ownerAllocation, cancelled)
  } else {
    const owner = normalizePrivateLinuxSealedOwnerIdentity(lifecycle.sandbox.value)
    if (
      owner.ownerStateAllocationDigest !== allocation.ownerAllocation.digest ||
      owner.runId !== `command-${identity.slice(0, 40)}` ||
      owner.deadlineUnixMs !== allocation.deadlineUnixMs
    )
      throw new Error('command sandbox differs from its allocation')
    const fence =
      lifecycle.fence === undefined
        ? (knownFence ?? (await input.backend.recoverFence(owner)))
        : normalizePrivateLinuxConfirmedEnforcementReceipt(lifecycle.fence.value)
    normalizePrivateLinuxPreparedOwnerIdentity({
      kind: 'private-linux-prepared-owner/1',
      digest: fence.ownerDigest,
      owner,
    })
    if (lifecycle.fence === undefined)
      lifecycle = await recordPrivateRootChildFence({
        ...key,
        allocationDigest: lifecycle.allocation.digest,
        sandboxDigest: lifecycle.sandbox!.digest,
        fence: fence as unknown as JsonValue,
      })
    const released = await releasePrivateLinuxOwnerState(owner, fence)
    if (lifecycle.cleanup === undefined)
      lifecycle = await recordPrivateRootChildCleanup({
        ...key,
        allocationDigest: lifecycle.allocation.digest,
        sandboxDigest: lifecycle.sandbox!.digest,
        fenceDigest: lifecycle.fence!.digest,
        cleanup: released as unknown as JsonValue,
      })
    else if (
      normalizePrivateLinuxOwnerStateReleaseReceipt(lifecycle.cleanup.value).digest !==
      released.digest
    )
      throw new Error('command cleanup receipt changed')
  }
  await closePrivateRootChildOwner({
    ...key,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox?.digest ?? null,
    fenceDigest: lifecycle.fence?.digest ?? null,
    cleanupDigest: lifecycle.cleanup?.digest ?? null,
  })
}

function parseAllocation(row: PrivateRootChildOwnerLifecycle): Allocation {
  const value = snapshotPrivateOrdinaryJson(
    row.allocation.value,
    'command allocation',
    (message) => new TypeError(message),
  ) as JsonObject
  const fields = [
    'kind',
    'parentRunId',
    'coordinatorEpoch',
    'operationId',
    'parentRequestDigest',
    'parentFlow',
    'requestDigest',
    'deadlineUnixMs',
    'ownerAllocation',
  ]
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field)) ||
    value.kind !== KIND ||
    value.parentRunId !== row.parentRunId ||
    value.operationId !== row.operationId ||
    typeof value.coordinatorEpoch !== 'number' ||
    !Number.isSafeInteger(value.coordinatorEpoch) ||
    value.coordinatorEpoch < 1 ||
    typeof value.deadlineUnixMs !== 'number' ||
    !Number.isSafeInteger(value.deadlineUnixMs) ||
    value.deadlineUnixMs < 0 ||
    typeof value.parentRequestDigest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(value.parentRequestDigest) ||
    typeof value.requestDigest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(value.requestDigest)
  )
    throw new TypeError('invalid command owner allocation')
  return {
    ...value,
    parentFlow: normalizeParentFlow(value.parentFlow, row.parentOperationId),
    ownerAllocation: normalizePrivateLinuxOwnerStateAllocationIdentity(value.ownerAllocation),
  } as unknown as Allocation
}

function operationKey(input: Context, operationId: string, parentOperationId?: string) {
  return {
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
    operationId,
    ...(parentOperationId === undefined ? {} : { parentOperationId }),
  }
}
function owners(input: Context) {
  return listPrivateRootChildOwners({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  })
}
function commandIdentity(
  parentRunId: string,
  operationId: string,
  parentOperationId?: string,
): string {
  return privateDomainDigest('JIG-Project-Command-Owner/1', {
    parentRunId,
    operationId,
    parentOperationId: parentOperationId ?? null,
  }).slice(7)
}
function failed(
  code: WireFailureCode,
  message: string,
  details?: JsonValue,
): RunHostEffectOperationTerminal {
  return { status: 'failed', code, message, ...(details === undefined ? {} : { details }) }
}
