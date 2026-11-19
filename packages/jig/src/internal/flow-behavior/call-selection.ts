import ts from 'typescript-parser'
import { type AuthoredCallSelection, BEHAVIOR_LIMITS } from './model.js'
import type { SourceIndex } from './source.js'
import {
  constInitializer,
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

/** Project local source selections independently of route feasibility. */
export function selectCallSites(
  source: Source,
  requests: readonly { call: ts.CallExpression; request: CallRequest }[],
  calls: ReadonlyMap<ts.Declaration, readonly ts.CallExpression[]>,
  slots: ReadonlyMap<string, string>,
  writes: ReadonlySet<ts.Declaration>,
  hasEval: boolean,
): { sites: AuthoredCallSelection[]; omitted: number } {
  const sites: AuthoredCallSelection[] = []
  let omitted = 0
  const append = (
    slot: string,
    call: ts.CallExpression,
    input: ts.Expression | undefined,
    dispatch?: ts.CallExpression,
  ) => {
    if (!slots.has(slot)) return
    const guards = lexicalGuards(call, (node) => source.site(node)).slice(-2)
    const inputChoices = selectedInputs(source, input)
    if (!dispatch && !guards.length && !inputChoices.length) return
    const item: AuthoredCallSelection = {
      slot,
      site: source.site(call),
      ...(dispatch ? { dispatch: source.site(dispatch) } : {}),
      guards,
      inputChoices,
    }
    const limit = BEHAVIOR_LIMITS.focusedCallSelections
    // Keep call sites that select a payload field before further locations.
    const insert = inputChoices.length ? sites.findIndex((entry) => !entry.inputChoices.length) : -1
    if (insert >= 0) sites.splice(insert, 0, item)
    else if (sites.length < limit) sites.push(item)
    else {
      omitted++
      return
    }
    if (sites.length > limit) {
      sites.pop()
      omitted++
    }
  }
  for (const { call, request } of requests) {
    const slot = request.fields.get('slot')
    const input = request.fields.get('input')
    if (slot && ts.isStringLiteralLike(slot)) {
      append(slot.text, call, input)
      continue
    }
    if (hasEval || !slot || !ts.isIdentifier(slot) || writes.has(request.receiver)) continue
    const parameter = source.declaration(slot)
    if (!parameter || !ts.isParameter(parameter) || writes.has(parameter)) continue
    const fn = parameter.parent
    if (
      !isLocalFunction(fn) ||
      fn.asteriskToken ||
      !fn.body ||
      fn.parameters.some((item) => item.dotDotDotToken || item.initializer) ||
      !ts.isVariableDeclaration(fn.parent) ||
      constInitializer(fn.parent) !== fn
    )
      continue
    let frame: ts.Node = call
    while (frame.parent && !ts.isFunctionLike(frame)) frame = frame.parent
    if (frame !== fn) continue
    const inputParameter = input && ts.isIdentifier(input) ? source.declaration(input) : undefined
    const inputIndex =
      inputParameter && ts.isParameter(inputParameter) && !writes.has(inputParameter)
        ? fn.parameters.indexOf(inputParameter)
        : -1
    for (const invocation of calls.get(fn.parent) ?? []) {
      if (invocation.questionDotToken || invocation.arguments.some(ts.isSpreadElement)) continue
      const slotArgument = invocation.arguments[fn.parameters.indexOf(parameter)]
      const selected = slotArgument && unwrap(slotArgument)
      if (!selected || !ts.isStringLiteralLike(selected)) continue
      append(selected.text, invocation, invocation.arguments[inputIndex], call)
    }
  }
  return { sites, omitted }
}

function selectedInputs(source: Source, input: ts.Expression | undefined) {
  const object = input && unwrap(input)
  if (!object || !ts.isObjectLiteralExpression(object)) return []
  const fields: AuthoredCallSelection['inputChoices'][number][] = []
  const names = new Set<string>()
  for (const property of [...object.properties].reverse()) {
    // Later properties own the value. An unresolved spread can replace earlier fields.
    if (ts.isSpreadAssignment(property)) {
      const spread = unwrap(property.expression)
      const alternatives = ts.isConditionalExpression(spread)
        ? [unwrap(spread.whenTrue), unwrap(spread.whenFalse)]
        : [spread]
      const keys: string[] = []
      for (const alternative of alternatives) {
        if (!ts.isObjectLiteralExpression(alternative)) return fields.reverse().slice(0, 2)
        for (const member of alternative.properties) {
          const name = propertyName(member)
          if (name === undefined) return fields.reverse().slice(0, 2)
          keys.push(name)
        }
      }
      for (const key of keys) names.add(key)
      continue
    }
    const name = propertyName(property)
    if (name === undefined) break
    if (names.has(name)) continue
    names.add(name)
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
    const value = ts.isPropertyAssignment(property) ? unwrap(property.initializer) : property.name
    const choice = ts.isIdentifier(value)
      ? (constInitializer(source.declaration(value)) ?? value)
      : value
    if (
      ts.isConditionalExpression(choice) ||
      (ts.isBinaryExpression(choice) &&
        choice.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      fields.push({
        field: name,
        code: shortText(choice),
        site: source.site(choice),
      })
    }
  }
  return fields.reverse().slice(0, 2)
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

export function recordWrites(source: Source, target: ts.Node, writes: Set<ts.Declaration>): void {
  for (const reference of sourceNodes(target)) {
    if (!ts.isIdentifier(reference)) continue
    const declaration = source.declaration(reference)
    if (declaration) writes.add(declaration)
  }
}
