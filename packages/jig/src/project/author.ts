import type { JsonObject } from '../json.js'
import { JSON_1_LIMITS, validateJson1 } from '../json.js'
import { expectJsonObject, snapshotJson, snapshotJsonObject } from './author-value.js'
import { type GrantInput, type GrantPolicy, grantName, normalizeGrant } from './grants.js'
import {
  assertNoProjectPathCollisions,
  compareProjectPaths,
  normalizeProjectPath,
} from './paths.js'

const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const GLOB_CHARACTERS = /[*?\[\]{}]/

export interface DiscoverySource {
  readonly kind: 'discover'
  readonly roots: readonly string[]
}

export interface MembersSource {
  readonly kind: 'members'
  readonly paths: readonly string[]
}

export type ProjectSource = DiscoverySource | MembersSource
export type ProjectSourceInput = DiscoverySource | readonly string[]

export interface JigDefinition {
  readonly flows?: ProjectSource
  readonly bindings?: ProjectSource
  readonly grants?: ProjectSource
  readonly defaults?: readonly string[]
}

export interface JigDefinitionInput {
  readonly flows?: ProjectSourceInput
  readonly bindings?: ProjectSourceInput
  readonly grants?: ProjectSourceInput
  readonly defaults?: readonly string[]
}

export interface FlowRef {
  readonly kind: 'flow'
  readonly path: string
}

export interface BindingRef {
  readonly kind: 'binding'
  readonly id: string
}

export type RunTargetRef = FlowRef | BindingRef

export interface PackageBindingDefinition {
  readonly kind: 'package'
  readonly package: string
  readonly settings: JsonObject
  readonly slots: Readonly<Record<string, string | GrantPolicy>>
  readonly attachments?: Readonly<Record<string, string>>
}

export interface PackageBindingInput {
  readonly package: string
  readonly settings?: JsonObject
  readonly slots?: Readonly<Record<string, string | GrantInput>>
  readonly attachments?: Readonly<Record<string, string>>
}

export type BindingDefinition = PackageBindingDefinition

export function discover(roots: string | readonly string[]): DiscoverySource {
  const values = typeof roots === 'string' ? [roots] : snapshotStringArray(roots, 'roots')
  if (values.length === 0) throw new TypeError('discover() requires at least one root')
  return record({
    kind: 'discover',
    roots: normalizeUniquePaths(values, 'root', true),
  }) as unknown as DiscoverySource
}

export function defineJig(input: JigDefinitionInput): JigDefinition {
  return normalizeJig(input, false)
}

/** Evaluator-only canonical re-normalization; absent from the package root. */
export function normalizeJigDefinition(input: unknown): JigDefinition {
  return normalizeJig(input as JigDefinitionInput, true)
}

function normalizeJig(input: JigDefinitionInput, canonical: boolean): JigDefinition {
  const captured = snapshotJsonObject(input, 'Jig definition')
  assertClosedObject(captured, ['flows', 'bindings', 'grants', 'defaults'], 'Jig definition')
  const output: {
    flows?: ProjectSource
    bindings?: ProjectSource
    grants?: ProjectSource
    defaults?: readonly string[]
  } = {}
  if (Object.hasOwn(captured, 'flows')) {
    output.flows = normalizeSource(
      captured.flows as unknown as ProjectSourceInput,
      'flows',
      canonical,
    )
  }
  if (Object.hasOwn(captured, 'bindings')) {
    output.bindings = normalizeSource(
      captured.bindings as unknown as ProjectSourceInput,
      'bindings',
      canonical,
    )
  }
  if (Object.hasOwn(captured, 'grants')) {
    output.grants = normalizeSource(
      captured.grants as unknown as ProjectSourceInput,
      'grants',
      canonical,
    )
  }
  if (Object.hasOwn(captured, 'defaults')) {
    output.defaults = normalizeDefaults(captured.defaults)
  }
  return record(output) as unknown as JigDefinition
}

function normalizeDefaults(value: unknown): readonly string[] {
  const selections = snapshotStringArray(value, 'defaults')
  if (selections.length > 256) throw new TypeError('defaults exceed 256 entries')
  const targets = selections.map((selector) => {
    const target = parseRunTargetSelector(selector, 'default')
    return target.kind === 'flow' ? `flow:${target.path}` : `binding:${target.id}`
  })
  targets.sort(compareUtf8)
  for (let index = 1; index < targets.length; index += 1) {
    if (targets[index] === targets[index - 1]) {
      throw new TypeError(`defaults contain a duplicate target: ${targets[index]}`)
    }
  }
  return Object.freeze(targets)
}

export function defineBinding(input: PackageBindingInput): PackageBindingDefinition {
  return normalizeBinding(input, false)
}

export function flowRef(path: string): FlowRef {
  return record({
    kind: 'flow',
    path: normalizeProjectPath(path, 'Flow reference'),
  }) as unknown as FlowRef
}

export function bindingRef(id: string): BindingRef {
  return record({
    kind: 'binding',
    id: validateLocalName(id, 'Binding reference'),
  }) as unknown as BindingRef
}

/** Evaluator-only canonical re-normalization; absent from the package root. */
export function normalizePackageBindingDefinition(input: unknown): PackageBindingDefinition {
  return normalizeBinding(input as PackageBindingInput, true)
}

function normalizeBinding(
  input: PackageBindingInput,
  canonical: boolean,
): PackageBindingDefinition {
  const captured = snapshotJsonObject(input, 'Binding definition')
  assertClosedObject(
    captured,
    canonical
      ? ['kind', 'package', 'settings', 'slots', 'attachments']
      : ['package', 'settings', 'slots', 'attachments'],
    'Binding definition',
  )
  if (canonical && captured.kind !== 'package') {
    throw new TypeError('Binding kind must be package')
  }
  if (!Object.hasOwn(captured, 'package')) throw new TypeError('Binding package is required')
  const packagePath = normalizeProjectPath(captured.package, 'package')
  const settings = Object.hasOwn(captured, 'settings')
    ? expectJsonObject(captured.settings, 'settings')
    : emptyRecord()
  const slots = Object.hasOwn(captured, 'slots')
    ? normalizeFlowSlots(captured.slots)
    : emptyRecord<string>()
  const attachments = normalizeBindingAttachments(
    Object.hasOwn(captured, 'attachments') ? captured.attachments : {},
  )
  return record({
    kind: 'package',
    package: packagePath,
    settings,
    slots,
    ...(Object.keys(attachments).length === 0 ? {} : { attachments }),
  }) as unknown as PackageBindingDefinition
}

/** Inert project-relative selections, never authority to reopen live files at Run time. */
export function normalizeBindingAttachments(value: unknown): Readonly<Record<string, string>> {
  const input = snapshotJsonObject(value, 'attachments')
  if (Object.keys(input).length > 8) throw new TypeError('attachments exceed eight entries')
  const output: Record<string, string> = Object.create(null)
  for (const name of Object.keys(input).sort(compareUtf8)) {
    validateLocalName(name, 'attachment name')
    const path = normalizeProjectPath(input[name], `attachment ${name}`)
    if (path.split('/').some((part) => part.toLowerCase() === '.jig'))
      throw new TypeError('attachments cannot select protected Jig state')
    output[name] = path
  }
  return Object.freeze(output)
}

function normalizeFlowSlots(value: unknown): Readonly<Record<string, string | GrantPolicy>> {
  const input = snapshotJsonObject(value, 'slots')
  if (Object.keys(input).length > 256) {
    throw new TypeError('slots exceed 256 entries')
  }
  const output: Record<string, string | GrantPolicy> = Object.create(null)
  for (const name of Object.keys(input).sort(compareUtf8)) {
    validateLocalName(name, 'slot name')
    const value = input[name]
    if (typeof value !== 'string') {
      output[name] = normalizeGrant(value)
      continue
    }
    if (value.startsWith('grant:')) {
      output[name] = 'grant:' + grantName(value.slice(6))
      continue
    }
    const target = parseRunTargetSelector(value, `slot ${name}`)
    output[name] = target.kind === 'flow' ? `flow:${target.path}` : `binding:${target.id}`
  }
  return Object.freeze(output)
}

/** Internal selector parsing shared by authoring and exact project linking. */
export function parseRunTargetSelector(value: unknown, label: string): RunTargetRef {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a target selector`)
  if (value.startsWith('flow:')) return flowRef(normalizeProjectPath(value.slice(5), label))
  if (value.startsWith('binding:')) return bindingRef(validateLocalName(value.slice(8), label))
  throw new TypeError(`${label} must select flow:<path> or binding:<id>`)
}

function normalizeSource(
  value: ProjectSourceInput | MembersSource | undefined,
  field: string,
  canonical: boolean,
): ProjectSource {
  if (value === undefined) throw new TypeError(`${field} cannot be undefined`)
  if (isReadonlyArray(value)) {
    return record({
      kind: 'members',
      paths: normalizeUniquePaths(snapshotStringArray(value, field), `${field} member`, false),
    }) as unknown as MembersSource
  }
  if ((value as ProjectSource).kind === 'members') {
    if (!canonical) throw new TypeError(`${field} source must come from discover()`)
    const members = value as unknown as MembersSource
    assertClosedObject(members, ['kind', 'paths'], `${field} source`)
    return record({
      kind: 'members',
      paths: normalizeUniquePaths(
        snapshotStringArray(members.paths, `${field} paths`),
        `${field} member`,
        false,
      ),
    }) as unknown as MembersSource
  }
  assertClosedObject(value, ['kind', 'roots'], `${field} source`)
  if (value.kind !== 'discover') throw new TypeError(`${field} source has an invalid kind`)
  const roots = normalizeUniquePaths(
    snapshotStringArray(value.roots, `${field} roots`),
    `${field} root`,
    true,
  )
  if (roots.length === 0) throw new TypeError(`${field} discovery requires at least one root`)
  return record({ kind: 'discover', roots }) as unknown as DiscoverySource
}

function normalizeUniquePaths(
  values: readonly unknown[],
  label: string,
  rejectGlob: boolean,
): readonly string[] {
  if (values.length > JSON_1_LIMITS.containerEntries) {
    throw new TypeError(`${label} values exceed the JSON/1 container bound`)
  }
  const paths = values.map((value) => {
    const path = normalizeProjectPath(value, label)
    if (rejectGlob && GLOB_CHARACTERS.test(path)) {
      throw new TypeError(`${label} cannot contain glob characters`)
    }
    return path
  })
  paths.sort(compareProjectPaths)
  assertNoProjectPathCollisions(paths, label)
  return Object.freeze(paths)
}

function validateLocalName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 64 || !LOCAL_NAME.test(value)) {
    throw new TypeError(`${label} must be a LocalName`)
  }
  return value
}

function assertRecord<T extends object>(value: T | undefined, label: string): T {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} cannot contain symbol properties`)
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`)
    }
  }
  return value
}

function assertClosedObject<T extends object>(
  value: T,
  allowed: readonly string[],
  label: string,
): void {
  const object = assertRecord(value, label)
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(object)) {
    if (!allowedSet.has(key)) throw new TypeError(`${label} has unknown field ${key}`)
  }
}

function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort(compareUtf8)
}

function snapshotStringArray(value: unknown, label: string): readonly string[] {
  const snapshot = snapshotJson(value, label)
  validateJson1(snapshot)
  if (!Array.isArray(snapshot) || snapshot.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${label} must be an array of strings`)
  }
  return snapshot as readonly string[]
}

function emptyRecord<T>(): Readonly<Record<string, T>> {
  return Object.freeze(Object.create(null) as Record<string, T>)
}

function record<T extends object>(value: T): Readonly<T> {
  const output = Object.create(null) as Record<string, unknown>
  for (const key of sortedKeys(value)) {
    Object.defineProperty(output, key, {
      value: (value as Record<string, unknown>)[key],
      enumerable: true,
      writable: false,
      configurable: false,
    })
  }
  return Object.freeze(output) as Readonly<T>
}

function compareUtf8(left: string, right: string): number {
  return compareProjectPaths(left, right)
}
