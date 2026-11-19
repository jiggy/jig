import ts from 'typescript-parser'
import type { BehaviorGuard, SourceSite } from './model.js'

export type LocalFunction = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration

export function isLocalFunction(node: ts.Node): node is LocalFunction {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)
}

export function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  )
    expression = expression.expression
  return expression
}

export function shortText(node: ts.Node): string {
  const code = node.getText()
  return code.length <= 140 ? code : code.slice(0, 139) + '…'
}

export function functionFrame(node: ts.Node): ts.Node {
  while (node.parent && !ts.isFunctionLike(node)) node = node.parent
  return node
}

export function constInitializer(
  declaration: ts.Declaration | undefined,
): ts.Expression | undefined {
  return declaration &&
    ts.isVariableDeclaration(declaration) &&
    ts.isIdentifier(declaration.name) &&
    declaration.parent.flags & ts.NodeFlags.Const &&
    declaration.initializer
    ? unwrap(declaration.initializer)
    : undefined
}

export function lexicalGuards(
  expression: ts.Expression,
  site: (node: ts.Node) => SourceSite,
): BehaviorGuard[] {
  const guards: BehaviorGuard[] = []
  for (
    let node: ts.Node = expression;
    node.parent && !ts.isFunctionLike(node);
    node = node.parent
  ) {
    const parent: ts.Node = node.parent
    if (
      ts.isIfStatement(parent) &&
      (node === parent.thenStatement || node === parent.elseStatement)
    )
      guards.unshift({
        site: site(parent.expression),
        code: shortText(parent.expression),
        taken: node === parent.thenStatement,
        unresolved: true,
      })
  }
  return guards
}

/** A direct branch exit, never an exit found inside a nested statement. */
export function branchExit(statement: ts.Statement | undefined) {
  const exit = statement && (ts.isBlock(statement) ? statement.statements.at(-1) : statement)
  return exit && (ts.isReturnStatement(exit) || ts.isThrowStatement(exit)) ? exit : undefined
}

/** Earlier sibling exits in the same function. An exit bypasses the later statement in that block. */
export function priorBranchExits(expression: ts.Expression) {
  const exits: {
    condition: ts.Expression
    taken: boolean
    statement: ts.ReturnStatement | ts.ThrowStatement
  }[] = []
  let budget = 40
  for (
    let node: ts.Node = expression;
    node.parent && !ts.isFunctionLike(node) && budget > 0;
    node = node.parent
  ) {
    const block: ts.Node = node.parent
    if (!ts.isBlock(block)) continue
    const index = block.statements.indexOf(node as ts.Statement)
    for (let at = index - 1; at >= 0 && budget > 0; at--, budget--) {
      const candidate = block.statements[at]
      if (!candidate || !ts.isIfStatement(candidate)) continue
      const yes = branchExit(candidate.thenStatement)
      const no = branchExit(candidate.elseStatement)
      if (yes) exits.push({ condition: candidate.expression, taken: true, statement: yes })
      if (no) exits.push({ condition: candidate.expression, taken: false, statement: no })
    }
  }
  return exits
}

export function* sourceNodes(
  root: ts.Node,
  descend: (node: ts.Node) => boolean = () => true,
): Iterable<ts.Node> {
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()!
    yield node
    if (!descend(node)) continue
    const children: ts.Node[] = []
    ts.forEachChild(node, (child) => {
      children.push(child)
    })
    pending.push(...children.reverse())
  }
}
