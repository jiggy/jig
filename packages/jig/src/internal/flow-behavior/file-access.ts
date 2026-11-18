import ts from 'typescript-parser'
import { type SourceIndex, unwrap } from './source.js'
import type { Value } from './values.js'

// Recognize the authored flags without resolving platform-specific numbers.
export function readOnlyOpen(
  source: SourceIndex,
  expression: ts.Expression | undefined,
  value: Value | undefined,
): boolean {
  if (expression === undefined || value?.kind === 'undefined') return true
  if (value?.kind === 'literal' && value.value === 'r') return true
  let readOnly = false
  function supported(operand: ts.Expression): boolean {
    const term = unwrap(operand)
    if (ts.isBinaryExpression(term) && term.operatorToken.kind === ts.SyntaxKind.BarToken)
      return supported(term.left) && supported(term.right)
    if (!ts.isPropertyAccessExpression(term)) return false
    const imported = source.importOf(unwrap(term.expression))
    if (imported?.module !== 'node:fs' || imported.member !== 'constants') return false
    if (term.name.text === 'O_RDONLY') {
      readOnly = true
      return true
    }
    return term.name.text === 'O_NOFOLLOW' || term.name.text === 'O_NONBLOCK'
  }
  return supported(expression) && readOnly
}
