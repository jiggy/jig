import { AgentMethodError } from './errors.js'
import { canonicalJson, type JsonObject, type JsonValue, validateJson1 } from './json.js'
import { exactKeys, ordinaryRecord } from './values.js'

const MAX_RESPONSE_SCHEMA_DEPTH = 8
const MAX_PROPERTIES_PER_OBJECT = 32
const MAX_RESPONSE_SCHEMA_PROPERTIES = 128
const MAX_ARRAY_ITEMS = 256
const MAX_RESPONSE_SCHEMA_ENUM_VALUES = 256
const MAX_RESPONSE_SCHEMA_SYMBOL_CHARACTERS = 120_000
const MAX_LARGE_ENUM_CHARACTERS = 15_000

interface ResponseSchemaProfileState {
  properties: number
  enumValues: number
  symbolCharacters: number
}

/** Validate Jig's deliberately bounded recursive Agent structured-output profile. */
export function assertResponseSchema(schema: JsonObject): void {
  requireSchemaJson(schema)
  if (schema.$schema !== 'https://flow.jig.md/schemas/schema-1.json') invalidSchemaProfile()
  const state: ResponseSchemaProfileState = {
    properties: 0,
    enumValues: 0,
    symbolCharacters: 0,
  }
  assertResponseSchemaNode(schema, 1, true, state)
}

function assertResponseSchemaNode(
  value: unknown,
  depth: number,
  root: boolean,
  state: ResponseSchemaProfileState,
): void {
  const schema = ordinaryRecord(value)
  if (schema === undefined || depth > MAX_RESPONSE_SCHEMA_DEPTH) invalidSchemaProfile()

  if (schema.type === 'object') {
    assertClosedResponseObject(schema, depth, root, state)
    return
  }
  if (root || Object.hasOwn(schema, '$schema')) invalidSchemaProfile()

  if (schema.type === 'array') {
    const baseExpected = Object.hasOwn(schema, 'minItems')
      ? ['items', 'maxItems', 'minItems', 'type']
      : ['items', 'maxItems', 'type']
    if (
      !exactProfileKeys(schema, baseExpected) ||
      !boundedNonnegativeInteger(schema.maxItems, MAX_ARRAY_ITEMS) ||
      (Object.hasOwn(schema, 'minItems') &&
        (!boundedNonnegativeInteger(schema.minItems, MAX_ARRAY_ITEMS) ||
          (schema.minItems as number) > (schema.maxItems as number)))
    ) {
      invalidSchemaProfile()
    }
    assertResponseSchemaNode(schema.items, depth + 1, false, state)
    return
  }

  if (schema.type === 'integer' || isNullableType(schema.type, 'integer')) {
    if (!exactProfileKeys(schema, ['type'])) invalidSchemaProfile()
    return
  }
  if (schema.type === 'string' || isNullableType(schema.type, 'string')) {
    assertResponseString(schema, isNullableType(schema.type, 'string'), state)
    return
  }
  invalidSchemaProfile()
}

function assertClosedResponseObject(
  schema: Record<string, unknown>,
  depth: number,
  root: boolean,
  state: ResponseSchemaProfileState,
): void {
  const expected = root
    ? ['$schema', 'additionalProperties', 'properties', 'required', 'type']
    : ['additionalProperties', 'properties', 'required', 'type']
  const properties = ordinaryRecord(schema.properties)
  if (
    !exactProfileKeys(schema, expected) ||
    schema.additionalProperties !== false ||
    properties === undefined ||
    !Array.isArray(schema.required)
  ) {
    invalidSchemaProfile()
  }
  const names = Object.keys(properties)
  if (
    names.length === 0 ||
    names.length > MAX_PROPERTIES_PER_OBJECT ||
    schema.required.length !== names.length ||
    new Set(schema.required).size !== names.length ||
    schema.required.some((name) => typeof name !== 'string' || !Object.hasOwn(properties, name))
  ) {
    invalidSchemaProfile()
  }
  state.properties += names.length
  if (state.properties > MAX_RESPONSE_SCHEMA_PROPERTIES) invalidSchemaProfile()
  for (const name of names) {
    state.symbolCharacters += unicodeScalarLength(name)
    if (state.symbolCharacters > MAX_RESPONSE_SCHEMA_SYMBOL_CHARACTERS) invalidSchemaProfile()
    assertResponseSchemaNode(properties[name], depth + 1, false, state)
  }
}

function assertResponseString(
  schema: Record<string, unknown>,
  nullable: boolean,
  state: ResponseSchemaProfileState,
): void {
  if (!Object.hasOwn(schema, 'enum')) {
    if (!exactProfileKeys(schema, ['type'])) invalidSchemaProfile()
    return
  }
  if (
    !exactProfileKeys(schema, ['enum', 'type']) ||
    !Array.isArray(schema.enum) ||
    schema.enum.length === 0 ||
    schema.enum.length > MAX_RESPONSE_SCHEMA_ENUM_VALUES ||
    schema.enum.some((item) => typeof item !== 'string' && (!nullable || item !== null)) ||
    new Set(schema.enum).size !== schema.enum.length ||
    (nullable &&
      (!schema.enum.includes(null) || !schema.enum.some((item) => typeof item === 'string')))
  ) {
    invalidSchemaProfile()
  }
  state.enumValues += schema.enum.length
  const enumCharacters = schema.enum.reduce(
    (total, item) => total + (typeof item === 'string' ? unicodeScalarLength(item) : 0),
    0,
  )
  if (schema.enum.length > 250 && enumCharacters > MAX_LARGE_ENUM_CHARACTERS) {
    invalidSchemaProfile()
  }
  state.symbolCharacters += enumCharacters
  if (state.enumValues > MAX_RESPONSE_SCHEMA_ENUM_VALUES) invalidSchemaProfile()
  if (state.symbolCharacters > MAX_RESPONSE_SCHEMA_SYMBOL_CHARACTERS) invalidSchemaProfile()
}

function isNullableType(value: unknown, base: 'integer' | 'string'): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    new Set(value).size === 2 &&
    value.includes(base) &&
    value.includes('null')
  )
}

function exactProfileKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  if (Object.hasOwn(value, 'description') && typeof value.description !== 'string') return false
  return exactKeys(
    value,
    Object.hasOwn(value, 'description') ? [...expected, 'description'] : expected,
  )
}

function boundedNonnegativeInteger(value: unknown, maximum: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
}

function unicodeScalarLength(value: string): number {
  return [...value].length
}

function invalidSchemaProfile(): never {
  throw new AgentMethodError(
    'INVALID_INPUT',
    'Agent responseSchema must use the bounded structured-output profile',
  )
}

function requireSchemaJson(schema: unknown): void {
  try {
    validateJson1(schema)
    if (ordinaryRecord(schema) === undefined) invalidSchemaProfile()
    if (canonicalJson(schema).byteLength > 256 * 1024) {
      throw new AgentMethodError('RESOURCE_EXHAUSTED', 'Agent responseSchema exceeds 256 KiB')
    }
  } catch (error) {
    if (error instanceof AgentMethodError) throw error
    throw new AgentMethodError('INVALID_INPUT', 'Agent responseSchema must be valid JSON/1')
  }
}

/** Remove only the FLOW dialect declaration from a fresh provider-facing copy. */
export function projectResponseSchema(schema: JsonObject): JsonObject {
  assertResponseSchema(schema)
  const copy = JSON.parse(new TextDecoder().decode(canonicalJson(schema))) as Record<
    string,
    JsonValue
  >
  delete copy.$schema
  return copy
}

/** Check a value against the already asserted closed structured-output profile. */
export function matchesResponseSchema(schema: JsonObject, value: JsonValue): boolean {
  if (value === null && Array.isArray(schema.type) && schema.type.includes('null')) {
    return !Array.isArray(schema.enum) || schema.enum.includes(null)
  }
  if (schema.type === 'object') {
    const record = ordinaryRecord(value)
    if (record === undefined) return false
    const properties = schema.properties as JsonObject
    return (
      exactKeys(record, Object.keys(properties)) &&
      Object.entries(properties).every(([name, child]) =>
        matchesResponseSchema(child as JsonObject, record[name] as JsonValue),
      )
    )
  }
  if (schema.type === 'array') {
    return (
      Array.isArray(value) &&
      value.length <= (schema.maxItems as number) &&
      value.length >= ((schema.minItems as number | undefined) ?? 0) &&
      value.every((item) => matchesResponseSchema(schema.items as JsonObject, item))
    )
  }
  if (schema.type === 'integer' || isNullableType(schema.type, 'integer')) {
    return typeof value === 'number' && Number.isSafeInteger(value)
  }
  return typeof value === 'string' && (!Array.isArray(schema.enum) || schema.enum.includes(value))
}
