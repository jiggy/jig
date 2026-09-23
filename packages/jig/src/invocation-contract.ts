import { createHash } from 'node:crypto'

import {
  type ChannelDeclaration,
  type ParsedChannelContract,
  parseChannelContract,
  parseChannelDeclarations,
} from './channel-contract.js'
import { isContractId, isContractVersion } from './contract-identity.js'
import { invalid } from './diagnostics.js'
import {
  canonicalJson,
  decodeJson1,
  Json1Error,
  type JsonObject,
  type JsonValue,
  validateJson1,
} from './json.js'
import {
  type CompiledSchema,
  compileEmbeddedSchemas,
  type EmbeddedSchemaSource,
} from './schema/index.js'

export const INVOCATION_CONTRACT_SCHEMA =
  'https://flow.jig.md/schemas/invocation-contract-0.schema.json'
export const INVOCATION_CONTRACT_LIMITS = Object.freeze({
  bytes: 262_144,
  preimageBytes: 1_048_576,
  channelPaths: 64,
  operations: 256,
  features: 256,
  outcomes: 256,
  attachments: 256,
  definitions: 1_024,
})

const DOMAIN = Buffer.from('FLOW-Invocation-Contract/0\0', 'ascii')
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/
const RESERVED_OUTCOMES = new Set(['done', 'failed', 'cancelled', 'error'])
const OPERATION_FIELDS = ['input', 'result', 'outcomes', 'channels', 'attachments'] as const
const SHARED_FIELDS = ['$schema', 'id', 'version', '$defs']

export interface InvocationOperationDescriptor {
  readonly input?: boolean | JsonObject
  readonly result?: boolean | JsonObject
  readonly outcomes?: Readonly<Record<string, string>>
  readonly channels?: Readonly<Record<string, ChannelDeclaration>>
  readonly attachments?: Readonly<Record<string, 'read' | 'read-write'>>
}

export interface InvocationContractDescriptor extends InvocationOperationDescriptor {
  readonly $schema: typeof INVOCATION_CONTRACT_SCHEMA
  readonly id?: string
  readonly version?: string
  readonly $defs?: JsonObject
  /** Optional behavior vocabulary, valid only on an identified single-form contract. */
  readonly features?: Readonly<Record<string, string>>
  readonly operations?: Readonly<Record<string, InvocationOperationDescriptor>>
}

export interface ParsedInvocationContract {
  readonly descriptor: InvocationContractDescriptor
  readonly digest: string
  readonly profile: 'single' | 'named'
  /** Present only for the initially supported single-operation profile. */
  readonly invocation?: InvocationOperationDescriptor
  /** Compiled schemas keyed by their pointer in the owning descriptor. */
  readonly schemas: ReadonlyMap<string, CompiledSchema>
  /** Keys are canonical paths relative to the invocation descriptor's directory. */
  readonly channelContracts: ReadonlyMap<string, ParsedChannelContract>
}

interface PreparedInvocationContract {
  readonly descriptor: InvocationContractDescriptor
  readonly invocation?: InvocationOperationDescriptor
  readonly schemas: ReadonlyMap<string, CompiledSchema>
  readonly paths: readonly string[]
}

/** Discover the complete validated, bounded offline closure before reading its files. */
export function invocationContractChannelPaths(
  bytes: Uint8Array,
  path = 'FLOW.contract.json',
): readonly string[] {
  return prepareInvocationContract(bytes, path).paths
}

/** Parse an exact descriptor and its supplied offline channel documents; never fetch. */
export function parseInvocationContract(
  bytes: Uint8Array,
  path = 'FLOW.contract.json',
  channelDocuments: ReadonlyMap<string, Uint8Array> = new Map(),
): ParsedInvocationContract {
  const prepared = prepareInvocationContract(bytes, path)
  const channelContracts = new Map<string, ParsedChannelContract>()
  const closure: Record<string, JsonValue> = Object.create(null)
  const identities = new Map<string, string>()
  for (const relativePath of prepared.paths) {
    const source = channelDocuments.get(relativePath)
    if (source === undefined) {
      invalid('CONTRACT_REFERENCE_MISSING', `missing channel agreement ./${relativePath}`, path)
    }
    const slash = path.lastIndexOf('/')
    const channelPath = `${slash < 0 ? '' : path.slice(0, slash + 1)}${relativePath}`
    const channel = parseChannelContract(source, channelPath)
    const identity = `${channel.descriptor.id}\0${channel.descriptor.version}`
    const prior = identities.get(identity)
    if (prior !== undefined && prior !== channel.digest) {
      invalid(
        'CHANNEL_EQUIVOCATION',
        'contract bundle carries conflicting channel agreements',
        channelPath,
      )
    }
    identities.set(identity, channel.digest)
    channelContracts.set(relativePath, channel)
    closure[relativePath] = channel.descriptor as unknown as JsonValue
  }
  const preimageValue = {
    descriptor: prepared.descriptor as unknown as JsonValue,
    channelContracts: closure,
  }
  try {
    validateJson1(preimageValue)
  } catch (error) {
    if (error instanceof Json1Error) invalid('CONTRACT_LIMIT', error.message, path)
    throw error
  }
  const canonical = canonicalJson(preimageValue)
  if (DOMAIN.byteLength + Buffer.byteLength(canonical) > INVOCATION_CONTRACT_LIMITS.preimageBytes) {
    invalid('CONTRACT_LIMIT', 'complete invocation contract preimage exceeds 1048576 bytes', path)
  }
  return Object.freeze({
    descriptor: prepared.descriptor,
    digest: `sha256:${createHash('sha256').update(DOMAIN).update(canonical).digest('hex')}`,
    profile: prepared.invocation === undefined ? 'named' : 'single',
    ...(prepared.invocation === undefined ? {} : { invocation: prepared.invocation }),
    schemas: prepared.schemas,
    channelContracts,
  })
}

function prepareInvocationContract(bytes: Uint8Array, path: string): PreparedInvocationContract {
  if (bytes.byteLength > INVOCATION_CONTRACT_LIMITS.bytes) {
    invalid('CONTRACT_LIMIT', 'invocation descriptor exceeds 262144 bytes', path)
  }
  let parsed: JsonValue
  try {
    parsed = decodeJson1(bytes)
  } catch (error) {
    if (error instanceof Json1Error) invalid('CONTRACT_INVALID_JSON', error.message, path)
    throw error
  }
  const root = object(parsed, 'descriptor', path)
  if (root.$schema !== INVOCATION_CONTRACT_SCHEMA) {
    invalid('CONTRACT_FIELD', `descriptor.$schema must be ${INVOCATION_CONTRACT_SCHEMA}`, path)
  }
  const named = Object.hasOwn(root, 'operations')
  exact(
    root,
    [...SHARED_FIELDS, ...(named ? ['operations'] : [...OPERATION_FIELDS, 'features'])],
    'descriptor',
    path,
  )
  if (Object.hasOwn(root, 'id') !== Object.hasOwn(root, 'version')) {
    invalid(
      'CONTRACT_IDENTITY',
      'contract id and version must both be present or both absent',
      path,
    )
  }
  if (root.id !== undefined && (typeof root.id !== 'string' || !isContractId(root.id))) {
    invalid('CONTRACT_ID', 'descriptor.id is not a canonical contract ID', path)
  }
  if (
    root.version !== undefined &&
    (typeof root.version !== 'string' || !isContractVersion(root.version))
  ) {
    invalid('CONTRACT_VERSION', 'descriptor.version must be stable SemVer core', path)
  }
  if (Object.hasOwn(root, 'features')) {
    if (root.id === undefined) {
      invalid('CONTRACT_FIELD', 'features require an identified single-form contract', path)
    }
    const features = object(root.features, 'descriptor.features', path)
    if (Object.keys(features).length > INVOCATION_CONTRACT_LIMITS.features) {
      invalid('CONTRACT_LIMIT', 'descriptor exceeds 256 features', path)
    }
    for (const [name, description] of Object.entries(features)) {
      localName(name, 'feature', path)
      if (
        typeof description !== 'string' ||
        Array.from(description).length < 1 ||
        Array.from(description).length > 16_384
      ) {
        invalid('CONTRACT_FIELD', 'feature description must contain 1-16384 Unicode scalars', path)
      }
    }
  }
  const definitions =
    root.$defs === undefined ? undefined : object(root.$defs, 'descriptor.$defs', path)
  if (
    definitions !== undefined &&
    Object.keys(definitions).length > INVOCATION_CONTRACT_LIMITS.definitions
  ) {
    invalid('CONTRACT_LIMIT', 'descriptor exceeds 1024 root definitions', path)
  }
  const sources: EmbeddedSchemaSource[] = []
  const paths = new Set<string>()
  let invocation: InvocationOperationDescriptor | undefined
  if (named) {
    const operations = object(root.operations, 'descriptor.operations', path)
    const entries = Object.entries(operations)
    if (entries.length < 1 || entries.length > INVOCATION_CONTRACT_LIMITS.operations) {
      invalid('CONTRACT_LIMIT', 'operations must contain 1-256 entries', path)
    }
    for (const [name, operation] of entries) {
      localName(name, 'operation', path)
      parseOperation(
        object(operation, `operations.${name}`, path),
        `/operations/${name}`,
        path,
        sources,
        paths,
      )
    }
  } else {
    const operation: Record<string, JsonValue> = Object.create(null)
    for (const field of OPERATION_FIELDS)
      if (Object.hasOwn(root, field)) operation[field] = root[field]!
    invocation = parseOperation(operation, '', path, sources, paths)
  }
  if (paths.size > INVOCATION_CONTRACT_LIMITS.channelPaths) {
    invalid('CONTRACT_LIMIT', 'contract references more than 64 distinct channel paths', path)
  }
  const schemas = compileEmbeddedSchemas(sources, {
    path,
    ...(definitions === undefined ? {} : { rootDefs: definitions }),
  })
  freeze(root)
  return {
    descriptor: root as unknown as InvocationContractDescriptor,
    ...(invocation === undefined ? {} : { invocation }),
    schemas,
    paths: Object.freeze([...paths]),
  }
}

function parseOperation(
  operation: JsonObject,
  pointer: string,
  path: string,
  sources: EmbeddedSchemaSource[],
  paths: Set<string>,
): InvocationOperationDescriptor {
  exact(operation, OPERATION_FIELDS, pointer || 'operation', path)
  for (const field of ['input', 'result'] as const) {
    const schema = operation[field]
    if (schema !== undefined) sources.push({ pointer: `${pointer}/${field}`, schema })
  }
  if (operation.outcomes !== undefined) {
    const outcomes = object(operation.outcomes, `${pointer}/outcomes`, path)
    if (Object.keys(outcomes).length > INVOCATION_CONTRACT_LIMITS.outcomes) {
      invalid('CONTRACT_LIMIT', 'operation exceeds 256 outcomes', path)
    }
    for (const [name, description] of Object.entries(outcomes)) {
      localName(name, 'outcome', path)
      if (RESERVED_OUTCOMES.has(name))
        invalid('CONTRACT_OUTCOME', `outcome ${name} is reserved`, path)
      if (
        typeof description !== 'string' ||
        Array.from(description).length < 1 ||
        Array.from(description).length > 16_384
      ) {
        invalid(
          'CONTRACT_OUTCOME',
          'outcome description must contain 1-16384 Unicode scalars',
          path,
        )
      }
    }
  }
  if (operation.attachments !== undefined) {
    const attachments = object(operation.attachments, `${pointer}/attachments`, path)
    if (Object.keys(attachments).length > INVOCATION_CONTRACT_LIMITS.attachments) {
      invalid('CONTRACT_LIMIT', 'operation exceeds 256 attachments', path)
    }
    for (const [name, access] of Object.entries(attachments)) {
      localName(name, 'attachment', path)
      if (access !== 'read' && access !== 'read-write') {
        invalid('CONTRACT_ATTACHMENT', 'attachment access must be read or read-write', path)
      }
    }
  }
  if (operation.channels !== undefined) {
    const channels = parseChannelDeclarations(operation.channels, path, { compileSchemas: false })
    for (const [name, channel] of Object.entries(channels)) {
      if (channel.contract !== undefined) paths.add(channel.contract.slice(2))
      if (channel.schema !== undefined) {
        const schemaPointer = `${pointer}/channels/${name}/schema`
        rejectInlineReferences(channel.schema, schemaPointer, path)
        sources.push({ pointer: schemaPointer, schema: channel.schema })
      }
    }
  }
  freeze(operation)
  return operation as unknown as InvocationOperationDescriptor
}

/** Visit schema positions only: message property names and example data stay literal. */
function rejectInlineReferences(schema: JsonValue, pointer: string, path: string): void {
  if (!isObject(schema)) return
  if (Object.hasOwn(schema, '$ref') || Object.hasOwn(schema, '$defs')) {
    invalid(
      'CONTRACT_CHANNEL_SCHEMA',
      'inline channel schemas cannot contain $ref or $defs',
      path,
      pointer,
    )
  }
  for (const keyword of ['properties', 'dependentSchemas']) {
    const children = schema[keyword]
    if (isObject(children)) {
      for (const [name, child] of Object.entries(children)) {
        rejectInlineReferences(
          child,
          `${pointer}/${keyword}/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`,
          path,
        )
      }
    }
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    const children = schema[keyword]
    if (Array.isArray(children))
      children.forEach((child, index) => {
        rejectInlineReferences(child, `${pointer}/${keyword}/${index}`, path)
      })
  }
  for (const keyword of [
    'not',
    'if',
    'then',
    'else',
    'additionalProperties',
    'items',
    'contains',
  ]) {
    if (schema[keyword] !== undefined)
      rejectInlineReferences(schema[keyword]!, `${pointer}/${keyword}`, path)
  }
}

function localName(value: string, field: string, path: string): void {
  if (value.length > 64 || !LOCAL_NAME.test(value))
    invalid('CONTRACT_LOCAL_NAME', `${field} must be a LocalName`, path)
}

function object(value: JsonValue | undefined, field: string, path: string): JsonObject {
  if (!isObject(value)) invalid('CONTRACT_FIELD', `${field} must be an object`, path)
  return value
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: JsonObject, fields: readonly string[], field: string, path: string): void {
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) invalid('CONTRACT_FIELD', `unknown ${field} field ${key}`, path)
  }
}

function freeze(value: JsonValue): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freeze(child)
  Object.freeze(value)
}
