import { types as utilTypes } from 'node:util'

import { privateDomainDigest } from './identity.js'
import type { JsonValue } from '../json.js'
import type { RunTargetIdentity } from '../project/package-project.js'
import { normalizeProjectPath } from '../project/paths.js'

const DIGEST = /^sha256:[0-9a-f]{64}$/
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._+:/@-]{0,255}$/
export const PRIVATE_ACTIVATION_TARGET_LIMIT = 4_096
const MAX_EVIDENCE_PER_ENTRY = 64
const MAX_TOTAL_EVIDENCE = 65_536

const authenticObservations = new WeakSet<object>()
const authenticSnapshots = new WeakSet<object>()

export interface PrivateExtensionObservation {
  readonly artifactDigest: string
  readonly revision: string
}

/**
 * Digest-only host planning evidence. This is not a retained or executable
 * recipe and must never cross the admission boundary.
 */
export interface PrivateActivationRecipeObservationInput {
  readonly requestDigest: string
  readonly adapter: PrivateExtensionObservation
  readonly toolchainDigest: string
  readonly inspectionDigest: string
  readonly launchPlanner: PrivateExtensionObservation
  readonly backend: PrivateExtensionObservation
  readonly launchEnvelopeDigest: string
  readonly installedSupportDigest: string
  readonly runtimePredicates: readonly []
  readonly requestedAuthorityDigest: string
  readonly wouldGrantAuthorityDigest: string
  readonly plannedAuthorityDigest: string
}

export interface PrivateActivationRecipeObservation
  extends PrivateActivationRecipeObservationInput {
  readonly kind: 'activation-recipe-observation/1'
  readonly digest: string
}

export type PrivateActivationUnavailableCode = 'RUNTIME_UNAVAILABLE' | 'SANDBOX_UNAVAILABLE'

export type PrivateActivationPlanningDisposition =
  | {
      readonly state: 'planned'
      readonly observation: PrivateActivationRecipeObservation
    }
  | {
      readonly state: 'unavailable'
      readonly code: PrivateActivationUnavailableCode
      readonly evidenceDigests: readonly string[]
    }

export interface PrivateActivationPlanningEntryInput {
  readonly target: RunTargetIdentity
  readonly requestDigest: string
  readonly disposition:
    | {
        readonly state: 'planned'
        readonly observation: PrivateActivationRecipeObservation
      }
    | {
        readonly state: 'unavailable'
        readonly code: PrivateActivationUnavailableCode
        readonly evidenceDigests: readonly string[]
      }
}

export interface PrivateActivationPlanningEntry {
  readonly target: RunTargetIdentity
  readonly requestDigest: string
  readonly disposition: PrivateActivationPlanningDisposition
}

export interface PrivateActivationPlanningObservationInput {
  readonly policyDigest: string
  readonly mechanismDigest: string
  readonly entries: readonly PrivateActivationPlanningEntryInput[]
}

/**
 * Immutable inert observation from trusted host planning. It carries no
 * callbacks, paths, commands, process handles, or live registry lookups.
 * Its digest-only mechanism summaries are intentionally non-admissible.
 */
export interface PrivateActivationPlanningObservation {
  readonly kind: 'activation-planning-observation/1'
  readonly digest: string
  readonly policyDigest: string
  readonly mechanismDigest: string
  readonly entries: readonly PrivateActivationPlanningEntry[]
}

export function createPrivateActivationRecipeObservation(
  input: PrivateActivationRecipeObservationInput,
): PrivateActivationRecipeObservation {
  const root = readClosedRecord(
    input,
    [
      'requestDigest',
      'adapter',
      'toolchainDigest',
      'inspectionDigest',
      'launchPlanner',
      'backend',
      'launchEnvelopeDigest',
      'installedSupportDigest',
      'runtimePredicates',
      'requestedAuthorityDigest',
      'wouldGrantAuthorityDigest',
      'plannedAuthorityDigest',
    ],
    'activation recipe observation',
  )
  const valueWithoutDigest = Object.freeze({
    kind: 'activation-recipe-observation/1' as const,
    requestDigest: requireDigest(root.requestDigest, 'recipe request'),
    adapter: normalizeExtension(root.adapter, 'adapter'),
    toolchainDigest: requireDigest(root.toolchainDigest, 'toolchain'),
    inspectionDigest: requireDigest(root.inspectionDigest, 'inspection'),
    launchPlanner: normalizeExtension(root.launchPlanner, 'launch planner'),
    backend: normalizeExtension(root.backend, 'sandbox backend'),
    launchEnvelopeDigest: requireDigest(root.launchEnvelopeDigest, 'launch envelope'),
    installedSupportDigest: requireDigest(root.installedSupportDigest, 'installed support'),
    runtimePredicates: normalizeRuntimePredicates(root.runtimePredicates),
    requestedAuthorityDigest: requireDigest(root.requestedAuthorityDigest, 'requested authority'),
    wouldGrantAuthorityDigest: requireDigest(
      root.wouldGrantAuthorityDigest,
      'would-grant authority',
    ),
    plannedAuthorityDigest: requireDigest(root.plannedAuthorityDigest, 'planned authority'),
  })
  const observation = Object.freeze({
    ...valueWithoutDigest,
    digest: privateDomainDigest(
      'JIG-Activation-Recipe-Observation/1',
      valueWithoutDigest as unknown as JsonValue,
    ),
  })
  authenticObservations.add(observation)
  return observation
}

export function requirePrivateActivationRecipeObservation(
  value: unknown,
): PrivateActivationRecipeObservation {
  if (value === null || typeof value !== 'object' || !authenticObservations.has(value)) {
    throw new TypeError('recipe observation was not produced by private activation planning')
  }
  return value as PrivateActivationRecipeObservation
}

export function createPrivateActivationPlanningObservation(
  input: PrivateActivationPlanningObservationInput,
): PrivateActivationPlanningObservation {
  const root = readClosedRecord(
    input,
    ['policyDigest', 'mechanismDigest', 'entries'],
    'activation planning observation',
  )
  const rawEntries = readBoundedArray(
    root.entries,
    PRIVATE_ACTIVATION_TARGET_LIMIT,
    'activation planning entries',
  )
  let evidenceCount = 0
  const entries = rawEntries
    .map((entry, index) => {
      const normalized = normalizeEntry(entry, index)
      if (normalized.disposition.state === 'unavailable') {
        evidenceCount += normalized.disposition.evidenceDigests.length
        if (evidenceCount > MAX_TOTAL_EVIDENCE) {
          throw new TypeError(`activation planning evidence exceeds ${MAX_TOTAL_EVIDENCE} digests`)
        }
      }
      return normalized
    })
    .sort((left, right) => compareTarget(left.target, right.target))
  for (let index = 1; index < entries.length; index += 1) {
    if (targetKey(entries[index - 1]!.target) === targetKey(entries[index]!.target)) {
      throw new TypeError(`duplicate activation target ${targetKey(entries[index]!.target)}`)
    }
  }
  const valueWithoutDigest = Object.freeze({
    kind: 'activation-planning-observation/1' as const,
    policyDigest: requireDigest(root.policyDigest, 'host policy'),
    mechanismDigest: requireDigest(root.mechanismDigest, 'host mechanism snapshot'),
    entries: Object.freeze(entries),
  })
  const snapshot = Object.freeze({
    ...valueWithoutDigest,
    digest: privateDomainDigest(
      'JIG-Activation-Planning-Observation/1',
      valueWithoutDigest as unknown as JsonValue,
    ),
  })
  authenticSnapshots.add(snapshot)
  return snapshot
}

export function requirePrivateActivationPlanningObservation(
  value: unknown,
): PrivateActivationPlanningObservation {
  if (value === null || typeof value !== 'object' || !authenticSnapshots.has(value)) {
    throw new TypeError('planning observation was not produced by the trusted host boundary')
  }
  return value as PrivateActivationPlanningObservation
}

function normalizeEntry(input: unknown, index: number): PrivateActivationPlanningEntry {
  const root = readClosedRecord(
    input,
    ['target', 'requestDigest', 'disposition'],
    `activation planning entries[${index}]`,
  )
  const target = normalizeTarget(root.target)
  const requestDigest = requireDigest(root.requestDigest, `activation request ${targetKey(target)}`)
  const state = readDataField(
    root.disposition,
    'state',
    `activation disposition ${targetKey(target)}`,
  )
  let disposition: PrivateActivationPlanningDisposition
  if (state === 'planned') {
    const value = readClosedRecord(
      root.disposition,
      ['state', 'observation'],
      `activation disposition ${targetKey(target)}`,
    )
    const observation = requirePrivateActivationRecipeObservation(value.observation)
    if (observation.requestDigest !== requestDigest) {
      throw new TypeError(
        `recipe observation does not belong to activation request ${targetKey(target)}`,
      )
    }
    disposition = Object.freeze({ state: 'planned' as const, observation })
  } else if (state === 'unavailable') {
    const value = readClosedRecord(
      root.disposition,
      ['state', 'code', 'evidenceDigests'],
      `activation disposition ${targetKey(target)}`,
    )
    if (!isUnavailableCode(value.code)) {
      throw new TypeError(`invalid activation unavailability code for ${targetKey(target)}`)
    }
    const rawEvidence = readBoundedArray(
      value.evidenceDigests,
      MAX_EVIDENCE_PER_ENTRY,
      `activation evidence ${targetKey(target)}`,
    )
    const evidenceDigests = rawEvidence
      .map((item) => requireDigest(item, `activation evidence ${targetKey(target)}`))
      .sort()
    if (evidenceDigests.length === 0) {
      throw new TypeError(`unavailable activation ${targetKey(target)} requires evidence`)
    }
    for (let evidenceIndex = 1; evidenceIndex < evidenceDigests.length; evidenceIndex += 1) {
      if (evidenceDigests[evidenceIndex - 1] === evidenceDigests[evidenceIndex]) {
        throw new TypeError(`duplicate activation evidence for ${targetKey(target)}`)
      }
    }
    disposition = Object.freeze({
      state: 'unavailable' as const,
      code: value.code,
      evidenceDigests: Object.freeze(evidenceDigests),
    })
  } else {
    throw new TypeError(`invalid activation disposition state for ${targetKey(target)}`)
  }
  return Object.freeze({ target, requestDigest, disposition })
}

function normalizeTarget(input: unknown): RunTargetIdentity {
  const kind = readDataField(input, 'kind', 'activation target')
  if (kind === 'flow') {
    const value = readClosedRecord(input, ['kind', 'path'], 'Flow target')
    if (typeof value.path !== 'string') throw new TypeError('Flow target path must be a string')
    return Object.freeze({
      kind: 'flow' as const,
      path: normalizeProjectPath(value.path, 'Flow target'),
    })
  }
  if (kind === 'binding') {
    const value = readClosedRecord(input, ['kind', 'id'], 'Binding target')
    if (typeof value.id !== 'string' || !LOCAL_NAME.test(value.id) || value.id.length > 64) {
      throw new TypeError('Binding target has an invalid LocalName')
    }
    return Object.freeze({ kind: 'binding' as const, id: value.id })
  }
  throw new TypeError('activation target must be a Flow or Binding reference')
}

function normalizeExtension(input: unknown, label: string): PrivateExtensionObservation {
  const value = readClosedRecord(input, ['artifactDigest', 'revision'], label)
  if (typeof value.revision !== 'string' || !REVISION.test(value.revision)) {
    throw new TypeError(`${label} revision has invalid syntax`)
  }
  return Object.freeze({
    artifactDigest: requireDigest(value.artifactDigest, `${label} artifact`),
    revision: value.revision,
  })
}

function normalizeRuntimePredicates(input: unknown): readonly [] {
  const values = readBoundedArray(input, 0, 'runtime predicates')
  if (values.length !== 0) throw new TypeError('public runtime predicates are not defined')
  return Object.freeze([])
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw new TypeError(
      `${label} digest must be sha256: followed by 64 lowercase hexadecimal digits`,
    )
  }
  return value
}

function isUnavailableCode(value: unknown): value is PrivateActivationUnavailableCode {
  return ['RUNTIME_UNAVAILABLE', 'SANDBOX_UNAVAILABLE'].includes(value as string)
}

function compareTarget(left: RunTargetIdentity, right: RunTargetIdentity): number {
  const a = targetKey(left)
  const b = targetKey(right)
  return a < b ? -1 : a > b ? 1 : 0
}

export function privateActivationTargetKey(target: RunTargetIdentity): string {
  return targetKey(target)
}

function targetKey(target: RunTargetIdentity): string {
  return target.kind === 'flow' ? `flow\0${target.path}` : `binding\0${target.id}`
}

function readBoundedArray(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (value !== null && typeof value === 'object' && utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must not be a Proxy`)
  }
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be an ordinary array`)
  }
  if (value.length > maximum) throw new TypeError(`${label} exceeds ${maximum} members`)
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== value.length + 1 ||
    keys.some(
      (key) => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)),
    )
  ) {
    throw new TypeError(`${label} must not contain extra, symbolic, or sparse properties`)
  }
  const result: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label} must not be sparse or accessor-backed`)
    }
    result.push(descriptor.value)
  }
  return result
}

function readClosedRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  const record = requirePlainRecord(value, label)
  const keys = Reflect.ownKeys(record)
  if (
    keys.some((key) => typeof key !== 'string') ||
    keys.length !== fields.length ||
    fields.some((field) => !keys.includes(field))
  ) {
    throw new TypeError(`${label} must contain only ${fields.join(' and ')}`)
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const field of fields) result[field] = readDataField(record, field, label)
  return result
}

function readDataField(value: unknown, field: string, label: string): unknown {
  const record = requirePlainRecord(value, label)
  const descriptor = Object.getOwnPropertyDescriptor(record, field)
  if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
    throw new TypeError(`${label}.${field} must be an enumerable data property`)
  }
  return descriptor.value
}

function requirePlainRecord(value: unknown, label: string): object {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`${label} must be an object`)
  }
  if (utilTypes.isProxy(value)) throw new TypeError(`${label} must not be a Proxy`)
  if (Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }
  return value
}
