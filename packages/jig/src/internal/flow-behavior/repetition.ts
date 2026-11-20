import ts from 'typescript-parser'
import type { AuthoredRepeat } from './model.js'
import type { SourceIndex } from './source.js'
import { constInitializer, lexicalGuards, shortText, sourceNodes, unwrap } from './source-syntax.js'

const transferLimit = 5

export function enclosingLoop(node: ts.Node): ts.IterationStatement | undefined {
  for (let parent = node.parent; parent && !ts.isFunctionLike(parent); parent = parent.parent)
    if (
      ts.isIterationStatement(parent, false) &&
      parent.statement.pos <= node.pos &&
      node.end <= parent.statement.end
    )
      return parent
}

export function describeRepeat(source: SourceIndex, loop: ts.IterationStatement): AuthoredRepeat {
  const site = (node: ts.Node) => source.site(node)
  const header = ts.isDoStatement(loop)
    ? `do … while (${shortText(loop.expression)})`
    : loop.getSourceFile().text.slice(loop.getStart(), loop.statement.getStart()).trim()
  const test = ts.isForStatement(loop) && loop.condition ? unwrap(loop.condition) : undefined
  const operand = test && ts.isBinaryExpression(test) ? unwrap(test.right) : undefined
  const bound = operand && ts.isIdentifier(operand) ? source.declaration(operand) : undefined
  const initializer = constInitializer(bound)
  const actions: AuthoredRepeat['actions'][number][] = []
  const failures: AuthoredRepeat['actions'][number][] = []
  let count = 0
  const descend = (node: ts.Node) =>
    !ts.isFunctionLike(node) && !ts.isClassLike(node) && !ts.isIterationStatement(node, false)
  for (const statement of sourceNodes(loop.statement, descend)) {
    const kind = transfer(statement, loop)
    if (!kind) continue
    count++
    const choices = kind === 'throw' ? failures : actions
    if (choices.length === transferLimit) continue
    const handler = enclosingHandler(statement, loop)
    const region = handler && {
      kind: handler.kind,
      site: site(handler.node),
      ...(handler.protectedStatement === undefined
        ? {}
        : {
            protectedStatement: {
              code: shortText(handler.protectedStatement),
              site: site(handler.protectedStatement),
            },
          }),
    }
    choices.push({
      kind,
      statement: { code: shortText(statement), site: site(statement) },
      guards: lexicalGuards(statement, site, loop).slice(-2),
      ...(region ? { region } : {}),
    })
  }
  const shown = [...actions, ...failures]
    .slice(0, transferLimit)
    .sort(
      (a, b) =>
        a.statement.site.line - b.statement.site.line ||
        (a.statement.site.column ?? 0) - (b.statement.site.column ?? 0),
    )
  const siblings = ts.isBlock(loop.parent) ? loop.parent.statements : undefined
  const at = siblings?.indexOf(loop) ?? -1
  const following = siblings
    ?.slice(at + 1, at + 9)
    .find((statement) => ts.isReturnStatement(statement) || ts.isThrowStatement(statement))
  return {
    site: site(loop),
    header: header.length <= 140 ? header : header.slice(0, 139) + '…',
    ...(initializer && bound ? { control: { code: shortText(bound), site: site(bound) } } : {}),
    actions: shown,
    omittedActions: count - shown.length,
    ...(following ? { following: { code: shortText(following), site: site(following) } } : {}),
  }
}

function transfer(statement: ts.Node, loop: ts.IterationStatement) {
  if (ts.isReturnStatement(statement)) return 'return'
  if (ts.isThrowStatement(statement)) return 'throw'
  if (ts.isContinueStatement(statement) && !statement.label) return 'continue'
  if (ts.isBreakStatement(statement) && !statement.label) {
    for (let parent = statement.parent; parent !== loop; parent = parent.parent)
      if (ts.isSwitchStatement(parent)) return undefined
    return 'break'
  }
}

function enclosingHandler(statement: ts.Node, loop: ts.IterationStatement) {
  for (let node = statement; node !== loop; node = node.parent) {
    const parent = node.parent
    if (ts.isCatchClause(parent)) {
      const statements = parent.parent.tryBlock.statements
      return {
        kind: 'catch' as const,
        node: parent,
        protectedStatement: statements.length === 1 ? statements[0] : undefined,
      }
    }
    if (ts.isTryStatement(parent) && parent.finallyBlock === node)
      return { kind: 'finally' as const, node, protectedStatement: undefined }
  }
}
