import ts from 'typescript-parser'
import type { AuthoredHandoff } from './model.js'
import type { SourceIndex } from './source.js'
import { branchExit, shortText, sourceNodes, unwrap } from './source-syntax.js'

type Check = AuthoredHandoff['exitChecks'][number]
type References = NonNullable<Check['via']>

/** Link authored exits to the awaited result, without interpreting the expressions that use it. */
export function resultExitChecks(
  source: SourceIndex,
  call: ts.CallExpression,
  writes: ReadonlyMap<ts.Declaration, ts.Node | undefined>,
): AuthoredHandoff['exitChecks'] {
  const awaited = call.parent
  if (!ts.isAwaitExpression(awaited)) return []
  const declaration = awaited.parent
  if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) return []
  if (!(declaration.parent.flags & ts.NodeFlags.Const)) return []
  const statement = declaration.parent.parent
  if (!ts.isVariableStatement(statement) || !ts.isBlock(statement.parent)) return []
  const { statements } = statement.parent
  const checks: Check[] = []
  const origins = new Map<ts.Declaration, References>([[declaration, []]])
  const references = (expression: ts.Expression): References | undefined => {
    let closest: References | undefined
    for (const node of sourceNodes(
      expression,
      (node) => !ts.isFunctionLike(node) && !ts.isTypeNode(node),
    )) {
      if (!ts.isIdentifier(node)) continue
      const binding = source.declaration(node)
      const origin = binding && origins.get(binding)
      if (origin && (!closest || origin.length < closest.length)) closest = origin
      if (closest?.length === 0) break
    }
    return closest
  }
  const derive = (binding: ts.Declaration, expression: ts.Expression, definition: ts.Node) => {
    const origin = references(expression)
    if (origin && origin.length < 2)
      origins.set(binding, [
        ...origin,
        { code: shortText(definition), site: source.site(definition) },
      ])
  }
  const start = statements.indexOf(statement) + 1
  const locals = new Set<ts.Declaration>()
  for (const following of statements.slice(start, start + 40)) {
    if (
      ts.isVariableStatement(following) &&
      following.declarationList.flags & ts.NodeFlags.BlockScoped
    ) {
      for (const local of following.declarationList.declarations) {
        if (!ts.isIdentifier(local.name)) continue
        if (local.initializer && !writes.has(local)) derive(local, local.initializer, local)
        else if (following.declarationList.flags & ts.NodeFlags.Let) locals.add(local)
      }
    }
    const assignment = successfulAssignment(following)
    if (assignment && ts.isIdentifier(assignment.left)) {
      const local = source.declaration(assignment.left)
      if (local && locals.has(local) && writes.get(local) === assignment)
        derive(local, assignment.right, assignment)
    }
    if (!ts.isIfStatement(following)) continue
    const via = references(following.expression)
    if (!via) continue
    for (const [branch, taken] of [
      [following.thenStatement, true],
      [following.elseStatement, false],
    ] as const) {
      const exit = branchExit(branch)
      if (!exit) continue
      checks.push({
        site: source.site(following.expression),
        code: shortText(following.expression),
        taken,
        exit: ts.isReturnStatement(exit) ? 'return' : 'throw',
        ...(via.length ? { via } : {}),
      })
    }
    if (checks.length >= 4) break
  }
  return checks.slice(0, 4)
}

function successfulAssignment(statement: ts.Statement): ts.BinaryExpression | undefined {
  if (ts.isTryStatement(statement)) {
    if (
      statement.finallyBlock ||
      !branchExit(statement.catchClause?.block) ||
      statement.tryBlock.statements.length !== 1
    )
      return undefined
    statement = statement.tryBlock.statements[0]!
  }
  if (!ts.isExpressionStatement(statement)) return undefined
  const expression = unwrap(statement.expression)
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
  )
    return expression
}
