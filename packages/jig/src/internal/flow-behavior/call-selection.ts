import ts from 'typescript-parser'
import {
  type AuthoredCallSelection,
  type AuthoredInputField,
  BEHAVIOR_LIMITS,
  type BehaviorGuard,
  type OmittedCallSites,
  type SourceSite,
  varyingInputFields,
} from './model.js'
import type { SourceIndex } from './source.js'
import {
  constInitializer,
  functionFrame,
  isLocalFunction,
  lexicalGuards,
  shortText,
  sourceNodes,
  unwrap,
} from './source-syntax.js'

type Source = Pick<SourceIndex, 'site' | 'declaration'>

export type CallRequest = {
  readonly receiver: ts.Declaration
  readonly fields: ReadonlyMap<string, ts.Expression | undefined>
}

type SlotChoice = { readonly slot: string; readonly guard?: BehaviorGuard }

function slotChoices(source: Source, value: ts.Expression): readonly SlotChoice[] {
  const expression = unwrap(value)
  if (ts.isStringLiteralLike(expression)) return [{ slot: expression.text }]
  if (!ts.isConditionalExpression(expression)) return []
  const yes = unwrap(expression.whenTrue)
  const no = unwrap(expression.whenFalse)
  if (!ts.isStringLiteralLike(yes) || !ts.isStringLiteralLike(no)) return []
  if (yes.text === no.text) return [{ slot: yes.text }]
  const code = shortText(expression.condition)
  const site = source.site(expression.condition)
  return [
    { slot: yes.text, guard: { code, site, taken: true, unresolved: true } },
    { slot: no.text, guard: { code, site, taken: false, unresolved: true } },
  ]
}

/** Project local source selections independently of route feasibility. */
export function selectCallSites(
  source: Source,
  requests: readonly { call: ts.CallExpression; request: CallRequest }[],
  calls: ReadonlyMap<ts.Declaration, readonly ts.CallExpression[]>,
  slots: ReadonlyMap<string, string>,
  writes: ReadonlySet<ts.Declaration>,
  hasEval: boolean,
): { sites: AuthoredCallSelection[]; omittedBySlot: ReadonlyMap<string, OmittedCallSites> } {
  const groups = new Map<
    string,
    { sites: AuthoredCallSelection[]; count: number; dropped: SourceSite[] }
  >()
  const dispatches = new Map<ts.Node, ts.CallExpression | null>()
  for (const { call } of requests) {
    const frame = functionFrame(call)
    dispatches.set(frame, dispatches.has(frame) ? null : call)
  }
  const limit = BEHAVIOR_LIMITS.focusedCallSelections
  const hasChoice = (entry: AuthoredCallSelection) =>
    entry.inputFields.some((field) => field.guard || field.kind === 'choice')
  const append = (
    { slot, guard }: SlotChoice,
    call: ts.CallExpression,
    input: ts.Expression | undefined,
    requestMetadata: AuthoredCallSelection['requestMetadata'],
    dispatch?: AuthoredCallSelection['dispatch'],
  ) => {
    if (!slots.has(slot)) return
    const guards = lexicalGuards(call, (node) => source.site(node)).slice(-2)
    if (guard) guards.push(guard)
    const item: AuthoredCallSelection = {
      slot,
      site: source.site(call),
      ...(dispatch ? { dispatch } : {}),
      guards,
      requestMetadata,
      ...(input ? { inputSite: source.site(input) } : {}),
      inputFields: selectedInputs(source, input, writes, hasEval),
    }
    const group = groups.get(slot) ?? { sites: [], count: 0, dropped: [] }
    group.count++
    groups.set(slot, group)
    const insert = hasChoice(item) ? group.sites.findIndex((entry) => !hasChoice(entry)) : -1
    if (insert >= 0) group.sites.splice(insert, 0, item)
    else group.sites.push(item)
    if (group.sites.length > limit) {
      const dropped = group.sites.pop()!
      if (group.dropped.length < BEHAVIOR_LIMITS.focusedOmittedCallLocations)
        group.dropped.push(dropped.site)
    }
  }
  for (const { call, request } of requests) {
    const slot = request.fields.get('slot')
    const input = request.fields.get('input')
    const requestMetadata = (['operationId', 'intent'] as const).flatMap((field) => {
      const value = request.fields.get(field)
      return value ? [{ field, code: shortText(value), site: source.site(value) }] : []
    })
    if (slot) {
      const choices = slotChoices(source, slot)
      if (choices.length > 0) {
        for (const choice of choices) append(choice, call, input, requestMetadata)
        continue
      }
    }
    if (hasEval || !slot || !ts.isIdentifier(slot) || writes.has(request.receiver)) continue
    const parameter = source.declaration(slot)
    if (!parameter || !ts.isParameter(parameter) || writes.has(parameter)) continue
    const fn = parameter.parent
    if (
      !isLocalFunction(fn) ||
      fn.asteriskToken ||
      !fn.body ||
      dispatches.get(fn) !== call ||
      fn.parameters.some((item) => item.dotDotDotToken || item.initializer) ||
      !ts.isVariableDeclaration(fn.parent) ||
      !ts.isIdentifier(fn.parent.name) ||
      constInitializer(fn.parent) !== fn
    )
      continue
    const forwarded = (['slot', 'operationId', 'intent', 'input'] as const).flatMap((field) => {
      const value = request.fields.get(field)
      if (!value || !ts.isIdentifier(value)) return []
      const declaration = source.declaration(value)
      if (!declaration || !ts.isParameter(declaration) || writes.has(declaration)) return []
      const index = fn.parameters.indexOf(declaration)
      return index < 0 ? [] : [{ field, index, parameter: shortText(value) }]
    })
    const inputIndex = forwarded.find((argument) => argument.field === 'input')?.index
    const dispatch = {
      ...source.site(call),
      helper: shortText(fn.parent.name),
      declaration: source.site(fn.parent.name),
      request: shortText(call),
      arguments: forwarded,
    }
    for (const invocation of calls.get(fn.parent) ?? []) {
      if (invocation.questionDotToken || invocation.arguments.some(ts.isSpreadElement)) continue
      const slotArgument = invocation.arguments[fn.parameters.indexOf(parameter)]
      if (!slotArgument) continue
      for (const choice of slotChoices(source, slotArgument))
        append(
          choice,
          invocation,
          inputIndex === undefined ? input : invocation.arguments[inputIndex],
          requestMetadata,
          dispatch,
        )
    }
  }
  // Keep comparable sites together before spending the budget on isolated calls.
  const ranked = [...groups].map(([slot, group]) => ({
    slot,
    group,
    priority: varyingInputFields(group.sites).size > 0 ? 2 : Number(group.sites.some(hasChoice)),
  }))
  ranked.sort((left, right) => right.priority - left.priority)
  const sites: AuthoredCallSelection[] = []
  const omittedBySlot = new Map<string, OmittedCallSites>()
  const byLocation = (left: SourceSite, right: SourceSite) =>
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    (left.column ?? 0) - (right.column ?? 0)
  for (const { slot, group } of ranked) {
    const selected = group.sites.slice(0, limit - sites.length)
    selected.sort((left, right) => byLocation(left.site, right.site))
    sites.push(...selected)
    const count = group.count - selected.length
    if (count > 0)
      omittedBySlot.set(slot, {
        count,
        locations: group.sites
          .slice(selected.length)
          .map((entry) => entry.site)
          .concat(group.dropped)
          .sort(byLocation)
          .slice(0, BEHAVIOR_LIMITS.focusedOmittedCallLocations),
      })
  }
  return { sites, omittedBySlot }
}

function selectedInputs(
  source: Source,
  input: ts.Expression | undefined,
  writes: ReadonlySet<ts.Declaration>,
  hasEval: boolean,
) {
  const object = input && unwrap(input)
  if (!object || !ts.isObjectLiteralExpression(object)) return []
  const fields: AuthoredInputField[] = []
  const assigned = new Set<string>()
  const optional = new Map<string, SourceSite>()
  let dynamic: SourceSite | undefined
  const spreadMembers = (expression: ts.Expression) =>
    namedProperties(expression) ??
    (hasEval ? undefined : returnedProperties(source, expression, writes))
  const append = (name: string, property: ts.ObjectLiteralElementLike, guard?: BehaviorGuard) => {
    if (assigned.has(name)) return
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return
    const value = ts.isPropertyAssignment(property) ? unwrap(property.initializer) : property.name
    const choice = ts.isIdentifier(value)
      ? (constInitializer(source.declaration(value)) ?? value)
      : value
    const selects =
      ts.isConditionalExpression(choice) ||
      (ts.isBinaryExpression(choice) &&
        choice.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    if (
      !selects &&
      !ts.isStringLiteralLike(choice) &&
      !ts.isNumericLiteral(choice) &&
      choice.kind !== ts.SyntaxKind.TrueKeyword &&
      choice.kind !== ts.SyntaxKind.FalseKeyword &&
      choice.kind !== ts.SyntaxKind.NullKeyword
    )
      return
    const possibleOverride = optional.get(name) ?? dynamic
    fields.push({
      field: name,
      kind: selects ? 'choice' : 'literal',
      code: shortText(choice),
      site: source.site(choice),
      ...(guard ? { guard } : {}),
      ...(possibleOverride ? { possibleOverride } : {}),
    })
  }

  for (const property of [...object.properties].reverse()) {
    if (ts.isSpreadAssignment(property)) {
      const spread = unwrap(property.expression)
      const conditional = ts.isConditionalExpression(spread) ? spread : undefined
      const first = spreadMembers(conditional ? unwrap(conditional.whenTrue) : spread)
      const second = conditional ? spreadMembers(unwrap(conditional.whenFalse)) : first
      if (!first || !second) {
        dynamic = source.site(property)
        continue
      }
      const alternatives = conditional ? [first, second] : [first]
      const keys = new Set<string>()
      for (const [index, branch] of alternatives.entries()) {
        const guard = conditional && {
          site: source.site(conditional.condition),
          code: shortText(conditional.condition),
          taken: index === 0,
          unresolved: true,
        }
        for (const [name, member] of branch) {
          append(name, member, guard)
          keys.add(name)
        }
      }
      for (const name of keys) {
        if (alternatives.every((branch) => branch.has(name))) assigned.add(name)
        else optional.set(name, source.site(property))
      }
      continue
    }
    const name = propertyName(property)
    if (name === undefined) {
      dynamic = source.site(property)
      continue
    }
    append(name, property)
    assigned.add(name)
  }
  fields.reverse()
  const choices = fields.filter((field) => field.kind === 'choice' || field.guard)
  const literals = fields.filter((field) => field.kind === 'literal' && !field.guard)
  return [...choices.slice(0, 4), ...literals.slice(0, 8)]
}

/** Inspect the keys returned by a direct local helper without evaluating its values. */
function returnedProperties(
  source: Source,
  expression: ts.Expression,
  writes: ReadonlySet<ts.Declaration>,
) {
  if (!ts.isCallExpression(expression) || expression.questionDotToken) return undefined
  const callee = unwrap(expression.expression)
  if (!ts.isIdentifier(callee)) return undefined
  const declaration = source.declaration(callee)
  if (!declaration || writes.has(declaration)) return undefined
  const fn = ts.isFunctionDeclaration(declaration) ? declaration : constInitializer(declaration)
  if (
    !fn ||
    !isLocalFunction(fn) ||
    fn.asteriskToken ||
    fn.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ||
    !fn.body
  )
    return undefined

  let returned: ts.Expression | undefined
  if (ts.isBlock(fn.body)) {
    const statements = fn.body.statements
    const last = statements.at(-1)
    if (
      !last ||
      !ts.isReturnStatement(last) ||
      !statements
        .slice(0, -1)
        .every(
          (statement) => ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement),
        )
    )
      return undefined
    returned = last.expression
  } else returned = fn.body
  if (!returned) return undefined
  const literal = unwrap(returned)
  if (
    !ts.isObjectLiteralExpression(literal) ||
    !literal.properties.every(
      (property) => ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property),
    )
  )
    return undefined
  const properties = namedProperties(literal)
  return properties?.has('__proto__') ? undefined : properties
}

function namedProperties(expression: ts.Expression) {
  if (!ts.isObjectLiteralExpression(expression)) return undefined
  const properties = new Map<string, ts.ObjectLiteralElementLike>()
  for (const property of expression.properties) {
    const name = propertyName(property)
    if (name === undefined) return undefined
    properties.set(name, property)
  }
  return properties
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  const name = property.name
  return name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : undefined
}

/** Record possible binding writes, including destructuring, before pairing helper arguments. */
export function assignmentTarget(node: ts.Node): ts.Node | undefined {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  )
    return node.left
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  )
    return node.operand
  if (
    (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
    !ts.isVariableDeclarationList(node.initializer)
  )
    return node.initializer
  return undefined
}

export function* writtenBindings(source: Source, target: ts.Node): Iterable<ts.Declaration> {
  for (const reference of sourceNodes(target)) {
    if (!ts.isIdentifier(reference)) continue
    const declaration = source.declaration(reference)
    if (declaration) yield declaration
  }
}
