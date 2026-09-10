import { Node, Parser } from 'commonmark'

import { CheckError, invalid, unavailable } from '../diagnostics.js'
import type {
  InvocationContractDescriptor,
  InvocationOperationDescriptor,
  ParsedInvocationContract,
} from '../invocation-contract.js'
import { decodeJson1, Json1Error, type JsonValue } from '../json.js'
import { type FlowMetadata, parseFlowDocument } from '../package/metadata.js'

export const MARKDOWN_LIMITS = Object.freeze({
  bodyBytes: 262_144,
  nodes: 4_096,
  depth: 64,
  recipes: 256,
  activations: 256,
  reasoningCalls: 32,
  resourceBytes: 1_048_576,
  valueBytes: 8_388_608,
  requestBytes: 1_048_576,
  conversationBytes: 8_388_608,
})
export const MARKDOWN_AGENT_SLOT = 'markdown-agent'
export const MARKDOWN_PARSER = Object.freeze({ name: 'commonmark', version: '0.31.2' })
export type MarkdownToolPolicy = 'recipes-and-read' | 'read' | 'none' | 'unsupported'
export type RecipeOperand =
  | { readonly kind: 'literal'; readonly value: JsonValue }
  | { readonly kind: 'input' | 'previous' | 'value' | 'fresh' }
export type RecipeInstruction =
  | {
      readonly operation: 'call' | 'send'
      readonly target: string
      readonly operand: RecipeOperand
    }
  | { readonly operation: 'receive' | 'close'; readonly target: string }
  | { readonly operation: 'return'; readonly operand: RecipeOperand }
export interface RecipeDiagnostic {
  readonly code: string
  readonly message: string
}
export interface FrozenRecipe {
  readonly index: number
  readonly span: {
    readonly start: number
    readonly end: number
    readonly line: number
    readonly endLine: number
  }
  readonly instruction?: RecipeInstruction
  readonly diagnostic?: RecipeDiagnostic
}
export interface CompiledMarkdown {
  readonly mode: 'direct' | 'mixed'
  readonly body: string
  readonly metadata: FlowMetadata
  readonly invocation: InvocationOperationDescriptor
  readonly contract?: InvocationContractDescriptor
  readonly slotContracts: Readonly<Record<string, InvocationContractDescriptor>>
  readonly recipes: readonly FrozenRecipe[]
  readonly toolPolicy: MarkdownToolPolicy
  readonly parser: typeof MARKDOWN_PARSER
  readonly limits: typeof MARKDOWN_LIMITS
}
export interface MarkdownCompileOptions {
  readonly contract?: ParsedInvocationContract
  readonly usedContracts?: readonly {
    readonly slot: string
    readonly contract: ParsedInvocationContract
  }[]
}

interface SourceLine {
  readonly text: string
  readonly start: number
  readonly end: number
}
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/
const WHITESPACE = /^[ \t\r\n]*(?![\s\S])/

/** Compile only original entrypoint nodes; resource and model text never enter this parser. */
export function compileMarkdown(
  source: Uint8Array,
  options: MarkdownCompileOptions = {},
): CompiledMarkdown {
  if (source.byteLength > MARKDOWN_LIMITS.bodyBytes + 262_144)
    unavailable(
      'MARKDOWN_LIMIT',
      'Markdown source exceeds the combined frontmatter and body bounds.',
      'FLOW.md',
    )
  const parsed = parseFlowDocument(source)
  const { markdown: body, metadata } = parsed
  const bodyBytes = Buffer.byteLength(body)
  if (bodyBytes > MARKDOWN_LIMITS.bodyBytes)
    unavailable('MARKDOWN_LIMIT', 'Markdown body exceeds 256 KiB.', 'FLOW.md')
  if (WHITESPACE.test(body))
    unavailable('MARKDOWN_EMPTY', 'The Markdown procedure body is empty.', 'FLOW.md')
  const offset = source.byteLength - bodyBytes
  const lines = sourceLines(body)
  const root = parseBoundedCommonMark(body)
  const invocation = options.contract?.invocation ?? Object.freeze({})
  const slotContracts: Record<string, InvocationContractDescriptor> = Object.create(null)
  for (const reference of options.usedContracts ?? [])
    slotContracts[reference.slot] = reference.contract.descriptor
  const policy = toolPolicy(metadata['allowed-tools'])
  const recipes: FrozenRecipe[] = []
  const spans: { start: number; end: number }[] = []
  for (let node = root.firstChild; node !== null; node = node.next) {
    if (node.type !== 'code_block') continue
    const [start, end] = node.sourcepos
    const first = lines[start[0] - 1]
    const last = lines[end[0] - 1]
    if (first === undefined || last === undefined)
      throw new Error('CommonMark source position is outside its admitted body')
    const opening = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)(?![\s\S])/.exec(first.text)
    if (opening === null || opening[3]!.replace(/^[ \t]+|[ \t]+$/g, '') !== 'flow') continue
    if (recipes.length >= MARKDOWN_LIMITS.recipes)
      unavailable('MARKDOWN_LIMIT', 'Markdown has more than 256 candidate recipes.', 'FLOW.md')
    const fence = opening[2]!
    const closing = /^( {0,3})(`{3,}|~{3,})[ \t]*(?![\s\S])/.exec(last.text)
    const closed =
      end[0] > start[0] &&
      closing !== null &&
      closing[2]![0] === fence[0] &&
      closing[2]!.length >= fence.length
    let instruction: RecipeInstruction | undefined
    let diagnostic: RecipeDiagnostic | undefined
    if (!closed)
      diagnostic = {
        code: 'MARKDOWN_FENCE_UNCLOSED',
        message: 'The candidate recipe has no explicit matching closing fence.',
      }
    else {
      try {
        instruction = parseInstruction(node.literal ?? '')
        diagnostic = instructionAvailability(instruction, metadata, invocation, policy)
      } catch (error) {
        if (!(error instanceof CheckError || error instanceof Json1Error)) throw error
        diagnostic = {
          code: 'MARKDOWN_RECIPE_INVALID',
          message: 'The candidate must contain exactly one valid FLOW SDK instruction.',
        }
      }
    }
    const span = {
      start: offset + Buffer.byteLength(body.slice(0, first.start)),
      end: offset + Buffer.byteLength(body.slice(0, last.end)),
      line: start[0],
      endLine: end[0],
    }
    spans.push({ start: first.start, end: last.end })
    recipes.push(
      freeze({
        index: recipes.length + 1,
        span,
        ...(instruction === undefined ? {} : { instruction }),
        ...(diagnostic === undefined ? {} : { diagnostic }),
      }),
    )
  }
  let cursor = 0
  let direct = recipes.length > 0
  for (const span of spans) {
    if (!WHITESPACE.test(body.slice(cursor, span.start))) direct = false
    cursor = span.end
  }
  if (!WHITESPACE.test(body.slice(cursor))) direct = false
  if (direct) {
    if (recipes.some((recipe) => recipe.diagnostic !== undefined))
      unavailable(
        'MARKDOWN_DIRECT_UNAVAILABLE',
        'Every direct recipe, including unreachable recipes, must be available.',
        'FLOW.md',
      )
    if (!recipes.some((recipe) => recipe.instruction?.operation === 'return'))
      unavailable(
        'MARKDOWN_DIRECT_RETURN',
        'A direct Markdown procedure requires an explicit return recipe.',
        'FLOW.md',
      )
    if (
      recipes.some(
        (recipe) =>
          recipe.instruction !== undefined &&
          'operand' in recipe.instruction &&
          ['value', 'fresh'].includes(recipe.instruction.operand.kind),
      )
    )
      unavailable(
        'MARKDOWN_DIRECT_OPERAND',
        'Direct recipes cannot use @value or ? operands.',
        'FLOW.md',
      )
  }
  return freeze({
    mode: direct ? 'direct' : 'mixed',
    body,
    metadata,
    invocation,
    ...(options.contract === undefined ? {} : { contract: options.contract.descriptor }),
    slotContracts,
    recipes,
    toolPolicy: policy,
    parser: MARKDOWN_PARSER,
    limits: MARKDOWN_LIMITS,
  })
}

function toolPolicy(value: string | undefined): MarkdownToolPolicy {
  if (value === undefined) return 'recipes-and-read'
  const trimmed = value.replace(/^ +| +$/g, '')
  if (trimmed === '') return 'none'
  return trimmed === 'Read' ? 'read' : 'unsupported'
}

function parseInstruction(source: string): RecipeInstruction {
  const instruction = source.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
  const match = /^([a-z]+)[ \t]+([\s\S]+)(?![\s\S])/.exec(instruction)
  if (match === null) invalid('MARKDOWN_RECIPE_INVALID', 'Missing instruction operands.')
  const operation = match[1]
  const remainder = match[2]!
  if (operation === 'return') return { operation, operand: parseOperand(remainder) }
  if (operation === 'close' || operation === 'receive') {
    requireLocalName(remainder)
    return { operation, target: remainder }
  }
  if (operation === 'call' || operation === 'send') {
    const parts = /^([^ \t\r\n]+)[ \t]+([\s\S]+)(?![\s\S])/.exec(remainder)
    if (parts === null) invalid('MARKDOWN_RECIPE_INVALID', 'Missing target or operand.')
    requireLocalName(parts[1]!)
    return { operation, target: parts[1]!, operand: parseOperand(parts[2]!) }
  }
  return invalid('MARKDOWN_RECIPE_INVALID', 'Unsupported SDK instruction.')
}

function parseOperand(source: string): RecipeOperand {
  const reserved: Record<string, 'input' | 'previous' | 'value' | 'fresh'> = {
    '@input': 'input',
    '@previous': 'previous',
    '@value': 'value',
    '?': 'fresh',
  }
  const kind = Object.hasOwn(reserved, source) ? reserved[source] : undefined
  return kind === undefined
    ? { kind: 'literal', value: decodeJson1(new TextEncoder().encode(source)) }
    : { kind }
}

function instructionAvailability(
  instruction: RecipeInstruction,
  metadata: FlowMetadata,
  invocation: InvocationOperationDescriptor,
  policy: MarkdownToolPolicy,
): RecipeDiagnostic | undefined {
  if (instruction.operation === 'return') return undefined
  if (instruction.operation !== 'close' && policy !== 'recipes-and-read')
    return {
      code: 'MARKDOWN_RECIPE_RESTRICTED',
      message: 'The allowed-tools restriction excludes this effect recipe.',
    }
  if (instruction.operation === 'call') {
    if (
      instruction.target === MARKDOWN_AGENT_SLOT ||
      !Object.hasOwn(metadata.uses ?? {}, instruction.target)
    )
      return {
        code: 'MARKDOWN_SLOT_UNAVAILABLE',
        message: 'The recipe target is not an authored invocation slot.',
      }
    return undefined
  }
  const channel = invocation.channels?.[instruction.target]
  if (
    channel === undefined ||
    (instruction.operation !== 'close' && channel.direction !== instruction.operation)
  )
    return {
      code: 'MARKDOWN_CHANNEL_UNAVAILABLE',
      message: 'The recipe does not name a channel with the required direction.',
    }
  return undefined
}

function requireLocalName(value: string): void {
  if (value.length > 64 || !LOCAL_NAME.test(value))
    invalid('MARKDOWN_RECIPE_INVALID', 'Instruction target must be a LocalName.')
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== '\r' && source[index] !== '\n') continue
    const text = source.slice(start, index)
    if (source[index] === '\r' && source[index + 1] === '\n') index++
    lines.push({ text, start, end: index + 1 })
    start = index + 1
  }
  if (start < source.length || lines.length === 0)
    lines.push({ text: source.slice(start), start, end: source.length })
  return lines
}

/**
 * The reference parser is synchronous. Guard its public tree mutations during
 * construction and restore them before returning; no asynchronous work or user
 * callbacks run while these scoped guards are installed.
 */
export function parseBoundedCommonMark(source: string): Node {
  const original = {
    appendChild: Node.prototype.appendChild,
    prependChild: Node.prototype.prependChild,
    insertAfter: Node.prototype.insertAfter,
    insertBefore: Node.prototype.insertBefore,
  }
  function rootOf(node: Node): Node {
    while (node.parent !== null) node = node.parent
    return node
  }
  function measure(node: Node): { size: number; depth: number } {
    let size = 0
    let depth = 0
    const pending: { node: Node; depth: number }[] = [{ node, depth: 1 }]
    while (pending.length) {
      const entry = pending.pop()!
      if (++size > MARKDOWN_LIMITS.nodes || entry.depth > MARKDOWN_LIMITS.depth)
        unavailable('MARKDOWN_LIMIT', 'Markdown AST exceeds 4096 nodes or depth 64.', 'FLOW.md')
      depth = Math.max(depth, entry.depth)
      for (let child = entry.node.firstChild; child !== null; child = child.next)
        pending.push({ node: child, depth: entry.depth + 1 })
    }
    return { size, depth }
  }
  function guard(parent: Node, child: Node): void {
    const root = rootOf(parent)
    const base = measure(root)
    const addition = measure(child)
    let depth = 1
    for (let node = parent; node.parent !== null; node = node.parent) depth++
    const size = base.size + (rootOf(child) === root ? 0 : addition.size)
    if (size > MARKDOWN_LIMITS.nodes || depth + addition.depth > MARKDOWN_LIMITS.depth)
      unavailable('MARKDOWN_LIMIT', 'Markdown AST exceeds 4096 nodes or depth 64.', 'FLOW.md')
  }
  Node.prototype.appendChild = function (child): void {
    guard(this, child)
    original.appendChild.call(this, child)
  }
  Node.prototype.prependChild = function (child): void {
    guard(this, child)
    original.prependChild.call(this, child)
  }
  Node.prototype.insertAfter = function (child): void {
    if (this.parent !== null) guard(this.parent, child)
    original.insertAfter.call(this, child)
  }
  Node.prototype.insertBefore = function (child): void {
    if (this.parent !== null) guard(this.parent, child)
    original.insertBefore.call(this, child)
  }
  try {
    const result = new Parser({ smart: false }).parse(source)
    measure(result)
    return result
  } finally {
    Object.assign(Node.prototype, original)
  }
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
