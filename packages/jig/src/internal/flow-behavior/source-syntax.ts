import ts from 'typescript-parser'

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
