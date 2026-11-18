import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import ts from 'typescript-parser'
import type { AuthoredHandoff, BehaviorPackage, SourceSite } from './model.js'

const root = '/flow/'
const compilerOptions: ts.CompilerOptions = {
  noLib: true,
  types: [],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
}

export type LocalFunction = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration
type ErrorBase = 'Error' | 'TypeError' | 'RangeError'
export type ErrorClass = { readonly base: ErrorBase; readonly identity?: string }
type HandoffSite = Omit<AuthoredHandoff, 'target'> & { receiver: ts.Declaration }

const shortText = (node: ts.Node) => {
  const code = node.getText()
  return code.length <= 140 ? code : code.slice(0, 139) + '…'
}

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

export class SourceIndex {
  readonly #files: ReadonlyMap<string, string>
  readonly #program: ts.Program
  readonly #checker: ts.TypeChecker
  readonly #reporting: ReadonlySet<string>
  readonly #callIdentities = new Map<ts.CallExpression, string>()
  readonly #indexedCalls = new Set<ts.SourceFile>()
  readonly #handoffs = new Map<LocalFunction, readonly HandoffSite[]>()
  readonly entry: ts.SourceFile | undefined

  constructor(
    readonly implementation: string,
    pkg: BehaviorPackage,
  ) {
    this.#reporting = pkg.reportingFiles ?? new Set()
    this.#files = new Map([...pkg.sources].map(([path, bytes]) => [root + path, bytes]))
    const host: ts.CompilerHost = {
      getSourceFile: (path) => {
        const text = this.#files.get(path)
        return text === undefined
          ? undefined
          : ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true)
      },
      getCurrentDirectory: () => root,
      getDefaultLibFileName: () => '',
      getCanonicalFileName: (path) => path,
      getNewLine: () => '\n',
      useCaseSensitiveFileNames: () => true,
      fileExists: (path) => this.#files.has(path),
      readFile: (path) => this.#files.get(path),
      writeFile: () => {
        throw new Error('Behavior analysis cannot emit code')
      },
      resolveModuleNames: (names, containingFile) =>
        names.map((name) => {
          // Only an exact relative TypeScript file inside this captured package is understood.
          if (!name.startsWith('./') && !name.startsWith('../')) return undefined
          const candidate = posix.resolve(posix.dirname(containingFile), name)
          if (!candidate.startsWith(root) || !this.#files.has(candidate)) return undefined
          return { resolvedFileName: candidate, extension: ts.Extension.Ts }
        }),
    }
    this.#program = ts.createProgram({
      rootNames: [root + pkg.entry],
      options: compilerOptions,
      host,
    })
    this.#checker = this.#program.getTypeChecker()
    this.entry = this.#program.getSourceFile(root + pkg.entry)
  }

  valid(file: ts.SourceFile): boolean {
    return this.#program.getSyntacticDiagnostics(file).length === 0
  }

  declaration(node: ts.Node): ts.Declaration | undefined {
    const symbol =
      ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
        ? this.#checker.getShorthandAssignmentValueSymbol(node.parent)
        : this.#checker.getSymbolAtLocation(node)
    if (symbol === undefined) return undefined
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? this.#checker.getAliasedSymbol(symbol) : symbol
    return resolved.valueDeclaration ?? resolved.declarations?.[0]
  }

  importOf(node: ts.Node): { module: string; member: string } | undefined {
    const declaration = this.#checker.getSymbolAtLocation(node)?.declarations?.[0]
    if (declaration === undefined || !ts.isImportSpecifier(declaration)) return undefined
    const statement = declaration.parent.parent.parent
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      return undefined
    return {
      module: statement.moduleSpecifier.text,
      member: (declaration.propertyName ?? declaration.name).text,
    }
  }

  reportingEnabled(node: ts.Node): boolean {
    return this.#reporting.has(node.getSourceFile().fileName.slice(root.length))
  }

  private builtinError(expression: ts.Expression): ErrorBase | undefined {
    if (!ts.isIdentifier(expression) || this.declaration(expression) !== undefined) return undefined
    const name = expression.text
    return name === 'Error' || name === 'TypeError' || name === 'RangeError' ? name : undefined
  }

  emptyErrorSubclass(node: ts.ClassDeclaration): ErrorBase | undefined {
    if (
      node.members.length ||
      node.heritageClauses?.length !== 1 ||
      (ts.canHaveDecorators(node) && ts.getDecorators(node)?.length) ||
      ts
        .getModifiers(node)
        ?.some(
          (modifier) =>
            modifier.kind !== ts.SyntaxKind.ExportKeyword &&
            modifier.kind !== ts.SyntaxKind.DefaultKeyword,
        )
    )
      return undefined
    const [heritage] = node.heritageClauses
    if (heritage?.token !== ts.SyntaxKind.ExtendsKeyword || heritage.types.length !== 1)
      return undefined
    return this.builtinError(heritage.types[0]!.expression)
  }

  errorClass(expression: ts.Expression): ErrorClass | undefined {
    const reference = unwrap(expression)
    if (!ts.isIdentifier(reference)) return undefined
    const builtin = this.builtinError(reference)
    if (builtin) return { base: builtin }
    const declaration = this.declaration(reference)
    if (!declaration || !ts.isClassDeclaration(declaration)) return undefined
    const base = this.emptyErrorSubclass(declaration)
    if (!base) return undefined
    const { path, line, column } = this.site(declaration)
    return { base, identity: JSON.stringify([path, line, column]) }
  }

  site(node: ts.Node): SourceSite {
    const file = node.getSourceFile()
    const position = file.getLineAndCharacterOfPosition(node.getStart(file))
    return {
      path: this.implementation + '/' + file.fileName.slice(root.length),
      line: position.line + 1,
      column: position.character + 1,
    }
  }

  handoffsIn(fn: LocalFunction): readonly HandoffSite[] {
    const cached = this.#handoffs.get(fn)
    if (cached !== undefined) return cached
    const sites: HandoffSite[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node) || ts.isClassLike(node)) return
      if (ts.isCallExpression(node)) {
        const handoff = this.handoffSite(node, fn)
        if (handoff) sites.push(handoff)
      }
      ts.forEachChild(node, visit)
    }
    if (fn.body) visit(fn.body)
    this.#handoffs.set(fn, sites)
    return sites
  }

  private handoffSite(call: ts.CallExpression, fn: LocalFunction): HandoffSite | undefined {
    const callee = unwrap(call.expression)
    const [argument] = call.arguments
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.name.text !== 'call' ||
      !ts.isIdentifier(callee.expression) ||
      call.arguments.length !== 1 ||
      !argument ||
      !ts.isObjectLiteralExpression(unwrap(argument))
    )
      return undefined
    const receiver = this.declaration(callee.expression)
    if (!receiver) return undefined
    const request = unwrap(argument) as ts.ObjectLiteralExpression
    const fields = new Map<string, string | undefined>()
    for (const property of request.properties) {
      const name = property.name
      if (
        !name ||
        (!ts.isIdentifier(name) && !ts.isStringLiteralLike(name)) ||
        fields.has(name.text)
      )
        return undefined
      const value = ts.isPropertyAssignment(property) ? unwrap(property.initializer) : undefined
      fields.set(name.text, value && ts.isStringLiteralLike(value) ? value.text : undefined)
    }
    const slot = fields.get('slot')
    if (!slot) return undefined
    const intent = fields.get('intent')
    const guards: AuthoredHandoff['guards'][number][] = []
    for (let node: ts.Node = call; node !== fn && node.parent; node = node.parent) {
      const parent: ts.Node = node.parent
      if (
        ts.isIfStatement(parent) &&
        (node === parent.thenStatement || node === parent.elseStatement)
      )
        guards.unshift({
          site: this.site(parent.expression),
          code: shortText(parent.expression),
          taken: node === parent.thenStatement,
          unresolved: true,
        })
    }
    return {
      receiver,
      slot,
      site: this.callSite(call),
      ...(intent ? { intent: intent.length <= 140 ? intent : intent.slice(0, 139) + '…' } : {}),
      guards: guards.slice(0, 4),
      exitChecks: this.resultExitChecks(call),
    }
  }

  private resultExitChecks(call: ts.CallExpression): AuthoredHandoff['exitChecks'] {
    const awaited = call.parent
    if (!ts.isAwaitExpression(awaited)) return []
    const declaration = awaited.parent
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) return []
    if (!(declaration.parent.flags & ts.NodeFlags.Const)) return []
    const statement = declaration.parent.parent
    if (!ts.isVariableStatement(statement) || !ts.isBlock(statement.parent)) return []
    const { statements } = statement.parent
    const checks: AuthoredHandoff['exitChecks'][number][] = []
    const readsResult = (node: ts.Node): boolean =>
      !ts.isFunctionLike(node) &&
      ((ts.isIdentifier(node) && this.declaration(node) === declaration) ||
        (ts.forEachChild(node, (child) => (readsResult(child) ? true : undefined)) ?? false))
    const start = statements.indexOf(statement) + 1
    for (const following of statements.slice(start, start + 40)) {
      if (!ts.isIfStatement(following) || !readsResult(following.expression)) continue
      for (const [branch, taken] of [
        [following.thenStatement, true],
        [following.elseStatement, false],
      ] as const) {
        const exit = branch && (ts.isBlock(branch) ? branch.statements.at(-1) : branch)
        if (!exit || (!ts.isReturnStatement(exit) && !ts.isThrowStatement(exit))) continue
        checks.push({
          site: this.site(following.expression),
          code: shortText(following.expression),
          taken,
          exit: ts.isReturnStatement(exit) ? 'return' : 'throw',
        })
      }
      if (checks.length >= 4) break
    }
    return checks.slice(0, 4)
  }

  callSite(node: ts.CallExpression): SourceSite {
    const file = node.getSourceFile()
    if (!this.#indexedCalls.has(file)) {
      this.#indexedCalls.add(file)
      const occurrences = new Map<string, number>()
      const visit = (candidate: ts.Node): void => {
        if (ts.isCallExpression(candidate)) {
          const receiver = unwrap(candidate.expression)
          if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'call') {
            const scanner = ts.createScanner(
              ts.ScriptTarget.ES2022,
              true,
              ts.LanguageVariant.Standard,
              candidate.getText(file),
            )
            const hash = createHash('sha256')
            for (
              let token = scanner.scan();
              token !== ts.SyntaxKind.EndOfFileToken;
              token = scanner.scan()
            )
              hash.update(JSON.stringify([token, scanner.getTokenText()]))
            const spelling = hash.digest('hex')
            const occurrence = (occurrences.get(spelling) ?? 0) + 1
            occurrences.set(spelling, occurrence)
            this.#callIdentities.set(candidate, spelling + '-' + occurrence)
          }
        }
        ts.forEachChild(candidate, visit)
      }
      visit(file)
    }
    const identity = this.#callIdentities.get(node)
    return { ...this.site(node), ...(identity === undefined ? {} : { identity }) }
  }
}
