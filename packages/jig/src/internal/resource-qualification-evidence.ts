import { types } from 'node:util'
import type { JsonValue } from '../json.js'
import type { RunTargetIdentity } from '../project/package-project.js'
import type { PrivateActivationRequest } from '../project/package-resolution.js'
import { normalizeProjectPath } from '../project/paths.js'
import { ACP_SETUP_CAUSES, acpSetupCode } from './acp-setup-diagnostics.js'
import { privateDomainDigest } from './identity.js'

export type PrivateRuntimeReadinessCause =
  | {
      readonly kind: 'acp'
      readonly slot: string
      readonly client: 'codex' | 'claude' | 'pi'
      readonly diagnostic: string
    }
  | { readonly kind: 'dependency'; readonly slot: string; readonly target: RunTargetIdentity }

export interface PrivateResourceQualificationTarget {
  readonly request: PrivateActivationRequest
  readonly disposition: {
    readonly state: string
    readonly code?: string
    readonly cause?: PrivateRuntimeReadinessCause
    readonly evidenceDigests?: readonly string[]
  }
}

export function normalizePrivateRuntimeReadinessCause(
  value: unknown,
): PrivateRuntimeReadinessCause {
  const v = record(value)
  if (
    typeof v.slot !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.slot) ||
    v.slot.length > 64
  )
    throw new TypeError('invalid readiness cause slot')
  if (v.kind === 'acp') {
    exact(v, ['kind', 'slot', 'client', 'diagnostic'])
    if (
      !['codex', 'claude', 'pi'].includes(v.client as string) ||
      typeof v.diagnostic !== 'string' ||
      !Object.hasOwn(ACP_SETUP_CAUSES, v.diagnostic) ||
      !['executable', 'model'].some(
        (stage) =>
          acpSetupCode(v.client as 'codex' | 'claude' | 'pi', stage as 'executable' | 'model') ===
          v.diagnostic,
      )
    )
      throw new TypeError('invalid readiness ACP diagnostic')
    return Object.freeze({
      kind: 'acp',
      slot: v.slot,
      client: v.client as 'codex' | 'claude' | 'pi',
      diagnostic: v.diagnostic,
    })
  }
  if (v.kind === 'dependency') {
    exact(v, ['kind', 'slot', 'target'])
    const target = record(v.target)
    let identity: RunTargetIdentity
    if (target.kind === 'flow') {
      exact(target, ['kind', 'path'])
      identity = Object.freeze({
        kind: 'flow',
        path: normalizeProjectPath(target.path, 'readiness target'),
      })
    } else if (target.kind === 'binding') {
      exact(target, ['kind', 'id'])
      if (
        typeof target.id !== 'string' ||
        target.id.length > 64 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.id)
      )
        throw new TypeError('invalid readiness target')
      identity = Object.freeze({ kind: 'binding', id: target.id })
    } else throw new TypeError('invalid readiness target')
    return Object.freeze({ kind: 'dependency', slot: v.slot, target: identity })
  }
  throw new TypeError('invalid runtime readiness cause')
}

export function privateResourceFailureEvidence(
  request: PrivateActivationRequest,
  cause: PrivateRuntimeReadinessCause,
  child?: PrivateResourceQualificationTarget,
): string {
  const route = request.slots[cause.slot]
  if (cause.kind === 'acp') {
    if (
      route?.kind !== 'native' ||
      route.native !== 'finite-acp' ||
      route.grant?.kind !== 'acp' ||
      route.grant.client !== cause.client
    )
      throw new TypeError('readiness cause does not match ACP route')
    return privateDomainDigest('JIG-ACP-Qualification/1', {
      request: request.digest,
      cause,
      grant: route.grant,
    } as unknown as JsonValue)
  }
  if (
    route?.kind !== 'flow' ||
    targetKey(route.target) !== targetKey(cause.target) ||
    child === undefined ||
    targetKey(child.request.target) !== targetKey(cause.target) ||
    child.disposition.state !== 'unavailable'
  )
    throw new TypeError('readiness cause does not match unavailable dependency')
  return privateDomainDigest('JIG-Resource-Dependency-Qualification/1', {
    request: request.digest,
    cause,
    childRequest: child.request.digest,
    childDisposition: child.disposition,
  } as unknown as JsonValue)
}

/** Retained data cannot make a parent ready while its exact selected child is unavailable. */
export function assertPrivateResourceQualification(
  targets: readonly PrivateResourceQualificationTarget[],
): void {
  const byTarget = new Map(targets.map((target) => [targetKey(target.request.target), target]))
  for (const target of targets) {
    if (target.disposition.state === 'ready' || target.disposition.state === 'planned') {
      for (const route of Object.values(target.request.slots))
        if (
          route.kind === 'flow' &&
          byTarget.get(targetKey(route.target))?.disposition.state === 'unavailable'
        )
          throw new TypeError('ready target selects an unavailable dependency')
    }
    if (
      target.disposition.cause !== undefined &&
      (target.disposition.state !== 'unavailable' ||
        target.disposition.code !== 'RUNTIME_UNAVAILABLE')
    )
      throw new TypeError('only runtime refusal may retain a readiness cause')
    if (
      target.disposition.state !== 'unavailable' ||
      target.disposition.code !== 'RUNTIME_UNAVAILABLE'
    )
      continue
    if (target.disposition.cause === undefined) {
      if (
        Object.values(target.request.slots).some(
          (route) => route.kind === 'native' && route.native === 'finite-acp',
        )
      )
        throw new TypeError('ACP runtime refusal requires a closed readiness cause')
      if (
        Object.values(target.request.slots).some((route) => {
          if (route.kind !== 'flow') return false
          const child = byTarget.get(targetKey(route.target))?.disposition
          return (
            child?.state === 'unavailable' &&
            child.code === 'RUNTIME_UNAVAILABLE' &&
            child.cause !== undefined
          )
        })
      )
        throw new TypeError('dependent runtime refusal requires a closed readiness cause')
      continue // Other unavailable runtime profiles retain their own digest-only evidence.
    }
    const cause = normalizePrivateRuntimeReadinessCause(target.disposition.cause)
    const expected = privateResourceFailureEvidence(
      target.request,
      cause,
      cause.kind === 'dependency' ? byTarget.get(targetKey(cause.target)) : undefined,
    )
    if (
      target.disposition.evidenceDigests?.length !== 1 ||
      target.disposition.evidenceDigests[0] !== expected
    )
      throw new TypeError('runtime readiness evidence does not match retained cause')
  }
}
function targetKey(target: RunTargetIdentity): string {
  return target.kind === 'flow' ? `flow\0${target.path}` : `binding\0${target.id}`
}
function record(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError('readiness cause must be an ordinary object')
  const output: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !d?.enumerable || !('value' in d))
      throw new TypeError('invalid readiness cause field')
    output[key] = d.value
  }
  return output
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw new TypeError('invalid readiness cause fields')
}
