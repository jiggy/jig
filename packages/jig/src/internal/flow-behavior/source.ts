import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import ts from 'typescript-parser'
import {
  assignmentTarget,
  type CallRequest,
  selectCallSites,
  writtenBindings,
} from './call-selection.js'
import type {
  AuthoredFileWrite,
  AuthoredHandoff,
  AuthoredRepeat,
  BehaviorPackage,
  CallReference,
  SourceSite,
} from './model.js'
import { describeRepeat, enclosingLoop } from './repetition.js'
import { resultExitChecks } from './result-checks.js'
import { slotSelection } from './slot-selection.js'
import {
  isLocalFunction,
  type LocalFunction,
  lexicalGuards,
  priorBranchExits,
  shortText,
  sourceNodes,
  unwrap,
} from './source-syntax.js'

export { isLocalFunction, type LocalFunction, unwrap } from './source-syntax.js'

const root = '/flow/'
const compilerOptions: ts.CompilerOptions = {
  noLib: true,
  types: [],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
}

type ErrorBase = 'Error' | 'TypeError' | 'RangeError' | 'SyntaxError'
export type ErrorClass = { readonly base: ErrorBase; readonly identity?: string }
type HandoffSite = Omit<AuthoredHandoff, 'target'> & {
  receiver: ts.Declaration
  repeat?: { readonly loop: AuthoredRepeat; readonly end: number }
}
type ContinuationSites = {
  handoffs: readonly HandoffSite[]
  fileWrites: readonly AuthoredFileWrite[]
}

function member(expression: ts.Expression) {
  const node = unwrap(expression)
  if (ts.isPropertyAccessExpression(node)) return { name: node.name.text, object: node.expression }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
    return { name: node.argumentExpression.text, object: node.expression }
}

export class SourceIndex {
  readonly #files: ReadonlyMap<string, string>
  readonly #program: ts.Program
  readonly #checker: ts.TypeChecker
  readonly #reporting: ReadonlySet<string>
  readonly #callIdentities = new Map<ts.CallExpression, string>()
  readonly #indexedCalls = new Set<ts.SourceFile>()
  readonly #continuations = new Map<LocalFunction, ContinuationSites>()
  readonly #repeats = new WeakMap<ts.IterationStatement, AuthoredRepeat>()
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
    return name === 'Error' ||
      name === 'TypeError' ||
      name === 'RangeError' ||
      name === 'SyntaxError'
      ? name
      : undefined
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

  /** Recognize direct setting checks without treating arbitrary calls as data reads. */
  settingRead(expression: ts.Expression, usesContext: (receiver: ts.Declaration) => boolean) {
    const value = unwrap(expression)
    const direct = (operand: ts.Expression) => {
      const property = member(operand)
      if (!property || property.name.length > 128) return undefined
      const settings = member(property.object)
      if (settings?.name !== 'settings') return undefined
      const context = unwrap(settings.object)
      if (!ts.isIdentifier(context)) return undefined
      const receiver = this.declaration(context)
      return receiver && usesContext(receiver) ? property.name : undefined
    }
    if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken)
      return direct(value.operand)
    if (ts.isBinaryExpression(value)) {
      const operator = value.operatorToken.kind
      if (
        operator !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
        operator !== ts.SyntaxKind.ExclamationEqualsEqualsToken
      )
        return undefined
      const scalar = (node: ts.Expression) => {
        const operand = unwrap(node)
        return (
          ts.isStringLiteralLike(operand) ||
          ts.isNumericLiteral(operand) ||
          operand.kind === ts.SyntaxKind.TrueKeyword ||
          operand.kind === ts.SyntaxKind.FalseKeyword ||
          operand.kind === ts.SyntaxKind.NullKeyword
        )
      }
      if (scalar(value.right)) return direct(value.left)
      if (scalar(value.left)) return direct(value.right)
      return undefined
    }
    return direct(value)
  }

  continuationSites(fn: LocalFunction): ContinuationSites {
    const cached = this.#continuations.get(fn)
    if (cached !== undefined) return cached
    const handoffs: HandoffSite[] = []
    const fileWrites: AuthoredFileWrite[] = []
    const writes = new Map<ts.Declaration, ts.Node | undefined>()
    if (fn.body) {
      for (const node of sourceNodes(fn.body)) {
        const target = assignmentTarget(node)
        if (target)
          for (const declaration of writtenBindings(this, target))
            writes.set(declaration, writes.has(declaration) ? undefined : node)
      }
    }
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node) || ts.isClassLike(node)) return
      if (ts.isCallExpression(node)) {
        const handoff = this.handoffSite(node, writes)
        if (handoff) handoffs.push(handoff)
        const callee = this.importOf(unwrap(node.expression))
        const destination = node.arguments[0]
        if (callee?.module === 'node:fs/promises' && callee.member === 'writeFile' && destination)
          fileWrites.push({
            site: this.site(node),
            destination: shortText(unwrap(destination)),
            guards: lexicalGuards(node, (guard) => this.site(guard)),
          })
      }
      ts.forEachChild(node, visit)
    }
    if (fn.body) visit(fn.body)
    const sites = { handoffs, fileWrites }
    this.#continuations.set(fn, sites)
    return sites
  }

  /** Source references are independent of the interpreter and carry no reachability claims. */
  callReferences(
    slots: ReadonlyMap<string, string>,
    represented: ReadonlySet<string>,
    options: { limit: number; fallback: boolean; focused: boolean },
  ) {
    const references: CallReference[] = []
    const computed = new Map<number, ts.Expression>()
    const calls = new Map<ts.Declaration, ts.CallExpression[]>()
    const requests: { call: ts.CallExpression; request: CallRequest }[] = []
    const writes = new Set<ts.Declaration>()
    let hasEval = false
    let omitted = 0
    const visit = (node: ts.Node): void => {
      if (options.focused) {
        const target = assignmentTarget(node)
        if (target) for (const declaration of writtenBindings(this, target)) writes.add(declaration)
      }
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression)
        if (ts.isIdentifier(callee) && callee.text === 'eval') hasEval = true
        const declaration = ts.isIdentifier(callee) ? this.declaration(callee) : undefined
        if (declaration) {
          const sites = calls.get(declaration) ?? []
          sites.push(node)
          calls.set(declaration, sites)
        }
        const request = this.callRequest(node)
        const slot = request?.fields.get('slot')
        if (request && slot && this.contextParameter(request.receiver)) {
          if (options.focused) requests.push({ call: node, request })
          if (!options.fallback) return
          const site = this.callSite(node)
          if (!represented.has(JSON.stringify(site))) {
            const reference: CallReference = ts.isStringLiteralLike(slot)
              ? { kind: 'literal', slot: slot.text, site }
              : { kind: 'computed', expression: shortText(slot), site }
            if (reference.kind === 'computed' || slots.has(reference.slot)) {
              if (references.length < options.limit) {
                if (reference.kind === 'computed') computed.set(references.length, slot)
                references.push(reference)
              } else omitted++
            }
          }
        }
      }
    }
    for (const file of this.#program.getSourceFiles()) {
      if (this.valid(file)) for (const node of sourceNodes(file)) visit(node)
    }
    const selections = new Map<ts.Declaration, Map<string, ReturnType<typeof slotSelection>>>()
    for (const [index, slot] of computed) {
      const reference = references[index]
      if (
        reference?.kind !== 'computed' ||
        !ts.isPropertyAccessExpression(slot) ||
        slot.questionDotToken
      )
        continue
      const receiver = this.declaration(slot.expression)
      if (!receiver) continue
      const cached = selections.get(receiver) ?? new Map()
      if (!cached.has(slot.name.text)) cached.set(slot.name.text, slotSelection(this, slot, calls))
      selections.set(receiver, cached)
      const selection = cached.get(slot.name.text)
      if (selection) references[index] = { ...reference, selection }
    }
    return {
      references,
      omitted,
      selected: options.focused
        ? selectCallSites(this, requests, calls, slots, writes, hasEval)
        : undefined,
    }
  }

  literalCallSlot(call: ts.CallExpression): string | undefined {
    const request = this.callRequest(call)
    const slot = request?.fields.get('slot')
    return request &&
      slot &&
      ts.isStringLiteralLike(slot) &&
      this.contextParameter(request.receiver)
      ? slot.text
      : undefined
  }

  private contextParameter(receiver: ts.Declaration): boolean {
    if (!ts.isParameter(receiver)) return false
    if (receiver.type && ts.isTypeReferenceNode(receiver.type)) {
      const imported = this.importOf(receiver.type.typeName)
      if (imported?.module === '@jigging/flow' && imported.member === 'RunContext') return true
    }
    const handler = receiver.parent
    if (
      !isLocalFunction(handler) ||
      handler.parameters[0] !== receiver ||
      !ts.isCallExpression(handler.parent) ||
      handler.parent.arguments[0] !== handler
    )
      return false
    const imported = this.importOf(unwrap(handler.parent.expression))
    return imported?.module === '@jigging/flow' && imported.member === 'handle'
  }

  private callRequest(call: ts.CallExpression): CallRequest | undefined {
    const callee = unwrap(call.expression)
    const [argument] = call.arguments
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.name.text !== 'call' ||
      !ts.isIdentifier(callee.expression) ||
      call.arguments.length > 2 ||
      !argument ||
      !ts.isObjectLiteralExpression(unwrap(argument))
    )
      return undefined
    const receiver = this.declaration(callee.expression)
    if (!receiver) return undefined
    const request = unwrap(argument) as ts.ObjectLiteralExpression
    const fields = new Map<string, ts.Expression | undefined>()
    for (const property of request.properties) {
      const name = property.name
      if (
        !name ||
        (!ts.isIdentifier(name) && !ts.isStringLiteralLike(name)) ||
        fields.has(name.text)
      )
        return undefined
      fields.set(
        name.text,
        ts.isPropertyAssignment(property)
          ? unwrap(property.initializer)
          : ts.isShorthandPropertyAssignment(property)
            ? property.name
            : undefined,
      )
    }
    return { receiver, fields }
  }

  private handoffSite(
    call: ts.CallExpression,
    writes: ReadonlyMap<ts.Declaration, ts.Node | undefined>,
  ): HandoffSite | undefined {
    if (call.arguments.length !== 1) return undefined
    const request = this.callRequest(call)
    if (!request) return undefined
    const { receiver, fields } = request
    const slotValue = fields.get('slot')
    const slot = slotValue && ts.isStringLiteralLike(slotValue) ? slotValue.text : undefined
    if (!slot) return undefined
    const intentValue = fields.get('intent')
    const intent = intentValue && ts.isStringLiteralLike(intentValue) ? intentValue.text : undefined
    const loop = writes.has(receiver) ? undefined : enclosingLoop(call)
    let repeat: HandoffSite['repeat']
    if (loop) {
      const description = this.#repeats.get(loop) ?? describeRepeat(this, loop)
      this.#repeats.set(loop, description)
      repeat = { loop: description, end: loop.end }
    }
    const priorExits = priorBranchExits(call).map(({ condition, taken, statement }) => {
      const setting = writes.has(receiver)
        ? undefined
        : this.settingRead(condition, (ref) => ref === receiver)
      return {
        condition: { code: shortText(condition), site: this.site(condition) },
        taken,
        statement: { code: shortText(statement), site: this.site(statement) },
        ...(setting === undefined ? {} : { setting }),
      }
    })
    return {
      receiver,
      slot,
      site: this.callSite(call),
      ...(intent ? { intent: intent.length <= 140 ? intent : intent.slice(0, 139) + '…' } : {}),
      ...(repeat ? { repeat } : {}),
      guards: lexicalGuards(call, (node) => this.site(node)).slice(0, 4),
      ...(priorExits.length ? { priorExits } : {}),
      exitChecks: resultExitChecks(this, call, writes),
    }
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
