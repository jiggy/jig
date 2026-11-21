import ts from 'typescript-parser'
import {
  dataEffects,
  dataIntrinsic,
  dataMethod,
  evaluateDataMethod,
  evaluateIntrinsic,
  isData,
} from './data.js'
import { readOnlyOpen, strictUtf8Decoder } from './file-access.js'
import {
  type AuthoredContinuation,
  BEHAVIOR_LIMITS,
  type BehaviorAssumption,
  type BehaviorStep,
  type BehaviorTarget,
  type ReportingCall,
  type ReportingWrapperSource,
  type SourceSite,
} from './model.js'
import { ReportingTrace } from './reporting.js'
import { isLocalFunction, type LocalFunction, type SourceIndex, unwrap } from './source.js'
import { shortText } from './source-syntax.js'
import {
  describe,
  type FileHandleValue,
  field,
  fromJson,
  literal,
  missing,
  numberBounds,
  object,
  resultText,
  truth,
  unknown,
  type Value,
} from './values.js'

export interface State {
  readonly values: ReadonlyMap<ts.Node, Value>
  readonly steps: readonly BehaviorStep[]
  readonly assumptions: readonly BehaviorAssumption[]
  readonly mode: 'next' | 'return' | 'throw' | 'unknown'
  readonly value: Value
  readonly consumesReturn?: boolean | undefined
  readonly returnedPromise?: 'fulfilled' | 'rejected'
  readonly site?: SourceSite
  readonly localCall?: ReportingCall | undefined
  readonly stoppedAt?: ts.Node
  readonly closeAttempted?: ReadonlySet<FileHandleValue>
}

type ReturnedCall = 'direct' | 'with-finalizer'

export interface ChildResult {
  readonly mode: 'next' | 'throw' | 'unknown'
  readonly value: Value
  readonly step: Extract<BehaviorStep, { kind: 'call' }>
  readonly prefix: readonly BehaviorStep[]
  readonly assumptions: readonly BehaviorAssumption[]
}

type InvokeChild = (
  slot: string,
  input: Value,
  site: SourceSite,
  depth: number,
  assumptions: readonly BehaviorAssumption[],
) => readonly ChildResult[]

export class AnalysisLimit extends Error {}

export class AnalysisBudget {
  #steps = 0
  constructor(
    readonly signal?: AbortSignal,
    readonly steps = Number(BEHAVIOR_LIMITS.steps),
    readonly parent?: AnalysisBudget,
  ) {}

  check(): void {
    this.signal?.throwIfAborted()
    if (++this.#steps > this.steps) throw new AnalysisLimit('Analysis reached the work limit.')
    this.parent?.check()
  }

  variants<T>(values: T[]): T[] {
    if (values.length > BEHAVIOR_LIMITS.variants)
      throw new AnalysisLimit('Analysis reached the limit on alternatives.')
    return values
  }
}

const withValue = (state: State, value: Value): State => ({ ...state, value })
const add = (state: State, step: BehaviorStep): State => {
  if (state.steps.length >= BEHAVIOR_LIMITS.stepsPerRoute)
    throw new AnalysisLimit('Analysis reached the route length limit.')
  return { ...state, steps: [...state.steps, step] }
}
const next = (state: State): State => ({ ...state, mode: 'next', value: missing })
const raised = (state: State, site: SourceSite, value: Value): State => {
  if (value.kind !== 'error') return { ...state, mode: 'throw', site, value }
  const origin = value.origin ?? site
  return { ...state, mode: 'throw', site: origin, value: { ...value, origin } }
}
const originalDeclaration = (node: ts.Node) => {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent)
    if (isLocalFunction(parent)) return parent
  return undefined
}
const isAsync = (fn: LocalFunction): boolean =>
  ts.getModifiers(fn)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false

export class Interpreter {
  readonly #context: Value = { kind: 'context' }

  constructor(
    readonly source: SourceIndex,
    readonly target: BehaviorTarget,
    readonly input: Value,
    readonly budget: AnalysisBudget,
    readonly invokeChild: InvokeChild,
    readonly retainLimitedPaths = true,
    readonly recordAuthoredContinuation?: (item: AuthoredContinuation) => void,
    private readonly reportingTrace = new ReportingTrace(),
  ) {}

  run(depth: number): State[] {
    const initial: State = {
      values: new Map(),
      steps: [],
      assumptions: [],
      mode: 'next',
      value: missing,
    }
    const entry = this.source.entry
    if (entry === undefined) return []
    const statements = entry.statements.filter((n) => ts.isExpressionStatement(n))
    const statement = statements.length === 1 ? statements[0] : undefined
    if (
      statement === undefined ||
      !ts.isExpressionStatement(statement) ||
      !this.moduleSupported(entry)
    )
      return [this.stop(initial, entry, 'The entry module has unsupported initialization.')]
    const expression = unwrap(statement.expression)
    const call = ts.isAwaitExpression(expression) ? unwrap(expression.expression) : expression
    const imported = ts.isCallExpression(call) ? this.source.importOf(call.expression) : undefined
    if (
      !ts.isCallExpression(call) ||
      imported?.module !== '@jigging/flow' ||
      imported.member !== 'handle' ||
      call.arguments.length !== 1
    )
      return [
        this.stop(
          initial,
          statement,
          'The entrypoint must invoke the FLOW handle function directly.',
        ),
      ]
    const handler = this.functionAt(call.arguments[0]!, initial)
    if (handler === undefined)
      return [this.stop(initial, call, 'The handler body could not be resolved.')]
    return this.invoke(handler, [this.#context], initial, depth, { consumesReturn: true }).map(
      ({ returnedPromise, ...state }) =>
        returnedPromise === 'rejected' ? { ...state, mode: 'throw' } : state,
    )
  }

  private moduleSupported(file: ts.SourceFile): boolean {
    return (
      this.source.valid(file) &&
      file.statements.every((n) =>
        ts.isImportDeclaration(n)
          ? n.importClause !== undefined
          : ts.isExportDeclaration(n)
            ? n.moduleSpecifier === undefined
            : ts.isFunctionDeclaration(n) ||
              (ts.isClassDeclaration(n) && this.source.emptyErrorSubclass(n) !== undefined) ||
              ts.isInterfaceDeclaration(n) ||
              ts.isTypeAliasDeclaration(n) ||
              ts.isEmptyStatement(n) ||
              ts.isExpressionStatement(n) ||
              (ts.isVariableStatement(n) &&
                (n.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
                n.declarationList.declarations.every(
                  (d) =>
                    ts.isIdentifier(d.name) &&
                    d.initializer !== undefined &&
                    this.staticInitializer(d.initializer),
                )),
      )
    )
  }

  private staticInitializer(n: ts.Expression): boolean {
    const e = unwrap(n)
    if (ts.isIdentifier(e))
      return e.text === 'undefined' && this.source.declaration(e) === undefined
    if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) || isLocalFunction(e)) return true
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AsteriskToken)
      return ts.isNumericLiteral(unwrap(e.left)) && ts.isNumericLiteral(unwrap(e.right))
    if (
      [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
        e.kind,
      )
    )
      return true
    if (ts.isArrayLiteralExpression(e))
      return e.elements.every((item) => this.staticInitializer(item))
    if (ts.isObjectLiteralExpression(e))
      return e.properties.every(
        (p) =>
          ts.isPropertyAssignment(p) &&
          !ts.isComputedPropertyName(p.name) &&
          this.staticInitializer(p.initializer),
      )
    return false
  }

  private stop(
    state: State,
    node: ts.Node,
    detail: string,
    reportingWrapperSource?: ReportingWrapperSource,
  ): State {
    const site = this.source.site(node)
    return {
      ...state,
      steps: [
        ...state.steps,
        {
          kind: 'end',
          site,
          completion: 'unknown',
          detail,
          ...(reportingWrapperSource ? { reportingWrapperSource } : {}),
        },
      ],
      site,
      mode: 'unknown',
      value: unknown,
      stoppedAt: node,
    }
  }

  private functionAt(expression: ts.Expression, state: State): LocalFunction | undefined {
    const e = unwrap(expression)
    if (isLocalFunction(e)) return e
    if (!ts.isIdentifier(e)) return undefined
    const d = this.source.declaration(e)
    if (d === undefined) return undefined
    const bound = state.values.get(d)
    if (bound !== undefined) return bound.kind === 'function' ? bound.node : undefined
    if (ts.isFunctionDeclaration(d)) return d
    if (ts.isVariableDeclaration(d) && originalDeclaration(d) === undefined && d.initializer) {
      const initializer = unwrap(d.initializer)
      if (isLocalFunction(initializer)) return initializer
    }
    return undefined
  }

  private invoke(
    fn: LocalFunction,
    args: readonly Value[],
    caller: State,
    depth: number,
    options: { consumesReturn?: boolean; localCall?: ReportingCall } = {},
  ): State[] {
    this.budget.check()
    if (depth >= BEHAVIOR_LIMITS.depth)
      return [this.stop(caller, fn, 'Analysis reached the call depth limit.')]
    if (
      !fn.body ||
      fn.asteriskToken ||
      fn.parameters.some(
        (p) =>
          !ts.isIdentifier(p.name) ||
          (p.initializer !== undefined && !this.staticInitializer(p.initializer)) ||
          p.dotDotDotToken !== undefined ||
          p.name.text === 'this',
      )
    )
      return [this.stop(caller, fn, 'This function signature is outside the supported subset.')]
    const file = fn.getSourceFile()
    if (
      !this.moduleSupported(file) ||
      (file !== this.source.entry && file.statements.some(ts.isExpressionStatement))
    )
      return [this.stop(caller, fn, 'The helper module has unsupported initialization.')]
    const values = new Map(caller.values)
    fn.parameters.forEach((parameter, index) => {
      const given = args[index] ?? missing
      const fallback = parameter.initializer
      if (given.kind !== 'undefined' || fallback === undefined) values.set(parameter, given)
      else {
        const evaluated = this.expression(fallback, { ...caller, values }, depth)[0]
        // Static initializers have a single, effect-free value.
        values.set(parameter, evaluated?.value ?? unknown)
      }
    })
    const inner = {
      ...caller,
      values,
      localCall: options.localCall,
      consumesReturn: options.consumesReturn || isAsync(fn),
      mode: 'next' as const,
      value: missing,
    }
    const results = ts.isBlock(fn.body)
      ? this.block(fn.body.statements, [inner], depth)
      : this.returnExpression(fn.body, inner, depth, true).map((state) =>
          state.mode === 'next'
            ? { ...state, mode: 'return' as const, site: this.source.site(fn.body!) }
            : state,
        )
    for (const result of results) {
      const stoppedAt = result.stoppedAt
      if (
        !this.recordAuthoredContinuation ||
        result.mode !== 'unknown' ||
        !stoppedAt ||
        originalDeclaration(stoppedAt) !== fn
      )
        continue
      const cut = this.source.site(stoppedAt)
      const afterCut = (site: SourceSite) =>
        site.path === cut.path &&
        (site.line > cut.line || (site.line === cut.line && (site.column ?? 0) > (cut.column ?? 0)))
      const { handoffs, fileWrites } = this.source.continuationSites(fn)
      for (const { receiver, priorExits, repeat, ...handoff } of handoffs) {
        if (result.values.get(receiver)?.kind !== 'context') continue
        const target = this.target.slots.get(handoff.slot)
        if (target === undefined) continue
        if (repeat && repeat.end > stoppedAt.getStart())
          this.recordAuthoredContinuation({
            kind: 'repeat',
            value: { loop: repeat.loop, site: handoff.site, slot: handoff.slot, target },
          })
        if (!afterCut(handoff.site)) continue
        const exits = priorExits?.filter(({ condition }) => afterCut(condition.site))
        this.recordAuthoredContinuation({
          kind: 'handoff',
          value: {
            ...handoff,
            target,
            ...(exits?.length ? { priorExits: exits } : {}),
          },
        })
      }
      for (const write of fileWrites)
        if (afterCut(write.site))
          this.recordAuthoredContinuation({ kind: 'file-write', value: write })
    }
    return results.map((state) => {
      const restored = new Map(state.values)
      for (const key of restored.keys()) {
        if (originalDeclaration(key) !== fn) continue
        const previous = caller.values.get(key)
        if (previous === undefined) restored.delete(key)
        else restored.set(key, previous)
      }
      return {
        ...state,
        values: restored,
        localCall: caller.localCall,
        consumesReturn: caller.consumesReturn,
        site: state.site ?? this.source.site(fn),
      }
    })
  }

  private block(statements: readonly ts.Statement[], states: State[], depth: number): State[] {
    for (const statement of statements) {
      states = this.retainVariants(
        statement,
        states.flatMap((state) =>
          state.mode === 'next' ? this.advance(statement, state, depth) : [state],
        ),
      )
    }
    return states
  }

  private advance(statement: ts.Statement, state: State, depth: number): State[] {
    try {
      return this.statement(statement, state, depth)
    } catch (error) {
      if (!(error instanceof AnalysisLimit) || !this.retainLimitedPaths) throw error
      return [this.stop(state, statement, error.message)]
    }
  }

  private retainVariants(node: ts.Node, states: State[]): State[] {
    if (states.length <= BEHAVIOR_LIMITS.variants) return states
    if (!this.retainLimitedPaths) return this.budget.variants(states)
    // Keep room for continuations as well as already established exits.
    const capacity = BEHAVIOR_LIMITS.variants - 1
    const continuing = states.filter((state) => state.mode === 'next')
    const differentExits = new Map<string, State>()
    const otherExits: State[] = []
    for (const state of states) {
      if (state.mode === 'next') continue
      const last = state.steps.at(-1)
      const result =
        state.mode === 'return'
          ? resultText(state.value)
          : state.value.kind === 'error'
            ? describe(state.value.message)
            : last?.kind === 'end'
              ? last.detail
              : describe(state.value)
      const key = JSON.stringify([state.mode, state.site, result])
      if (differentExits.has(key)) otherExits.push(state)
      else differentExits.set(key, state)
    }
    const completed = [...differentExits.values(), ...otherExits]
    const keep = Math.min(
      continuing.length,
      Math.max(Math.floor(capacity / 2), capacity - completed.length),
    )
    const sample = [...continuing.slice(0, keep), ...completed.slice(0, capacity - keep)]
    const omitted = [...continuing.slice(keep), ...completed.slice(capacity - keep)]
    const first = omitted[0]!
    const prefix: BehaviorStep[] = []
    for (const [index, step] of first.steps.entries()) {
      if (!omitted.every((state) => state.steps[index] === step)) break
      if (step.kind === 'end') break
      prefix.push(step)
    }
    const assumptions = first.assumptions.filter((fact) =>
      omitted.every((state) => state.assumptions.includes(fact)),
    )
    return [
      ...sample,
      this.stop(
        { ...first, steps: prefix, assumptions },
        node,
        'Analysis reached the limit on alternatives. Other continuations here are unknown.',
      ),
    ]
  }

  private branch<T extends State>(
    n: ts.Expression,
    value: Value,
    state: T,
    alternatives: (s: State, taken: boolean) => State[],
    {
      label,
      enteringValues,
      readOperation,
      validation,
    }: {
      label?: string
      enteringValues?: State['values']
      readOperation?: true
      validation?: true
    } = {},
  ): State[] {
    const condition = truth(value)
    const possible = condition === undefined ? [true, false] : [condition]
    const sourceCode = label ?? n.getText()
    const enteringNumbers =
      condition === undefined && enteringValues && sourceCode.length <= 140
        ? this.comparisonNumbers(n, enteringValues)
        : []
    const setting =
      condition !== undefined && enteringValues && this.target.declarationPath
        ? this.source.settingRead(n, (receiver) => enteringValues.get(receiver)?.kind === 'context')
        : undefined
    return this.retainVariants(
      n,
      possible.flatMap((taken) =>
        alternatives(
          add(state, {
            kind: 'condition',
            site: this.source.site(n),
            code: sourceCode.length <= 512 ? sourceCode : sourceCode.slice(0, 511) + '…',
            taken,
            unresolved: condition === undefined,
            ...(validation ? { validation } : {}),
            ...(enteringNumbers.length > 0 ? { enteringNumbers } : {}),
            ...(setting === undefined ? {} : { setting: { owner: this.target.id, name: setting } }),
            ...(readOperation ? { readOperation } : {}),
          }),
          taken,
        ),
      ),
    )
  }

  private validationGuard(statement: ts.IfStatement): true | undefined {
    if (statement.elseStatement) return undefined
    const arm = statement.thenStatement
    const only = ts.isBlock(arm)
      ? arm.statements.length === 1
        ? arm.statements[0]
        : undefined
      : arm
    const failure = only && ts.isThrowStatement(only) ? unwrap(only.expression) : undefined
    if (!failure || !ts.isNewExpression(failure)) return undefined
    const args = failure.arguments ?? []
    if (args.length > 1 || (args[0] && !ts.isStringLiteralLike(args[0]))) return undefined
    const error = this.source.errorClass(failure.expression)
    return error?.base === 'TypeError' || error?.base === 'RangeError' ? true : undefined
  }

  private comparisonNumbers(n: ts.Expression, values: State['values']) {
    const numbers = new Map<string, number>()
    const visit = (expression: ts.Expression): void => {
      const node = unwrap(expression)
      if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
        visit(node.operand)
        return
      }
      if (!ts.isBinaryExpression(node)) return
      const operator = node.operatorToken.kind
      if (
        operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.BarBarToken
      ) {
        visit(node.left)
        visit(node.right)
        return
      }
      if (operator < ts.SyntaxKind.LessThanToken || operator > ts.SyntaxKind.GreaterThanEqualsToken)
        return
      for (const operand of [unwrap(node.left), unwrap(node.right)]) {
        if (!ts.isIdentifier(operand) || numbers.size >= 2) continue
        const declaration = this.source.declaration(operand)
        const value = declaration && values.get(declaration)
        if (
          value?.kind === 'literal' &&
          typeof value.value === 'number' &&
          Number.isFinite(value.value)
        )
          numbers.set(operand.text, value.value)
      }
    }
    visit(n)
    return [...numbers]
  }

  private statement(n: ts.Statement, state: State, depth: number): State[] {
    this.budget.check()
    if (ts.isBlock(n)) return this.block(n.statements, [state], depth)
    if (ts.isExpressionStatement(n)) return this.expression(n.expression, state, depth)
    if (ts.isVariableStatement(n)) {
      let states = [state]
      for (const declaration of n.declarationList.declarations) {
        if (!(n.declarationList.flags & ts.NodeFlags.BlockScoped))
          return states.map((s) =>
            this.stop(s, n, 'Function-scoped variables are outside the supported subset.'),
          )
        states = this.retainVariants(
          declaration,
          states.flatMap((s) => {
            if (s.mode !== 'next') return [s]
            const expr = declaration.initializer
            return (expr ? this.expression(expr, s, depth) : [withValue(s, missing)]).map(
              (result) =>
                result.mode === 'next' ? this.bind(result, declaration.name, result.value) : result,
            )
          }),
        )
      }
      return states
    }
    if (ts.isIfStatement(n))
      return this.continue(this.expression(n.expression, state, depth), (s, value) =>
        this.branch(
          n.expression,
          value,
          s,
          (branch, taken) => {
            const selected = taken ? n.thenStatement : n.elseStatement
            return selected === undefined ? [branch] : this.advance(selected, branch, depth)
          },
          {
            enteringValues: state.values,
            ...(this.validationGuard(n) ? { validation: true } : {}),
          },
        ),
      )
    if (ts.isReturnStatement(n)) {
      const results = n.expression
        ? this.returnExpression(n.expression, state, depth)
        : [withValue(state, missing)]
      return results.map((s) =>
        s.mode === 'next' ? { ...s, mode: 'return', site: this.source.site(n) } : s,
      )
    }
    if (ts.isThrowStatement(n)) {
      const results = this.expression(n.expression, state, depth)
      return results.map((s) => (s.mode === 'next' ? raised(s, this.source.site(n), s.value) : s))
    }
    if (ts.isTryStatement(n)) {
      const caught = n.catchClause
      let results = this.advance(n.tryBlock, state, depth)
      if (caught !== undefined)
        results = this.retainVariants(
          caught,
          results.flatMap((s) => {
            if (s.mode !== 'throw') return [s]
            const resumed = next(s)
            return this.advance(
              caught.block,
              caught.variableDeclaration
                ? this.bind(resumed, caught.variableDeclaration.name, s.value)
                : resumed,
              depth,
            )
          }),
        )
      const finalizer = n.finallyBlock
      if (finalizer !== undefined)
        results = this.retainVariants(
          finalizer,
          results.flatMap((s) =>
            s.mode === 'unknown'
              ? [s]
              : this.advance(finalizer, next(s), depth).map((fin) =>
                  fin.mode !== 'next'
                    ? fin
                    : {
                        ...s,
                        values: fin.values,
                        steps: fin.steps,
                        assumptions: fin.assumptions,
                        ...(fin.closeAttempted ? { closeAttempted: fin.closeAttempted } : {}),
                      },
                ),
          ),
        )
      return results
    }
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isTypeAliasDeclaration(n) ||
      ts.isInterfaceDeclaration(n) ||
      ts.isEmptyStatement(n)
    )
      return [state]
    if (ts.isForOfStatement(n) && !n.awaitModifier) {
      const declaration =
        ts.isVariableDeclarationList(n.initializer) &&
        (n.initializer.flags & ts.NodeFlags.Const) !== 0 &&
        n.initializer.declarations.length === 1
          ? n.initializer.declarations[0]
          : undefined
      const collection = n.expression.getText().replace(/\s+/g, ' ').slice(0, 80)
      const site = this.source.site(n)
      if (declaration && !declaration.initializer) {
        // The body cannot already hold an alias to a fresh literal array.
        const array = unwrap(n.expression)
        const fixed =
          ts.isArrayLiteralExpression(array) &&
          array.elements.every((item) => this.staticInitializer(item))
        const iterables = this.expression(n.expression, state, depth)
        return this.retainVariants(
          n,
          iterables.flatMap((iterable) => {
            if (iterable.mode !== 'next') return [iterable]
            if (
              iterable.value.kind === 'array' &&
              iterable.value.items.length <= BEHAVIOR_LIMITS.loopItems &&
              fixed
            ) {
              const { items } = iterable.value
              let paths = [add(iterable, { kind: 'repeat', site, collection, count: items.length })]
              for (const item of items)
                paths = this.retainVariants(
                  n,
                  paths.flatMap((path) => {
                    if (path.mode !== 'next') return [path]
                    const bound = this.bind(path, declaration.name, item)
                    return bound.mode === 'next' ? this.advance(n.statement, bound, depth) : [bound]
                  }),
                )
              return paths
            }
            return [this.dataLoop(n, add(iterable, { kind: 'repeat', site, collection }))]
          }),
        )
      }
      return [this.dataLoop(n, add(state, { kind: 'repeat', site, collection }))]
    }
    return [this.stop(state, n, 'Unsupported statement: ' + ts.SyntaxKind[n.kind] + '.')]
  }

  private dataLoop(n: ts.ForOfStatement, state: State): State {
    const proof = dataEffects(this.source, n, state.values)
    if (proof) {
      const arrays = new Set<Value | undefined>(
        [...proof.writes]
          .map((key) => state.values.get(key))
          .filter((value) => value?.kind === 'array'),
      )
      const invalidate = (value: Value): Value =>
        arrays.has(value)
          ? unknown
          : value.kind === 'array'
            ? { kind: 'array', items: value.items.map(invalidate) }
            : value.kind === 'object'
              ? object(
                  [...value.fields].map(([key, field]) => [key, invalidate(field)]),
                  value.open,
                )
              : value
      return {
        ...add(state, {
          kind: 'gap',
          site: this.source.site(n),
          detail: 'Iteration details unknown. This continuation assumes the data loop completes.',
        }),
        values: new Map(
          [...state.values].map(([key, value]) => [
            key,
            proof.writes.has(key as ts.Declaration) ? unknown : invalidate(value),
          ]),
        ),
      }
    }
    return this.stop(
      state,
      n,
      'The loop body or number of iterations is outside the supported subset.',
    )
  }

  private bind(state: State, name: ts.BindingName, value: Value): State {
    const values = new Map(state.values)
    const bindOne = (pattern: ts.BindingName, item: Value): boolean => {
      if (ts.isIdentifier(pattern)) {
        const declaration = this.source.declaration(pattern)
        if (declaration === undefined) return false
        values.set(declaration, item)
        return true
      }
      if (ts.isArrayBindingPattern(pattern))
        return pattern.elements.every(
          (element, i) =>
            ts.isOmittedExpression(element) ||
            (!element.dotDotDotToken &&
              !element.initializer &&
              bindOne(element.name, field(item, String(i)))),
        )
      if (!ts.isObjectBindingPattern(pattern)) return false
      return pattern.elements.every((element) => {
        const key = element.propertyName ?? element.name
        return (
          !element.dotDotDotToken &&
          !element.initializer &&
          (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) &&
          bindOne(element.name, field(item, key.text))
        )
      })
    }
    return bindOne(name, value)
      ? { ...state, values }
      : this.stop(state, name, 'This binding pattern is outside the supported subset.')
  }

  private continue(states: State[], apply: (state: State, value: Value) => State[]): State[] {
    return this.budget.variants(
      states.flatMap((s) => (s.mode === 'next' ? apply(s, s.value) : [s])),
    )
  }

  private returnExpression(
    expression: ts.Expression,
    state: State,
    depth: number,
    concise = false,
  ): State[] {
    const owner = originalDeclaration(expression)
    const value = unwrap(expression)
    if (owner && state.consumesReturn && ts.isCallExpression(value)) {
      const callee = unwrap(value.expression)
      const imported = this.source.importOf(callee)
      if (
        this.functionAt(callee, state) ||
        (imported?.module === '@jigging/reporting' && imported.member === 'withReporting')
      ) {
        let returned: ReturnedCall = 'direct'
        for (
          let parent = value.parent;
          parent !== undefined && parent !== owner;
          parent = parent.parent
        )
          if (ts.isTryStatement(parent) && parent.finallyBlock) {
            returned = 'with-finalizer'
            break
          }
        this.budget.check()
        return this.call(value, state, depth, false, returned)
      }
    }
    return this.expression(expression, state, depth, concise && state.consumesReturn === true)
  }

  private promiseCompletion(
    completion: State,
    returned: ReturnedCall | undefined,
    e: ts.CallExpression,
  ): State {
    if (completion.mode === 'unknown') return { ...completion, stoppedAt: e }
    const { returnedPromise, ...settled } = completion
    const rejected = settled.mode === 'throw' || returnedPromise === 'rejected'
    const value = settled.mode === 'next' ? missing : settled.value
    // A direct return leaves the local try before a rejection reaches the caller.
    return returned === undefined
      ? { ...settled, value, mode: rejected ? 'throw' : 'next' }
      : { ...settled, value, mode: 'return', returnedPromise: rejected ? 'rejected' : 'fulfilled' }
  }

  private returnedWithFinalizer(state: State, call: ts.CallExpression): State {
    return this.stop(state, call, 'Returned helper and a surrounding finalizer can interleave.')
  }

  private expression(
    expression: ts.Expression,
    state: State,
    depth: number,
    awaited = false,
  ): State[] {
    this.budget.check()
    const e = unwrap(expression)
    const result = (value: Value) => [withValue(state, value)]
    if (ts.isAwaitExpression(e)) return this.expression(e.expression, state, depth, true)
    if (ts.isStringLiteralLike(e)) return result(literal(e.text))
    if (e.kind === ts.SyntaxKind.RegularExpressionLiteral) return result(unknown)
    if (ts.isNumericLiteral(e)) return result(literal(Number(e.text)))
    if (e.kind === ts.SyntaxKind.NullKeyword) return result(literal(null))
    if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword)
      return result(literal(e.kind === ts.SyntaxKind.TrueKeyword))
    if (ts.isIdentifier(e)) {
      const d = this.source.declaration(e)
      if (d === undefined && e.text === 'undefined') return result(missing)
      const bound = d === undefined ? undefined : state.values.get(d)
      if (bound !== undefined) return result(bound)
      const fn = this.functionAt(e, state)
      if (fn !== undefined) return result({ kind: 'function', node: fn })
      if (
        d &&
        ts.isVariableDeclaration(d) &&
        originalDeclaration(d) === undefined &&
        d.initializer &&
        this.staticInitializer(d.initializer)
      )
        return this.expression(d.initializer, state, depth)
      return result(unknown)
    }
    if (isLocalFunction(e)) return result({ kind: 'function', node: e })
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e))
      return this.continue(this.expression(e.expression, state, depth), (s, receiver) => {
        if (
          e.questionDotToken &&
          (receiver.kind === 'undefined' ||
            (receiver.kind === 'literal' && receiver.value === null))
        )
          return [withValue(s, missing)]
        const get = (current: State, name: string) => {
          const value =
            receiver.kind !== 'context'
              ? field(receiver, name)
              : name === 'input'
                ? this.input
                : name === 'settings'
                  ? fromJson(this.target.settings)
                  : unknown
          return [withValue(current, value)]
        }
        return ts.isPropertyAccessExpression(e)
          ? get(s, e.name.text)
          : this.continue(this.expression(e.argumentExpression, s, depth), (current, key) =>
              key.kind === 'literal'
                ? get(current, String(key.value))
                : [withValue(current, unknown)],
            )
      })
    if (ts.isObjectLiteralExpression(e)) {
      let states = result(object([]))
      for (const property of e.properties)
        states = this.continue(states, (s, current) => {
          const fields = current.kind === 'object' ? current.fields : new Map<string, Value>()
          const open = current.kind === 'object' && current.open === true
          if (ts.isSpreadAssignment(property))
            return this.continue(this.expression(property.expression, s, depth), (ss, spread) => [
              withValue(
                ss,
                this.reportingTrace.spread(
                  current,
                  spread.kind === 'object' && !spread.open
                    ? object([...fields, ...spread.fields], open)
                    : object(spread.kind === 'object' ? spread.fields : [], true),
                  spread,
                ),
              ),
            ])
          if (ts.isShorthandPropertyAssignment(property))
            return this.continue(this.expression(property.name, s, depth), (ss, item) => [
              withValue(
                ss,
                this.reportingTrace.property(
                  current,
                  object([...fields, [property.name.text, item]], open),
                  property.name.text,
                  property.name,
                  this.source,
                ),
              ),
            ])
          if (
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteralLike(property.name) ||
              ts.isNumericLiteral(property.name))
          ) {
            const name = property.name.text
            if (name === '__proto__')
              return [
                this.stop(
                  s,
                  property,
                  'Object prototype changes are outside the supported subset.',
                ),
              ]
            return this.continue(this.expression(property.initializer, s, depth), (ss, item) => [
              withValue(
                ss,
                this.reportingTrace.property(
                  current,
                  object([...fields, [name, item]], open),
                  name,
                  property.initializer,
                  this.source,
                ),
              ),
            ])
          }
          return [this.stop(s, property, 'Unsupported object property.')]
        })
      return states
    }
    if (ts.isArrayLiteralExpression(e)) {
      let states = result({ kind: 'array', items: [] })
      for (const item of e.elements)
        states = this.continue(states, (s, array) =>
          this.continue(
            this.expression(ts.isSpreadElement(item) ? item.expression : item, s, depth),
            (ss, value) => {
              const prefix = array.kind === 'array' ? array.items : []
              if (!ts.isSpreadElement(item))
                return [withValue(ss, { kind: 'array', items: [...prefix, value] })]
              if (
                (value.kind === 'array' || value.kind === 'set') &&
                value.items.length <= BEHAVIOR_LIMITS.loopItems
              )
                return [withValue(ss, { kind: 'array', items: [...prefix, ...value.items] })]
              return [
                this.stop(
                  ss,
                  item,
                  'The spread iterable or length is outside the supported subset.',
                ),
              ]
            },
          ),
        )
      return states
    }
    if (ts.isTemplateExpression(e)) {
      let states = result(literal(e.head.text))
      for (const span of e.templateSpans)
        states = this.continue(states, (s, prefix) =>
          this.continue(this.expression(span.expression, s, depth), (ss, value) => [
            withValue(
              ss,
              prefix.kind === 'literal' && value.kind === 'literal'
                ? literal(String(prefix.value) + String(value.value) + span.literal.text)
                : unknown,
            ),
          ]),
        )
      return states
    }
    if (ts.isTypeOfExpression(e))
      return this.continue(this.expression(e.expression, state, depth), (s, value) => [
        withValue(
          s,
          value.kind === 'unknown' || (value.kind === 'integer-range' && value.optional)
            ? unknown
            : literal(
                value.kind === 'literal'
                  ? typeof value.value
                  : value.kind === 'decoded-text' || value.kind === 'input-string'
                    ? 'string'
                    : value.kind === 'integer-range'
                      ? 'number'
                      : value.kind === 'undefined' || value.kind === 'function'
                        ? value.kind
                        : 'object',
              ),
        ),
      ])
    if (ts.isNewExpression(e)) {
      if (strictUtf8Decoder(this.source, e)) return result({ kind: 'strict-utf8-decoder' })
      const error = this.source.errorClass(e.expression)
      const args = e.arguments ?? []
      if (error && args.length <= 1 && !args.some(ts.isSpreadElement)) {
        const message = args[0]
        return message === undefined
          ? result({ kind: 'error', type: error, message: literal('') })
          : this.continue(this.expression(message, state, depth), (s, value) => [
              withValue(s, {
                kind: 'error',
                type: error,
                message:
                  value.kind === 'literal'
                    ? literal(String(value.value))
                    : value.kind === 'undefined'
                      ? literal('')
                      : unknown,
              }),
            ])
      }
      if (ts.isIdentifier(e.expression) && this.source.declaration(e.expression) === undefined) {
        if (e.expression.text === 'Set') {
          if (!args.length) return result({ kind: 'set', items: [] })
          const arg = args[0]
          if (arg && args.length === 1 && dataEffects(this.source, arg, state.values)) {
            return this.continue(this.expression(arg, state, depth), (s, entries) => {
              if (
                entries.kind === 'undefined' ||
                (entries.kind === 'literal' && entries.value === null)
              )
                return [withValue(s, { kind: 'set', items: [] })]
              if (
                entries.kind !== 'array' ||
                entries.items.length > BEHAVIOR_LIMITS.loopItems ||
                !entries.items.every((item) => item.kind === 'literal' || item.kind === 'undefined')
              )
                return [withValue(s, object([['size', unknown]]))]
              const seen = new Set<string | number | boolean | null | undefined>()
              const items: Value[] = []
              for (const item of entries.items) {
                const scalar = item.kind === 'literal' ? item.value : undefined
                if (seen.has(scalar)) continue
                seen.add(scalar)
                items.push(scalar === 0 ? literal(0) : item)
              }
              return [withValue(s, { kind: 'set', items })]
            })
          }
        }
        if (e.expression.text === 'Map' && args.length === 0) return result(unknown)
      }
    }
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken)
      return this.continue(this.expression(e.operand, state, depth), (s, value) => {
        const known = truth(value)
        return [withValue(s, known === undefined ? unknown : literal(!known))]
      })
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken) {
      const operand = unwrap(e.operand)
      if (ts.isNumericLiteral(operand)) return result(literal(-Number(operand.text)))
    }
    if (ts.isConditionalExpression(e))
      return this.continue(this.expression(e.condition, state, depth), (s, value) =>
        this.branch(
          e.condition,
          value,
          s,
          (ss, taken) => this.expression(taken ? e.whenTrue : e.whenFalse, ss, depth),
          { enteringValues: state.values },
        ),
      )
    if (ts.isBinaryExpression(e)) return this.binary(e, state, depth)
    if (ts.isCallExpression(e)) return this.call(e, state, depth, awaited)
    return [this.stop(state, e, 'Unsupported expression: ' + ts.SyntaxKind[e.kind] + '.')]
  }

  private binary(e: ts.BinaryExpression, state: State, depth: number): State[] {
    const operator = e.operatorToken.kind
    if (operator === ts.SyntaxKind.InstanceOfKeyword) {
      const expected = this.source.errorClass(e.right)
      if (expected)
        return this.continue(this.expression(e.left, state, depth), (s, value) => [
          withValue(
            s,
            value.kind !== 'error'
              ? unknown
              : literal(
                  expected.identity !== undefined
                    ? value.type.identity === expected.identity
                    : expected.base === 'Error' || value.type.base === expected.base,
                ),
          ),
        ])
    }
    if (operator === ts.SyntaxKind.EqualsToken) {
      const left = unwrap(e.left)
      const binding = ts.isIdentifier(left) ? this.source.declaration(left) : undefined
      if (binding === undefined || !state.values.has(binding))
        return [
          this.stop(state, e, 'This assignment may change state outside the supported subset.'),
        ]
      return this.continue(this.expression(e.right, state, depth), (s, value) => [
        { ...s, values: new Map([...s.values, [binding, value]]) },
      ])
    }
    return this.continue(this.expression(e.left, state, depth), (s, left) => {
      if (
        operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.BarBarToken
      ) {
        const known = truth(left)
        if (known === undefined && dataEffects(this.source, e.right, s.values))
          return [withValue(s, unknown)]
        if (known === undefined)
          return this.branch(e.left, left, s, (ss, taken) =>
            taken === (operator === ts.SyntaxKind.AmpersandAmpersandToken)
              ? this.expression(e.right, ss, depth)
              : [
                  withValue(ss, {
                    kind: left.kind === 'decoded-text' ? 'decoded-text' : 'unknown',
                    truthiness: taken,
                  }),
                ],
          )
        return known === (operator === ts.SyntaxKind.AmpersandAmpersandToken)
          ? this.expression(e.right, s, depth)
          : [withValue(s, left)]
      }
      if (operator === ts.SyntaxKind.QuestionQuestionToken) {
        if (left.kind === 'integer-range' && left.optional) {
          const expression = unwrap(e.right)
          const fallback = ts.isNumericLiteral(expression) ? Number(expression.text) : undefined
          if (fallback !== undefined && Number.isSafeInteger(fallback))
            return [
              withValue(s, {
                kind: 'integer-range',
                minimum: Math.min(left.minimum, fallback),
                maximum: Math.max(left.maximum, fallback),
              }),
            ]
        }
        if (left.kind === 'unknown' || (left.kind === 'integer-range' && left.optional)) {
          if (truth(left) === true) return [withValue(s, left)]
          if (dataEffects(this.source, e.right, s.values)) return [withValue(s, unknown)]
          return this.branch(
            e.left,
            unknown,
            s,
            (ss, coalesces) =>
              coalesces ? this.expression(e.right, ss, depth) : [withValue(ss, left)],
            { label: 'nullish test: ' + e.left.getText().slice(0, 100) },
          )
        }
        return left.kind === 'undefined' || (left.kind === 'literal' && left.value === null)
          ? this.expression(e.right, s, depth)
          : [withValue(s, left)]
      }
      return this.continue(this.expression(e.right, s, depth), (ss, right) => {
        if (
          operator >= ts.SyntaxKind.LessThanToken &&
          operator <= ts.SyntaxKind.GreaterThanEqualsToken
        ) {
          const order = compareBounds(operator, left, right)
          if (order !== undefined) return [withValue(ss, literal(order))]
        }
        if (
          operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
        ) {
          if (
            left.kind === 'unknown' ||
            right.kind === 'unknown' ||
            (left.kind !== 'literal' && left.kind !== 'undefined') ||
            (right.kind !== 'literal' && right.kind !== 'undefined')
          )
            return [withValue(ss, unknown)]
          const equal =
            left.kind === 'literal' && right.kind === 'literal'
              ? left.value === right.value
              : left.kind === right.kind
          return [
            withValue(ss, literal(equal === (operator === ts.SyntaxKind.EqualsEqualsEqualsToken))),
          ]
        }
        if (
          operator === ts.SyntaxKind.PlusToken &&
          left.kind === 'literal' &&
          right.kind === 'literal' &&
          (typeof left.value === 'string' || typeof right.value === 'string')
        )
          return [withValue(ss, literal(String(left.value) + String(right.value)))]
        if (
          left.kind === 'literal' &&
          right.kind === 'literal' &&
          typeof left.value === 'number' &&
          typeof right.value === 'number'
        ) {
          const a = left.value,
            b = right.value
          switch (operator) {
            case ts.SyntaxKind.PlusToken:
              return [withValue(ss, literal(a + b))]
            case ts.SyntaxKind.BarToken:
              return [withValue(ss, literal(a | b))]
            case ts.SyntaxKind.MinusToken:
              return [withValue(ss, literal(a - b))]
            case ts.SyntaxKind.AsteriskToken:
              return [withValue(ss, literal(a * b))]
            case ts.SyntaxKind.SlashToken:
              return [withValue(ss, literal(a / b))]
            case ts.SyntaxKind.LessThanToken:
              return [withValue(ss, literal(a < b))]
            case ts.SyntaxKind.LessThanEqualsToken:
              return [withValue(ss, literal(a <= b))]
            case ts.SyntaxKind.GreaterThanToken:
              return [withValue(ss, literal(a > b))]
            case ts.SyntaxKind.GreaterThanEqualsToken:
              return [withValue(ss, literal(a >= b))]
          }
        }
        if (
          isData(left) &&
          isData(right) &&
          [
            ts.SyntaxKind.PlusToken,
            ts.SyntaxKind.MinusToken,
            ts.SyntaxKind.AsteriskToken,
            ts.SyntaxKind.SlashToken,
            ts.SyntaxKind.BarToken,
            ts.SyntaxKind.InKeyword,
            ts.SyntaxKind.LessThanToken,
            ts.SyntaxKind.LessThanEqualsToken,
            ts.SyntaxKind.GreaterThanToken,
            ts.SyntaxKind.GreaterThanEqualsToken,
          ].includes(operator)
        )
          return [withValue(ss, unknown)]
        return [this.stop(ss, e, 'Unsupported or unresolved binary operation.')]
      })
    })
  }

  private call(
    e: ts.CallExpression,
    state: State,
    depth: number,
    awaited: boolean,
    returned?: ReturnedCall,
  ): State[] {
    const callee = unwrap(e.expression)
    const fn = this.functionAt(callee, state)
    const imported = this.source.importOf(callee)
    const intrinsic = dataIntrinsic(this.source, callee)
    if (intrinsic && !e.questionDotToken)
      return this.arguments(e.arguments, state, depth).map(({ state: result, values }) =>
        result.mode !== 'next'
          ? result
          : withValue(
              result,
              intrinsic === 'Boolean' || values.every(isData)
                ? evaluateIntrinsic(intrinsic, values)
                : unknown,
            ),
      )
    if (imported?.module === '@jigging/reporting' && imported.member === 'withReporting') {
      const [context, channel, body] = e.arguments
      const handler = body === undefined ? undefined : this.functionAt(body, state)
      if (
        !this.source.reportingEnabled(callee) ||
        (!awaited && returned === undefined) ||
        context === undefined ||
        this.boundValue(context, state)?.kind !== 'context' ||
        channel === undefined ||
        !ts.isStringLiteralLike(channel) ||
        handler === undefined ||
        e.arguments.length !== 3
      ) {
        const source =
          body && !e.arguments.some(ts.isSpreadElement)
            ? this.source.callbackSource(body)
            : undefined
        return [
          this.stop(state, e, 'Reporting wrapper or installed implementation is opaque.', source),
        ]
      }
      if (returned === 'with-finalizer') return [this.returnedWithFinalizer(state, e)]
      return this.invoke(handler, [{ kind: 'reporter' }], state, depth + 1, {
        consumesReturn: true,
      }).map((completion) => this.promiseCompletion(completion, returned, e))
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const receiver = this.boundValue(callee.expression, state)
      const base = unwrap(callee.expression)
      const argument = e.arguments[0]
      if (
        callee.name.text === 'decode' &&
        (receiver?.kind === 'strict-utf8-decoder' ||
          (ts.isNewExpression(base) && strictUtf8Decoder(this.source, base))) &&
        e.arguments.length === 1 &&
        argument &&
        !ts.isSpreadElement(argument)
      )
        return this.continue(this.expression(argument, state, depth), (s, value) =>
          value.kind === 'file-bytes'
            ? this.checkedOperation(
                e,
                s,
                'UTF-8 decoding succeeds',
                { kind: 'decoded-text' },
                { kind: 'error', type: { base: 'TypeError' }, message: unknown },
              )
            : [this.stop(s, e, 'The bytes supplied to the decoder are unresolved.')],
        )
      if (
        callee.name.text === 'parse' &&
        ts.isIdentifier(base) &&
        base.text === 'JSON' &&
        this.source.declaration(base) === undefined &&
        e.arguments.length === 1 &&
        argument &&
        !ts.isSpreadElement(argument)
      )
        return this.continue(this.expression(argument, state, depth), (s, value) =>
          value.kind === 'decoded-text'
            ? this.checkedOperation(e, s, 'JSON syntax is valid', unknown, {
                kind: 'error',
                type: { base: 'SyntaxError' },
                message: unknown,
              })
            : [this.stop(s, e, 'The text supplied to JSON.parse is unresolved.')],
        )
      if (receiver?.kind === 'file-handle' && awaited && e.arguments.length === 0) {
        const method = callee.name.text
        if (state.closeAttempted?.has(receiver))
          return [this.stop(state, e, 'File handle use after a close attempt is unresolved.')]
        if (method === 'stat')
          return this.fileOperation(e, state, method, receiver.path, { kind: 'file-stat' })
        if (method === 'readFile')
          return this.fileOperation(e, state, method, receiver.path, { kind: 'file-bytes' })
        if (method === 'close')
          return this.fileOperation(
            e,
            {
              ...state,
              closeAttempted: new Set([...(state.closeAttempted ?? []), receiver]),
            },
            method,
            receiver.path,
            missing,
          )
      }
      if (
        receiver?.kind === 'file-stat' &&
        callee.name.text === 'isFile' &&
        e.arguments.length === 0
      )
        return [withValue(state, unknown)]
      const reporting = this.reportCall(e, callee.name.text, receiver, state, depth)
      if (reporting !== undefined) return reporting
      if (ts.isCallExpression(unwrap(callee.expression))) {
        const inner = unwrap(callee.expression)
        if (
          ts.isCallExpression(inner) &&
          ts.isPropertyAccessExpression(inner.expression) &&
          this.boundValue(inner.expression.expression, state)?.kind === 'reporter'
        )
          return this.continue(
            this.expression(inner, state, depth),
            (ss, view) =>
              this.reportCall(e, callee.name.text, view, ss, depth) ?? [
                this.stop(ss, e, 'Opaque reporting view operation.'),
              ],
          )
      }
      if (
        callee.name.text === 'test' &&
        unwrap(callee.expression).kind === ts.SyntaxKind.RegularExpressionLiteral
      )
        return this.arguments(e.arguments, state, depth).map(({ state: result, values }) => {
          if (result.mode !== 'next') return result
          return values.every(isData)
            ? withValue(result, unknown)
            : this.stop(result, e, 'The regular expression argument is opaque.')
        })
      const callback = e.arguments[0]
      if (
        this.retainLimitedPaths &&
        callee.name.text === 'map' &&
        !callee.questionDotToken &&
        !e.questionDotToken &&
        callback !== undefined &&
        e.arguments.length === 1
      ) {
        const mapper = this.functionAt(callback, state)
        if (
          mapper &&
          dataEffects(this.source, callee.expression, state.values) &&
          dataEffects(this.source, mapper, state.values, { allowExplicitThrows: true })
        )
          return this.continue(this.expression(callee.expression, state, depth), (s, array) =>
            this.mapData(e, mapper, s, array, depth),
          )
      }
      if (dataMethod(callee.name.text) && dataEffects(this.source, e, state.values))
        return this.continue(this.expression(callee.expression, state, depth), (ss, recv) =>
          this.arguments(e.arguments, ss, depth).map((row) =>
            row.state.mode !== 'next'
              ? row.state
              : withValue(row.state, evaluateDataMethod(callee.name.text, recv, row.values)),
          ),
        )
      if (
        receiver?.kind === 'array' &&
        ts.isIdentifier(callee.expression) &&
        ['push', 'unshift', 'splice'].includes(callee.name.text)
      ) {
        const declaration = this.source.declaration(callee.expression)
        if (
          declaration &&
          ts.isVariableDeclaration(declaration) &&
          ts.isVariableDeclarationList(declaration.parent) &&
          (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
          declaration.initializer &&
          ts.isArrayLiteralExpression(unwrap(declaration.initializer))
        ) {
          return this.arguments(e.arguments, state, depth).map(({ state: ss, values }) => {
            if (ss.mode !== 'next') return ss
            // Do not conflate a receiver that an argument may already have changed.
            if (
              ss.values.get(declaration) !== receiver ||
              !values.every(isData) ||
              values.some((item) => contains(item, receiver))
            )
              return this.stop(ss, e, 'The local array mutation could not be isolated.')
            const items = [...receiver.items]
            if (callee.name.text === 'push') items.push(...values)
            else if (callee.name.text === 'unshift') items.unshift(...values)
            else {
              const [start, size, ...insert] = values
              if (
                start?.kind !== 'literal' ||
                typeof start.value !== 'number' ||
                size?.kind !== 'literal' ||
                typeof size.value !== 'number'
              )
                return this.stop(ss, e, 'Unknown splice range.')
              const removed = items.splice(start.value, size.value, ...insert)
              return this.updateArray(ss, receiver, items, { kind: 'array', items: removed })
            }
            return this.updateArray(ss, receiver, items, literal(items.length))
          })
        }
      }
      if (callee.name.text === 'sort' && e.arguments.length === 0) {
        const inner = unwrap(callee.expression)
        if (
          ts.isCallExpression(inner) &&
          dataIntrinsic(this.source, unwrap(inner.expression)) === 'Object.keys'
        )
          return this.continue(this.expression(inner, state, depth), (ss, value) => [
            withValue(
              ss,
              value.kind === 'array'
                ? {
                    kind: 'array',
                    items: [...value.items].sort((a, b) =>
                      describe(a) < describe(b) ? -1 : describe(a) === describe(b) ? 0 : 1,
                    ),
                  }
                : unknown,
            ),
          ])
      }
    }

    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isPropertyAccessExpression(callee.expression) &&
      callee.name.text === 'throwIfAborted' &&
      callee.expression.name.text === 'signal'
    ) {
      const receiver = this.boundValue(callee.expression.expression, state)
      if (receiver?.kind === 'context' && e.arguments.length === 0)
        return [withValue(state, missing)] // All shown continuations require operations to complete.
    }
    if (
      fn === undefined &&
      imported === undefined &&
      !(
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'call' &&
        this.boundValue(callee.expression, state)?.kind === 'context'
      )
    )
      return [this.stop(state, e, 'Opaque call may affect later behavior.')]
    const args = this.arguments(e.arguments, state, depth)
    return this.budget.variants(
      args.flatMap(({ state: s, values }) => {
        if (s.mode !== 'next') return [s]
        if (fn !== undefined) {
          const asyncHelper = isAsync(fn)
          if (asyncHelper && !awaited && returned === undefined)
            return [this.stop(s, e, 'An unawaited helper may continue independently.')]
          if (asyncHelper && returned === 'with-finalizer')
            return [this.returnedWithFinalizer(s, e)]
          const proof = values.every(isData) && dataEffects(this.source, fn, s.values)
          return this.invoke(fn, values, s, depth + 1, {
            consumesReturn: awaited || returned !== undefined,
            localCall: { ...this.source.site(e), code: shortText(e) },
          }).map((body) => {
            if (proof && body.mode === 'unknown')
              return withValue(
                add(s, {
                  kind: 'gap',
                  site: body.site ?? this.source.site(e),
                  detail: 'Data result unknown. This continuation assumes the helper completes.',
                }),
                unknown,
              )
            if (body.mode === 'unknown') return { ...body, stoppedAt: e }
            if (body.mode === 'return' && body.value.kind === 'function')
              return this.stop(body, e, 'Escaping closures are outside the supported subset.')
            if (asyncHelper || body.returnedPromise !== undefined)
              return returned === 'with-finalizer'
                ? this.returnedWithFinalizer(s, e)
                : this.promiseCompletion(body, returned, e)
            return body.mode === 'return'
              ? { ...body, mode: 'next' as const }
              : body.mode === 'next'
                ? withValue(body, missing)
                : body
          })
        }
        if (
          imported?.module === 'node:fs/promises' &&
          imported.member === 'open' &&
          awaited &&
          values.length >= 1 &&
          values.length <= 2 &&
          readOnlyOpen(this.source, e.arguments[1], values[1])
        ) {
          const filename = values[0]!
          if (
            filename.kind === 'path' ||
            filename.kind === 'unknown' ||
            (filename.kind === 'literal' && typeof filename.value === 'string')
          ) {
            const path = describe(filename)
            return this.fileOperation(e, s, 'open', 'read-only · ' + path, {
              kind: 'file-handle',
              path,
            })
          }
        }
        if (imported?.module === 'node:fs/promises' && imported.member === 'writeFile' && awaited) {
          return [
            withValue(
              add(s, {
                kind: 'effect',
                owner: this.target.id,
                site: this.source.site(e),
                operation: 'writeFile',
                detail:
                  values[0]?.kind === 'literal' || values[0]?.kind === 'path'
                    ? describe(values[0])
                    : 'destination unknown',
              }),
              missing,
            ),
          ]
        }
        if (imported?.module === 'node:path' && imported.member === 'join') {
          const last = values.at(-1)
          return [
            withValue(
              s,
              last?.kind === 'literal' && typeof last.value === 'string'
                ? { kind: 'path', suffix: last.value }
                : unknown,
            ),
          ]
        }
        if (
          imported?.module === '@jigging/reporting' &&
          imported.member === 'previewCollection' &&
          this.source.reportingEnabled(e) &&
          values.every(isData)
        )
          return [withValue(s, object([['collection', unknown]]))]
        if (imported !== undefined)
          return [this.stop(s, e, 'Opaque imported call: ' + imported.module + '.')]
        const request = values[0] ?? unknown
        const slot = field(request, 'slot')
        if (!awaited || slot.kind !== 'literal' || typeof slot.value !== 'string')
          return [this.stop(s, e, 'A handoff needs an awaited call and an established slot.')]
        return this.invokeChild(
          slot.value,
          field(request, 'input'),
          this.source.callSite(e),
          depth + 1,
          s.assumptions,
        ).map((child) => {
          let updated = s
          for (const step of child.prefix) updated = add(updated, step)
          return {
            ...add(updated, child.step),
            assumptions: [...s.assumptions, ...child.assumptions],
            mode: child.mode,
            ...(child.mode === 'unknown' ? { stoppedAt: e } : {}),
            value: child.value,
            site: child.step.site,
          }
        })
      }),
    )
  }

  private fileOperation(
    call: ts.CallExpression,
    state: State,
    operation: 'open' | 'stat' | 'readFile' | 'close',
    detail: string,
    result: Value,
  ): State[] {
    const site = this.source.site(call)
    const attempted = add(state, { kind: 'effect', owner: this.target.id, operation, detail, site })
    return this.checkedOperation(call, attempted, operation + ' completes', result, unknown, true)
  }

  private checkedOperation(
    call: ts.CallExpression,
    state: State,
    check: string,
    result: Value,
    failure: Value,
    readOperation?: true,
  ): State[] {
    const site = this.source.site(call)
    return this.branch(
      call,
      unknown,
      state,
      (branch, completed) => [
        completed ? withValue(branch, result) : raised(branch, site, failure),
      ],
      { label: check, ...(readOperation ? { readOperation } : {}) },
    )
  }

  private mapData(
    call: ts.CallExpression,
    mapper: LocalFunction,
    state: State,
    array: Value,
    depth: number,
  ): State[] {
    if (array.kind === 'array' && array.items.length <= BEHAVIOR_LIMITS.loopItems) {
      let paths = [withValue(state, { kind: 'array', items: [] })]
      for (const [index, item] of array.items.entries()) {
        paths = this.retainVariants(
          call,
          paths.flatMap((path) => {
            if (path.mode !== 'next' || path.value.kind !== 'array') return [path]
            const prefix = path.value.items
            return this.invoke(mapper, [item, literal(index), array], path, depth + 1).map(
              (result) => {
                if (result.mode === 'unknown') return { ...result, stoppedAt: call }
                if (result.mode === 'throw') return result
                const value = result.mode === 'return' ? result.value : missing
                if (value.kind === 'function')
                  return this.stop(
                    result,
                    call,
                    'Escaping closures are outside the supported subset.',
                  )
                return withValue(next(result), { kind: 'array', items: [...prefix, value] })
              },
            )
          }),
        )
      }
      return paths
    }
    if (array.kind !== 'array' && array.kind !== 'unknown')
      return [this.stop(state, call, 'The map receiver is outside the supported array subset.')]
    if (dataEffects(this.source, mapper, state.values))
      return [withValue(state, evaluateDataMethod('map', array, []))]
    return [
      withValue(
        add(state, {
          kind: 'gap',
          site: this.source.site(call),
          detail:
            'Array elements and callback failures are unresolved. This continuation assumes mapping completes.',
        }),
        unknown,
      ),
    ]
  }

  private arguments(args: readonly ts.Expression[], state: State, depth: number) {
    let rows: { state: State; values: readonly Value[] }[] = [{ state, values: [] }]
    for (const arg of args)
      rows = this.budget.variants(
        rows.flatMap((row) =>
          row.state.mode !== 'next'
            ? [row]
            : this.expression(arg, row.state, depth).map((nextState) => ({
                state: nextState,
                values: [...row.values, nextState.value],
              })),
        ),
      )
    return rows
  }

  private reportCall(
    e: ts.CallExpression,
    method: string,
    receiver: Value | undefined,
    state: State,
    depth: number,
  ): State[] | undefined {
    const view = receiver?.kind === 'reporter' && method === 'view'
    const notice = receiver?.kind === 'reporter' && method === 'notice'
    const update = receiver?.kind === 'report-view' && method === 'update'
    if (
      ((receiver?.kind === 'reporter' && ['activity', 'clear'].includes(method)) ||
        (receiver?.kind === 'report-view' && method === 'retire')) &&
      e.arguments.every((arg) => this.staticInitializer(arg))
    )
      return [withValue(state, missing)]
    if (!view && !notice && !update) return undefined
    const first = e.arguments[0]
    if (!first || e.arguments.length > (update ? 1 : 2))
      return [this.stop(state, e, 'Unsupported reporting arguments.')]
    if (view && (!ts.isStringLiteralLike(first) || e.arguments[1] === undefined))
      return e.arguments.length === 1 && ts.isStringLiteralLike(first)
        ? [withValue(state, { kind: 'report-view' })]
        : [this.stop(state, e, 'Unknown reporting view key.')]
    const severity = notice ? e.arguments[1] : undefined
    if (severity && !ts.isStringLiteralLike(severity))
      return [this.stop(state, e, 'Unknown notice severity expression.')]
    const argument = view ? e.arguments[1]! : first
    const pure = dataEffects(this.source, argument, state.values)
    const summarize = (result: State) =>
      update
        ? this.reportingTrace.progress(result.mode === 'unknown' ? unknown : result.value)
        : {
            detail:
              severity && ts.isStringLiteralLike(severity) ? severity.text : 'default severity',
            sources: [],
          }
    const record = (s: State, { detail, sources }: ReturnType<typeof summarize>) => {
      const authored =
        update && detail === 'display effect unknown'
          ? this.reportingTrace.authoredProgress(argument, this.source)
          : []
      return view
        ? withValue(s, { kind: 'report-view' })
        : withValue(
            add(s, {
              kind: 'effect',
              owner: this.target.id,
              operation: update ? 'view update' : 'notice',
              detail,
              site: this.source.site(e),
              ...(s.localCall === undefined ? {} : { reportingCall: s.localCall }),
              ...(sources.length ? { progressFields: sources } : {}),
              ...(authored.length ? { authoredProgressFields: authored } : {}),
            }),
            missing,
          )
    }
    if (!pure)
      return this.expression(argument, state, depth).map((result) =>
        result.mode === 'next' ? record(result, summarize(result)) : result,
      )

    const probe = new Interpreter(
      this.source,
      this.target,
      this.input,
      new AnalysisBudget(this.budget.signal, 512, this.budget),
      this.invokeChild,
      false,
      undefined,
      this.reportingTrace,
    )
    let observed: State[]
    try {
      observed = probe.expression(argument, state, depth)
    } catch (error) {
      if (!(error instanceof AnalysisLimit)) throw error
      return [
        record(
          add(state, {
            kind: 'gap',
            site: this.source.site(argument),
            detail: 'Reporting payload exceeded its data analysis allowance.',
          }),
          { detail: 'display effect unknown', sources: [] },
        ),
      ]
    }

    // Internal formatting choices cannot alter this caller. Preserve only the
    // common displayed fact and retain explicit abrupt outcomes separately.
    const ordinary = observed.filter((result) => result.mode !== 'throw')
    const abrupt = observed.filter((result) => result.mode === 'throw')
    const [summary, ...rest] = ordinary.map(summarize)
    if (!summary) return abrupt
    const detail = rest.every((result) => result.detail === summary.detail)
      ? summary.detail
      : 'display effect unknown'
    return [
      ...abrupt,
      record(state, {
        detail,
        sources:
          detail === summary.detail
            ? summary.sources.filter((origin) =>
                rest.every((result) =>
                  result.sources.some(
                    (other) =>
                      origin.field === other.field &&
                      origin.path === other.path &&
                      origin.line === other.line &&
                      origin.column === other.column,
                  ),
                ),
              )
            : [],
      }),
    ]
  }

  private updateArray(
    state: State,
    receiver: Value,
    items: readonly Value[],
    result: Value,
  ): State {
    const updated: Value = { kind: 'array', items }
    const replace = (value: Value): Value =>
      value === receiver
        ? updated
        : value.kind === 'array' && contains(value, receiver)
          ? { kind: 'array', items: value.items.map(replace) }
          : value.kind === 'object' && contains(value, receiver)
            ? object(
                [...value.fields].map(([key, field]) => [key, replace(field)]),
                value.open,
              )
            : value
    return {
      ...state,
      value: result,
      values: new Map([...state.values].map(([key, value]) => [key, replace(value)])),
    }
  }

  private boundValue(e: ts.Expression, state: State): Value | undefined {
    if (!ts.isIdentifier(e)) return undefined
    const declaration = this.source.declaration(e)
    return declaration !== undefined ? state.values.get(declaration) : undefined
  }
}

function compareBounds(operator: ts.SyntaxKind, left: Value, right: Value): boolean | undefined {
  const descending =
    operator === ts.SyntaxKind.GreaterThanToken || operator === ts.SyntaxKind.GreaterThanEqualsToken
  const first = numberBounds(descending ? right : left)
  const second = numberBounds(descending ? left : right)
  if (!first || !second) return undefined
  const inclusive =
    operator === ts.SyntaxKind.LessThanEqualsToken ||
    operator === ts.SyntaxKind.GreaterThanEqualsToken
  if (inclusive ? first[1] <= second[0] : first[1] < second[0]) return true
  if (inclusive ? first[0] > second[1] : first[0] >= second[1]) return false
  return undefined
}

function contains(value: Value, member: Value): boolean {
  return (
    value === member ||
    (value.kind === 'array' && value.items.some((item) => contains(item, member))) ||
    (value.kind === 'object' && [...value.fields.values()].some((item) => contains(item, member)))
  )
}
