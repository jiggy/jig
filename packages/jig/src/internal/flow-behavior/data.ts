import ts from 'typescript-parser'
import { isLocalFunction, type SourceIndex, unwrap } from './source.js'
import { type Value, literal, toJson, unknown } from './values.js'

const readers = new Set([
  'at',
  'entries',
  'filter',
  'includes',
  'indexOf',
  'join',
  'map',
  'slice',
  'some',
  'startsWith',
  'toLowerCase',
  'trim',
])
const localArrayWrites = new Set(['push', 'splice', 'unshift'])
const globals = new Set(['JSON.stringify', 'Math.max', 'Number.isInteger', 'Object.keys'])

export function dataIntrinsic(source: SourceIndex, callee: ts.Expression): string | undefined {
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !ts.isIdentifier(callee.expression) ||
    source.declaration(callee.expression) !== undefined
  )
    return undefined
  const name = callee.expression.text + '.' + callee.name.text
  return globals.has(name) ? name : undefined
}

export function isData(value: Value): boolean {
  switch (value.kind) {
    case 'object':
      return [...value.fields.values()].every(isData)
    case 'array':
      return value.items.every(isData)
    case 'function':
    case 'context':
    case 'reporter':
    case 'report-view':
      return false
    default:
      return true
  }
}

export function dataMethod(name: string): boolean {
  return readers.has(name)
}

export function evaluateIntrinsic(name: string, args: readonly Value[]): Value {
  const first = args[0] ?? unknown
  if (name === 'Math.max') {
    const values = args.map((arg) =>
      arg.kind === 'literal' && typeof arg.value === 'number' ? arg.value : undefined,
    )
    return values.every((n) => n !== undefined) ? literal(Math.max(...values)) : unknown
  }
  if (name === 'Number.isInteger') {
    return first.kind === 'literal' ? literal(Number.isInteger(first.value)) : unknown
  }
  if (name === 'Object.keys' && first.kind === 'object' && !first.open)
    return { kind: 'array', items: [...first.fields.keys()].map(literal) }
  if (name === 'JSON.stringify') {
    const concrete = toJson(first)
    const replacer = args[1]
    const space = args[2]
    if (
      concrete === undefined ||
      args.length > 3 ||
      (replacer &&
        replacer.kind !== 'undefined' &&
        !(replacer.kind === 'literal' && replacer.value === null))
    )
      return unknown
    if (
      space &&
      space.kind !== 'undefined' &&
      (space.kind !== 'literal' ||
        (typeof space.value !== 'number' && typeof space.value !== 'string'))
    )
      return unknown
    const formatting =
      space?.kind === 'literal' &&
      (typeof space.value === 'number' || typeof space.value === 'string')
        ? space.value
        : undefined
    const json = JSON.stringify(concrete, undefined, formatting)
    return json.length <= 8192 ? literal(json) : unknown
  }
  return unknown
}

export function evaluateDataMethod(name: string, receiver: Value, args: readonly Value[]): Value {
  if (receiver.kind === 'array') {
    const array = receiver.items.map(toJson)
    if (name === 'map') return { kind: 'array', items: receiver.items.map(() => unknown) }
    if (array.some((value) => value === undefined)) return unknown
    if (
      name === 'join' &&
      args[0]?.kind === 'literal' &&
      typeof args[0].value === 'string' &&
      array.every((value) => value === null || typeof value !== 'object')
    )
      return literal(array.join(args[0].value))
    if (name === 'includes' || name === 'indexOf') {
      const arg = args[0]
      if (args.length !== 1 || arg?.kind !== 'literal') return unknown
      return literal(name === 'includes' ? array.includes(arg.value) : array.indexOf(arg.value))
    }
  }
  if (receiver.kind === 'literal' && typeof receiver.value === 'string') {
    const input = receiver.value
    if (name === 'trim' && args.length === 0) return literal(input.trim())
    if (name === 'toLowerCase' && args.length === 0) return literal(input.toLowerCase())
    if (args.length === 1 && args[0]?.kind === 'literal' && typeof args[0].value === 'string') {
      if (name === 'includes') return literal(input.includes(args[0].value))
      if (name === 'startsWith') return literal(input.startsWith(args[0].value))
      if (name === 'indexOf') return literal(input.indexOf(args[0].value))
    }
  }
  return unknown
}

type Proof = { readonly writes: ReadonlySet<ts.Declaration> }

/**
 * A small whitelist for inert data computations. It proves absence of changes
 * to caller-visible state or handoffs, not successful evaluation. Unrecognized
 * syntax denies the proof. Loop summaries expose writes to enrolled locals.
 */
export function dataEffects(
  source: SourceIndex,
  root: ts.Expression | ts.ForOfStatement | ts.FunctionLikeDeclaration,
  values: ReadonlyMap<ts.Node, Value>,
): Proof | undefined {
  const writes = new Set<ts.Declaration>()
  const visiting = new Set<ts.Node>()
  let remaining = 4_000
  const inside = (node: ts.Node, boundary: ts.Node) =>
    node.getSourceFile() === boundary.getSourceFile() &&
    node.pos >= boundary.pos &&
    node.end <= boundary.end
  const lexical = (decl: ts.Declaration, scopes: readonly ts.Node[]) =>
    scopes.some((scope) => inside(decl, scope))
  const known = (decl: ts.Declaration) => {
    const value = values.get(decl)
    return value !== undefined && isData(value)
  }
  const writableArray = (decl: ts.Declaration, scopes: readonly ts.Node[]) =>
    ts.isVariableDeclaration(decl) &&
    ts.isVariableDeclarationList(decl.parent) &&
    (decl.parent.flags & ts.NodeFlags.Const) !== 0 &&
    decl.initializer !== undefined &&
    ts.isArrayLiteralExpression(unwrap(decl.initializer)) &&
    (lexical(decl, scopes) || (ts.isForOfStatement(root) && values.get(decl)?.kind === 'array'))
  const functionOf = (expression: ts.Expression) => {
    const e = unwrap(expression)
    if (isLocalFunction(e)) return e
    if (!ts.isIdentifier(e)) return undefined
    const decl = source.declaration(e)
    const value = decl && values.get(decl)
    if (value !== undefined) return value.kind === 'function' ? value.node : undefined
    if (decl && ts.isFunctionDeclaration(decl)) return decl
    if (
      decl &&
      ts.isVariableDeclaration(decl) &&
      decl.initializer &&
      ts.isVariableDeclarationList(decl.parent) &&
      (decl.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const initializer = unwrap(decl.initializer)
      if (isLocalFunction(initializer)) return initializer
    }
    return undefined
  }
  function check(node: ts.Node, scopes: readonly ts.Node[], inFunction: boolean): boolean {
    if (--remaining < 0 || visiting.has(node)) return false
    const sub = (n: ts.Node) => check(n, scopes, inFunction)
    if (isLocalFunction(node)) {
      if (
        !node.body ||
        node.asteriskToken ||
        ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      )
        return false
      visiting.add(node)
      const next = [...scopes, node]
      const okay =
        node.parameters.every(
          (p) =>
            !p.dotDotDotToken &&
            check(p.name, next, true) &&
            (!p.initializer || check(p.initializer, next, true)),
        ) && check(node.body, next, true)
      visiting.delete(node)
      return okay
    }
    if (ts.isIdentifier(node)) {
      const decl = source.declaration(node)
      if (decl === undefined) return node.text === 'undefined'
      if (lexical(decl, scopes) || known(decl)) return true
      if (
        !ts.isVariableDeclaration(decl) ||
        !ts.isVariableDeclarationList(decl.parent) ||
        !(decl.parent.flags & ts.NodeFlags.Const) ||
        !decl.initializer
      )
        return false
      visiting.add(node)
      const okay = sub(decl.initializer)
      visiting.delete(node)
      return okay
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      const args = node.arguments
      if (args.some(ts.isSpreadElement)) return false
      const helper = functionOf(callee)
      if (helper) return sub(helper) && args.every(sub)
      const imported = source.importOf(callee)
      if (
        imported?.module === '@jigging/reporting' &&
        imported.member === 'previewCollection' &&
        source.reportingEnabled(callee)
      )
        return args.every(sub)
      if (imported?.module === 'node:crypto' && imported.member === 'createHash')
        return args.every(sub)
      if (dataIntrinsic(source, callee) !== undefined) return args.every(sub)
      if (!ts.isPropertyAccessExpression(callee)) return false
      const name = callee.name.text
      const receiver = unwrap(callee.expression)
      if (localArrayWrites.has(name) && ts.isIdentifier(receiver)) {
        const decl = source.declaration(receiver)
        if (!decl || !writableArray(decl, scopes) || !args.every(sub)) return false
        if (!lexical(decl, scopes)) writes.add(decl)
        return true
      }
      if (name === 'test' && receiver.kind === ts.SyntaxKind.RegularExpressionLiteral)
        return args.every(sub)
      if ((name === 'update' || name === 'digest') && ts.isCallExpression(receiver)) {
        const first = source.importOf(unwrap(receiver.expression))
        if (first?.module === 'node:crypto' && first.member === 'createHash')
          return sub(receiver) && args.every(sub)
        if (
          ts.isPropertyAccessExpression(receiver.expression) &&
          receiver.expression.name.text === 'update' &&
          ts.isCallExpression(receiver.expression.expression)
        ) {
          const create = source.importOf(unwrap(receiver.expression.expression.expression))
          if (create?.module === 'node:crypto' && create.member === 'createHash')
            return sub(receiver) && args.every(sub)
        }
      }
      if (
        name === 'sort' &&
        ts.isCallExpression(receiver) &&
        dataIntrinsic(source, unwrap(receiver.expression)) === 'Object.keys'
      )
        return args.length === 0 && sub(receiver)
      return readers.has(name) && sub(receiver) && args.every(sub)
    }
    if (ts.isPropertyAccessExpression(node)) return sub(node.expression)
    if (ts.isElementAccessExpression(node))
      return sub(node.expression) && sub(node.argumentExpression)
    if (ts.isShorthandPropertyAssignment(node))
      return !node.objectAssignmentInitializer && sub(node.name)
    if (ts.isPropertyAssignment(node))
      return (
        !ts.isComputedPropertyName(node.name) &&
        node.name.getText() !== '__proto__' &&
        !(ts.isStringLiteralLike(node.name) && node.name.text === '__proto__') &&
        sub(node.initializer)
      )
    if (ts.isVariableDeclaration(node))
      return sub(node.name) && (!node.initializer || sub(node.initializer))
    if (ts.isBindingElement(node))
      return (
        (!node.propertyName || !ts.isComputedPropertyName(node.propertyName)) &&
        sub(node.name) &&
        (!node.initializer || sub(node.initializer))
      )
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) {
        if (op !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(node.left)) return false
        const decl = source.declaration(node.left)
        if (
          !decl ||
          (!lexical(decl, scopes) && !(ts.isForOfStatement(root) && known(decl))) ||
          !sub(node.right)
        )
          return false
        if (!lexical(decl, scopes)) writes.add(decl)
        return true
      }
      return sub(node.left) && sub(node.right)
    }
    if (ts.isNewExpression(node))
      return (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Set' &&
        source.declaration(node.expression) === undefined &&
        (node.arguments ?? []).every(sub)
      )
    if (ts.isReturnStatement(node)) return inFunction && (!node.expression || sub(node.expression))
    if (ts.isConditionalExpression(node))
      return sub(node.condition) && sub(node.whenTrue) && sub(node.whenFalse)
    if (ts.isForOfStatement(node)) {
      const inner = [...scopes, node]
      return (
        !node.awaitModifier &&
        check(node.initializer, inner, inFunction) &&
        sub(node.expression) &&
        check(node.statement, inner, inFunction)
      )
    }
    if (ts.isIfStatement(node))
      return (
        sub(node.expression) &&
        sub(node.thenStatement) &&
        (node.elseStatement === undefined || sub(node.elseStatement))
      )
    if (ts.isPrefixUnaryExpression(node))
      return (
        [
          ts.SyntaxKind.ExclamationToken,
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.MinusToken,
          ts.SyntaxKind.TildeToken,
        ].includes(node.operator) && sub(node.operand)
      )
    if (
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isTypeOfExpression(node)
    )
      return sub(node.expression)
    if (ts.isTemplateExpression(node))
      return node.templateSpans.every((span) => sub(span.expression))
    if (ts.isExpressionStatement(node) || ts.isSpreadElement(node) || ts.isSpreadAssignment(node))
      return sub(node.expression)
    if (ts.isBlock(node)) return node.statements.every(sub)
    if (ts.isVariableStatement(node)) return sub(node.declarationList)
    if (ts.isVariableDeclarationList(node))
      return (node.flags & ts.NodeFlags.BlockScoped) !== 0 && node.declarations.every(sub)
    if (ts.isArrayLiteralExpression(node) || ts.isArrayBindingPattern(node))
      return node.elements.every(sub)
    if (ts.isObjectLiteralExpression(node)) return node.properties.every(sub)
    if (ts.isObjectBindingPattern(node)) return node.elements.every(sub)
    if (ts.isBreakStatement(node) || ts.isContinueStatement(node))
      return (
        node.label === undefined && (ts.isForOfStatement(root) || scopes.some(ts.isForOfStatement))
      )
    return (
      ts.isStringLiteralLike(node) ||
      ts.isNumericLiteral(node) ||
      ts.isEmptyStatement(node) ||
      ts.isOmittedExpression(node) ||
      [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
        node.kind,
      )
    )
  }
  return check(root, [], false) ? { writes } : undefined
}
