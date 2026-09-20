import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalJson, type JsonObject } from '../json.js'
import { flowSlotTargets } from '../project/invocation-slots.js'
import type { RunTargetIdentity } from '../project/package-project.js'
import { validateProjectPath } from '../project/paths.js'
import { findPrivateActivationCandidateTargetV5 } from './activation-admission.js'
import { PRIVATE_MAX_CHILD_FLOW_LEVELS } from './root-operation-limits.js'
import {
  listPrivateRootChildOwners,
  type PrivateProjectCoordinator,
  type PrivateReacquiredRootExecutionWork,
} from './activation-admission-store.js'

/** Bounded invocation ancestry, shared by every contained effect.
 * This is private ownership machinery, not a provider API. */
export interface PrivateInvocationContext {
  readonly projectRoot: string
  readonly parent: PrivateReacquiredRootExecutionWork
  readonly parentFlow?: PrivateParentFlow | undefined
  readonly coordinator: PrivateProjectCoordinator
}

const DIGEST = /^sha256:[0-9a-f]{64}$/

/** Exact admitted Flow and its immediate invocation parent. */
export interface PrivateParentFlow {
  readonly operationId: string
  readonly target: RunTargetIdentity
  readonly requestDigest: string
  readonly parent: PrivateParentFlow | null
}

export function requireParentTarget(input: PrivateInvocationContext) {
  const { parent } = input
  const parentFlow =
    input.parentFlow === undefined
      ? undefined
      : normalizeParentFlow(input.parentFlow, input.parentFlow.operationId)!
  const root = findPrivateActivationCandidateTargetV5(parent.candidate, parent.run.target)
  if (
    root === undefined ||
    root.request.digest !== parent.intent.requestDigest ||
    root.disposition.state !== 'ready'
  ) {
    throw new Error('parent Run differs from its admitted target')
  }
  if (parentFlow === undefined) return root
  const caller = requireParentTarget({ ...input, parentFlow: parentFlow.parent ?? undefined })
  const target = findPrivateActivationCandidateTargetV5(parent.candidate, parentFlow.target)
  if (
    target === undefined ||
    target.request.digest !== parentFlow.requestDigest ||
    target.disposition.state !== 'ready' ||
    !Object.values(flowSlotTargets(caller.request.slots)).some(
      (identity) =>
        findPrivateActivationCandidateTargetV5(parent.candidate, identity)?.request.digest ===
        target.request.digest,
    )
  ) {
    throw new Error('invocation parent Flow differs from its admitted child target')
  }
  return target
}

export async function requireParentFlowOwner(
  input: PrivateInvocationContext,
  parentFlow: PrivateParentFlow,
  deadlineUnixMs: number,
): Promise<void> {
  const owners = await listPrivateRootChildOwners({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  })
  const parent = owners.find(
    (owner) =>
      owner.parentOperationId === parentFlow.parent?.operationId &&
      owner.operationId === parentFlow.operationId,
  )
  const allocation = parent?.allocation.value as JsonObject | undefined
  if (
    allocation === null ||
    typeof allocation !== 'object' ||
    Array.isArray(allocation) ||
    allocation.kind !== 'private-root-child-owner-allocation/1' ||
    allocation.parentRunId !== input.parent.run.runId ||
    allocation.coordinatorEpoch !== input.parent.run.coordinatorEpoch ||
    allocation.operationId !== parentFlow.operationId ||
    allocation.requestDigest !== parentFlow.requestDigest ||
    allocation.parentFlow === undefined ||
    !Buffer.from(canonicalJson(allocation.parentFlow)).equals(
      Buffer.from(canonicalJson(parentFlow.parent as unknown as JsonObject | null)),
    ) ||
    typeof allocation.effectiveDeadlineUnixMs !== 'number' ||
    !Number.isSafeInteger(allocation.effectiveDeadlineUnixMs) ||
    allocation.effectiveDeadlineUnixMs > input.parent.intent.deadlineUnixMs ||
    allocation.effectiveDeadlineUnixMs < deadlineUnixMs ||
    parent?.sandbox === undefined
  ) {
    throw new Error('invocation parent Flow differs from its durable execution owner')
  }
  if (parentFlow.parent !== null)
    await requireParentFlowOwner(input, parentFlow.parent, deadlineUnixMs)
}

export function normalizeParentFlow(
  value: unknown,
  parentOperationId: string | undefined,
  depth = 0,
): PrivateParentFlow | null {
  if (parentOperationId === undefined) {
    if (value !== null) throw new TypeError('root invocation allocation has a nested parent')
    return null
  }
  if (depth >= PRIVATE_MAX_CHILD_FLOW_LEVELS)
    throw new TypeError('invocation ancestry exceeds the fixed root resource budget')
  const parent = exactObject(
    value,
    ['operationId', 'target', 'requestDigest', 'parent'],
    'invocation parent Flow',
  )
  if (
    typeof parent.operationId !== 'string' ||
    parent.operationId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$(?![\s\S])/.test(parent.operationId) ||
    parent.operationId !== parentOperationId ||
    !isDigest(parent.requestDigest)
  ) {
    throw new TypeError('invocation parent Flow identity is invalid')
  }
  const target = exactObject(
    parent.target,
    parent.target?.kind === 'flow' ? ['kind', 'path'] : ['kind', 'id'],
    'invocation parent Flow target',
  )
  let identity: RunTargetIdentity
  if (target.kind === 'flow' && typeof target.path === 'string') {
    validateProjectPath(target.path, 'invocation parent Flow target')
    identity = Object.freeze({ kind: 'flow', path: target.path })
  } else if (
    target.kind === 'binding' &&
    typeof target.id === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.id)
  ) {
    identity = Object.freeze({ kind: 'binding', id: target.id })
  } else {
    throw new TypeError('invocation parent Flow target is invalid')
  }
  return Object.freeze({
    operationId: parentOperationId,
    target: identity,
    requestDigest: parent.requestDigest,
    parent: normalizeParentFlow(
      parent.parent,
      parent.parent === null ? undefined : parent.parent?.operationId,
      depth + 1,
    ),
  })
}

export async function protectedOwnerRoot(projectRoot: string): Promise<string> {
  const state = await realpath(join(projectRoot, '.jig'))
  const owners = join(state, 'private-root-linux-owners')
  await mkdir(owners, { mode: 0o700 }).catch((error) => {
    if (!hasCode(error, 'EEXIST')) throw error
  })
  const information = await lstat(owners)
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1
  if (
    !information.isDirectory() ||
    information.isSymbolicLink() ||
    information.uid !== uid ||
    (information.mode & 0o077) !== 0 ||
    (await realpath(owners)) !== owners
  ) {
    throw new Error('execution owner directory is not protected')
  }
  return owners
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

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value)
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error !== null && typeof error === 'object' && (error as NodeJS.ErrnoException).code === code
  )
}
