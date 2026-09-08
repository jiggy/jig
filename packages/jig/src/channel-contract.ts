import { createHash } from 'node:crypto'

import { isContractId, isContractVersion } from './contract-identity.js'
import { invalid } from './diagnostics.js'
import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from './json.js'
import { isNfc15_1 } from './package/paths.js'
import { compileEmbeddedSchema, type CompiledSchema } from './schema/index.js'

export const CHANNEL_CONTRACT_SCHEMA = 'https://flow.jig.md/schemas/channel-contract-1.schema.json'
export const CHANNEL_CONTRACT_BYTES = 262_144

export interface ChannelDeclaration {
  readonly direction: 'send' | 'receive'
  readonly required?: boolean
  readonly schema?: JsonValue
  readonly contract?: string
  readonly delivery?: 'direct' | 'broadcast'
  readonly start?: 'beginning' | 'suffix'
}

export interface ChannelContractDescriptor {
  readonly $schema: typeof CHANNEL_CONTRACT_SCHEMA
  readonly id: string
  readonly version: string
  readonly semantics: string
  readonly item: boolean | JsonObject
  readonly $defs?: JsonObject
}

export interface ParsedChannelContract {
  readonly descriptor: ChannelContractDescriptor
  readonly digest: string
  readonly itemSchema: CompiledSchema
}

export function parseChannelDeclarations(
  value: JsonValue,
  path: string,
): Readonly<Record<string, ChannelDeclaration>> {
  const entries = Object.entries(object(value, path))
  if (entries.length > 256) invalid('CHANNEL_LIMIT', 'too many channel declarations', path)
  const result: Record<string, ChannelDeclaration> = Object.create(null)
  for (const [name, value] of entries) {
    if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
      invalid('CHANNEL_FIELD', 'invalid channel local name', path)
    const entry = object(value, path)
    exact(entry, ['direction', 'required', 'schema', 'contract', 'delivery', 'start'], path)
    if (entry.direction !== 'send' && entry.direction !== 'receive')
      invalid('CHANNEL_FIELD', `${name}.direction must be send or receive`, path)
    if (entry.required !== undefined && typeof entry.required !== 'boolean')
      invalid('CHANNEL_FIELD', `${name}.required must be boolean`, path)
    if (entry.schema !== undefined && entry.contract !== undefined)
      invalid('CHANNEL_FIELD', `${name} cannot declare both schema and contract`, path)
    if (entry.schema !== undefined) compileEmbeddedSchema(entry.schema, { path })
    if (entry.contract !== undefined) requireChannelReference(entry.contract, path)
    if (entry.delivery !== undefined && entry.delivery !== 'direct')
      invalid('CHANNEL_FIELD', `${name}.delivery is unsupported`, path)
    if (
      entry.start !== undefined &&
      (entry.direction !== 'receive' || (entry.start !== 'beginning' && entry.start !== 'suffix'))
    )
      invalid(
        'CHANNEL_FIELD',
        `${name}.start requires a receive channel and beginning or suffix`,
        path,
      )
    const declaration = { ...entry }
    freeze(declaration)
    result[name] = declaration as unknown as ChannelDeclaration
  }
  return Object.freeze(result)
}

export function requireChannelReference(value: JsonValue, path: string): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('./') ||
    Buffer.byteLength(value) > 1_026 ||
    !isNfc15_1(value)
  )
    invalid('CHANNEL_REFERENCE', 'channel contract must be a canonical ./ package reference', path)
  const segments = value.slice(2).split('/')
  if (
    segments.length > 64 ||
    segments.some((part) => Buffer.byteLength(part) > 255) ||
    segments.some(
      (part) => !part || part === '.' || part === '..' || /[\\\u0000-\u001f\u007f]/.test(part),
    )
  )
    invalid('CHANNEL_REFERENCE', 'channel contract must stay inside its package', path)
  return value as string
}

export function parseChannelContract(
  bytes: Uint8Array,
  path = 'channel contract',
): ParsedChannelContract {
  if (bytes.byteLength > CHANNEL_CONTRACT_BYTES)
    invalid('CHANNEL_LIMIT', 'channel descriptor exceeds 256 KiB', path)
  const root = object(decodeJson1(bytes), path)
  exact(root, ['$schema', 'id', 'version', 'semantics', 'item', '$defs'], path)
  if (root.$schema !== CHANNEL_CONTRACT_SCHEMA)
    invalid('CHANNEL_FIELD', `descriptor.$schema must be ${CHANNEL_CONTRACT_SCHEMA}`, path)
  if (typeof root.id !== 'string' || !isContractId(root.id))
    invalid('CHANNEL_FIELD', 'invalid channel contract identity', path)
  if (typeof root.version !== 'string' || !isContractVersion(root.version))
    invalid('CHANNEL_FIELD', 'invalid channel contract version', path)
  if (
    typeof root.semantics !== 'string' ||
    !root.semantics.length ||
    Buffer.byteLength(root.semantics) > 16_384
  )
    invalid('CHANNEL_LIMIT', 'channel semantics must contain 1–16384 UTF-8 bytes', path)
  if (
    typeof root.item !== 'boolean' &&
    (root.item === null || typeof root.item !== 'object' || Array.isArray(root.item))
  )
    invalid('CHANNEL_FIELD', 'channel item must be a Schema/1 schema', path)
  const defs = root.$defs === undefined ? undefined : object(root.$defs, path)
  if (defs !== undefined && Object.keys(defs).length > 1_024)
    invalid('CHANNEL_LIMIT', 'channel descriptor exceeds 1024 definitions', path)
  const itemSchema = compileEmbeddedSchema(root.item, {
    path,
    pointer: '/item',
    ...(defs === undefined ? {} : { rootDefs: defs }),
  })
  const descriptor = root as unknown as ChannelContractDescriptor
  freeze(root)
  const digest = `sha256:${createHash('sha256').update('FLOW-Channel-Contract/1\0').update(canonicalJson(root)).digest('hex')}`
  return Object.freeze({ descriptor, digest, itemSchema })
}

function object(value: JsonValue | undefined, path: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    invalid('CHANNEL_FIELD', 'expected an object', path)
  return value as JsonObject
}

function exact(value: JsonObject, fields: readonly string[], path: string): void {
  for (const key of Object.keys(value))
    if (!fields.includes(key)) invalid('CHANNEL_FIELD', `unknown channel field ${key}`, path)
}

function freeze(value: JsonValue): void {
  if (value === null || typeof value !== 'object') return
  for (const child of Object.values(value)) freeze(child)
  Object.freeze(value)
}
