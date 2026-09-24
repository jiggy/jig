import { closeSync } from 'node:fs'
import { CheckError } from '../diagnostics.js'
import {
  canonicalJson,
  decodeJson1,
  JSON_1_LIMITS,
  type JsonObject,
  type JsonValue,
} from '../json.js'
import type { ProjectCommand } from '../project/commands.js'
import type { GrantPolicy, HttpGrant } from '../project/grants.js'
import type { RunHostCall, RunHostOperationTerminal, WireFailureCode } from '../run/session.js'
import { RunHostFatalOperationError } from '../run/session.js'
import {
  allocatePrivateRootChildOwner,
  closePrivateRootChildOwner,
  listPrivateRootChildOwners,
  type PrivateRootChildOwnerLifecycle,
  recordPrivateRootChildCleanup,
  recordPrivateRootChildFence,
  recordPrivateRootChildSandbox,
} from './activation-admission-store.js'
import type { PrivateAcpResources } from './private-acp-resources.js'
import {
  type PrivateDirectRunInstalledSupport,
  type PrivateDirectRunRecipe,
  planPrivateDirectRun,
} from './direct-run.js'
import { httpCredential, type PrivateHttpGrants } from './http-grants.js'
import { privateDomainDigest } from './identity.js'
import { revalidatePrivateInstalledBunSupport } from './installed-bun-support.js'
import {
  normalizeParentFlow,
  protectedOwnerRoot,
  requireParentFlowOwner,
  requireParentTarget,
  type PrivateInvocationContext,
} from './invocation-context.js'
import { privateSealedBytes, sha256 } from './linux-file-input.js'
import {
  cancelPrivateLinuxOwnerStateAllocation,
  normalizePrivateLinuxConfirmedEnforcementReceipt,
  normalizePrivateLinuxOwnerStateAllocationIdentity,
  normalizePrivateLinuxOwnerStateReleaseReceipt,
  normalizePrivateLinuxPreparedOwnerIdentity,
  normalizePrivateLinuxSealedOwnerIdentity,
  type PrivateLinuxCapturedInput,
  type PrivateLinuxCgroupBackend,
  type PrivateLinuxComponentProcess,
  type PrivateLinuxConfirmedEnforcementReceipt,
  PrivateLinuxFenceUnconfirmedError,
  type PrivateLinuxLaunchPlan,
  type PrivateLinuxOwnerStateAllocationIdentity,
  planPrivateLinuxOwnerStateAllocation,
  releasePrivateLinuxOwnerState,
} from './linux-rootless-backend.js'
import {
  HTTP_REQUEST_CONTRACT_DIGEST,
  type PreparedHttpRequest,
  parseHttpRequest,
  parseHttpWorkerResult,
  encodeHttpWorkerInput,
  httpCredentialEcho,
} from './private-http-request.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'
import {
  isProjectCommandContract,
  PROJECT_COMMAND_LIMITS,
  type PreparedProjectCommand,
  type ProjectCommandResult,
  parseProjectCommandInput,
} from './private-project-command.js'

const KIND = 'private-contained-effect-owner/1'
const ROOT = '/jig-input/project'
interface Context extends PrivateInvocationContext {
  readonly installedSupport: PrivateDirectRunInstalledSupport
  readonly backend: PrivateLinuxCgroupBackend
  readonly httpGrants?: PrivateHttpGrants | undefined
  readonly acpResources?: PrivateAcpResources | undefined
}
interface Allocation {
  readonly kind: typeof KIND
  readonly effect: 'project-command' | 'http-request'
  readonly parentRunId: string
  readonly coordinatorEpoch: number
  readonly operationId: string
  readonly parentRequestDigest: string
  readonly parentFlow: NonNullable<Context['parentFlow']> | null
  readonly requestDigest: string
  readonly deadlineUnixMs: number
  readonly ownerAllocation: PrivateLinuxOwnerStateAllocationIdentity
}

/** Shared durable ownership for command and credential-bearing HTTP workers. */
export async function executePrivateContainedEffect(
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
    route.grant === undefined ||
    !(
      (route.native === 'project-command' && isProjectCommandContract(route.contract)) ||
      (route.native === 'http-request' && route.contract.digest === HTTP_REQUEST_CONTRACT_DIGEST)
    )
  )
    return failed('UNAVAILABLE', 'the requested slot has no admitted contained operation')
  if (input.signal.aborted) return failed('CANCELLED', 'the contained operation was cancelled')
  let prepared:
    | { kind: 'command'; value: PreparedProjectCommand }
    | { kind: 'http'; value: PreparedHttpRequest }
  let httpInput: string | undefined
  let bearer: string | undefined
  try {
    prepared =
      route.grant.kind === 'command'
        ? {
            kind: 'command',
            value: parseProjectCommandInput(input.call.input, commandPolicy(route.grant)),
          }
        : {
            kind: 'http',
            value: parseHttpRequest(input.call.input, httpPolicy(route.grant)),
          }
    if (prepared.kind === 'http') {
      bearer = httpCredential(input.httpGrants, prepared.value.grant)
      httpInput = Buffer.from(encodeHttpWorkerInput(prepared.value, bearer)).toString('utf8')
    }
  } catch {
    return failed(
      'INVALID_INPUT',
      'supply valid bounded input for an admitted command or HTTP resource',
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
      throw new Error('operation parent recipe changed')
    await revalidatePrivateInstalledBunSupport(input.installedSupport)
  } catch {
    return failed('UNAVAILABLE', 'the admitted contained-operation runtime cannot be reproduced')
  }
  const ownDeadlineUnixMs =
    Date.now() +
    (prepared.kind === 'http' ? prepared.value.grant.timeoutMs : PROJECT_COMMAND_LIMITS.timeoutMs)
  const deadlineUnixMs = Math.min(
    input.parentDeadlineUnixMs,
    input.parent.intent.deadlineUnixMs,
    ownDeadlineUnixMs,
  )
  const deadlineLimit = privateContainedDeadlineLimit(
    prepared.kind,
    input.parent.intent.deadlineUnixMs,
    input.parentDeadlineUnixMs,
    ownDeadlineUnixMs,
  )
  if (deadlineUnixMs <= Date.now())
    return failed('DEADLINE_EXCEEDED', 'the operation deadline elapsed before dispatch')
  if (input.parentFlow !== undefined)
    await requireParentFlowOwner(input, input.parentFlow, deadlineUnixMs)
  const rows = (await owners(input)).filter(
    (row) => row.parentOperationId === input.parentFlow?.operationId,
  )
  const prior = rows.find((row) => row.operationId === input.call.operationId)
  if (prior !== undefined) {
    if (!isEffectOwner(prior)) throw new Error('operation identity names a different effect')
    await releaseEffect(input, prior)
    return failed('UNCERTAIN', 'a prior operation dispatch was fenced without a proved result')
  }
  if (rows.length !== 0)
    return failed('RESOURCE_EXHAUSTED', 'the parent already has an active operation')
  const identity = effectIdentity(
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
    effect: route.native as Allocation['effect'],
    parentRunId: input.parent.run.runId,
    coordinatorEpoch: input.parent.run.coordinatorEpoch,
    operationId: input.call.operationId,
    parentRequestDigest: target.request.digest,
    parentFlow: input.parentFlow ?? null,
    deadlineUnixMs,
    ownerAllocation,
    requestDigest: privateDomainDigest(
      'JIG-Contained-Effect-Request/1',
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
    try {
      const cancelled = await cancelPrivateLinuxOwnerStateAllocation(ownerAllocation)
      await releasePrivateLinuxOwnerState(ownerAllocation, cancelled)
    } catch (cleanupError) {
      throw new RunHostFatalOperationError(
        cleanupError instanceof PrivateLinuxFenceUnconfirmedError
          ? 'UNCERTAIN'
          : 'EXECUTION_FAILED',
        { cause: new AggregateError([error, cleanupError], 'operation allocation cleanup failed') },
      )
    }
    if (error instanceof CheckError && error.code === 'RUN_CHILD_CAPACITY')
      return failed('RESOURCE_EXHAUSTED', 'the parent already has an active operation')
    throw error
  }
  const files: PrivateLinuxCapturedInput[] = []
  let attempted = false
  let phase = 'preparing input'
  try {
    for (const [path, source] of Object.entries(
      prepared.kind === 'command' ? prepared.value.input.files : {},
    )) {
      const bytes = Buffer.from(source)
      files.push({
        fd: privateSealedBytes(bytes),
        destination: `${ROOT}/${path}`,
        bytes: bytes.length,
        digest: sha256(bytes),
      })
    }
    const sealed = await input.backend.seal(
      prepared.kind === 'command'
        ? commandPlan(recipe, prepared.value, files, identity, deadlineUnixMs)
        : httpPlan(recipe, identity, deadlineUnixMs),
      ownerAllocation,
    )
    lifecycle = await recordPrivateRootChildSandbox({
      ...key,
      allocationDigest: lifecycle.allocation.digest,
      sandbox: sealed.identity as unknown as JsonValue,
    })
    attempted = true
    phase = 'starting the worker'
    const component = await sealed.admit(input.signal)
    const stdin = prepared.kind === 'command' ? (prepared.value.input.stdin ?? '') : httpInput!
    phase = 'collecting the worker result'
    const observed = await collectEffect(
      component,
      stdin,
      prepared.kind === 'http' ? JSON_1_LIMITS.bytes : PROJECT_COMMAND_LIMITS.streamBytes,
    )
    phase = 'fencing and cleanup'
    await releaseEffect(input, lifecycle, observed.fence)
    phase = 'checking the collected result'
    const reason = observed.fence.stopReason
    if (!['payload_exit', 'cancelled', 'deadline'].includes(reason))
      return failed(
        'UNCERTAIN',
        'the operation was fenced without a proved terminal; effects may have occurred',
      )
    if (prepared.kind === 'http') {
      if (input.signal.aborted || reason === 'cancelled')
        return failed('CANCELLED', 'HTTP request cancelled; remote effects may have occurred')
      if (reason === 'deadline')
        return failed(
          'DEADLINE_EXCEEDED',
          'HTTP request deadline; remote effects may have occurred',
        )
      if (observed.stdout.truncated || observed.fence.exitCode !== 0)
        return failed(
          'UNCERTAIN',
          'HTTP worker did not provide a complete result; remote effects may have occurred',
        )
      let result
      try {
        result = parseHttpWorkerResult(
          decodeJson1(Buffer.from(observed.stdout.text)),
          prepared.value.grant,
          prepared.value.response,
        )
        if (
          'response' in result &&
          bearer !== undefined &&
          httpCredentialEcho(result.response.body, bearer)
        )
          throw new Error('credential echo')
      } catch {
        return failed('INVALID_RESULT', 'HTTP response rejected; remote effects may have occurred')
      }
      if ('failure' in result)
        return failed(
          result.failure,
          'HTTP response unavailable; remote effects may have occurred. The request was not retried.',
        )
      return {
        status: 'succeeded',
        result: { outcome: 'done', output: result.response as unknown as JsonValue },
      }
    }
    const command = prepared.value
    const value: ProjectCommandResult = Object.freeze({
      candidateDigest: command.candidateDigest,
      invocation: command.invocation,
      stdinDigest: command.stdinDigest,
      stdout: observed.stdout,
      stderr: observed.stderr,
      exitCode: observed.fence.exitCode,
      signal: observed.fence.signal,
      stopReason: reason === 'payload_exit' ? 'exited' : (reason as 'cancelled' | 'deadline'),
      cleanup: 'complete',
    })
    const details = { command: value } as unknown as JsonValue
    if (input.signal.aborted || reason === 'cancelled')
      return failed('CANCELLED', 'the contained operation was cancelled', details)
    if (reason === 'deadline')
      return failed('DEADLINE_EXCEEDED', 'the project command exceeded its deadline', details)
    return {
      status: 'succeeded',
      result: { outcome: 'done', output: value as unknown as JsonValue },
    }
  } catch (error) {
    try {
      const row = (await owners(input)).find(
        (row) =>
          row.operationId === input.call.operationId &&
          row.parentOperationId === input.parentFlow?.operationId,
      )
      if (row !== undefined) await releaseEffect(input, row)
    } catch (cleanupError) {
      throw new RunHostFatalOperationError(
        cleanupError instanceof PrivateLinuxFenceUnconfirmedError
          ? 'UNCERTAIN'
          : 'EXECUTION_FAILED',
        { cause: new AggregateError([error, cleanupError], 'operation cleanup failed') },
      )
    }
    if (input.signal.aborted) return failed('CANCELLED', 'the contained operation was cancelled')
    if (Date.now() >= deadlineUnixMs)
      return failed(
        'DEADLINE_EXCEEDED',
        privateContainedDeadlineMessage(prepared.kind, deadlineLimit, phase),
      )
    return failed(
      attempted ? 'UNCERTAIN' : 'EXECUTION_FAILED',
      attempted
        ? 'operation dispatch may have occurred but no result was proved'
        : 'contained operation setup failed before dispatch',
    )
  } finally {
    for (const file of files) closeSync(file.fd)
  }
}

/** Static diagnostic facts; budget ties favor the root Run's outer authority. */
export function privateContainedDeadlineLimit(
  kind: 'command' | 'http',
  rootDeadlineUnixMs: number,
  parentDeadlineUnixMs: number,
  ownDeadlineUnixMs: number,
): 'root Run' | 'parent Flow' | 'HTTP grant' | 'project command' {
  const deadline = Math.min(rootDeadlineUnixMs, parentDeadlineUnixMs, ownDeadlineUnixMs)
  if (deadline === rootDeadlineUnixMs) return 'root Run'
  if (deadline === parentDeadlineUnixMs) return 'parent Flow'
  return kind === 'http' ? 'HTTP grant' : 'project command'
}

export function privateContainedDeadlineMessage(
  kind: 'command' | 'http',
  limit: ReturnType<typeof privateContainedDeadlineLimit>,
  phase: string,
): string {
  return `the ${kind === 'http' ? 'HTTP request' : 'project command'} did not return a proved result by its effective deadline (limited by ${limit}) while ${phase}; effects may have occurred`
}

function httpPlan(
  recipe: PrivateDirectRunRecipe,
  identity: string,
  deadlineUnixMs: number,
): PrivateLinuxLaunchPlan {
  return {
    runId: `effect-${identity.slice(0, 40)}`,
    limits: { ...recipe.resourceCeilings, deadlineUnixMs, cancellationGraceMs: 1000 },
    readOnlyMounts: [
      ...recipe.installedSupport.runtimeMounts,
      {
        source: recipe.installedSupport.httpWorkerPath,
        destination: recipe.installedSupport.sandboxHttpWorkerPath,
      },
      { source: '/etc/resolv.conf', destination: '/etc/resolv.conf' },
    ],
    command: [
      recipe.sandboxExecutablePath,
      ...recipe.bunPolicy,
      recipe.installedSupport.sandboxHttpWorkerPath,
    ],
    network: 'inherited',
  }
}

function commandPlan(
  recipe: PrivateDirectRunRecipe,
  prepared: PreparedProjectCommand,
  files: readonly PrivateLinuxCapturedInput[],
  identity: string,
  deadlineUnixMs: number,
): PrivateLinuxLaunchPlan {
  const policy = prepared.policy
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
    runId: `effect-${identity.slice(0, 40)}`,
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
  limit: number = PROJECT_COMMAND_LIMITS.streamBytes,
): Promise<ProjectCommandResult['stdout']> {
  const chunks: Uint8Array[] = []
  let retained = 0
  let truncated = false
  for await (const chunk of source) {
    const keep = Math.min(chunk.length, limit - retained)
    if (keep > 0) {
      chunks.push(Uint8Array.from(chunk.subarray(0, keep)))
      retained += keep
    }
    if (keep < chunk.length) truncated = true
  }
  return Object.freeze({ text: new TextDecoder().decode(Buffer.concat(chunks)), truncated })
}

async function collectEffect(
  component: PrivateLinuxComponentProcess,
  stdin: string,
  stdoutLimit: number,
) {
  // Observe every backend settlement promise, including exceptional enforcement.
  for (const promise of [component.completion, component.evidence, component.terminationReason])
    void promise.catch(() => undefined)
  const stdout = collectProjectCommandStream(component.stdout, stdoutLimit)
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

export async function recoverPrivateContainedEffectOwners(input: Context): Promise<void> {
  for (const owner of await owners(input)) {
    if (
      isEffectOwner(owner) &&
      (input.parentFlow === undefined || owner.parentOperationId === input.parentFlow.operationId)
    )
      await releaseEffect(input, owner)
  }
}

function isEffectOwner(row: PrivateRootChildOwnerLifecycle): boolean {
  const value = row.allocation.value
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as JsonObject).kind === KIND
  )
}

async function releaseEffect(
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
  const identity = effectIdentity(
    lifecycle.parentRunId,
    lifecycle.operationId,
    lifecycle.parentOperationId,
  )
  if (
    allocation.parentRunId !== input.parent.run.runId ||
    allocation.coordinatorEpoch !== input.parent.run.coordinatorEpoch ||
    allocation.parentRequestDigest !== target.request.digest ||
    allocation.deadlineUnixMs > input.parent.intent.deadlineUnixMs ||
    !Object.values(target.request.slots).some(
      (route) =>
        route.kind === 'native' &&
        route.native === allocation.effect &&
        (route.native === 'project-command'
          ? isProjectCommandContract(route.contract)
          : route.contract.digest === HTTP_REQUEST_CONTRACT_DIGEST),
    ) ||
    allocation.ownerAllocation.parent !== (await protectedOwnerRoot(input.projectRoot)) ||
    allocation.ownerAllocation.name !== `x-${identity.slice(0, 62)}` ||
    (input.parentFlow !== undefined && input.parentFlow.operationId !== parentFlow?.operationId)
  )
    throw new Error('operation owner differs from its admitted parent')
  if (parentFlow !== null)
    await requireParentFlowOwner(context, parentFlow, allocation.deadlineUnixMs)
  const key = operationKey(input, lifecycle.operationId, lifecycle.parentOperationId)
  if (lifecycle.sandbox === undefined) {
    if (lifecycle.fence !== undefined || lifecycle.cleanup !== undefined)
      throw new Error('operation fence precedes sandbox')
    const cancelled = await cancelPrivateLinuxOwnerStateAllocation(allocation.ownerAllocation)
    await releasePrivateLinuxOwnerState(allocation.ownerAllocation, cancelled)
  } else {
    const owner = normalizePrivateLinuxSealedOwnerIdentity(lifecycle.sandbox.value)
    if (
      owner.ownerStateAllocationDigest !== allocation.ownerAllocation.digest ||
      owner.runId !== `effect-${identity.slice(0, 40)}` ||
      owner.deadlineUnixMs !== allocation.deadlineUnixMs
    )
      throw new Error('operation sandbox differs from its allocation')
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
      throw new Error('operation cleanup receipt changed')
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
    'operation allocation',
    (message) => new TypeError(message),
  ) as JsonObject
  const fields = [
    'kind',
    'effect',
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
    typeof value.effect !== 'string' ||
    !['project-command', 'http-request'].includes(value.effect) ||
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
    throw new TypeError('invalid operation owner allocation')
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
function effectIdentity(
  parentRunId: string,
  operationId: string,
  parentOperationId?: string,
): string {
  return privateDomainDigest('JIG-Contained-Effect-Owner/1', {
    parentRunId,
    operationId,
    parentOperationId: parentOperationId ?? null,
  }).slice(7)
}
function failed(
  code: WireFailureCode,
  message: string,
  details?: JsonValue,
): RunHostOperationTerminal {
  return { status: 'failed', code, message, ...(details === undefined ? {} : { details }) }
}

function commandPolicy(grant: GrantPolicy): ProjectCommand {
  if (grant.kind !== 'command') throw new TypeError('expected command grant')
  const { kind: _, ...policy } = grant
  return policy
}
function httpPolicy(grant: GrantPolicy): HttpGrant {
  if (grant.kind !== 'http') throw new TypeError('expected HTTP grant')
  const { kind: _, ...policy } = grant
  return policy
}
