import ts from 'typescript-parser'
import { progressDescription } from './reporting.js'
import {
  BEHAVIOR_LIMITS,
  type BehaviorStep,
  type BehaviorTarget,
  type SourceSite,
} from './model.js'
import { type LocalFunction, type SourceIndex, isLocalFunction, unwrap } from './source.js'
import {
  type Value,
  describe,
  field,
  fromJson,
  literal,
  missing,
  object,
  truth,
  unknown,
} from './values.js'

export interface State {
  readonly values: ReadonlyMap<ts.Node, Value>
  readonly steps: readonly BehaviorStep[]
  readonly mode: 'next' | 'return' | 'throw' | 'unknown'
  readonly value: Value
  readonly site?: SourceSite
}

export interface ChildResult {
  readonly mode: 'next' | 'throw'
  readonly value: Value
  readonly step: Extract<BehaviorStep, { kind: 'call' }>
  readonly effects?: readonly Extract<BehaviorStep, { kind: 'effect' }>[]
}

type InvokeChild = (
  slot: string,
  input: Value,
  site: SourceSite,
  depth: number,
) => readonly ChildResult[]

export class AnalysisLimit extends Error {}

export class AnalysisBudget {
  #steps = 0
  constructor(readonly signal?: AbortSignal) {}

  check(): void {
    this.signal?.throwIfAborted()
    if (++this.#steps > BEHAVIOR_LIMITS.steps)
      throw new AnalysisLimit('Analysis reached the work limit.')
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
const originalDeclaration = (node: ts.Node) => {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent)
    if (isLocalFunction(parent)) return parent
  return undefined
}

export class Interpreter {
  readonly #context: Value = { kind: 'context' }

  constructor(
    readonly source: SourceIndex,
    readonly target: BehaviorTarget,
    readonly input: Value,
    readonly budget: AnalysisBudget,
    readonly invokeChild: InvokeChild,
  ) {}

  run(depth: number): State[] {
    const initial: State = { values: new Map(), steps: [], mode: 'next', value: missing }
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
    return this.invoke(handler, [this.#context], initial, depth)
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

  private stop(state: State, node: ts.Node, detail: string): State {
    const site = this.source.site(node)
    return {
      ...add(state, { kind: 'end', site, completion: 'unknown', detail }),
      site,
      mode: 'unknown',
      value: unknown,
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

  private invoke(fn: LocalFunction, args: readonly Value[], caller: State, depth: number): State[] {
    this.budget.check()
    if (depth >= BEHAVIOR_LIMITS.depth)
      return [this.stop(caller, fn, 'Analysis reached the call depth limit.')]
    if (
      !fn.body ||
      fn.asteriskToken ||
      fn.parameters.some(
        (p) =>
          !ts.isIdentifier(p.name) ||
          p.initializer !== undefined ||
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
    fn.parameters.forEach((p, i) => values.set(p, args[i] ?? missing))
    const inner = { ...caller, values, mode: 'next' as const, value: missing }
    const results = ts.isBlock(fn.body)
      ? this.block(fn.body.statements, [inner], depth)
      : this.expression(fn.body, inner, depth, true).map((state) =>
          state.mode === 'next'
            ? { ...state, mode: 'return' as const, site: this.source.site(fn.body!) }
            : state,
        )
    return results.map((state) => {
      const restored = new Map(state.values)
      for (const key of restored.keys()) {
        if (originalDeclaration(key) !== fn) continue
        const previous = caller.values.get(key)
        if (previous === undefined) restored.delete(key)
        else restored.set(key, previous)
      }
      return { ...state, values: restored, site: state.site ?? this.source.site(fn) }
    })
  }

  private block(statements: readonly ts.Statement[], states: State[], depth: number): State[] {
    for (const statement of statements) {
      states = this.budget.variants(
        states.flatMap((state) =>
          state.mode === 'next' ? this.statement(statement, state, depth) : [state],
        ),
      )
    }
    return states
  }

  private branch<T extends State>(
    n: ts.Expression,
    value: Value,
    state: T,
    alternatives: (s: State, taken: boolean) => State[],
  ): State[] {
    const condition = truth(value)
    const possible = condition === undefined ? [true, false] : [condition]
    return this.budget.variants(
      possible.flatMap((taken) =>
        alternatives(
          add(state, {
            kind: 'condition',
            site: this.source.site(n),
            code: n.getText().length <= 140 ? n.getText() : '(see full predicate in source)',
            taken,
          }),
          taken,
        ),
      ),
    )
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
        states = this.budget.variants(
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
        this.branch(n.expression, value, s, (branch, taken) => {
          const selected = taken ? n.thenStatement : n.elseStatement
          return selected === undefined ? [branch] : this.statement(selected, branch, depth)
        }),
      )
    if (ts.isReturnStatement(n)) {
      const results = n.expression
        ? this.expression(n.expression, state, depth)
        : [withValue(state, missing)]
      return results.map((s) =>
        s.mode === 'next' ? { ...s, mode: 'return', site: this.source.site(n) } : s,
      )
    }
    if (ts.isThrowStatement(n)) {
      const error = unwrap(n.expression)
      const ordinaryError =
        ts.isNewExpression(error) &&
        ts.isIdentifier(error.expression) &&
        ['Error', 'TypeError', 'RangeError'].includes(error.expression.text) &&
        this.source.declaration(error.expression) === undefined &&
        (error.arguments ?? []).every((arg) => this.staticInitializer(arg))
      const results = ordinaryError ? [state] : this.expression(error, state, depth)
      return results.map((s) =>
        s.mode === 'next'
          ? { ...s, mode: 'throw' as const, value: unknown, site: this.source.site(n) }
          : s,
      )
    }
    if (ts.isTryStatement(n)) {
      const caught = n.catchClause
      let results = this.statement(n.tryBlock, state, depth)
      if (caught !== undefined)
        results = this.budget.variants(
          results.flatMap((s) => {
            if (s.mode !== 'throw') return [s]
            const resumed = next(s)
            return this.statement(
              caught.block,
              caught.variableDeclaration
                ? this.bind(resumed, caught.variableDeclaration.name, unknown)
                : resumed,
              depth,
            )
          }),
        )
      const finalizer = n.finallyBlock
      if (finalizer !== undefined)
        results = this.budget.variants(
          results.flatMap((s) =>
            s.mode === 'unknown'
              ? [s]
              : this.statement(finalizer, next(s), depth).map((fin) =>
                  fin.mode !== 'next' ? fin : { ...s, values: fin.values, steps: fin.steps },
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
    return [this.stop(state, n, 'Unsupported statement: ' + ts.SyntaxKind[n.kind] + '.')]
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
                spread.kind === 'object' && !spread.open
                  ? object([...fields, ...spread.fields], open)
                  : object(spread.kind === 'object' ? spread.fields : [], true),
              ),
            ])
          if (ts.isShorthandPropertyAssignment(property))
            return this.continue(this.expression(property.name, s, depth), (ss, item) => [
              withValue(ss, object([...fields, [property.name.text, item]], open)),
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
              withValue(ss, object([...fields, [name, item]], open)),
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
          this.continue(this.expression(item, s, depth), (ss, value) => [
            withValue(ss, {
              kind: 'array',
              items: [...(array.kind === 'array' ? array.items : []), value],
            }),
          ]),
        )
      return states
    }
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken)
      return this.continue(this.expression(e.operand, state, depth), (s, value) => {
        const known = truth(value)
        return [withValue(s, known === undefined ? unknown : literal(!known))]
      })
    if (ts.isConditionalExpression(e))
      return this.continue(this.expression(e.condition, state, depth), (s, value) =>
        this.branch(e.condition, value, s, (ss, taken) =>
          this.expression(taken ? e.whenTrue : e.whenFalse, ss, depth),
        ),
      )
    if (ts.isBinaryExpression(e)) return this.binary(e, state, depth)
    if (ts.isCallExpression(e)) return this.call(e, state, depth, awaited)
    return [this.stop(state, e, 'Unsupported expression: ' + ts.SyntaxKind[e.kind] + '.')]
  }

  private binary(e: ts.BinaryExpression, state: State, depth: number): State[] {
    const operator = e.operatorToken.kind
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
        if (known === undefined)
          return this.branch(e.left, left, s, (ss, taken) =>
            taken === (operator === ts.SyntaxKind.AmpersandAmpersandToken)
              ? this.expression(e.right, ss, depth)
              : [withValue(ss, left)],
          )
        return known === (operator === ts.SyntaxKind.AmpersandAmpersandToken)
          ? this.expression(e.right, s, depth)
          : [withValue(s, left)]
      }
      if (operator === ts.SyntaxKind.QuestionQuestionToken) {
        if (left.kind === 'unknown')
          return [this.stop(s, e, 'Nullish fallback depends on an unknown value.')]
        return left.kind === 'undefined' || (left.kind === 'literal' && left.value === null)
          ? this.expression(e.right, s, depth)
          : [withValue(s, left)]
      }
      return this.continue(this.expression(e.right, s, depth), (ss, right) => {
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
            case ts.SyntaxKind.MinusToken:
              return [withValue(ss, literal(a - b))]
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
        return [this.stop(ss, e, 'Unsupported or unresolved binary operation.')]
      })
    })
  }

  private call(e: ts.CallExpression, state: State, depth: number, awaited: boolean): State[] {
    const callee = unwrap(e.expression)
    const fn = this.functionAt(callee, state)
    const imported = this.source.importOf(callee)
    if (imported?.module === '@jigging/reporting' && imported.member === 'withReporting') {
      const [context, channel, body] = e.arguments
      const handler = body === undefined ? undefined : this.functionAt(body, state)
      if (
        !this.source.reportingEnabled(callee) ||
        !awaited ||
        context === undefined ||
        this.boundValue(context, state)?.kind !== 'context' ||
        channel === undefined ||
        !ts.isStringLiteralLike(channel) ||
        handler === undefined ||
        e.arguments.length !== 3
      )
        return [this.stop(state, e, 'Reporting wrapper or installed implementation is opaque.')]
      return this.invoke(handler, [{ kind: 'reporter' }], state, depth + 1).map((completion) =>
        completion.mode === 'return' ? { ...completion, mode: 'next' as const } : completion,
      )
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const receiver = this.boundValue(callee.expression, state)
      if (
        receiver?.kind === 'reporter' &&
        callee.name.text === 'view' &&
        e.arguments.length <= 2 &&
        e.arguments.every((arg) => this.staticInitializer(arg))
      )
        return [withValue(state, { kind: 'report-view' })]
      const operation =
        receiver?.kind === 'report-view' && callee.name.text === 'update'
          ? 'view update'
          : receiver?.kind === 'reporter' && callee.name.text === 'notice'
            ? 'notice'
            : undefined
      if (operation !== undefined && e.arguments[0] !== undefined)
        return this.continue(this.expression(e.arguments[0], state, depth), (s, value) => {
          const severity = e.arguments[1]
          if (operation === 'notice' && severity !== undefined && !ts.isStringLiteralLike(severity))
            return [this.stop(s, e, 'Unknown notice severity expression.')]
          const detail =
            operation === 'view update'
              ? progressDescription(value)
              : severity !== undefined && ts.isStringLiteralLike(severity)
                ? severity.text
                : 'default severity'
          return [
            withValue(
              add(s, {
                kind: 'effect',
                operation,
                detail,
                site: this.source.site(e),
              }),
              missing,
            ),
          ]
        })
      if (
        ((receiver?.kind === 'reporter' && ['activity', 'clear'].includes(callee.name.text)) ||
          (receiver?.kind === 'report-view' && callee.name.text === 'retire')) &&
        e.arguments.every((arg) => this.staticInitializer(arg))
      )
        return [withValue(state, missing)]
      if (
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'Math' &&
        this.source.declaration(callee.expression) === undefined &&
        callee.name.text === 'max'
      ) {
        let rows: { state: State; values: number[]; unknown: boolean }[] = [
          { state, values: [], unknown: false },
        ]
        for (const argument of e.arguments)
          rows = this.budget.variants(
            rows.flatMap((row) =>
              row.state.mode !== 'next'
                ? [row]
                : this.expression(argument, row.state, depth).map((s) => {
                    const value = s.value
                    return value.kind === 'literal' && typeof value.value === 'number'
                      ? { ...row, state: s, values: [...row.values, value.value] }
                      : { ...row, state: s, unknown: true }
                  }),
            ),
          )
        return rows.map((row) =>
          row.state.mode === 'next'
            ? withValue(row.state, row.unknown ? unknown : literal(Math.max(...row.values)))
            : row.state,
        )
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
    let args: readonly { state: State; values: readonly Value[] }[] = [{ state, values: [] }]
    for (const argument of e.arguments)
      args = this.budget.variants(
        args.flatMap((row) =>
          row.state.mode !== 'next'
            ? [row]
            : this.expression(argument, row.state, depth).map((s) => ({
                state: s,
                values: [...row.values, s.value],
              })),
        ),
      )
    return this.budget.variants(
      args.flatMap(({ state: s, values }) => {
        if (s.mode !== 'next') return [s]
        if (fn !== undefined) {
          const async = ts.getModifiers(fn)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
          if (async && !awaited)
            return [this.stop(s, e, 'An unawaited helper may continue independently.')]
          return this.invoke(fn, values, s, depth + 1).map((body) => {
            if (body.mode === 'return' && body.value.kind === 'function')
              return this.stop(body, e, 'Escaping closures are outside the supported subset.')
            return body.mode === 'return'
              ? { ...body, mode: 'next' as const }
              : body.mode === 'next'
                ? withValue(body, missing)
                : body
          })
        }
        if (imported?.module === 'node:fs/promises' && imported.member === 'writeFile' && awaited) {
          return [
            withValue(
              add(s, {
                kind: 'effect',
                site: this.source.site(e),
                operation: 'writeFile',
                detail: values[0]?.kind === 'literal' ? describe(values[0]) : 'destination unknown',
              }),
              missing,
            ),
          ]
        }
        if (imported?.module === 'node:path' && imported.member === 'join')
          return [withValue(s, unknown)]
        if (imported !== undefined)
          return [this.stop(s, e, 'Opaque imported call: ' + imported.module + '.')]
        const request = values[0] ?? unknown
        const slot = field(request, 'slot')
        if (!awaited || slot.kind !== 'literal' || typeof slot.value !== 'string')
          return [this.stop(s, e, 'A handoff needs an awaited call and an established slot.')]
        return this.invokeChild(
          slot.value,
          field(request, 'input'),
          this.source.site(e),
          depth + 1,
        ).map((child) => {
          let updated = s
          for (const effect of child.effects ?? []) updated = add(updated, effect)
          return {
            ...add(updated, child.step),
            mode: child.mode,
            value: child.value,
            site: child.step.site,
          }
        })
      }),
    )
  }

  private boundValue(e: ts.Expression, state: State): Value | undefined {
    if (!ts.isIdentifier(e)) return undefined
    const declaration = this.source.declaration(e)
    return declaration !== undefined ? state.values.get(declaration) : undefined
  }
}
