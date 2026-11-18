import ts from 'typescript-parser'
import type { SlotSelection } from './model.js'
import type { SourceIndex } from './source.js'
import { isLocalFunction, shortText, sourceNodes, unwrap } from './source-syntax.js'

type Source = Pick<SourceIndex, 'site' | 'declaration' | 'literalCallSlot'>
type Calls = ReadonlyMap<ts.Declaration, readonly ts.CallExpression[]>

/** Trace an authored strict-equality lookup in a literal table through one local helper. */
export function slotSelection(
  source: Source,
  slot: ts.Expression,
  calls: Calls,
): SlotSelection | undefined {
  if (!ts.isPropertyAccessExpression(slot) || slot.questionDotToken) return undefined
  let row = unwrap(slot.expression)
  if (!ts.isIdentifier(row)) return undefined
  const receiver = source.declaration(row)
  if (receiver && ts.isParameter(receiver)) {
    const argument = helperArgument(receiver, calls)
    if (!argument) return undefined
    row = argument
  }
  const rowDeclaration = source.declaration(row)
  const lookup = constInitializer(rowDeclaration)
  if (!lookup || !ts.isCallExpression(lookup) || lookup.questionDotToken) return undefined
  const method = unwrap(lookup.expression)
  if (
    !ts.isPropertyAccessExpression(method) ||
    method.name.text !== 'find' ||
    method.questionDotToken
  )
    return undefined
  const table = unwrap(method.expression)
  if (!ts.isIdentifier(table)) return undefined
  const array = constInitializer(source.declaration(table))
  if (!array || !ts.isArrayLiteralExpression(array) || array.elements.length > 16) return undefined

  const [predicate] = lookup.arguments
  if (
    lookup.arguments.length !== 1 ||
    !predicate ||
    !isLocalFunction(predicate) ||
    !predicate.body ||
    predicate.parameters.length !== 1
  )
    return undefined
  const parameter = predicate.parameters[0]!
  const body = predicate.body
  const expression = ts.isBlock(body) ? onlyReturn(body)?.expression : body
  if (!expression || !ts.isIdentifier(parameter.name)) return undefined
  const comparison = unwrap(expression)
  if (
    !ts.isBinaryExpression(comparison) ||
    comparison.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
  )
    return undefined
  const property = (expression: ts.Expression) =>
    ts.isPropertyAccessExpression(expression) &&
    !expression.questionDotToken &&
    source.declaration(expression.expression) === parameter
      ? expression.name.text
      : undefined
  const left = unwrap(comparison.left)
  const right = unwrap(comparison.right)
  const leftKey = property(left)
  const rightKey = property(right)
  if ((leftKey === undefined) === (rightKey === undefined)) return undefined
  const member = (leftKey ?? rightKey)!
  const key = leftKey === undefined ? left : right
  if (
    [...sourceNodes(key)].some(
      (node) => ts.isIdentifier(node) && source.declaration(node) === parameter,
    )
  )
    return undefined
  const rows = tableRows(array, member, slot.name.text)
  if (!rows.length) return undefined
  return {
    lookup: describe(source, lookup),
    table: { code: table.text, site: source.site(array) },
    key: shortText(key),
    member,
    rows,
    origins: writesBefore(source, key, lookup).map(({ value, write }) =>
      origin(source, value, write),
    ),
  }
}

function tableRows(
  array: ts.ArrayLiteralExpression,
  key: string,
  slot: string,
): SlotSelection['rows'] {
  const rows = new Map<string, string>()
  for (const element of array.elements) {
    const row = unwrap(element)
    if (!ts.isObjectLiteralExpression(row)) return []
    const fields = new Map<string, ts.Expression>()
    for (const property of row.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) && !ts.isStringLiteralLike(property.name)) ||
        fields.has(property.name.text)
      )
        return []
      fields.set(property.name.text, unwrap(property.initializer))
    }
    const id = fields.get(key)
    const target = fields.get(slot)
    if (
      !id ||
      !target ||
      !ts.isStringLiteralLike(id) ||
      !ts.isStringLiteralLike(target) ||
      rows.has(id.text)
    )
      return []
    rows.set(id.text, target.text)
  }
  return [...rows].map(([key, slot]) => ({ key, slot }))
}

function constInitializer(declaration: ts.Declaration | undefined): ts.Expression | undefined {
  return declaration &&
    ts.isVariableDeclaration(declaration) &&
    ts.isIdentifier(declaration.name) &&
    declaration.parent.flags & ts.NodeFlags.Const &&
    declaration.initializer
    ? unwrap(declaration.initializer)
    : undefined
}

function helperArgument(
  parameter: ts.ParameterDeclaration,
  calls: Calls,
): ts.Expression | undefined {
  const helper = parameter.parent
  if (
    !isLocalFunction(helper) ||
    helper.asteriskToken ||
    helper.parameters.some((item) => item.dotDotDotToken || item.initializer)
  )
    return undefined
  const declaration = ts.isFunctionDeclaration(helper)
    ? helper
    : ts.isVariableDeclaration(helper.parent) && constInitializer(helper.parent) === helper
      ? helper.parent
      : undefined
  if (!declaration) return undefined
  const sites = calls.get(declaration)
  if (sites?.length !== 1 || sites[0]!.arguments.some(ts.isSpreadElement)) return undefined
  const argument = sites[0]!.arguments[helper.parameters.indexOf(parameter)]
  return argument ? unwrap(argument) : undefined
}

function onlyReturn(arm: ts.Statement): ts.ReturnStatement | undefined {
  if (ts.isBlock(arm))
    return arm.statements.length === 1 && ts.isReturnStatement(arm.statements[0]!)
      ? arm.statements[0]
      : undefined
  return ts.isReturnStatement(arm) ? arm : undefined
}

function identityRoot(expression: ts.Expression): ts.Expression {
  let root = unwrap(expression)
  if (
    ts.isBinaryExpression(root) &&
    root.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
    ts.isStringLiteralLike(unwrap(root.right))
  )
    root = unwrap(root.left)
  while (ts.isPropertyAccessExpression(root)) root = unwrap(root.expression)
  return root
}

function frame(node: ts.Node): ts.Node {
  while (node.parent && !ts.isFunctionLike(node)) node = node.parent
  return node
}

function writesBefore(source: Source, name: ts.Expression, use: ts.Node) {
  const writes: { value: ts.Expression; write: ts.Node }[] = []
  if (!ts.isIdentifier(name)) return writes
  const declaration = source.declaration(name)
  if (!declaration || !ts.isVariableDeclaration(declaration)) return writes
  const sameFrame = frame(declaration)
  if (sameFrame !== frame(use) || declaration.getStart() >= use.getStart()) return writes
  if (declaration.initializer)
    writes.push({ value: unwrap(declaration.initializer), write: declaration })
  for (const node of sourceNodes(
    sameFrame,
    (node) => node === sameFrame || !ts.isFunctionLike(node),
  )) {
    if (
      ts.isBinaryExpression(node) &&
      ts.isIdentifier(node.left) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.getStart() < use.getStart() &&
      source.declaration(node.left) === declaration
    ) {
      if (writes.length >= 6) return []
      writes.push({ value: unwrap(node.right), write: node })
    }
  }
  return writes
}

function origin(
  source: Source,
  value: ts.Expression,
  write: ts.Node,
): SlotSelection['origins'][number] {
  const root = identityRoot(value)
  const [computed, ...more] = writesBefore(source, root, write)
  const producer = root !== value && !more.length && computed?.value
  const statement = write.parent
  const block = statement?.parent
  const previous =
    ts.isExpressionStatement(statement) && block && ts.isBlock(block)
      ? block.statements[block.statements.indexOf(statement) - 1]
      : undefined
  const reference = ts.isIdentifier(root) ? source.declaration(root) : undefined
  const guard =
    reference &&
    previous &&
    ts.isIfStatement(previous) &&
    !previous.elseStatement &&
    [...sourceNodes(previous.expression)].some(
      (node) => ts.isIdentifier(node) && source.declaration(node) === reference,
    )
      ? previous
      : undefined
  const exit = guard && onlyReturn(guard.thenStatement)
  const enclosing = enclosingCheck(source, write)
  return {
    value: describe(source, value),
    ...(enclosing ? { enclosing } : {}),
    ...(producer ? { producer: describe(source, producer) } : {}),
    ...(producer && ts.isCallExpression(producer) ? callerInput(source, producer) : {}),
    ...(guard && exit
      ? { guard: { condition: describe(source, guard.expression), exit: describe(source, exit) } }
      : {}),
  }
}

function enclosingCheck(
  source: Source,
  node: ts.Node,
): SlotSelection['origins'][number]['enclosing'] {
  for (let child = node; child.parent && !ts.isFunctionLike(child); child = child.parent) {
    const parent = child.parent
    if (
      ts.isIfStatement(parent) &&
      (child === parent.thenStatement || child === parent.elseStatement)
    )
      return {
        condition: describe(source, parent.expression),
        taken: child === parent.thenStatement,
      }
  }
  return undefined
}

function callerInput(
  source: Source,
  call: ts.CallExpression,
): Pick<SlotSelection['origins'][number], 'inputSlot'> {
  if (call.arguments.some(ts.isSpreadElement)) return {}
  const slots = call.arguments.flatMap((argument) => {
    const [write, ...others] = writesBefore(source, unwrap(argument), call)
    const value = write?.value
    if (!value || others.length || !ts.isAwaitExpression(value)) return []
    const request = unwrap(value.expression)
    const name = ts.isCallExpression(request) ? source.literalCallSlot(request) : undefined
    return name === undefined ? [] : [{ name, site: source.site(request) }]
  })
  return slots.length === 1 ? { inputSlot: slots[0]! } : {}
}

function describe(source: Source, node: ts.Node) {
  return { code: shortText(node), site: source.site(node) }
}
