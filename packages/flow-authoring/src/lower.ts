import {
  getDocData,
  getMaxItemsAsNumeric,
  getMaxLengthAsNumeric,
  getMaxValueAsNumeric,
  getMaxValueExclusiveAsNumeric,
  getMinItemsAsNumeric,
  getMinLengthAsNumeric,
  getMinValueAsNumeric,
  getMinValueExclusiveAsNumeric,
  isArrayModelType,
  type ModelProperty,
  type Namespace,
  type Numeric,
  type Program,
  type Scalar,
  type Type,
} from '@typespec/compiler'
import { fail } from './errors.js'
import { channelKey, closedKey, invocationKey, oneOfKey, projectionKey } from './library.js'

export type Schema = {
  type?: string | string[]
  const?: string | number | boolean
  enum?: (string | number | boolean | null)[]
  $ref?: string
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: false
  items?: Schema
  anyOf?: Schema[]
  oneOf?: Schema[]
  description?: string
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
}
export interface Descriptor {
  $schema: string
  $defs: Record<string, Schema>
  input: Schema
  result: Schema
  outcomes?: Record<string, string>
  id?: string
  version?: string
  features?: Record<string, string>
  channels?: Record<string, ChannelPort>
}
interface ChannelPort {
  direction: 'send' | 'receive'
  contract: string
  required?: boolean
  delivery?: 'direct' | 'broadcast'
  start?: 'beginning' | 'suffix'
}
interface ChannelDescriptor {
  $schema: string
  id: string
  version: string
  semantics: string
  item: Schema
  $defs: Record<string, Schema>
}
export const schemaId = 'https://flow.jig.md/schemas/schema-1.json'
export const contractId = 'https://flow.jig.md/schemas/invocation-contract-1.schema.json'
const channelId = 'https://flow.jig.md/schemas/channel-contract-1.schema.json'
const definitionName = /^[A-Za-z][A-Za-z0-9]{0,63}(?![\s\S])/
const reservedTypes = new Set(
  'Array FlowInput FlowResult any unknown never undefined string number boolean bigint symbol object void null true false default import export class enum extends interface type break case catch const continue debugger delete do else finally for function if in instanceof new return super switch this throw try typeof var while with yield let static await implements private protected public package infer keyof readonly unique is asserts as satisfies abstract declare namespace module require global'.split(
    ' ',
  ),
)
const localName = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/
const getters = [
  ['minLength', getMinLengthAsNumeric],
  ['maxLength', getMaxLengthAsNumeric],
  ['minItems', getMinItemsAsNumeric],
  ['maxItems', getMaxItemsAsNumeric],
  ['minimum', getMinValueAsNumeric],
  ['maximum', getMaxValueAsNumeric],
  ['exclusiveMinimum', getMinValueExclusiveAsNumeric],
  ['exclusiveMaximum', getMaxValueExclusiveAsNumeric],
] as const

function number(value: number | Numeric, target: Type): number {
  const n = typeof value === 'number' ? value : value.asNumber()
  if (n === null || !Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n))) {
    fail('SOURCE_UNSUPPORTED', 'This number cannot be represented exactly within JSON/1.', target)
  }
  return n === 0 ? 0 : n!
}

export function lower(program: Program) {
  const entries = [...program.stateMap(invocationKey)]
  if (entries.length !== 1)
    fail('SOURCE_INVALID', 'Declare exactly one @invocation on a namespace.')
  const [owner, invocation] = entries[0] as [
    Namespace,
    {
      input: Type
      result: Type
      options: Record<string, unknown>
    },
  ]
  const globals = program.getGlobalNamespaceType()
  if (owner.models.size + owner.unions.size > 1024) {
    fail('SCHEMA_LIMIT', 'The descriptor supports at most 1024 shared definitions.', owner)
  }
  if (
    owner.namespace !== globals ||
    owner.namespaces.size ||
    [...globals.namespaces.keys()].some((n) => !['FLOW', 'TypeSpec', owner.name].includes(n)) ||
    globals.models.size ||
    globals.scalars.size ||
    globals.unions.size
  ) {
    fail(
      'SOURCE_UNSUPPORTED',
      'Use one top-level invocation namespace for all authored models.',
      owner,
    )
  }
  const opts = invocation.options
  if (
    !opts ||
    typeof opts !== 'object' ||
    Array.isArray(opts) ||
    Object.keys(opts).some(
      (k) => !['outcomes', 'id', 'version', 'features', 'channels'].includes(k),
    )
  ) {
    fail(
      'SOURCE_UNSUPPORTED',
      'Invocation options support outcomes, id/version, optional features and named channel ports.',
      owner,
    )
  }
  if (opts.id !== undefined || opts.version !== undefined || opts.features !== undefined)
    identity(opts, owner)
  if (opts.features !== undefined) {
    const features = record(opts.features, owner, 'Feature catalog')
    if (
      Object.keys(features).length > 256 ||
      Object.entries(features).some(
        ([name, description]) =>
          !localName.test(name) ||
          name.length > 64 ||
          typeof description !== 'string' ||
          [...description].length < 1 ||
          [...description].length > 16384,
      )
    )
      fail(
        'SOURCE_INVALID',
        'Features must map at most 256 LocalNames to descriptions of 1–16384 Unicode scalars.',
        owner,
      )
  }
  const ports: Record<string, ChannelPort> = Object.create(null)
  if (opts.channels !== undefined) {
    const channels = record(opts.channels, owner, 'channels')
    if (Object.keys(channels).length > 256) fail('SOURCE_LIMIT', 'Too many channel ports.', owner)
    for (const [name, value] of Object.entries(channels)) {
      const port = record(value, owner, 'channel port')
      if (
        !localName.test(name) ||
        name.length > 64 ||
        Object.keys(port).some(
          (key) => !['direction', 'contract', 'required', 'delivery', 'start'].includes(key),
        ) ||
        !['send', 'receive'].includes(port.direction as string) ||
        typeof port.contract !== 'string' ||
        !/^\.\/[a-z][a-z0-9-]*\.channel\.json(?![\s\S])/.test(port.contract) ||
        (port.required !== undefined && typeof port.required !== 'boolean') ||
        (port.delivery !== undefined &&
          !['direct', 'broadcast'].includes(port.delivery as string)) ||
        (port.start !== undefined &&
          (port.direction !== 'receive' || !['beginning', 'suffix'].includes(port.start as string)))
      )
        fail(
          'SOURCE_INVALID',
          'Channel ports require a direction and a generated ./name.channel.json contract.',
          owner,
        )
      ports[name] = port as unknown as ChannelPort
    }
  }
  if (opts.outcomes !== undefined) {
    const outcomes = opts.outcomes
    if (
      !outcomes ||
      typeof outcomes !== 'object' ||
      Array.isArray(outcomes) ||
      Object.keys(outcomes).length > 256 ||
      Object.entries(outcomes).some(
        ([k, v]) =>
          !localName.test(k) ||
          ['done', 'failed', 'cancelled', 'error'].includes(k) ||
          typeof v !== 'string' ||
          [...v].length < 1 ||
          [...v].length > 16384,
      )
    ) {
      fail(
        'SOURCE_INVALID',
        'Outcomes must map permitted names to nonempty bounded descriptions.',
        owner,
      )
    }
  }
  const definitions: Record<string, Schema> = Object.create(null)
  const origins = new WeakMap<Schema, Type>()
  const pending = new Set<Type>()
  let count = 0
  const authored = (t: Type) => 'namespace' in t && t.namespace === owner
  const named = (t: Type): t is Type & { name: string } =>
    authored(t) && (t.kind === 'Model' || t.kind === 'Union') && !!t.name

  function constraints(schema: Schema, target: Scalar | ModelProperty) {
    for (const [key, getter] of getters) {
      const value = getter(program, target)
      if (value === undefined) continue
      const n = number(value, target)
      const previous = schema[key]
      // Derived constraints can narrow a base scalar, never erase its bounds.
      schema[key] =
        previous === undefined
          ? n
          : key.startsWith('max')
            ? Math.min(previous, n)
            : key === 'exclusiveMaximum'
              ? Math.min(previous, n)
              : Math.max(previous, n)
    }
    return schema
  }

  function emit(t: Type, depth = 1, expandNamed = false): Schema {
    if (depth > 64 || ++count > 4096)
      fail('SCHEMA_LIMIT', 'The emitted schema exceeds its graph limits.', t)
    if (pending.has(t)) fail('SOURCE_UNSUPPORTED', 'Recursive model graphs are not supported.', t)
    if (named(t) && !expandNamed) {
      if (!definitionName.test(t.name) || reservedTypes.has(t.name)) {
        fail(
          'SOURCE_UNSUPPORTED',
          'Use a distinct Schema/1 definition name (FlowInput and FlowResult are reserved).',
          t,
        )
      }
      if (!definitions[t.name]) {
        // Namespace maps distinguish model kinds; prevent cross-kind definition collision.
        const collision = [...owner.models.values(), ...owner.unions.values()].filter(
          (v) => v.name === t.name,
        )
        if (collision.length !== 1) fail('SOURCE_INVALID', 'Definition name collision.', t)
        definitions[t.name] = emit(t, depth + 1, true)
      }
      const ref = { $ref: `#/$defs/${t.name}` }
      origins.set(ref, t)
      return ref
    }
    pending.add(t)
    let out: Schema
    switch (t.kind) {
      case 'ModelProperty':
        if (t.defaultValue) fail('SOURCE_UNSUPPORTED', 'Defaults are not supported.', t)
        out = constraints({ ...emit(t.type, depth + 1) }, t)
        break
      case 'Scalar':
        if (authored(t)) {
          if (!t.baseScalar)
            fail('SOURCE_UNSUPPORTED', 'A scalar needs a supported primitive base.', t)
          out = constraints({ ...emit(t.baseScalar, depth + 1) }, t)
        } else if (
          t.namespace?.name === 'TypeSpec' &&
          ['string', 'integer', 'float64', 'boolean'].includes(t.name)
        ) {
          out = { type: t.name === 'float64' ? 'number' : t.name }
        } else {
          fail(
            'SOURCE_UNSUPPORTED',
            `Scalar ${t.name} is not supported; use string, integer, float64 or boolean.`,
            t,
          )
        }
        break
      case 'String':
        out = { const: t.value }
        break
      case 'Number':
        out = { const: number(t.numericValue, t) }
        break
      case 'Boolean':
        out = { const: t.value }
        break
      case 'Intrinsic':
        if (t.name !== 'null') fail('SOURCE_UNSUPPORTED', `Intrinsic ${t.name} is unsupported.`, t)
        out = { type: 'null' }
        break
      case 'Model':
        if (isArrayModelType(program, t)) {
          out = { type: 'array', items: emit(t.indexer.value, depth + 1) }
        } else {
          if (!authored(t) || !program.stateMap(closedKey).has(t) || t.indexer) {
            fail('SOURCE_UNSUPPORTED', 'Object models must be authored and explicitly @closed.', t)
          }
          const properties: Record<string, Schema> = Object.create(null)
          const required: string[] = []
          for (const [name, property] of t.properties) {
            properties[name] = emit(property, depth + 1)
            if (!property.optional) required.push(name)
          }
          out = { type: 'object', properties, required, additionalProperties: false }
        }
        break
      case 'Union': {
        const variants = [...t.variants.values()].map((v) => emit(v.type, depth + 1))
        if (!variants.length) fail('SOURCE_UNSUPPORTED', 'Empty unions are not supported.', t)
        if (program.stateMap(oneOfKey).has(t)) out = { oneOf: variants }
        else if (
          variants.every((v) => Object.keys(v).length === 1 && typeof v.const === 'string')
        ) {
          out = { enum: [...new Set(variants.map((v) => v.const!))] }
        } else out = { anyOf: variants }
        break
      }
      default:
        fail('SOURCE_UNSUPPORTED', `Type ${t.kind} is outside this profile.`, t)
    }
    const doc = getDocData(program, t)
    if (doc?.source === 'decorator') out.description = doc.value
    pending.delete(t)
    origins.set(out, t)
    return out
  }

  // Validate unused declarations too; otherwise unsupported constructs can hide.
  for (const t of [...owner.models.values(), ...owner.scalars.values(), ...owner.unions.values()])
    emit(t)
  const descriptor: Descriptor = {
    $schema: contractId,
    $defs: definitions,
    input: emit(invocation.input),
    result: emit(invocation.result),
    ...(opts.outcomes === undefined ? {} : { outcomes: opts.outcomes as Record<string, string> }),
    ...(opts.id === undefined ? {} : { id: opts.id as string, version: opts.version as string }),
    ...(opts.features === undefined ? {} : { features: opts.features as Record<string, string> }),
    ...(opts.channels === undefined ? {} : { channels: ports }),
  }
  const channels: Record<string, ChannelDescriptor> = Object.create(null)
  for (const [type, value] of program.stateMap(channelKey)) {
    const { path, options } = value as { path: string; options: unknown }
    if (
      !authored(type) ||
      typeof path !== 'string' ||
      !/^\.\/[a-z][a-z0-9-]*\.channel\.json(?![\s\S])/.test(path)
    )
      fail('SOURCE_INVALID', 'Channel outputs use a root ./name.channel.json path.', type)
    const metadata = record(options, type, 'channel options')
    identity(metadata, type)
    if (
      Object.keys(metadata).some((key) => !['id', 'version', 'semantics'].includes(key)) ||
      typeof metadata.semantics !== 'string' ||
      !metadata.semantics.length ||
      Buffer.byteLength(metadata.semantics) > 16384
    )
      fail('SOURCE_INVALID', 'Channel options require id, version and bounded semantics.', type)
    const file = path.slice(2)
    if (Object.hasOwn(channels, file))
      fail('SOURCE_INVALID', 'Two channels select the same output path.', type, file)
    channels[file] = {
      $schema: channelId,
      id: metadata.id as string,
      version: metadata.version as string,
      semantics: metadata.semantics,
      item: emit(type),
      $defs: reachableDefinitions(emit(type), definitions),
    }
  }
  for (const port of Object.values(ports)) {
    if (!Object.hasOwn(channels, port.contract.slice(2)))
      fail(
        'SOURCE_INVALID',
        'Every port must reference a channel generated from this source.',
        owner,
        port.contract,
      )
  }
  const projections: Record<string, { $schema: string } & Schema> = Object.create(null)
  for (const [type, path] of program.stateMap(projectionKey)) {
    if (
      !authored(type) ||
      typeof path !== 'string' ||
      !/^\.\/[a-z][a-z0-9-]*\.schema\.json(?![\s\S])/.test(path)
    ) {
      fail('SOURCE_UNSUPPORTED', 'Agent outputs use a root ./name.schema.json path.', type)
    }
    const file = path.slice(2)
    if (['input.schema.json', 'result.schema.json', 'settings.schema.json'].includes(file))
      fail(
        'SOURCE_INVALID',
        'Agent projections cannot replace reserved package schema owners.',
        type,
        file,
      )
    if (projections[file])
      fail('SOURCE_INVALID', 'Two projections select the same output path.', type, file)
    const expanded = expand(emit(type), definitions, origins, file)
    checkAgent(expanded, origins, file)
    projections[file] = { $schema: schemaId, ...expanded }
  }
  if (Object.keys(channels).length + Object.keys(projections).length > 63)
    fail('SOURCE_LIMIT', 'At most 63 channel and Agent schema outputs are supported.', owner)
  const identities = new Map<string, string>()
  for (const channel of Object.values(channels)) {
    const key = `${channel.id}\0${channel.version}`
    const shape = JSON.stringify(channel)
    if (identities.has(key) && identities.get(key) !== shape)
      fail('SOURCE_INVALID', 'Channel identity has conflicting declarations.', owner)
    identities.set(key, shape)
  }
  return { descriptor, projections, channels, declarations: declarations(descriptor) }
}

// A channel's identity must not change when unrelated invocation models change.
function reachableDefinitions(schema: Schema, definitions: Record<string, Schema>) {
  const selected: Record<string, Schema> = Object.create(null)
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return
    const ref = (value as Schema).$ref
    if (ref) {
      const name = ref.slice('#/$defs/'.length)
      if (!Object.hasOwn(selected, name)) {
        selected[name] = definitions[name]!
        visit(selected[name])
      }
    }
    for (const child of Object.values(value)) visit(child)
  }
  visit(schema)
  return selected
}

function record(value: unknown, target: Type, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('SOURCE_INVALID', `${label} must be an explicit record.`, target)
  return value as Record<string, unknown>
}

function identity(value: Record<string, unknown>, target: Type): void {
  const id = value.id
  if (
    typeof id !== 'string' ||
    !/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\/[a-z0-9._~-]+)+(?![\s\S])/.test(
      id,
    ) ||
    id
      .slice(8)
      .split('/')
      .slice(1)
      .some((part) => part === '.' || part === '..') ||
    isIpHost(id) ||
    typeof value.version !== 'string' ||
    !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?![\s\S])/.test(value.version)
  )
    fail('SOURCE_INVALID', 'Supply an exact FLOW HTTPS contract id and version together.', target)
}

function isIpHost(id: string): boolean {
  const labels = id.slice(8).split('/')[0]!.split('.')
  return labels.length === 4 && labels.every((s) => /^[0-9]{1,3}$/.test(s) && Number(s) <= 255)
}

function expand(
  schema: Schema,
  definitions: Record<string, Schema>,
  origins: WeakMap<Schema, Type>,
  output: string,
): Schema {
  let count = 0
  function walk(s: Schema, depth: number): Schema {
    const origin = origins.get(s)
    if (++count > 4096 || depth > 64)
      fail('PROJECTION_LIMIT', 'Expanded projection exceeds its resource limits.', origin, output)
    let result: Schema
    if (s.$ref) {
      const { $ref, ...rest } = s
      const target = definitions[$ref.slice('#/$defs/'.length)]
      if (!target) fail('PROJECTION_INVALID', 'Unresolved projection definition.', origin, output)
      result = { ...walk(target, depth + 1), ...rest }
    } else {
      result = { ...s }
      if (s.properties)
        result.properties = Object.fromEntries(
          Object.entries(s.properties).map(([k, v]) => [k, walk(v, depth + 1)]),
        )
      if (s.items) result.items = walk(s.items, depth + 1)
      if (s.anyOf) result.anyOf = s.anyOf.map((v) => walk(v, depth + 1))
      if (s.oneOf) result.oneOf = s.oneOf.map((v) => walk(v, depth + 1))
    }
    if (typeof result.const === 'string') {
      const { const: literal, ...rest } = result
      result = { ...rest, type: 'string', enum: [literal] }
    } else if (result.enum?.every((v) => typeof v === 'string')) {
      result = { ...result, type: 'string' }
    }
    if (result.anyOf?.length === 2) {
      const nil = result.anyOf.find((v) => v.type === 'null' && Object.keys(v).length === 1)
      const value = result.anyOf.find((v) => v !== nil)
      if (nil && value && (value.type === 'string' || value.type === 'integer')) {
        const { anyOf: _branches, ...rest } = result
        result = {
          ...value,
          ...rest,
          type: [value.type, 'null'],
          ...(value.enum ? { enum: [...value.enum, null] } : {}),
        }
      }
    }
    if (origin) origins.set(result, origin)
    return result
  }
  return walk(schema, 1)
}

function checkAgent(root: Schema, origins: WeakMap<Schema, Type>, output: string) {
  let properties = 0,
    enums = 0,
    characters = 0
  function walk(s: Schema, depth: number) {
    const target = origins.get(s)
    const reject = (why: string): never => fail('AGENT_SCHEMA_UNSUPPORTED', why, target, output)
    if (depth > 8) reject('Agent schemas allow at most eight levels.')
    const keys = new Set(['type', 'description'])
    const baseType =
      Array.isArray(s.type) && s.type.length === 2 && s.type[1] === 'null' ? s.type[0] : s.type
    if (s.type === 'object') {
      for (const k of ['properties', 'required', 'additionalProperties']) keys.add(k)
      const names = Object.keys(s.properties ?? {})
      properties += names.length
      characters += names.reduce((n, k) => n + [...k].length, 0)
      const optional = names.find((k) => !s.required?.includes(k))
      if (optional)
        fail(
          'AGENT_SCHEMA_UNSUPPORTED',
          `Optional property "${optional}" is not supported by the Agent profile.`,
          origins.get(s.properties![optional]!),
          output,
        )
      if (
        !names.length ||
        names.length > 32 ||
        properties > 128 ||
        s.additionalProperties !== false ||
        s.required?.length !== names.length ||
        names.some((k) => !s.required?.includes(k))
      ) {
        reject('Agent objects require 1–32 properties, all required and closed (128 total).')
      }
      for (const child of Object.values(s.properties!)) walk(child, depth + 1)
    } else if (s.type === 'array') {
      for (const k of ['items', 'minItems', 'maxItems']) keys.add(k)
      if (!s.items || !Number.isSafeInteger(s.maxItems) || s.maxItems! < 0 || s.maxItems! > 256) {
        reject('Agent arrays require maxItems between 0 and 256.')
      }
      walk(s.items!, depth + 1)
    } else if (baseType === 'string') {
      keys.add('enum')
    } else if (baseType !== 'integer') {
      reject('This type or union is outside the qualified Agent projection profile.')
    }
    if (Object.keys(s).some((k) => !keys.has(k))) {
      reject('A constraint cannot be represented in the Agent profile; it was not removed.')
    }
    if (s.enum) {
      if (
        !s.enum.length ||
        s.enum.some((v) => typeof v !== 'string' && !(v === null && Array.isArray(s.type)))
      )
        reject('Agent string enums must be nonempty string sets.')
      enums += s.enum.length
      const chars = s.enum.reduce<number>(
        (n, v) => n + (typeof v === 'string' ? [...v].length : 0),
        0,
      )
      characters += chars
      if (enums > 256 || (s.enum.length > 250 && chars > 15000))
        reject('Agent enum limits exceeded.')
    }
    if (characters > 120000) reject('Agent property/enum text limit exceeded.')
  }
  if (root.type !== 'object')
    fail(
      'AGENT_SCHEMA_UNSUPPORTED',
      'An Agent projection needs a closed object root.',
      origins.get(root),
      output,
    )
  walk(root, 1)
}

function declarations(descriptor: Descriptor): string {
  function render(s: Schema): string {
    if (s.$ref) return s.$ref.slice('#/$defs/'.length)
    if (s.const !== undefined) return JSON.stringify(s.const)
    if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ')
    if (s.anyOf || s.oneOf) return (s.anyOf ?? s.oneOf)!.map((v) => `(${render(v)})`).join(' | ')
    if (s.type === 'object')
      return `{ ${Object.entries(s.properties ?? {})
        .map(([k, v]) => `${JSON.stringify(k)}${s.required?.includes(k) ? '' : '?'}: ${render(v)};`)
        .join(' ')} }`
    if (s.type === 'array') return `Array<${render(s.items!)}>`
    if (s.type === 'integer' || s.type === 'number') return 'number'
    if (['string', 'boolean', 'null'].includes(s.type as string)) return s.type as string
    throw new Error('The lowered schema cannot be represented.')
  }
  return (
    '// Generated from the lowered FLOW contract. Bounds and exact validation remain runtime checks.\n' +
    Object.entries(descriptor.$defs)
      .map(([k, v]) => `export type ${k} = ${render(v)};\n`)
      .join('') +
    `export type FlowInput = ${render(descriptor.input)};\nexport type FlowResult = ${render(descriptor.result)};\n`
  )
}
