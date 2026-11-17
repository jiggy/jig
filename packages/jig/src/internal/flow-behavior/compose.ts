import {
  AnalysisBudget,
  AnalysisLimit,
  type ChildResult,
  Interpreter,
  type State,
} from './analyze.js'
import {
  BEHAVIOR_LIMITS,
  type BehaviorInput,
  type BehaviorReport,
  type BehaviorStep,
  type BehaviorTarget,
  type SourceSite,
} from './model.js'
import { SourceIndex } from './source.js'
import { field, literal, object, resultText, toJson, type Value, unknown } from './values.js'

type Effect = Extract<BehaviorStep, { kind: 'effect' }>
type Scope = BehaviorReport['scopes'][number]

export function analyzeFlowBehavior(input: BehaviorInput, signal?: AbortSignal): BehaviorReport {
  const targets = new Map(input.targets.map((target) => [target.id, target]))
  const sources = new Map<string, SourceIndex>()
  const inventory = input.visible.flatMap((id) => {
    const target = targets.get(id)
    return target ? [target] : []
  })
  const scopes: Scope[] = []
  if (input.focus === undefined)
    return { revision: input.revision, focus: undefined, inventory, scopes }

  // A focus gets priority. Other displayed targets retain their own configured instance.
  const focus = input.focus
  const visible = [focus, ...input.visible.filter((id) => id !== focus)]
  const budget = new AnalysisBudget(signal)
  for (const id of visible) {
    signal?.throwIfAborted()
    const target = targets.get(id)
    if (target === undefined) continue
    const site = location(target)
    if (scopes.length >= BEHAVIOR_LIMITS.scopes) {
      scopes.push({
        target: id,
        routes: [],
        gaps: [{ ...site, reason: 'Scope analysis limit reached. Inspect this target directly.' }],
      })
      break
    }
    try {
      const run = evaluate(target, unknown, 0, new Set())
      const gaps = new Map<string, Scope['gaps'][number]>()
      const routes = new Map<string, readonly BehaviorStep[]>()
      if (run.length === 0)
        gaps.set('entry', {
          ...site,
          reason:
            input.packages.get(target.implementation)?.unavailable ??
            'The implementation is opaque.',
        })
      for (const state of run) {
        const terminal = state.site ?? site
        for (const step of state.steps)
          if (step.kind === 'end' && step.completion === 'unknown')
            gaps.set(JSON.stringify(step.site), { ...step.site, reason: step.detail })
        const route =
          state.mode === 'unknown'
            ? state.steps
            : [
                ...state.steps,
                {
                  kind: 'end' as const,
                  completion: state.mode === 'throw' ? ('throw' as const) : ('return' as const),
                  detail:
                    state.mode === 'return'
                      ? resultText(state.value)
                      : state.mode === 'throw'
                        ? 'Throws'
                        : 'Finishes without an explicit return',
                  site: terminal,
                },
              ]
        routes.set(JSON.stringify(route), route)
      }
      scopes.push({ target: id, routes: [...routes.values()], gaps: [...gaps.values()] })
    } catch (error) {
      if (!(error instanceof AnalysisLimit)) throw error
      scopes.push({ target: id, routes: [], gaps: [{ ...site, reason: error.message }] })
    }
  }
  return { revision: input.revision, focus, inventory, scopes }

  function location(target: BehaviorTarget): SourceSite {
    return {
      path:
        target.implementation + '/' + (input.packages.get(target.implementation)?.entry ?? 'FLOW'),
      line: 1,
    }
  }

  function evaluate(
    target: BehaviorTarget,
    argument: Value,
    depth: number,
    active: ReadonlySet<string>,
  ): State[] {
    budget.check()
    const pkg = input.packages.get(target.implementation)
    if (
      pkg === undefined ||
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
    return new Interpreter(index, target, argument, budget, (slot, value, site, childDepth) => {
      const selected = target.slots.get(slot)
      const callee = selected === undefined ? undefined : targets.get(selected)
      return continuations(callee, slot, selected, value, site, childDepth, chain)
    }).run(depth)
  }

  function continuations(
    callee: BehaviorTarget | undefined,
    slot: string,
    selected: string | undefined,
    argument: Value,
    site: SourceSite,
    depth: number,
    active: ReadonlySet<string>,
  ): ChildResult[] {
    const target = selected ?? '(unresolved or host resource)'
    const choice = (
      mode: ChildResult['mode'],
      value: Value,
      completion: ChildResult['step']['completion'],
      result: string,
      effects?: readonly Effect[],
    ): ChildResult => ({
      mode,
      value,
      step: { kind: 'call', site, slot, target, completion, result },
      ...(effects === undefined ? {} : { effects }),
    })
    const refusal = choice('throw', unknown, 'if-failed', 'call or result admission fails')
    const results = callee === undefined ? [] : evaluate(callee, argument, depth, active)
    const pkg = callee === undefined ? undefined : input.packages.get(callee.implementation)
    const values: ChildResult[] = []
    let opaque = results.length === 0
    for (const result of results) {
      if (result.mode === 'unknown') {
        opaque = true
        continue
      }
      const effects = result.steps.filter((step): step is Effect => step.kind === 'effect')
      if (result.mode === 'throw') {
        values.push(
          choice('throw', unknown, 'if-failed', 'source throws before returning', effects),
        )
        continue
      }
      if (result.mode !== 'return') continue
      const outcome = field(result.value, 'outcome')
      if (outcome.kind === 'unknown') {
        opaque = true
        continue
      }
      if (
        outcome.kind !== 'literal' ||
        typeof outcome.value !== 'string' ||
        !callee?.outcomes.includes(outcome.value)
      )
        continue
      const output = field(result.value, 'output')
      const concrete = toJson(
        object([
          ['outcome', outcome],
          ['output', output],
        ]),
      )
      if (concrete !== undefined && pkg?.checkResult?.(concrete) === false) {
        values.push(
          choice('throw', unknown, 'if-failed', 'known result fails its declared schema', effects),
        )
        continue
      }
      // Only the host knows what artifact was captured and forwarded.
      const returned = object([
        ['outcome', outcome],
        ['output', output],
        ['artifacts', unknown],
      ])
      values.push(choice('next', returned, 'source-return', resultText(returned), effects))
    }
    // Keep caller reactions to declared but unobserved custom results discoverable.
    // A hypothesis is conditional on the child actually returning an admitted value.
    const names = (callee?.outcomes ?? []).filter(
      (name) =>
        opaque ||
        (name !== 'done' &&
          !values.some((item) => {
            const outcome = field(item.value, 'outcome')
            return outcome.kind === 'literal' && outcome.value === name
          })),
    )
    for (const name of names)
      values.push(
        choice(
          'next',
          object([
            ['outcome', literal(name)],
            ['output', unknown],
            ['artifacts', unknown],
          ]),
          'if-returned',
          'outcome ' +
            JSON.stringify(name) +
            (opaque ? '; implementation incomplete' : '; contract alternative'),
        ),
      )
    if (opaque && names.length === 0)
      values.push(choice('next', object([], true), 'if-returned', 'result unknown'))
    const candidates = values.filter(
      (result, index) =>
        values.findIndex(
          (other) =>
            other.step.completion === result.step.completion &&
            other.step.result === result.step.result &&
            JSON.stringify(other.effects) === JSON.stringify(result.effects) &&
            // Values with unresolved fields may carry different caller-relevant facts.
            JSON.stringify(other.value, mapEntries) === JSON.stringify(result.value, mapEntries),
        ) === index,
    )
    return budget.variants([...candidates, refusal])
  }
}

function mapEntries(_key: string, value: unknown): unknown {
  if (value instanceof Map) return [...value]
  if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'function')
    return { kind: 'function' }
  return value
}
