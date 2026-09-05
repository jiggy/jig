import { createHash } from 'node:crypto'

import { invalid } from '../diagnostics.js'
import { canonicalJson, decodeJson1, Json1Error, type JsonObject, type JsonValue } from '../json.js'
import {
  compileEmbeddedSchemas,
  type CompiledSchema,
  type EmbeddedSchemaSource,
} from '../schema/index.js'

export const CAPABILITY_CONTRACT_SCHEMA =
  'https://flow.jig.md/schemas/capability-contract-1.schema.json'

export const CAPABILITY_CONTRACT_LIMITS = Object.freeze({
  bytes: 262_144,
  methods: 256,
  errorsPerMethod: 128,
  definitions: 1_024,
})

const DOMAIN = Buffer.from('FLOW-Capability-Contract/1\0', 'ascii')
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DEFINITION_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const PATH_SEGMENT = /^[a-z0-9._~-]+$/
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

export type CapabilitySchema = boolean | JsonObject

export interface CapabilityMethodDescriptor {
  readonly input: CapabilitySchema
  readonly output: CapabilitySchema
  readonly errors: Readonly<Record<string, CapabilitySchema>>
}

export interface CapabilityContractDescriptor {
  readonly $schema: typeof CAPABILITY_CONTRACT_SCHEMA
  readonly flowCapabilityContract: 1
  readonly id: string
  readonly version: string
  readonly methods: Readonly<Record<string, CapabilityMethodDescriptor>>
  readonly $defs?: JsonObject
}

export interface ParsedCapabilityContract {
  readonly descriptor: CapabilityContractDescriptor
  readonly digest: string
  /** Compiled method and error schemas keyed by their descriptor-root RFC 6901 pointer. */
  readonly schemas: ReadonlyMap<string, CompiledSchema>
}

/** Parse, structurally validate, compile, and identify one Capability Contract/1 descriptor. */
export function parseCapabilityContract(
  bytes: Uint8Array,
  path = 'capability contract',
): ParsedCapabilityContract {
  if (bytes.byteLength > CAPABILITY_CONTRACT_LIMITS.bytes) {
    invalid(
      'CAPABILITY_LIMIT',
      `capability descriptor exceeds ${CAPABILITY_CONTRACT_LIMITS.bytes} bytes`,
      path,
    )
  }

  let value: JsonValue
  try {
    value = decodeJson1(bytes)
  } catch (error) {
    if (error instanceof Json1Error) {
      invalid('CAPABILITY_INVALID_JSON', error.message, path)
    }
    throw error
  }

  const root = requireObject(value, 'descriptor', path)
  assertExactFields(
    root,
    new Set(['$schema', 'flowCapabilityContract', 'id', 'version', 'methods', '$defs']),
    'descriptor',
    path,
  )
  if (root.$schema !== CAPABILITY_CONTRACT_SCHEMA) {
    invalid('CAPABILITY_FIELD', `descriptor.$schema must be ${CAPABILITY_CONTRACT_SCHEMA}`, path)
  }
  if (root.flowCapabilityContract !== 1) {
    invalid('CAPABILITY_FIELD', 'descriptor.flowCapabilityContract must be the integer 1', path)
  }
  if (typeof root.id !== 'string' || !isCapabilityContractId(root.id)) {
    invalid('CAPABILITY_ID', 'descriptor.id is not a canonical Capability Contract/1 ID', path)
  }
  if (typeof root.version !== 'string' || !isCapabilityContractVersion(root.version)) {
    invalid('CAPABILITY_VERSION', 'descriptor.version is not stable SemVer core', path)
  }

  const methodsObject = requireObject(root.methods, 'descriptor.methods', path)
  const methodEntries = Object.entries(methodsObject)
  if (methodEntries.length < 1 || methodEntries.length > CAPABILITY_CONTRACT_LIMITS.methods) {
    invalid(
      'CAPABILITY_LIMIT',
      `descriptor.methods must contain 1-${CAPABILITY_CONTRACT_LIMITS.methods} methods`,
      path,
    )
  }

  let definitions: JsonObject | undefined
  if (root.$defs !== undefined) {
    definitions = requireObject(root.$defs, 'descriptor.$defs', path)
    const definitionEntries = Object.entries(definitions)
    if (definitionEntries.length > CAPABILITY_CONTRACT_LIMITS.definitions) {
      invalid(
        'CAPABILITY_LIMIT',
        `descriptor.$defs exceeds ${CAPABILITY_CONTRACT_LIMITS.definitions} definitions`,
        path,
      )
    }
    for (const [name, schema] of definitionEntries) {
      if (!DEFINITION_NAME.test(name)) {
        invalid(
          'CAPABILITY_DEFINITION_NAME',
          `invalid definition name ${JSON.stringify(name)}`,
          path,
        )
      }
      requireSchema(schema, `descriptor.$defs.${name}`, path)
    }
  }

  const schemaSources: EmbeddedSchemaSource[] = []
  const methods: Record<string, CapabilityMethodDescriptor> = Object.create(null) as Record<
    string,
    CapabilityMethodDescriptor
  >
  for (const [name, methodValue] of methodEntries) {
    requireLocalName(name, `method ${JSON.stringify(name)}`, path)
    const method = requireObject(methodValue, `descriptor.methods.${name}`, path)
    assertExactFields(
      method,
      new Set(['input', 'output', 'errors']),
      `descriptor.methods.${name}`,
      path,
    )
    if (
      !Object.hasOwn(method, 'input') ||
      !Object.hasOwn(method, 'output') ||
      !Object.hasOwn(method, 'errors')
    ) {
      invalid(
        'CAPABILITY_METHOD',
        `descriptor.methods.${name} must contain input, output, and errors`,
        path,
      )
    }
    const input = requireSchema(method.input!, `descriptor.methods.${name}.input`, path)
    const output = requireSchema(method.output!, `descriptor.methods.${name}.output`, path)
    const errorsObject = requireObject(method.errors!, `descriptor.methods.${name}.errors`, path)
    const errorEntries = Object.entries(errorsObject)
    if (errorEntries.length > CAPABILITY_CONTRACT_LIMITS.errorsPerMethod) {
      invalid(
        'CAPABILITY_LIMIT',
        `descriptor.methods.${name}.errors exceeds ${CAPABILITY_CONTRACT_LIMITS.errorsPerMethod} errors`,
        path,
      )
    }
    const errors: Record<string, CapabilitySchema> = Object.create(null) as Record<
      string,
      CapabilitySchema
    >
    for (const [errorName, errorSchemaValue] of errorEntries) {
      requireLocalName(errorName, `error ${JSON.stringify(errorName)}`, path)
      const errorSchema = requireSchema(
        errorSchemaValue,
        `descriptor.methods.${name}.errors.${errorName}`,
        path,
      )
      errors[errorName] = errorSchema
      schemaSources.push({
        pointer: `/methods/${name}/errors/${errorName}`,
        schema: errorSchema,
      })
    }
    methods[name] = { input, output, errors }
    schemaSources.push(
      { pointer: `/methods/${name}/input`, schema: input },
      { pointer: `/methods/${name}/output`, schema: output },
    )
  }

  const descriptor: CapabilityContractDescriptor = {
    $schema: CAPABILITY_CONTRACT_SCHEMA,
    flowCapabilityContract: 1,
    id: root.id,
    version: root.version,
    methods,
    ...(definitions === undefined ? {} : { $defs: definitions }),
  }
  deepFreezeJson(descriptor as unknown as JsonValue)
  const schemas = compileEmbeddedSchemas(schemaSources, {
    path,
    ...(definitions === undefined ? {} : { rootDefs: definitions }),
  })

  return Object.freeze({
    descriptor,
    digest: capabilityContractDigest(descriptor),
    schemas,
  })
}

/** Calculate the domain-separated digest of a validated complete descriptor. */
export function capabilityContractDigest(descriptor: CapabilityContractDescriptor): string {
  const hash = createHash('sha256')
  hash.update(DOMAIN)
  hash.update(canonicalJson(descriptor as unknown as JsonValue))
  return `sha256:${hash.digest('hex')}`
}

/** Shared syntax check for already-parsed Capability Contract identities. */
export function isCapabilityContractId(value: string): boolean {
  if (!value.startsWith('https://')) return false
  const remainder = value.slice('https://'.length)
  const separator = remainder.indexOf('/')
  if (separator <= 0 || separator === remainder.length - 1) return false
  const authority = remainder.slice(0, separator)
  const labels = authority.split('.')
  if (labels.length < 2 || labels.some((label) => !DNS_LABEL.test(label))) return false
  if (
    labels.length === 4 &&
    labels.every((label) => /^[0-9]{1,3}$/.test(label) && Number(label) <= 255)
  )
    return false
  const segments = remainder.slice(separator + 1).split('/')
  return segments.every(
    (segment) => segment !== '.' && segment !== '..' && PATH_SEGMENT.test(segment),
  )
}

/** Capability Contract/1 uses stable SemVer core without ranges or labels. */
export function isCapabilityContractVersion(value: string): boolean {
  return VERSION.test(value)
}

function requireLocalName(value: string, field: string, path: string): void {
  if (value.length < 1 || value.length > 64 || !LOCAL_NAME.test(value)) {
    invalid('CAPABILITY_LOCAL_NAME', `${field} is not a LocalName`, path)
  }
}

function requireSchema(value: JsonValue, field: string, path: string): CapabilitySchema {
  if (typeof value === 'boolean' || isObject(value)) return value
  return invalid('CAPABILITY_SCHEMA', `${field} must be a Schema/1 object or boolean`, path)
}

function requireObject(value: JsonValue | undefined, field: string, path: string): JsonObject {
  if (!isObject(value)) invalid('CAPABILITY_FIELD', `${field} must be an object`, path)
  return value
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertExactFields(
  value: JsonObject,
  allowed: ReadonlySet<string>,
  field: string,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid('CAPABILITY_FIELD', `unknown ${field} field ${key}`, path)
  }
}

function deepFreezeJson(value: JsonValue): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return
  if (Array.isArray(value)) {
    for (const child of value) deepFreezeJson(child)
  } else {
    for (const child of Object.values(value)) deepFreezeJson(child)
  }
  Object.freeze(value)
}
