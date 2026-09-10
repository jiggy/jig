import { isContractId, isContractVersion } from '../contract-identity.js'
import {
  AGENT_RUN_CONTRACT_DIGEST,
  AGENT_RUN_CONTRACT_ID,
  AGENT_RUN_CONTRACT_VERSION,
} from '../internal/private-agent-run.js'
import {
  PROJECT_COMMAND_CONTRACT_DIGEST,
  PROJECT_COMMAND_CONTRACT_ID,
  PROJECT_COMMAND_CONTRACT_VERSION,
} from '../internal/private-project-command.js'
import {
  RUN_CHECKPOINT_CONTRACT_DIGEST,
  RUN_CHECKPOINT_CONTRACT_ID,
  RUN_CHECKPOINT_CONTRACT_VERSION,
} from '../internal/private-run-checkpoint.js'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import type { RunTargetIdentity } from './package-project.js'
import { normalizeProjectPath } from './paths.js'

export interface InvocationIdentity {
  readonly id: string
  readonly version: string
  readonly digest: string
}

export type InvocationRequirement = InvocationIdentity | Readonly<Record<string, never>>
export type NativeInvocation = 'agent' | 'project-command' | 'run-checkpoint'
export type InvocationSlot =
  | {
      readonly kind: 'flow'
      readonly target: RunTargetIdentity
      readonly contract?: InvocationIdentity
    }
  | {
      readonly kind: 'native'
      readonly native: NativeInvocation
      readonly contract: InvocationIdentity
    }
export type InvocationSlots = Readonly<Record<string, InvocationSlot>>

const NATIVE: Readonly<Record<NativeInvocation, InvocationIdentity>> = Object.freeze({
  agent: Object.freeze({
    id: AGENT_RUN_CONTRACT_ID,
    version: AGENT_RUN_CONTRACT_VERSION,
    digest: AGENT_RUN_CONTRACT_DIGEST,
  }),
  'project-command': Object.freeze({
    id: PROJECT_COMMAND_CONTRACT_ID,
    version: PROJECT_COMMAND_CONTRACT_VERSION,
    digest: PROJECT_COMMAND_CONTRACT_DIGEST,
  }),
  'run-checkpoint': Object.freeze({
    id: RUN_CHECKPOINT_CONTRACT_ID,
    version: RUN_CHECKPOINT_CONTRACT_VERSION,
    digest: RUN_CHECKPOINT_CONTRACT_DIGEST,
  }),
})

export function nativeInvocationKind(
  identity: InvocationRequirement,
): NativeInvocation | undefined {
  return (Object.keys(NATIVE) as NativeInvocation[]).find((name) =>
    sameInvocationIdentity(NATIVE[name], identity),
  )
}

export function isNativeInvocationId(id: string | undefined): boolean {
  return Object.values(NATIVE).some((identity) => identity.id === id)
}

export function sameInvocationIdentity(
  left: InvocationRequirement,
  right: InvocationRequirement,
): boolean {
  return (
    left.id !== undefined &&
    left.id === right.id &&
    left.version === right.version &&
    left.digest === right.digest
  )
}

/** Resolve only recognized native defaults. This does not qualify operator support. */
export function defaultInvocationSlots(
  uses: Readonly<Record<string, InvocationRequirement>>,
): InvocationSlots {
  return resolveInvocationSlots(uses, {})
}

/** Explicit selections always win or fail; only omitted native requirements have defaults. */
export function resolveInvocationSlots(
  uses: Readonly<Record<string, InvocationRequirement>>,
  targets: Readonly<Record<string, RunTargetIdentity>>,
): InvocationSlots {
  const slots: Record<string, InvocationSlot> = Object.create(null)
  for (const [name, target] of Object.entries(targets)) {
    const requirement = uses[name]
    slots[name] = Object.freeze({
      kind: 'flow',
      target,
      ...(requirement?.id === undefined ? {} : { contract: requirement as InvocationIdentity }),
    })
  }
  for (const [name, contract] of Object.entries(uses)) {
    if (Object.hasOwn(slots, name)) continue
    const native = nativeInvocationKind(contract)
    if (native === undefined)
      throw new TypeError(`slot ${name} requires an explicit matching Flow or Binding`)
    slots[name] = Object.freeze({ kind: 'native', native, contract: NATIVE[native] })
  }
  return normalizeInvocationSlots(slots)
}

export function flowSlotTargets(
  slots: InvocationSlots,
): Readonly<Record<string, RunTargetIdentity>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(slots).flatMap(([name, slot]) =>
        slot.kind === 'flow' ? [[name, slot.target]] : [],
      ),
    ),
  )
}

export function nativeSlotRoutes(
  slots: InvocationSlots,
): readonly Extract<InvocationSlot, { kind: 'native' }>[] {
  return Object.values(slots).filter(
    (slot): slot is Extract<InvocationSlot, { kind: 'native' }> => slot.kind === 'native',
  )
}

export function normalizeInvocationIdentity(value: unknown): InvocationIdentity {
  const item = object(value)
  exact(item, ['id', 'version', 'digest'])
  if (
    typeof item.id !== 'string' ||
    !isContractId(item.id) ||
    typeof item.version !== 'string' ||
    !isContractVersion(item.version) ||
    typeof item.digest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(item.digest) ||
    item.digest.length !== 71
  )
    throw new TypeError('invalid invocation interface identity')
  return Object.freeze({ id: item.id, version: item.version, digest: item.digest })
}

/** Decode the one persisted route map; no digest alone selects native authority. */
export function normalizeInvocationSlots(value: unknown): InvocationSlots {
  const input = object(decodeJson1(canonicalJson(value as JsonValue)))
  if (Object.keys(input).length > 256) throw new TypeError('invocation slots exceed 256 entries')
  const output: Record<string, InvocationSlot> = Object.create(null)
  const usedNative = new Set<NativeInvocation>()
  for (const name of Object.keys(input).sort()) {
    localName(name)
    const slot = object(input[name])
    if (slot.kind === 'native') {
      exact(slot, ['kind', 'native', 'contract'])
      const contract = normalizeInvocationIdentity(slot.contract)
      const native = nativeInvocationKind(contract)
      if (native === undefined || slot.native !== native || usedNative.has(native))
        throw new TypeError(
          `slot ${name} does not select one distinct supported native implementation`,
        )
      usedNative.add(native)
      output[name] = Object.freeze({ kind: 'native', native, contract })
    } else if (slot.kind === 'flow') {
      exact(slot, ['kind', 'target', ...(Object.hasOwn(slot, 'contract') ? ['contract'] : [])])
      const target = object(slot.target)
      let identity: RunTargetIdentity
      if (target.kind === 'flow') {
        exact(target, ['kind', 'path'])
        identity = Object.freeze({
          kind: 'flow',
          path: normalizeProjectPath(target.path, 'Flow slot target'),
        })
      } else if (target.kind === 'binding') {
        exact(target, ['kind', 'id'])
        identity = Object.freeze({ kind: 'binding', id: localName(target.id) })
      } else throw new TypeError('unknown Flow slot target')
      const contract =
        slot.contract === undefined ? undefined : normalizeInvocationIdentity(slot.contract)
      if (contract !== undefined && isNativeInvocationId(contract.id))
        throw new TypeError('native interfaces cannot be replaced by ordinary Flow targets')
      output[name] = Object.freeze({
        kind: 'flow',
        target: identity,
        ...(contract === undefined ? {} : { contract }),
      })
    } else throw new TypeError(`slot ${name} has an unknown implementation kind`)
  }
  return Object.freeze(output)
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('expected an invocation object')
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw new TypeError('unexpected invocation fields')
}
function localName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
    value.includes('\n')
  )
    throw new TypeError('invalid invocation LocalName')
  return value
}
