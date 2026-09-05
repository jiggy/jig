import {
  decodeJson1,
  Json1Error,
  type JsonObject,
  type JsonScalar,
  type JsonValue,
  validateJson1,
} from '../json.js'
import {
  type CompiledSchema,
  type EmbeddedSchemaOptions,
  type EmbeddedSchemaSource,
  SCHEMA_1_LIMITS,
  SCHEMA_1_URI,
  SchemaDiagnostic,
  type SchemaValue,
  type SingleEmbeddedSchemaOptions,
} from './types.js'

const KEYWORDS = new Set([
  '$schema',
  '$defs',
  '$ref',
  '$comment',
  'title',
  'description',
  'examples',
  'type',
  'enum',
  'const',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'properties',
  'required',
  'additionalProperties',
  'minProperties',
  'maxProperties',
  'dependentRequired',
  'dependentSchemas',
  'prefixItems',
  'items',
  'contains',
  'minContains',
  'maxContains',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'exclusiveMinimum',
  'maximum',
  'exclusiveMaximum',
])
const SIMPLE_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'])
const DEFINITION_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/

interface SchemaNode {
  readonly pointer: string
  readonly schema: SchemaValue
}

interface SchemaGraph {
  readonly path: string
  readonly nodes: ReadonlyMap<string, SchemaNode>
  readonly references: ReadonlyMap<string, string>
}

interface EvaluationFailure {
  readonly instancePointer: string
  readonly schemaPointer: string
  readonly keyword?: string
}

interface EvaluationResult {
  readonly valid: boolean
  readonly failure?: EvaluationFailure
}

interface EvaluationState {
  work: number
  readonly memo: Map<string, Map<string, EvaluationResult>>
}

export function compileSchemaFile(bytes: Uint8Array, path: string): CompiledSchema {
  if (bytes.byteLength > SCHEMA_1_LIMITS.bytes) {
    throw diagnostic(
      'SCHEMA_LIMIT_EXCEEDED',
      `schema exceeds ${SCHEMA_1_LIMITS.bytes} encoded bytes`,
      path,
      '',
    )
  }

  let parsed: JsonValue
  try {
    parsed = decodeJson1(bytes)
  } catch (error) {
    if (error instanceof Json1Error) {
      throw diagnostic('SCHEMA_INVALID_JSON', error.message, path, '')
    }
    throw error
  }
  if (!isObject(parsed)) {
    throw diagnostic('SCHEMA_INVALID', 'a Schema/1 file root must be an object', path, '')
  }
  if (parsed.$schema !== SCHEMA_1_URI) {
    throw diagnostic(
      'SCHEMA_INVALID',
      `root $schema must be the exact string ${SCHEMA_1_URI}`,
      path,
      '/$schema',
      '$schema',
    )
  }

  const builder = new GraphBuilder(path)
  builder.addFileRoot(parsed)
  const graph = builder.finish()
  return new CompiledSchemaImpl(graph, '')
}

export function compileEmbeddedSchema(
  schema: JsonValue,
  options: SingleEmbeddedSchemaOptions,
): CompiledSchema {
  const pointer = options.pointer ?? ''
  const compiled = compileEmbeddedSchemas([{ pointer, schema }], options)
  return compiled.get(pointer)!
}

export function compileEmbeddedSchemas(
  entries: readonly EmbeddedSchemaSource[],
  options: EmbeddedSchemaOptions,
): ReadonlyMap<string, CompiledSchema> {
  const builder = new GraphBuilder(options.path)
  builder.addEmbeddedRoots(entries, options.rootDefs)
  const graph = builder.finish()
  const result = new Map<string, CompiledSchema>()
  for (const entry of entries) {
    result.set(entry.pointer, new CompiledSchemaImpl(graph, entry.pointer))
  }
  return result
}

class GraphBuilder {
  private readonly nodes = new Map<string, SchemaNode>()
  private readonly definitionPointers = new Map<string, string>()
  private readonly references = new Map<string, string>()
  private nodeCount = 0

  constructor(private readonly path: string) {}

  addFileRoot(root: JsonObject): void {
    this.visit(root, '', 1, true)
  }

  addEmbeddedRoots(entries: readonly EmbeddedSchemaSource[], rootDefs?: JsonObject): void {
    if (entries.length === 0) {
      this.fail('SCHEMA_INVALID', 'at least one embedded schema is required', '')
    }
    this.validateJsonValue(rootDefs, '/$defs')
    if (rootDefs !== undefined) {
      for (const name of orderedKeys(rootDefs)) {
        this.validateDefinitionName(name, '/$defs')
        const pointer = `/$defs/${escapePointer(name)}`
        this.definitionPointers.set(name, pointer)
        this.visit(rootDefs[name]!, pointer, 1, false)
      }
    }
    for (const entry of entries) {
      validatePointer(entry.pointer, this.path)
      if (entry.pointer === '/$defs' || entry.pointer.startsWith('/$defs/')) {
        this.fail(
          'SCHEMA_INVALID',
          'an embedded schema root overlaps descriptor $defs',
          entry.pointer,
        )
      }
      this.validateJsonValue(entry.schema, entry.pointer)
      this.visit(entry.schema, entry.pointer, 1, false)
    }
  }

  finish(): SchemaGraph {
    this.resolveReferences()
    this.rejectReferenceCycles()
    return { path: this.path, nodes: this.nodes, references: this.references }
  }

  private validateJsonValue(value: unknown, pointer: string): void {
    if (value === undefined) return
    try {
      validateJson1(value)
    } catch (error) {
      if (error instanceof Json1Error) {
        throw diagnostic('SCHEMA_INVALID_JSON', error.message, this.path, pointer)
      }
      throw error
    }
  }

  private visit(value: JsonValue, pointer: string, depth: number, allowDefinitions: boolean): void {
    if (depth > SCHEMA_1_LIMITS.depth) {
      this.fail(
        'SCHEMA_LIMIT_EXCEEDED',
        `schema nesting exceeds depth ${SCHEMA_1_LIMITS.depth}`,
        pointer,
      )
    }
    if (typeof value !== 'boolean' && !isObject(value)) {
      this.fail(
        'SCHEMA_INVALID',
        'a schema-valued position must contain an object or boolean',
        pointer,
      )
    }
    if (this.nodes.has(pointer)) {
      this.fail('SCHEMA_INVALID', `duplicate embedded schema pointer ${pointer}`, pointer)
    }
    this.nodeCount += 1
    if (this.nodeCount > SCHEMA_1_LIMITS.nodes) {
      this.fail(
        'SCHEMA_LIMIT_EXCEEDED',
        `schema graph exceeds ${SCHEMA_1_LIMITS.nodes} nodes`,
        pointer,
      )
    }
    const schema = value as SchemaValue
    this.nodes.set(pointer, { pointer, schema })
    if (typeof schema === 'boolean') return

    for (const keyword of orderedKeys(schema)) {
      if (!KEYWORDS.has(keyword)) {
        this.fail(
          'SCHEMA_KEYWORD_UNSUPPORTED',
          `unsupported Schema/1 keyword ${keyword}`,
          childPointer(pointer, keyword),
          keyword,
        )
      }
    }

    for (const keyword of orderedKeys(schema)) {
      const value = schema[keyword]!
      const keywordPointer = childPointer(pointer, keyword)
      switch (keyword) {
        case '$schema':
          if (pointer !== '' || !allowDefinitions || value !== SCHEMA_1_URI) {
            this.fail(
              'SCHEMA_INVALID',
              '$schema is allowed only as the exact file-root declaration',
              keywordPointer,
              keyword,
            )
          }
          break
        case '$defs': {
          if (!allowDefinitions) {
            this.fail(
              'SCHEMA_INVALID',
              '$defs is allowed only on a Schema/1 file root',
              keywordPointer,
              keyword,
            )
          }
          const definitions = this.objectValue(value, keywordPointer, keyword)
          for (const name of orderedKeys(definitions)) {
            this.validateDefinitionName(name, keywordPointer)
            const definitionPointer = childPointer(keywordPointer, name)
            this.definitionPointers.set(name, definitionPointer)
            this.visit(definitions[name]!, definitionPointer, depth + 1, false)
          }
          break
        }
        case '$ref':
          this.stringValue(value, keywordPointer, keyword)
          break
        case '$comment':
        case 'title':
        case 'description':
          this.stringValue(value, keywordPointer, keyword)
          break
        case 'examples':
          this.arrayValue(value, keywordPointer, keyword)
          break
        case 'type':
          this.validateType(value, keywordPointer)
          break
        case 'enum':
          this.validateEnum(value, keywordPointer)
          break
        case 'const':
          if (!isScalar(value))
            this.fail(
              'SCHEMA_INVALID',
              'const is limited to a JSON/1 scalar',
              keywordPointer,
              keyword,
            )
          break
        case 'allOf':
        case 'anyOf':
        case 'oneOf': {
          const schemas = this.arrayValue(value, keywordPointer, keyword)
          if (schemas.length === 0)
            this.fail('SCHEMA_INVALID', `${keyword} must not be empty`, keywordPointer, keyword)
          this.visitSchemaArray(schemas, keywordPointer, depth)
          break
        }
        case 'prefixItems': {
          const schemas = this.arrayValue(value, keywordPointer, keyword)
          if (schemas.length === 0)
            this.fail('SCHEMA_INVALID', 'prefixItems must not be empty', keywordPointer, keyword)
          this.visitSchemaArray(schemas, keywordPointer, depth)
          break
        }
        case 'not':
        case 'if':
        case 'then':
        case 'else':
        case 'additionalProperties':
        case 'items':
        case 'contains':
          this.visit(value, keywordPointer, depth + 1, false)
          break
        case 'properties':
        case 'dependentSchemas': {
          const schemas = this.objectValue(value, keywordPointer, keyword)
          for (const name of orderedKeys(schemas)) {
            this.visit(schemas[name]!, childPointer(keywordPointer, name), depth + 1, false)
          }
          break
        }
        case 'required':
          this.stringArray(value, keywordPointer, keyword)
          break
        case 'dependentRequired': {
          const dependencies = this.objectValue(value, keywordPointer, keyword)
          for (const name of orderedKeys(dependencies)) {
            this.stringArray(dependencies[name]!, childPointer(keywordPointer, name), keyword)
          }
          break
        }
        case 'minProperties':
        case 'maxProperties':
        case 'minContains':
        case 'maxContains':
        case 'minItems':
        case 'maxItems':
        case 'minLength':
        case 'maxLength':
          this.nonnegativeInteger(value, keywordPointer, keyword)
          break
        case 'minimum':
        case 'exclusiveMinimum':
        case 'maximum':
        case 'exclusiveMaximum':
          if (typeof value !== 'number')
            this.fail('SCHEMA_INVALID', `${keyword} must be a number`, keywordPointer, keyword)
          break
      }
    }
  }

  private visitSchemaArray(values: readonly JsonValue[], pointer: string, depth: number): void {
    for (let index = 0; index < values.length; index += 1) {
      this.visit(values[index]!, `${pointer}/${index}`, depth + 1, false)
    }
  }

  private validateType(value: JsonValue, pointer: string): void {
    if (typeof value === 'string') {
      if (!SIMPLE_TYPES.has(value))
        this.fail('SCHEMA_INVALID', `unknown type ${value}`, pointer, 'type')
      return
    }
    const values = this.arrayValue(value, pointer, 'type')
    if (values.length === 0)
      this.fail('SCHEMA_INVALID', 'type array must not be empty', pointer, 'type')
    const seen = new Set<string>()
    for (const item of values) {
      if (typeof item !== 'string' || !SIMPLE_TYPES.has(item)) {
        this.fail('SCHEMA_INVALID', 'type array contains an unknown type', pointer, 'type')
      }
      if (seen.has(item))
        this.fail('SCHEMA_INVALID', 'type array contains a duplicate', pointer, 'type')
      seen.add(item)
    }
  }

  private validateEnum(value: JsonValue, pointer: string): void {
    const values = this.arrayValue(value, pointer, 'enum')
    for (const item of values) {
      if (!isScalar(item))
        this.fail('SCHEMA_INVALID', 'enum is limited to JSON/1 scalars', pointer, 'enum')
    }
  }

  private stringValue(value: JsonValue, pointer: string, keyword: string): string {
    if (typeof value !== 'string')
      this.fail('SCHEMA_INVALID', `${keyword} must be a string`, pointer, keyword)
    return value
  }

  private arrayValue(value: JsonValue, pointer: string, keyword: string): readonly JsonValue[] {
    if (!Array.isArray(value))
      this.fail('SCHEMA_INVALID', `${keyword} must be an array`, pointer, keyword)
    return value
  }

  private objectValue(value: JsonValue, pointer: string, keyword: string): JsonObject {
    if (!isObject(value))
      this.fail('SCHEMA_INVALID', `${keyword} must be an object`, pointer, keyword)
    return value
  }

  private stringArray(value: JsonValue, pointer: string, keyword: string): readonly string[] {
    const values = this.arrayValue(value, pointer, keyword)
    const seen = new Set<string>()
    for (const item of values) {
      if (typeof item !== 'string')
        this.fail('SCHEMA_INVALID', `${keyword} must contain only strings`, pointer, keyword)
      if (seen.has(item))
        this.fail('SCHEMA_INVALID', `${keyword} must contain unique strings`, pointer, keyword)
      seen.add(item)
    }
    return values as readonly string[]
  }

  private nonnegativeInteger(value: JsonValue, pointer: string, keyword: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      this.fail('SCHEMA_INVALID', `${keyword} must be a non-negative integer`, pointer, keyword)
    }
    return value
  }

  private validateDefinitionName(name: string, defsPointer: string): void {
    if (!DEFINITION_NAME.test(name)) {
      this.fail(
        'SCHEMA_INVALID',
        `invalid Schema/1 definition name ${JSON.stringify(name)}`,
        childPointer(defsPointer, name),
        '$defs',
      )
    }
  }

  private resolveReferences(): void {
    for (const node of this.nodes.values()) {
      if (typeof node.schema === 'boolean' || node.schema.$ref === undefined) continue
      const reference = node.schema.$ref
      if (typeof reference !== 'string') continue
      const name = decodeDefinitionReference(reference)
      if (name === undefined) {
        this.fail(
          'SCHEMA_REFERENCE_INVALID',
          `$ref is not an allowed local definition pointer: ${reference}`,
          childPointer(node.pointer, '$ref'),
          '$ref',
        )
      }
      const target = this.definitionPointers.get(name)
      if (target === undefined) {
        this.fail(
          'SCHEMA_REFERENCE_INVALID',
          `$ref target does not exist: ${reference}`,
          childPointer(node.pointer, '$ref'),
          '$ref',
        )
      }
      this.references.set(node.pointer, target)
    }
  }

  private rejectReferenceCycles(): void {
    const namesByPointer = new Map<string, string>()
    for (const [name, pointer] of this.definitionPointers) namesByPointer.set(pointer, name)
    const dependencies = new Map<string, Map<string, string>>()
    for (const [name, pointer] of this.definitionPointers) {
      const targets = new Map<string, string>()
      for (const [sourcePointer, targetPointer] of this.references) {
        if (sourcePointer === pointer || sourcePointer.startsWith(`${pointer}/`)) {
          targets.set(namesByPointer.get(targetPointer)!, sourcePointer)
        }
      }
      dependencies.set(name, targets)
    }

    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (name: string): void => {
      if (visited.has(name)) return
      visiting.add(name)
      for (const [target, sourcePointer] of dependencies.get(name) ?? []) {
        if (visiting.has(target)) {
          this.fail(
            'SCHEMA_REFERENCE_INVALID',
            `cyclic $ref through definition ${target}`,
            childPointer(sourcePointer, '$ref'),
            '$ref',
          )
        }
        visit(target)
      }
      visiting.delete(name)
      visited.add(name)
    }
    for (const name of this.definitionPointers.keys()) visit(name)
  }

  private fail(code: string, message: string, pointer: string, keyword?: string): never {
    throw diagnostic(code, message, this.path, pointer, keyword)
  }
}

class CompiledSchemaImpl implements CompiledSchema {
  readonly path: string

  constructor(
    private readonly graph: SchemaGraph,
    readonly schemaPointer: string,
  ) {
    this.path = graph.path
  }

  validate(instance: unknown, code: string): void {
    try {
      validateJson1(instance)
    } catch (error) {
      if (error instanceof Json1Error) {
        throw diagnostic(code, error.message, this.path, this.schemaPointer, undefined, '')
      }
      throw error
    }
    const state: EvaluationState = { work: 0, memo: new Map() }
    const result = evaluate(this.graph, this.schemaPointer, instance as JsonValue, '', state)
    if (!result.valid) {
      const failure = result.failure!
      throw diagnostic(
        code,
        `value does not satisfy ${failure.keyword ?? 'the schema'}`,
        this.path,
        failure.schemaPointer,
        failure.keyword,
        failure.instancePointer,
      )
    }
  }
}

function evaluate(
  graph: SchemaGraph,
  schemaPointer: string,
  instance: JsonValue,
  instancePointer: string,
  state: EvaluationState,
): EvaluationResult {
  const schemaMemo = state.memo.get(schemaPointer)
  const memoized = schemaMemo?.get(instancePointer)
  if (memoized !== undefined) return memoized
  charge(state, 1, graph.path, schemaPointer, instancePointer)
  const node = graph.nodes.get(schemaPointer)
  if (node === undefined) throw new Error(`internal Schema/1 node missing at ${schemaPointer}`)
  if (node.schema === true) {
    const valid = { valid: true } as const
    memoize(state, schemaPointer, instancePointer, valid)
    return valid
  }
  if (node.schema === false) {
    const invalid = { valid: false, failure: { instancePointer, schemaPointer } } as const
    memoize(state, schemaPointer, instancePointer, invalid)
    return invalid
  }

  const schema = node.schema
  let failure: EvaluationFailure | undefined
  const retain = (candidate: EvaluationFailure | undefined): void => {
    if (failure === undefined && candidate !== undefined) failure = candidate
  }
  const reject = (keyword: string, at = instancePointer): void => {
    retain({ instancePointer: at, schemaPointer: childPointer(schemaPointer, keyword), keyword })
  }
  const evaluateChild = (pointer: string, value: JsonValue, at: string): EvaluationResult =>
    evaluate(graph, pointer, value, at, state)

  if (schema.$ref !== undefined) {
    charge(state, 1, graph.path, childPointer(schemaPointer, '$ref'), instancePointer)
    retain(evaluateChild(graph.references.get(schemaPointer)!, instance, instancePointer).failure)
  }

  if (schema.type !== undefined) {
    const types =
      typeof schema.type === 'string' ? [schema.type] : (schema.type as readonly string[])
    charge(state, types.length, graph.path, childPointer(schemaPointer, 'type'), instancePointer)
    if (!types.some((type) => hasType(instance, type))) reject('type')
  }

  if (schema.const !== undefined) {
    charge(state, 1, graph.path, childPointer(schemaPointer, 'const'), instancePointer)
    if (!scalarEqual(instance, schema.const as JsonScalar)) reject('const')
  }
  if (schema.enum !== undefined) {
    const values = schema.enum as readonly JsonScalar[]
    charge(state, values.length, graph.path, childPointer(schemaPointer, 'enum'), instancePointer)
    let matched = false
    for (const value of values) if (scalarEqual(instance, value)) matched = true
    if (!matched) reject('enum')
  }

  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (schema[keyword] === undefined) continue
    const branches = schema[keyword] as readonly JsonValue[]
    charge(
      state,
      branches.length,
      graph.path,
      childPointer(schemaPointer, keyword),
      instancePointer,
    )
    let validBranches = 0
    let firstBranchFailure: EvaluationFailure | undefined
    for (let index = 0; index < branches.length; index += 1) {
      const result = evaluateChild(
        `${childPointer(schemaPointer, keyword)}/${index}`,
        instance,
        instancePointer,
      )
      if (result.valid) validBranches += 1
      else if (firstBranchFailure === undefined) firstBranchFailure = result.failure
    }
    if (keyword === 'allOf' && validBranches !== branches.length) retain(firstBranchFailure)
    if (keyword === 'anyOf' && validBranches === 0) reject(keyword)
    if (keyword === 'oneOf' && validBranches !== 1) reject(keyword)
  }

  if (schema.not !== undefined) {
    charge(state, 1, graph.path, childPointer(schemaPointer, 'not'), instancePointer)
    if (evaluateChild(childPointer(schemaPointer, 'not'), instance, instancePointer).valid)
      reject('not')
  }
  if (schema.if !== undefined) {
    charge(state, 1, graph.path, childPointer(schemaPointer, 'if'), instancePointer)
    const condition = evaluateChild(childPointer(schemaPointer, 'if'), instance, instancePointer)
    const selected = condition.valid ? 'then' : 'else'
    if (schema[selected] !== undefined) {
      charge(state, 1, graph.path, childPointer(schemaPointer, selected), instancePointer)
      retain(
        evaluateChild(childPointer(schemaPointer, selected), instance, instancePointer).failure,
      )
    }
  }

  if (isObject(instance)) {
    const instanceKeys = orderedKeys(instance)
    const properties = isObject(schema.properties) ? schema.properties : undefined
    if (properties !== undefined) {
      const names = orderedKeys(properties)
      charge(
        state,
        names.length,
        graph.path,
        childPointer(schemaPointer, 'properties'),
        instancePointer,
      )
      for (const name of names) {
        if (!Object.hasOwn(instance, name)) continue
        retain(
          evaluateChild(
            childPointer(childPointer(schemaPointer, 'properties'), name),
            instance[name]!,
            childPointer(instancePointer, name),
          ).failure,
        )
      }
    }
    if (schema.required !== undefined) {
      const names = schema.required as readonly string[]
      charge(
        state,
        names.length,
        graph.path,
        childPointer(schemaPointer, 'required'),
        instancePointer,
      )
      for (const name of names) if (!Object.hasOwn(instance, name)) reject('required')
    }
    if (schema.additionalProperties !== undefined) {
      charge(
        state,
        instanceKeys.length,
        graph.path,
        childPointer(schemaPointer, 'additionalProperties'),
        instancePointer,
      )
      const declared = new Set(properties === undefined ? [] : Object.keys(properties))
      for (const name of instanceKeys) {
        if (declared.has(name)) continue
        retain(
          evaluateChild(
            childPointer(schemaPointer, 'additionalProperties'),
            instance[name]!,
            childPointer(instancePointer, name),
          ).failure,
        )
      }
    }
    if (schema.minProperties !== undefined) {
      charge(state, 1, graph.path, childPointer(schemaPointer, 'minProperties'), instancePointer)
      if (instanceKeys.length < (schema.minProperties as number)) reject('minProperties')
    }
    if (schema.maxProperties !== undefined) {
      charge(state, 1, graph.path, childPointer(schemaPointer, 'maxProperties'), instancePointer)
      if (instanceKeys.length > (schema.maxProperties as number)) reject('maxProperties')
    }
    if (isObject(schema.dependentRequired)) {
      for (const trigger of orderedKeys(schema.dependentRequired)) {
        charge(
          state,
          1,
          graph.path,
          childPointer(childPointer(schemaPointer, 'dependentRequired'), trigger),
          instancePointer,
        )
        if (!Object.hasOwn(instance, trigger)) continue
        const names = schema.dependentRequired[trigger] as readonly string[]
        charge(
          state,
          names.length,
          graph.path,
          childPointer(childPointer(schemaPointer, 'dependentRequired'), trigger),
          instancePointer,
        )
        for (const name of names) if (!Object.hasOwn(instance, name)) reject('dependentRequired')
      }
    }
    if (isObject(schema.dependentSchemas)) {
      for (const trigger of orderedKeys(schema.dependentSchemas)) {
        charge(
          state,
          1,
          graph.path,
          childPointer(childPointer(schemaPointer, 'dependentSchemas'), trigger),
          instancePointer,
        )
        if (!Object.hasOwn(instance, trigger)) continue
        retain(
          evaluateChild(
            childPointer(childPointer(schemaPointer, 'dependentSchemas'), trigger),
            instance,
            instancePointer,
          ).failure,
        )
      }
    }
  }

  if (Array.isArray(instance)) {
    const prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems : undefined
    if (prefixItems !== undefined) {
      charge(
        state,
        prefixItems.length,
        graph.path,
        childPointer(schemaPointer, 'prefixItems'),
        instancePointer,
      )
      for (let index = 0; index < prefixItems.length && index < instance.length; index += 1) {
        retain(
          evaluateChild(
            `${childPointer(schemaPointer, 'prefixItems')}/${index}`,
            instance[index]!,
            `${instancePointer}/${index}`,
          ).failure,
        )
      }
    }
    if (schema.items !== undefined) {
      charge(state, 1, graph.path, childPointer(schemaPointer, 'items'), instancePointer)
      for (let index = prefixItems?.length ?? 0; index < instance.length; index += 1) {
        retain(
          evaluateChild(
            childPointer(schemaPointer, 'items'),
            instance[index]!,
            `${instancePointer}/${index}`,
          ).failure,
        )
      }
    }
    if (schema.contains !== undefined) {
      let matches = 0
      for (let index = 0; index < instance.length; index += 1) {
        charge(
          state,
          1,
          graph.path,
          childPointer(schemaPointer, 'contains'),
          `${instancePointer}/${index}`,
        )
        if (
          evaluateChild(
            childPointer(schemaPointer, 'contains'),
            instance[index]!,
            `${instancePointer}/${index}`,
          ).valid
        ) {
          matches += 1
        }
      }
      if (schema.minContains !== undefined) {
        charge(state, 1, graph.path, childPointer(schemaPointer, 'minContains'), instancePointer)
        if (matches < (schema.minContains as number)) reject('minContains')
      } else if (matches < 1) {
        reject('contains')
      }
      if (schema.maxContains !== undefined) {
        charge(state, 1, graph.path, childPointer(schemaPointer, 'maxContains'), instancePointer)
        if (matches > (schema.maxContains as number)) reject('maxContains')
      }
    }
    if (schema.minItems !== undefined) {
      charge(state, 1, graph.path, childPointer(schemaPointer, 'minItems'), instancePointer)
      if (instance.length < (schema.minItems as number)) reject('minItems')
    }
    if (schema.maxItems !== undefined) {
      charge(state, 1, graph.path, childPointer(schemaPointer, 'maxItems'), instancePointer)
      if (instance.length > (schema.maxItems as number)) reject('maxItems')
    }
  }

  if (typeof instance === 'string') {
    if (schema.minLength !== undefined || schema.maxLength !== undefined) {
      charge(state, unicodeScalarLength(instance), graph.path, schemaPointer, instancePointer)
    }
    if (schema.minLength !== undefined) {
      charge(state, 1, graph.path, childPointer(schemaPointer, 'minLength'), instancePointer)
      if (unicodeScalarLength(instance) < (schema.minLength as number)) reject('minLength')
    }
    if (schema.maxLength !== undefined) {
      charge(state, 1, graph.path, childPointer(schemaPointer, 'maxLength'), instancePointer)
      if (unicodeScalarLength(instance) > (schema.maxLength as number)) reject('maxLength')
    }
  }

  if (typeof instance === 'number') {
    for (const keyword of ['minimum', 'exclusiveMinimum', 'maximum', 'exclusiveMaximum'] as const) {
      const bound = schema[keyword] as number | undefined
      if (bound === undefined) continue
      charge(state, 1, graph.path, childPointer(schemaPointer, keyword), instancePointer)
      if (
        (keyword === 'minimum' && instance < bound) ||
        (keyword === 'exclusiveMinimum' && instance <= bound) ||
        (keyword === 'maximum' && instance > bound) ||
        (keyword === 'exclusiveMaximum' && instance >= bound)
      )
        reject(keyword)
    }
  }

  const result: EvaluationResult =
    failure === undefined ? { valid: true } : { valid: false, failure }
  memoize(state, schemaPointer, instancePointer, result)
  return result
}

function memoize(
  state: EvaluationState,
  schemaPointer: string,
  instancePointer: string,
  result: EvaluationResult,
): void {
  let instances = state.memo.get(schemaPointer)
  if (instances === undefined) {
    instances = new Map()
    state.memo.set(schemaPointer, instances)
  }
  instances.set(instancePointer, result)
}

function charge(
  state: EvaluationState,
  units: number,
  path: string,
  schemaPointer: string,
  instancePointer: string,
): void {
  if (state.work + units > SCHEMA_1_LIMITS.work) {
    throw diagnostic(
      'SCHEMA_LIMIT_EXCEEDED',
      `Schema/1 validation exceeds ${SCHEMA_1_LIMITS.work} work units`,
      path,
      schemaPointer,
      undefined,
      instancePointer,
    )
  }
  state.work += units
}

function diagnostic(
  code: string,
  message: string,
  path: string,
  schemaPointer: string,
  keyword?: string,
  instancePointer = '',
): SchemaDiagnostic {
  return new SchemaDiagnostic(message, {
    code,
    instancePointer,
    schemaPointer,
    path,
    ...(keyword === undefined ? {} : { keyword }),
  })
}

function hasType(value: JsonValue, type: string): boolean {
  switch (type) {
    case 'null':
      return value === null
    case 'boolean':
      return typeof value === 'boolean'
    case 'object':
      return isObject(value)
    case 'array':
      return Array.isArray(value)
    case 'number':
      return typeof value === 'number'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'string':
      return typeof value === 'string'
    default:
      return false
  }
}

function scalarEqual(value: JsonValue, expected: JsonScalar): boolean {
  return (
    isScalar(value) &&
    (typeof value !== 'number' || typeof expected !== 'number'
      ? value === expected
      : value === expected ||
        (Object.is(value, -0) && Object.is(expected, 0)) ||
        (Object.is(value, 0) && Object.is(expected, -0)))
  )
}

function isScalar(value: JsonValue): value is JsonScalar {
  return (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  )
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function orderedKeys(value: JsonObject): string[] {
  return Object.keys(value).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function childPointer(parent: string, token: string): string {
  return `${parent}/${escapePointer(token)}`
}

function escapePointer(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1')
}

function validatePointer(pointer: string, path: string): void {
  if (pointer === '') return
  if (!pointer.startsWith('/') || /~(?:[^01]|$)/.test(pointer)) {
    throw diagnostic('SCHEMA_INVALID', `invalid embedded schema pointer ${pointer}`, path, pointer)
  }
}

function decodeDefinitionReference(reference: string): string | undefined {
  const prefix = '#/$defs/'
  if (!reference.startsWith(prefix)) return undefined
  const name = reference.slice(prefix.length)
  return DEFINITION_NAME.test(name) ? name : undefined
}

function unicodeScalarLength(value: string): number {
  let length = 0
  for (const _scalar of value) length += 1
  return length
}
