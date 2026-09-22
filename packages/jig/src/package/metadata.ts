import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  parseDocument,
  type Scalar,
} from 'yaml'

import { invalid } from '../diagnostics.js'
import { decodeJson1, Json1Error, type JsonObject, type JsonValue, validateJson1 } from '../json.js'
import { isNfc15_1 } from './paths.js'

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const encoder = new TextEncoder()
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?(?![\s\S])/

export interface InvocationUse {
  readonly contract?: string
  readonly requires?: readonly string[]
}

export interface FlowMetadata {
  readonly name?: string
  readonly description?: string
  readonly uses?: Readonly<Record<string, InvocationUse>>
  readonly supports?: readonly string[]
  readonly license?: string
  readonly compatibility?: string
  readonly metadata?: Readonly<Record<string, string>>
  readonly 'allowed-tools'?: string
  readonly extensions: JsonObject
  /** Inspectable unknown declarations prevent execution qualification. */
  readonly unknownFields: JsonObject
}

export interface ParsedFlowDocument {
  readonly metadata: FlowMetadata
  readonly markdown: string
}

export interface ParsedFlowMetadataPrefix {
  readonly metadata: FlowMetadata
  readonly bodyOffset: number
}

export function parseFlowDocument(bytes: Uint8Array): ParsedFlowDocument {
  // A complete in-memory document parser is useful for fixtures and small
  // packages. Admission uses parseFlowMetadataPrefix plus streaming UTF-8
  // validation so a large Markdown body is never buffered as one string.
  try {
    decoder.decode(bytes)
  } catch {
    invalid('METADATA_INVALID_UTF8', 'FLOW.md is not valid UTF-8', 'FLOW.md')
  }
  const parsed = parseFlowMetadataPrefix(bytes)
  return {
    metadata: parsed.metadata,
    markdown: decoder.decode(bytes.subarray(parsed.bodyOffset)),
  }
}

export function parseFlowMetadataPrefix(bytes: Uint8Array): ParsedFlowMetadataPrefix {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    invalid('METADATA_BOM', 'FLOW.md must not begin with a UTF-8 BOM', 'FLOW.md')
  }
  const opening = openingLength(bytes)
  if (opening === 0) {
    return { metadata: validateMetadata({}, 'FLOW.md'), bodyOffset: 0 }
  }
  const closing = findClosingDelimiter(bytes, opening)
  if (closing === undefined) {
    if (bytes.byteLength > 262_144) {
      invalid('METADATA_LIMIT', 'FLOW.md frontmatter exceeds 262144 bytes', 'FLOW.md')
    }
    invalid('METADATA_DELIMITER', 'FLOW.md has no exact closing --- delimiter line', 'FLOW.md')
  }
  if (closing.end > 262_144) {
    invalid('METADATA_LIMIT', 'FLOW.md frontmatter exceeds 262144 bytes', 'FLOW.md')
  }

  let source: string
  try {
    source = decoder.decode(bytes.subarray(opening, closing.start))
  } catch {
    invalid('METADATA_INVALID_UTF8', 'FLOW.md frontmatter is not valid UTF-8', 'FLOW.md')
  }
  const document = parseDocument(source, {
    keepSourceTokens: true,
    prettyErrors: false,
    schema: 'failsafe',
    strict: true,
    uniqueKeys: true,
  })
  if (document.errors.length > 0 || document.warnings.length > 0) {
    const problem = document.errors[0] ?? document.warnings[0]!
    invalid('METADATA_INVALID_YAML', problem.message, 'FLOW.md')
  }
  const declaredTags = Object.keys(document.directives.tags).filter((tag) => tag !== '!!')
  if (declaredTags.length > 0) {
    invalid('METADATA_YAML_FEATURE', 'YAML tag directives are not allowed', 'FLOW.md')
  }
  const root =
    document.contents === null ? {} : convertNode(document.contents as Node, 1, { nodes: 0 }, true)
  if (!isObject(root)) {
    invalid('METADATA_ROOT', 'FLOW.md frontmatter must be a mapping', 'FLOW.md')
  }
  try {
    validateJson1(root)
  } catch (error) {
    if (error instanceof Json1Error) {
      invalid('METADATA_JSON_VALUE', error.message, 'FLOW.md')
    }
    throw error
  }
  const metadata = validateMetadata(root, 'FLOW.md')
  return { metadata, bodyOffset: closing.end }
}

export function parseFlowMetadataSidecar(bytes: Uint8Array): FlowMetadata {
  const path = 'flow.meta.json'
  if (bytes.byteLength > 262_144) invalid('METADATA_LIMIT', 'metadata exceeds 262144 bytes', path)
  let root: JsonValue
  try {
    root = decodeJson1(bytes)
  } catch (error) {
    if (error instanceof Json1Error) invalid('METADATA_INVALID_JSON', error.message, path)
    throw error
  }
  if (!isObject(root)) invalid('METADATA_ROOT', 'metadata must be an object', path)
  boundJsonMetadata(root, 1, { nodes: 0 }, path)
  return validateMetadata(root, path)
}

function boundJsonMetadata(
  value: JsonValue,
  depth: number,
  state: MetadataLimitState,
  path: string,
): void {
  if (depth > 16 || ++state.nodes > 4_096)
    invalid('METADATA_LIMIT', 'metadata exceeds depth 16 or 4096 nodes', path)
  if (value === null || typeof value !== 'object') return
  const children = Object.values(value)
  if (children.length > 256)
    invalid('METADATA_LIMIT', 'metadata container exceeds 256 entries', path)
  if (!Array.isArray(value)) {
    for (const key of Object.keys(value)) boundJsonMetadata(key, depth + 1, state, path)
  }
  for (const child of children) boundJsonMetadata(child, depth + 1, state, path)
}

function openingLength(bytes: Uint8Array): number {
  if (bytes[0] !== 0x2d || bytes[1] !== 0x2d || bytes[2] !== 0x2d) return 0
  if (bytes.byteLength === 3) return 3
  if (bytes[3] === 0x0a) return 4
  if (bytes[3] === 0x0d && bytes[4] === 0x0a) return 5
  if (bytes[3] === 0x0d) return 4
  return 0
}

function findClosingDelimiter(
  bytes: Uint8Array,
  start: number,
): { readonly start: number; readonly end: number } | undefined {
  let lineStart = start
  for (let position = start; position <= bytes.byteLength; position += 1) {
    if (position !== bytes.byteLength && bytes[position] !== 0x0a && bytes[position] !== 0x0d)
      continue
    const lineEnd = position
    if (
      lineEnd - lineStart === 3 &&
      bytes[lineStart] === 0x2d &&
      bytes[lineStart + 1] === 0x2d &&
      bytes[lineStart + 2] === 0x2d
    ) {
      const end =
        position >= bytes.byteLength
          ? position
          : position + (bytes[position] === 0x0d && bytes[position + 1] === 0x0a ? 2 : 1)
      return { start: lineStart, end }
    }
    if (bytes[position] === 0x0d && bytes[position + 1] === 0x0a) position += 1
    lineStart = position + 1
  }
  return undefined
}

interface MetadataLimitState {
  nodes: number
}

function convertNode(
  node: Node | null,
  depth: number,
  state: MetadataLimitState,
  root = false,
): JsonValue {
  if (node === null) invalid('METADATA_INVALID_YAML', 'empty YAML nodes are not allowed', 'FLOW.md')
  if (depth > 16) invalid('METADATA_LIMIT', 'frontmatter exceeds depth 16', 'FLOW.md')
  state.nodes += 1
  if (state.nodes > 4_096) invalid('METADATA_LIMIT', 'frontmatter exceeds 4096 nodes', 'FLOW.md')
  if (isAlias(node)) invalid('METADATA_YAML_FEATURE', 'YAML aliases are not allowed', 'FLOW.md')
  if (node.anchor !== undefined)
    invalid('METADATA_YAML_FEATURE', 'YAML anchors are not allowed', 'FLOW.md')
  if (node.tag !== undefined)
    invalid('METADATA_YAML_FEATURE', 'explicit YAML tags are not allowed', 'FLOW.md')

  if (isScalar(node)) return convertScalar(node)
  if (isSeq(node)) {
    if (node.items.length > 256)
      invalid('METADATA_LIMIT', 'a YAML sequence exceeds 256 entries', 'FLOW.md')
    return node.items.map((child) => convertNode(child as Node | null, depth + 1, state))
  }
  if (isMap(node)) {
    if (node.items.length > 256)
      invalid('METADATA_LIMIT', 'a YAML mapping exceeds 256 entries', 'FLOW.md')
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
    for (const pair of node.items as Pair[]) {
      const keyValue = convertNode(pair.key as Node | null, depth + 1, state)
      if (typeof keyValue !== 'string') {
        invalid('METADATA_YAML_KEY', 'YAML mapping keys must resolve to strings', 'FLOW.md')
      }
      if (keyValue === '<<')
        invalid('METADATA_YAML_FEATURE', 'YAML merge keys are not allowed', 'FLOW.md')
      if (Object.hasOwn(result, keyValue))
        invalid('METADATA_DUPLICATE_KEY', `duplicate key ${keyValue}`, 'FLOW.md')
      result[keyValue] = convertNode(pair.value as Node | null, depth + 1, state)
    }
    if (root && state.nodes < 1) invalid('METADATA_ROOT', 'invalid metadata root', 'FLOW.md')
    return result
  }
  return invalid('METADATA_YAML_FEATURE', 'unsupported YAML node', 'FLOW.md')
}

function convertScalar(node: Scalar): JsonValue {
  const source = node.source ?? ''
  if (node.type !== 'PLAIN') return String(node.value ?? '')
  if (source === 'null') return null
  if (source === 'true') return true
  if (source === 'false') return false
  if (JSON_NUMBER.test(source)) {
    if (encoder.encode(source).byteLength > 128) {
      invalid('METADATA_NUMBER', 'frontmatter number token exceeds 128 bytes', 'FLOW.md')
    }
    const value = Number(source)
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      invalid('METADATA_NUMBER', 'frontmatter number is outside FLOW JSON/1', 'FLOW.md')
    }
    return value
  }
  return source
}

function validateMetadata(root: JsonObject, path: string): FlowMetadata {
  const known = new Set([
    'name',
    'description',
    'uses',
    'supports',
    'license',
    'compatibility',
    'metadata',
    'allowed-tools',
  ])
  const extensions: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  const unknownFields: Record<string, JsonValue> = Object.create(null)
  for (const [key, value] of Object.entries(root)) {
    if (known.has(key)) continue
    if (key.startsWith('x-') && isLocalName(key.slice(2))) extensions[key] = value
    else unknownFields[key] = value
  }
  const name = root.name === undefined ? undefined : requireLocalName(root.name, 'name', path)
  const description =
    root.description === undefined
      ? undefined
      : requireDescription(root.description, 'description', path)
  const uses = root.uses === undefined ? undefined : validateUses(root.uses, path)
  const supports =
    root.supports === undefined ? undefined : requireFeatureNames(root.supports, 'supports', path)
  const strings: Record<string, string> = Object.create(null)
  for (const key of ['license', 'compatibility', 'allowed-tools']) {
    if (root[key] === undefined) continue
    if (typeof root[key] !== 'string') invalid('METADATA_FIELD', `${key} must be text`, path)
    strings[key] = root[key] as string
  }
  let extraMetadata: Readonly<Record<string, string>> | undefined
  if (root.metadata !== undefined) {
    const entries = requireObject(root.metadata, 'metadata', path)
    for (const value of Object.values(entries)) {
      if (typeof value !== 'string')
        invalid('METADATA_FIELD', 'metadata values must be strings', path)
    }
    extraMetadata = entries as Readonly<Record<string, string>>
  }

  const metadata: FlowMetadata = {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(uses === undefined ? {} : { uses }),
    ...(supports === undefined ? {} : { supports }),
    ...strings,
    ...(extraMetadata === undefined ? {} : { metadata: extraMetadata }),
    extensions,
    unknownFields,
  }
  deepFreezeJson(metadata as unknown as JsonValue)
  return metadata
}

function validateUses(value: JsonValue, path: string): Readonly<Record<string, InvocationUse>> {
  const object = requireObject(value, 'uses', path)
  const result: Record<string, InvocationUse> = Object.create(null)
  for (const [slot, declaration] of Object.entries(object)) {
    requireLocalName(slot, `uses.${slot}`, path)
    if (path === 'FLOW.md' && slot === 'markdown-agent')
      invalid('METADATA_USES', 'markdown-agent is reserved for Markdown interpretation', path)
    const item = requireObject(declaration, `uses.${slot}`, path)
    if (Object.keys(item).length === 0) result[slot] = {}
    else if (
      Object.keys(item).every((key) => key === 'contract' || key === 'requires') &&
      typeof item.contract === 'string'
    ) {
      result[slot] = {
        contract: requireAuthorReference(item.contract, `uses.${slot}.contract`, path),
        ...(item.requires === undefined
          ? {}
          : { requires: requireFeatureNames(item.requires, `uses.${slot}.requires`, path) }),
      }
    } else
      invalid(
        'METADATA_USES',
        `uses.${slot} must be {} or contain a contract reference and optional requires`,
        path,
      )
  }
  return result
}

function requireFeatureNames(value: JsonValue, field: string, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 256)
    invalid('METADATA_FEATURES', `${field} must contain at most 256 unique LocalNames`, path)
  const names = value.map((item) => requireLocalName(item, field, path))
  if (new Set(names).size !== names.length)
    invalid('METADATA_FEATURES', `${field} contains duplicate feature names`, path)
  return Object.freeze(names)
}

export function requireAuthorReference(value: string, field: string, owner = 'FLOW.md'): string {
  if (!value.startsWith('./') || value.length <= 2) {
    invalid('METADATA_REFERENCE', `${field} must begin with ./`, owner)
  }
  const path = value.slice(2)
  if (!isCanonicalLogicalPath(path)) {
    invalid('METADATA_REFERENCE', `${field} is not a canonical package reference`, owner)
  }
  return value
}

function requireLocalName(value: JsonValue | undefined, field: string, path: string): string {
  if (typeof value !== 'string' || !isLocalName(value)) {
    invalid('METADATA_LOCAL_NAME', `${field} must be a Metadata/1 LocalName`, path)
  }
  return value
}

function isLocalName(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && LOCAL_NAME.test(value)
}

function requireDescription(value: JsonValue | undefined, field: string, path: string): string {
  if (typeof value !== 'string') invalid('METADATA_DESCRIPTION', `${field} must be text`, path)
  const length = Array.from(value).length
  if (length < 1 || length > 16_384) {
    invalid('METADATA_DESCRIPTION', `${field} must contain 1-16384 Unicode scalars`, path)
  }
  return value
}

function requireObject(value: JsonValue, field: string, path: string): JsonObject {
  if (!isObject(value)) invalid('METADATA_FIELD', `${field} must be a mapping`, path)
  return value
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function deepFreezeJson(value: JsonValue): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) deepFreezeJson(child)
  Object.freeze(value)
}

function isCanonicalLogicalPath(path: string): boolean {
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return false
  if (!isNfc15_1(path)) return false
  const segments = path.split('/')
  if (segments.length === 0 || segments.length > 64) return false
  if (encoder.encode(path).byteLength > 1_024) return false
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..' &&
      encoder.encode(segment).byteLength <= 255,
  )
}
