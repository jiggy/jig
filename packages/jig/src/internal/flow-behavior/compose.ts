import {
  AnalysisBudget,
  AnalysisLimit,
  type ChildResult,
  Interpreter,
  type State,
} from './analyze.js'
import {
  BEHAVIOR_LIMITS,
  type BehaviorAssumption,
  type BehaviorGuard,
  type BehaviorInput,
  type BehaviorReport,
  type BehaviorStep,
  type BehaviorTarget,
  type SourceSite,
} from './model.js'
import { SourceIndex } from './source.js'
import {
  field,
  literal,
  object,
  resultText,
  returnFacts,
  toJson,
  type Value,
  unknown,
} from './values.js'

type Scope = BehaviorReport['scopes'][number]
type Route = Scope['routes'][number]
type Handoff = { readonly slot: string; readonly site: SourceSite }

export function analyzeFlowBehavior(input: BehaviorInput, signal?: AbortSignal): BehaviorReport {
  const targets = new Map(input.targets.map((target) => [target.id, target]))
  const sources = new Map<string, SourceIndex>()
  const inventory = input.visible.flatMap((id) => {
    const target = targets.get(id)
    return target ? [target] : []
  })
  const scopes: Scope[] = []
  const { focus, revision } = input
  if (focus === undefined) return { revision, focus, inventory, scopes }

  const primary = new AnalysisBudget(signal)
  const visible = [focus, ...input.visible.filter((id) => id !== focus)]
  // Finish all primary analysis before spending work on secondary alternatives.
  for (const id of visible) {
    signal?.throwIfAborted()
    const target = targets.get(id)
    if (!target) continue
    if (scopes.length >= BEHAVIOR_LIMITS.scopes) {
      scopes.push({
        target: id,
        routes: [],
        alternatives: [],
        gaps: [
          {
            ...location(target),
            reason: 'Scope analysis limit reached. Inspect this target directly.',
          },
        ],
      })
      break
    }
    scopes.push(inspect(target, primary))
  }
  const index = scopes.findIndex((scope) => scope.target === focus)
  const scope = scopes[index]
  if (scope) {
    const seeds = new Map<string, Handoff>()
    for (const candidate of scopes)
      for (const route of candidate.routes)
        for (const step of route)
          if (step.kind === 'call') seeds.set(JSON.stringify([step.slot, step.site]), step)
    const alternatives = new Map<string, Route>()
    const gaps = new Map(scope.gaps.map((gap) => [JSON.stringify(gap), gap]))
    for (const seed of [...seeds.values()].slice(0, 8)) {
      // Keep the work allowance for each handoff independent.
      const conditional = inspect(targets.get(focus)!, new AnalysisBudget(signal, 6_000), seed)
      for (const route of conditional.alternatives) alternatives.set(JSON.stringify(route), route)
      for (const gap of conditional.gaps) gaps.set(JSON.stringify(gap), gap)
    }
    if (seeds.size > 8) {
      const site = location(targets.get(focus)!)
      gaps.set('secondary-limit', {
        ...site,
        reason: 'Some handoffs exceed the conditional analysis limit.',
      })
    }
    scopes[index] = { ...scope, alternatives: [...alternatives.values()], gaps: [...gaps.values()] }
  }
  return { revision, focus, inventory, scopes }

  function location(target: BehaviorTarget): SourceSite {
    return {
      path:
        target.implementation + '/' + (input.packages.get(target.implementation)?.entry ?? 'FLOW'),
      line: 1,
    }
  }

  function inspect(target: BehaviorTarget, budget: AnalysisBudget, handoff?: Handoff): Scope {
    const site = location(target)
    const evidence = new Map<string, Scope['gaps'][number]>()
    const routes = new Map<string, Route>()
    const alternate = new Map<string, Route>()
    try {
      const states = evaluate(target, unknown, 0, new Set(), budget, handoff)
      if (!handoff && states.length === 0)
        evidence.set('entry', {
          ...site,
          reason:
            input.packages.get(target.implementation)?.unavailable ??
            'The implementation is opaque.',
        })
      for (const state of states) {
        const isAlternative = state.assumptions.some((fact) => fact.kind !== 'opaque-return')
        if ((handoff !== undefined) !== isAlternative) continue
        const terminal = state.site ?? site
        for (const step of state.steps)
          if (step.kind === 'gap' || (step.kind === 'end' && step.completion === 'unknown'))
            evidence.set(JSON.stringify([step.site, step.detail]), {
              ...step.site,
              reason: step.detail,
            })
        const route: Route =
          state.mode === 'unknown' && state.steps.at(-1)?.kind === 'end'
            ? state.steps
            : [
                ...state.steps,
                {
                  kind: 'end',
                  completion:
                    state.mode === 'throw'
                      ? 'throw'
                      : state.mode === 'unknown'
                        ? 'unknown'
                        : 'return',
                  detail:
                    state.mode === 'return'
                      ? resultText(state.value)
                      : state.mode === 'throw'
                        ? failureText(state.value)
                        : state.mode === 'unknown'
                          ? 'Continuation unknown'
                          : 'Finishes without an explicit return',
                  site: terminal,
                  ...(state.mode === 'return' ? { returned: returnFacts(state.value) } : {}),
                },
              ]
        ;(isAlternative ? alternate : routes).set(JSON.stringify(route), route)
      }
    } catch (error) {
      if (!(error instanceof AnalysisLimit)) throw error
      evidence.set('limit', {
        ...site,
        reason: handoff
          ? 'Conditional alternatives for ' + handoff.slot + ': ' + error.message
          : error.message,
      })
    }
    return {
      target: target.id,
      routes: [...routes.values()],
      alternatives: [...alternate.values()],
      gaps: [...evidence.values()],
    }
  }

  function evaluate(
    target: BehaviorTarget,
    argument: Value,
    depth: number,
    active: ReadonlySet<string>,
    budget: AnalysisBudget,
    handoff: Handoff | undefined,
  ): State[] {
    budget.check()
    const pkg = input.packages.get(target.implementation)
    if (
      !pkg ||
      pkg.unavailable !== undefined ||
      active.has(target.id) ||
      depth >= BEHAVIOR_LIMITS.depth
    )
      return []
    let index = sources.get(target.implementation)
    if (index === undefined) {
      index = new SourceIndex(target.implementation, pkg)
      sources.set(target.implementation, index)
    }
    const chain = new Set([...active, target.id])
    return new Interpreter(
      index,
      target,
      argument,
      budget,
      (slot, value, site, childDepth, assumptions) => {
        const selected = target.slots.get(slot)
        const callee = selected === undefined ? undefined : targets.get(selected)
        const next = assumptions.every((fact) => fact.kind === 'opaque-return')
          ? handoff
          : undefined
        return continuations(callee, slot, selected, value, site, childDepth, chain, budget, next)
      },
    ).run(depth)
  }

  function continuations(
    callee: BehaviorTarget | undefined,
    slot: string,
    selected: string | undefined,
    argument: Value,
    site: SourceSite,
    depth: number,
    active: ReadonlySet<string>,
    budget: AnalysisBudget,
    handoff: Handoff | undefined,
  ): ChildResult[] {
    const target = selected ?? '(unresolved or host resource)'
    const choice = (
      mode: ChildResult['mode'],
      value: Value,
      result: string,
      prefix: readonly BehaviorStep[],
      assumptions: readonly BehaviorAssumption[],
      guards: readonly BehaviorGuard[] = [],
    ): ChildResult => ({
      mode,
      value,
      prefix,
      assumptions,
      step: {
        kind: 'call',
        site,
        slot,
        target,
        result,
        completion:
          mode === 'throw' ? 'if-failed' : assumptions.length ? 'if-returned' : 'source-return',
        ...(assumptions.length ? { assumptions } : {}),
        ...(guards.length ? { guards } : {}),
        ...(mode === 'next' ? { returned: returnFacts(value) } : {}),
      },
    })
    const newAssumption = (
      kind: BehaviorAssumption['kind'],
      detail: string,
    ): BehaviorAssumption => ({ kind, detail, site, slot })
    const allowSecondary =
      handoff?.slot === slot && handoff.site.path === site.path && handoff.site.line === site.line
    const states = callee ? evaluate(callee, argument, depth, active, budget, handoff) : []
    const pkg = callee && input.packages.get(callee.implementation)
    const values: ChildResult[] = []
    const opaque: {
      steps: readonly BehaviorStep[]
      assumptions: readonly BehaviorAssumption[]
      guards: readonly BehaviorGuard[]
    }[] = []
    if (states.length === 0) opaque.push({ steps: [], assumptions: [], guards: [] })
    const outcomes = new Set<string>()

    for (const state of states) {
      const guards = state.steps
        .flatMap((step) =>
          step.kind === 'condition' && step.unresolved
            ? [step]
            : step.kind === 'call'
              ? (step.guards ?? [])
              : [],
        )
        .slice(0, 4)
      const prefix: BehaviorStep[] = state.steps.flatMap((step): BehaviorStep[] =>
        step.kind === 'effect'
          ? [step]
          : step.kind === 'gap'
            ? [step]
            : step.kind === 'end' && step.completion === 'unknown'
              ? [{ kind: 'gap', site: step.site, detail: step.detail }]
              : [],
      )
      if (state.mode === 'unknown') {
        opaque.push({ steps: prefix, assumptions: state.assumptions, guards })
        continue
      }
      if (state.mode === 'throw') {
        values.push(
          choice('throw', state.value, failureText(state.value), prefix, state.assumptions, guards),
        )
        continue
      }
      if (state.mode !== 'return') continue
      const outcome = field(state.value, 'outcome')
      if (outcome.kind === 'unknown') {
        opaque.push({ steps: prefix, assumptions: state.assumptions, guards })
        continue
      }
      if (
        outcome.kind !== 'literal' ||
        typeof outcome.value !== 'string' ||
        !callee?.outcomes.includes(outcome.value)
      ) {
        values.push(
          choice(
            'throw',
            unknown,
            'source result has an invalid outcome',
            prefix,
            state.assumptions,
            guards,
          ),
        )
        continue
      }
      const output = field(state.value, 'output')
      const concrete = toJson(
        object([
          ['outcome', outcome],
          ['output', output],
        ]),
      )
      if (concrete !== undefined && pkg && pkg.checkResult?.(concrete) === false) {
        values.push(
          choice(
            'throw',
            unknown,
            'known result fails its declared schema',
            prefix,
            state.assumptions,
            guards,
          ),
        )
        continue
      }
      const returned = object([
        ['outcome', outcome],
        ['output', output],
        ['artifacts', unknown],
      ])
      if (state.assumptions.every((fact) => fact.kind === 'opaque-return'))
        outcomes.add(outcome.value)
      values.push(choice('next', returned, resultText(returned), prefix, state.assumptions, guards))
    }
    for (const prefix of opaque) {
      const assumption = newAssumption(
        'opaque-return',
        'opaque implementation completes and returns an admitted result',
      )
      const facts = [...prefix.assumptions, assumption]
      // Keep a known caller's follow-on behavior even when a callee is opaque.
      const returned = callee
        ? object([
            ['outcome', literal('done')],
            ['output', unknown],
            ['artifacts', unknown],
          ])
        : object([], true)
      values.push(
        choice(
          'next',
          returned,
          callee ? 'outcome "done"; implementation incomplete' : 'result unknown',
          prefix.steps,
          facts,
          prefix.guards,
        ),
      )
      if (
        allowSecondary &&
        prefix.steps.length > 0 &&
        prefix.assumptions.every((fact) => fact.kind === 'opaque-return')
      )
        values.push(
          choice(
            'throw',
            unknown,
            'call fails after the known prefix',
            prefix.steps,
            [
              ...prefix.assumptions,
              newAssumption('call-failure', 'opaque continuation fails after known prefix'),
            ],
            prefix.guards,
          ),
        )
    }
    if (allowSecondary) {
      // Hypotheses at different handoffs do not multiply the main analysis.
      for (const name of callee?.outcomes ?? []) {
        if (name === 'done' || outcomes.has(name)) continue
        const outcome = literal(name)
        values.push(
          choice(
            'next',
            object([
              ['outcome', outcome],
              ['output', unknown],
              ['artifacts', unknown],
            ]),
            'outcome ' + JSON.stringify(name) + '; contract alternative',
            [],
            [newAssumption('contract-return', 'admits outcome ' + JSON.stringify(name))],
          ),
        )
      }
      values.push(
        choice(
          'throw',
          unknown,
          'call or result admission fails',
          [],
          [newAssumption('call-failure', 'call or result admission fails')],
        ),
      )
    }
    const distinct = new Map<string, ChildResult>()
    for (const result of values) distinct.set(JSON.stringify(result, mapEntries), result)
    return budget.variants(
      [...distinct.values()].filter(
        (option) =>
          !allowSecondary ||
          option.assumptions.some(
            (fact) =>
              fact.kind !== 'opaque-return' &&
              fact.slot === slot &&
              fact.site.path === site.path &&
              fact.site.line === site.line,
          ),
      ),
    )
  }
}

function failureText(value: Value): string {
  return value.kind === 'literal' && typeof value.value === 'string' && value.value.length <= 160
    ? 'Throws: ' + value.value
    : 'Throws'
}

function mapEntries(_key: string, value: unknown): unknown {
  if (value instanceof Map) return [...value]
  if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'function')
    return { kind: 'function' }
  return value
}
