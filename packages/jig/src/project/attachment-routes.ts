import type {
  BindingAttachmentInterface,
  BindingAttachmentMap,
  BindingAttachmentMapping,
} from './author.js'
import type { GrantedSlot } from './grants.js'
import type { RunTargetIdentity } from './package-project.js'
export interface MappedFlowRoute {
  readonly kind: 'route'
  readonly target: RunTargetIdentity
  readonly attachments: BindingAttachmentMap
}
export type ProjectSlotTarget = RunTargetIdentity | GrantedSlot | MappedFlowRoute

// Negative end lookahead excludes a final newline accepted by JavaScript `$`.
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/

export function bindingAttachmentLocalName(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || !LOCAL_NAME.test(value))
    throw new TypeError('attachment route names must be lower-case LocalNames of 1–64 characters')
  return value
}

/** One canonical pure validator for authoring, lock and retained slot maps. */
export function normalizeBindingAttachmentMap(value: unknown): BindingAttachmentMap {
  const map = dataRecord(value, 8)
  const names = Object.keys(map).sort()
  if (names.length === 0) throw new TypeError('attachment route map must have 1–8 members')
  const result: Record<string, BindingAttachmentMapping> = Object.create(null)
  for (const name of names) {
    bindingAttachmentLocalName(name)
    const mapping = dataRecord(map[name], 2)
    if (Object.hasOwn(mapping, 'from')) {
      exact(mapping, ['from'])
      result[name] = Object.freeze({ from: bindingAttachmentLocalName(mapping.from) })
    } else if (Object.hasOwn(mapping, 'supplied')) {
      exact(mapping, ['supplied'])
      if (mapping.supplied !== 'read')
        throw new TypeError('supplied attachment route must require read access')
      result[name] = Object.freeze({ supplied: 'read' })
    } else {
      exact(mapping, ['create'])
      if (mapping.create !== true)
        throw new TypeError('created attachment route must select create: true')
      result[name] = Object.freeze({ create: true })
    }
  }
  return Object.freeze(result)
}

/** Revalidate the full map against both exact immediate-caller interfaces. */
export function validateBindingAttachmentMapForInterfaces(input: {
  readonly attachments: unknown
  readonly caller: BindingAttachmentInterface
  readonly child: BindingAttachmentInterface
}): BindingAttachmentMap {
  const attachments = normalizeBindingAttachmentMap(input.attachments)
  const caller = attachmentInterface(input.caller, false)
  const child = attachmentInterface(input.child, true)
  if (Object.keys(attachments).join('\0') !== Object.keys(child).sort().join('\0'))
    throw new TypeError('attachment route must supply every declared child port exactly once')
  for (const [name, mapping] of Object.entries(attachments)) {
    if ('from' in mapping) {
      if (child[name] !== 'read' || caller[mapping.from] !== 'read')
        throw new TypeError(
          'read attachment route requires declared read ports on caller and child',
        )
    } else if ('supplied' in mapping) {
      if (child[name] !== 'read')
        throw new TypeError('supplied attachment route requires a declared child read port')
    } else if (child[name] !== 'read-write')
      throw new TypeError('created attachment route requires a declared child read-write port')
  }
  return attachments
}

function attachmentInterface(value: unknown, child: boolean): BindingAttachmentInterface {
  const ports = dataRecord(value, 8)
  let writable = 0
  for (const [name, access] of Object.entries(ports)) {
    bindingAttachmentLocalName(name)
    if (access !== 'read' && access !== 'read-write')
      throw new TypeError('invalid declared attachment access')
    if (access === 'read-write' && ++writable > 1 && child)
      throw new TypeError('a mapped child can declare at most one writable attachment')
  }
  return ports as BindingAttachmentInterface
}

function dataRecord(value: unknown, maximum: number): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError('attachment route must be a plain data record')
  const keys = Reflect.ownKeys(value)
  if (keys.length > maximum || keys.some((name) => typeof name !== 'string'))
    throw new TypeError('attachment route record exceeds its closed field bound')
  const result: Record<string, unknown> = Object.create(null)
  for (const name of keys as string[]) {
    const field = Object.getOwnPropertyDescriptor(value, name)
    if (field === undefined || !Object.hasOwn(field, 'value') || !field.enumerable)
      throw new TypeError('attachment route cannot contain accessors or hidden fields')
    result[name] = field.value
  }
  return result
}

function exact(record: Record<string, unknown>, fields: readonly string[]) {
  if (Object.keys(record).sort().join('\0') !== [...fields].sort().join('\0'))
    throw new TypeError('attachment route mapping must contain exactly its declared fields')
}
