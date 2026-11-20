import {
  AnalysisBudget,
  AnalysisLimit,
  type ChildResult,
  Interpreter,
  type State,
} from './analyze.js'
import { declaredInputPaths } from './input-contract.js'
import {
  type AuthoredContinuation,
  type AuthoredFileWrite,
  type AuthoredHandoff,
  type AuthoredRepeatedCall,
  BEHAVIOR_LIMITS,
  type BehaviorAssumption,
  type BehaviorChildPath,
  type BehaviorGuard,
  type BehaviorInput,
  type BehaviorPackage,
  type BehaviorReport,
  type BehaviorStep,
  type BehaviorTarget,
  forwardedResult,
  isFileOperation,
  type RelatedCall,
  type SourceSite,
  withoutReportingLocations,
} from './model.js'
import { SourceIndex } from './source.js'
import {
  describe,
  field,
  inputFacts,
  literal,
  object,
  resultText,
  returnFacts,
  toJson,
  unknown,
  type Value,
} from './values.js'

type Scope = BehaviorReport['scopes'][number]
type Route = Scope['routes'][number]
type Call = Extract<BehaviorStep, { kind: 'call' }>
type Handoff = { readonly caller: string; readonly slot: string; readonly site: SourceSite }
type EarlierReturn = NonNullable<BehaviorReport['earlierReturns']>[number]

function earlierHandoffs(scope: Scope, focus: string) {
  const sites = new Map<
    string,
    { calls: Map<string, Call>; sourceOutcomes: Set<string>; trigger: Call }
  >()
  for (const route of scope.routes) {
    const later: Call[] = []
    for (let index = route.length - 1; index >= 0; index--) {
      const step = route[index]
      if (step?.kind !== 'call' || step.caller !== scope.target) continue
      if (step.target === focus) {
        later.push(step)
        continue
      }
      if (!later.length || step.completion !== 'source-return' || !step.returned) continue
      const identity = JSON.stringify([step.slot, step.site])
      const prior = sites.get(identity) ?? {
        calls: new Map(),
        sourceOutcomes: new Set(),
        trigger: step,
      }
      prior.sourceOutcomes.add(step.returned.outcome)
      for (const call of later) prior.calls.set(JSON.stringify([call.slot, call.site]), call)
      sites.set(identity, prior)
    }
  }
  return [...sites.values()]
}

function earlierReturn(route: Route, focus: string): Call | undefined {
  const trigger = forwardedResult(route)?.call
  if (!trigger) return
  if (
    route.some(
      (step) => step.kind === 'call' && step.caller === trigger.caller && step.target === focus,
    )
  )
    return
  return trigger
}

/** Spend the application budget on the entrypoint and configured callers first. */
export function applicationScopeOrder(
  visible: readonly string[],
  targets: ReadonlyMap<string, BehaviorTarget>,
  entrypoint?: string,
): string[] {
  return visible
    .map((id) => ({
      id,
      calls: [...(targets.get(id)?.slots.values() ?? [])].filter((child) => targets.has(child))
        .length,
    }))
    .sort((a, b) => Number(b.id === entrypoint) - Number(a.id === entrypoint) || b.calls - a.calls)
    .map(({ id }) => id)
}

function incomingScopes(
  focus: string,
  visible: readonly string[],
  targets: ReadonlyMap<string, BehaviorTarget>,
): Set<string> {
  const callers = new Map<string, string[]>()
  for (const id of visible)
    for (const child of targets.get(id)?.slots.values() ?? []) {
      const owners = callers.get(child) ?? []
      owners.push(id)
      callers.set(child, owners)
    }
  const incoming = new Set([focus])
  for (const child of incoming) for (const caller of callers.get(child) ?? []) incoming.add(caller)
  return incoming
}

/** Apply the display allowance after relating each exit to its later call sites. */
function limitAuthoredPriorExits(handoffs: readonly AuthoredHandoff[]) {
  const unique = new Map<string, SourceSite>()
  for (const handoff of handoffs)
    for (const exit of handoff.priorExits ?? [])
      unique.set(JSON.stringify(exit), exit.condition.site)
  const omitted = Math.max(0, unique.size - BEHAVIOR_LIMITS.authoredPriorExits)
  if (!omitted) return { handoffs, omitted }
  const retained = new Set(
    [...unique]
      .sort(
        ([, a], [, b]) =>
          a.path.localeCompare(b.path) || a.line - b.line || (a.column ?? 0) - (b.column ?? 0),
      )
      .slice(0, BEHAVIOR_LIMITS.authoredPriorExits)
      .map(([key]) => key),
  )
  return {
    handoffs: handoffs.map(({ priorExits, ...handoff }) => {
      const exits = priorExits?.filter((exit) => retained.has(JSON.stringify(exit)))
      return exits?.length ? { ...handoff, priorExits: exits } : handoff
    }),
    omitted,
  }
}

export function analyzeFlowBehavior(input: BehaviorInput, signal?: AbortSignal): BehaviorReport {
  const targets = new Map(input.targets.map((target) => [target.id, target]))
  const sources = new Map<string, SourceIndex>()
  const inventory = input.visible.flatMap((id) => {
    const target = targets.get(id)
    if (target === undefined) return []
    const contractPath = input.packages.get(target.implementation)?.contractPath
    return [
      contractPath === undefined || target.implementation.startsWith('npm:')
        ? target
        : { ...target, contractPath },
    ]
  })
  const scopes: Scope[] = []
  const childPaths: BehaviorChildPath[] = []
  const childKeys = new Map<string, number>()
  const resultOrigins = new WeakMap<Value, Call>()
  let childSteps = 0
  const { focus, entrypoint, packagePath, revision } = input
  const application = focus === undefined && packagePath === undefined
  const directHandoffs = []
  const focused = focus === undefined ? undefined : targets.get(focus)
  const orientationExtras: BehaviorTarget[] = []
  if (focused) {
    const visibleTargets = new Set(input.visible)
    const uses = new Set(
      input.targets
        .filter(({ implementation }) => implementation === focused.implementation)
        .map(({ id }) => id),
    )
    for (const target of input.targets)
      if (
        !visibleTargets.has(target.id) &&
        (uses.has(target.id) || [...target.slots.values()].some((choice) => uses.has(choice)))
      )
        orientationExtras.push(target)
  }
  const inputFields = focused
    ? declaredInputPaths(input.packages.get(focused.implementation)?.inputSchema)
    : undefined
  const directSelectors =
    focused &&
    new Map(
      input.targets.flatMap(({ id, implementation }) =>
        id.startsWith('flow:') || id.startsWith('npm:') ? [[implementation, id] as const] : [],
      ),
    )
  if (focused && directSelectors) {
    for (const [slot, selected] of focused.slots) {
      const target = targets.get(selected)
      const direct = target && directSelectors.get(target.implementation)
      if (direct?.startsWith('flow:')) directHandoffs.push({ slot, selected, direct })
    }
  }

  const incoming = focus === undefined ? undefined : incomingScopes(focus, input.visible, targets)
  const incomingCallerUses = new Map<string, BehaviorTarget[]>()
  if (focus !== undefined) {
    const usesByPackage = new Map<string, BehaviorTarget[]>()
    for (const target of input.targets) {
      const uses = usesByPackage.get(target.implementation) ?? []
      uses.push(target)
      usesByPackage.set(target.implementation, uses)
    }
    for (const caller of inventory) {
      if (caller.id === focus || ![...caller.slots.values()].includes(focus)) continue
      const uses = usesByPackage.get(caller.implementation)!
      if (uses.length > 1) incomingCallerUses.set(caller.id, uses)
    }
  }
  const focusedBinding = inventory.find(
    ({ id, declarationPath }) => id === focus && declarationPath,
  )
  const siblingUses = focusedBinding
    ? inventory.filter(
        ({ id, implementation }) =>
          id !== focus && implementation === focusedBinding.implementation,
      )
    : []
  const comparableUses =
    focusedBinding &&
    siblingUses.some(
      (use) => JSON.stringify(use.settings) !== JSON.stringify(focusedBinding.settings),
    )
      ? siblingUses.slice(0, BEHAVIOR_LIMITS.focusedComparedUses)
      : []
  // Upstream callers and compared uses share the bounded application allowance.
  // Each configured use still has its own source analysis bound.
  const primary = new AnalysisBudget(
    signal,
    focus === undefined || (incoming?.size ?? 0) > 1 || comparableUses.length
      ? 72_000
      : BEHAVIOR_LIMITS.steps,
  )
  const visible = application
    ? applicationScopeOrder(input.visible, targets, entrypoint)
    : incoming === undefined
      ? input.visible
      : [...new Set([...incoming, ...comparableUses.map(({ id }) => id), ...input.visible])]
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
            reason:
              'Scope analysis limit reached. Inspect this target directly for analyzed routes.',
          },
        ],
        ...(application ? authoredContext(target, new Set(), true) : {}),
      })
      if (application) continue
      break
    }
    scopes.push(inspect(target, new AnalysisBudget(signal, BEHAVIOR_LIMITS.steps, primary)))
  }
  const secondary = new AnalysisBudget(signal, 96_000)
  // Package inspection needs local source anchors for configured calls.
  for (const [index, scope] of (packagePath === undefined ? scopes : []).entries()) {
    const target = targets.get(scope.target)!
    const callerOfFocus = focus !== undefined && scope.target !== focus
    if (callerOfFocus && !incoming?.has(scope.target)) continue
    const seeds = new Map<string, Handoff>()
    const visitedPaths = new Set<number>()
    function collect(route: Route): void {
      for (const step of route) {
        if (step.kind !== 'call') continue
        if (!callerOfFocus || step.target === focus)
          seeds.set(JSON.stringify([step.caller, step.slot, step.site]), step)
        const id = step.childPath
        if (id === undefined || visitedPaths.has(id)) continue
        visitedPaths.add(id)
        const child = childPaths[id]
        if (child) collect(child.steps)
      }
    }
    for (const route of scope.routes) collect(route)
    if (!seeds.size) continue
    const alternatives = new Map<string, Route>()
    const gaps = new Map(scope.gaps.map((gap) => [JSON.stringify(gap), gap]))
    for (const seed of [...seeds.values()].slice(0, 8)) {
      // A later handoff also pays to traverse its caller's prefix. Give it room
      // to reach the response while charging all probes to the shared ceiling.
      const conditional = inspect(target, new AnalysisBudget(signal, 12_000, secondary), seed)
      for (const route of conditional.alternatives)
        alternatives.set(JSON.stringify(route, withoutReportingLocations), route)
      for (const gap of conditional.gaps) gaps.set(JSON.stringify(gap), gap)
    }
    if (seeds.size > 8) {
      const site = location(target)
      gaps.set('secondary-limit', {
        ...site,
        reason: 'Some handoffs exceed the conditional analysis limit.',
      })
    }
    scopes[index] = { ...scope, alternatives: [...alternatives.values()], gaps: [...gaps.values()] }
  }
  const earlierReturns = new Map<string, EarlierReturn>()
  let earlierReturnsLimited = false
  if (focus !== undefined && packagePath === undefined) {
    for (const scope of scopes) {
      const target = targets.get(scope.target)!
      if (scope.target === focus || ![...target.slots.values()].includes(focus)) continue
      const candidates = earlierHandoffs(scope, focus)
      const probes = candidates.filter(({ trigger, sourceOutcomes }) =>
        targets
          .get(trigger.target)
          ?.outcomes.some(
            (outcome) => outcome !== 'done' && !sourceOutcomes.has(JSON.stringify(outcome)),
          ),
      )
      const routes: { route: Route; probe?: Call }[] = scope.routes.map((route) => ({ route }))
      for (const { trigger } of probes.slice(0, 2)) {
        const conditional = inspect(target, new AnalysisBudget(signal, 12_000, secondary), trigger)
        routes.push(...conditional.alternatives.map((route) => ({ route, probe: trigger })))
        earlierReturnsLimited ||= conditional.gaps.length > 0
      }
      earlierReturnsLimited ||= probes.length > 2
      for (const { route, probe } of routes) {
        const trigger = earlierReturn(route, focus)
        if (!trigger || trigger.caller !== scope.target) continue
        if (probe && (probe.slot !== trigger.slot || !sameSite(probe.site, trigger.site))) continue
        const prior = candidates.find(
          ({ trigger: call }) => trigger.slot === call.slot && sameSite(trigger.site, call.site),
        )
        if (!prior) continue
        const after = route
          .slice(route.indexOf(trigger) + 1)
          .filter(
            (step) =>
              step.kind === 'condition' ||
              step.kind === 'call' ||
              step.kind === 'end' ||
              (isFileOperation(step) &&
                step.owner === trigger.caller &&
                step.operation === 'writeFile'),
          )
        for (const later of prior.calls.values()) {
          const key = JSON.stringify(
            [
              trigger.caller,
              trigger.site,
              trigger.slot,
              trigger.completion,
              trigger.returned,
              trigger.assumptions,
              later.site,
              later.slot,
              after,
            ],
            withoutReportingLocations,
          )
          if (earlierReturns.has(key)) continue
          if (earlierReturns.size >= 8) earlierReturnsLimited = true
          else
            earlierReturns.set(key, {
              trigger,
              later,
              sourceOutcomes: [...prior.sourceOutcomes],
              after,
            })
        }
      }
    }
  }
  return {
    revision,
    focus,
    ...(packagePath === undefined ? {} : { packagePath }),
    ...(entrypoint === undefined ? {} : { entrypoint }),
    ...(inputFields?.paths.length || inputFields?.truncated || inputFields?.required?.length
      ? { inputFields }
      : {}),
    ...(directHandoffs.length ? { directHandoffs } : {}),
    ...(directSelectors ? { directSelectors } : {}),
    ...(incomingCallerUses.size
      ? {
          incomingCallerUses,
          bindingDeclarations: new Map(
            input.targets.flatMap(({ id, declarationPath }) =>
              declarationPath === undefined ? [] : [[id, declarationPath] as const],
            ),
          ),
        }
      : {}),
    ...(earlierReturns.size ? { earlierReturns: [...earlierReturns.values()] } : {}),
    ...(earlierReturnsLimited ? { earlierReturnsLimited: true } : {}),
    inventory,
    ...(orientationExtras.length ? { orientationExtras } : {}),
    scopes,
    childPaths,
  }

  function complete(state: State, site: SourceSite, refusal?: string, contractPath?: string) {
    const call = state.mode === 'return' ? resultOrigins.get(state.value) : undefined
    const forwardedCall = call === undefined ? -1 : state.steps.indexOf(call)
    return completedRoute(state, site, refusal, contractPath, forwardedCall)
  }

  function retainChild(argument: string, steps: Route): number | undefined {
    const key = JSON.stringify([argument, steps], withoutReportingLocations)
    const existing = childKeys.get(key)
    if (existing !== undefined) return existing
    if (
      childPaths.length >= BEHAVIOR_LIMITS.retainedChildPaths ||
      childSteps + steps.length > BEHAVIOR_LIMITS.retainedChildSteps
    )
      return undefined
    const id = childPaths.length
    childKeys.set(key, id)
    childPaths.push({ input: argument, steps })
    childSteps += steps.length
    return id
  }

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
    const authored = new Map<string, AuthoredHandoff>()
    const writes = new Map<string, AuthoredFileWrite>()
    const repeats = new Map<string, AuthoredRepeatedCall>()
    const record = handoff
      ? undefined
      : (item: AuthoredContinuation) => {
          const key = JSON.stringify(item.value.site)
          if (item.kind === 'handoff') authored.set(key, item.value)
          else if (item.kind === 'file-write') writes.set(key, item.value)
          else repeats.set(key, item.value)
        }
    try {
      const argument = input.packages.get(target.implementation)?.acceptedInput ?? unknown
      const states = evaluate(target, argument, 0, new Set(), budget, handoff, record)
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
        for (const step of state.steps)
          if (step.kind === 'gap' || (step.kind === 'end' && step.completion === 'unknown'))
            evidence.set(JSON.stringify([step.site, step.detail]), {
              ...step.site,
              reason: step.detail,
            })
        const pkg = input.packages.get(target.implementation)
        const refusal =
          state.mode === 'return' ? resultRefusal(state.value, target, pkg) : undefined
        const route = complete(state, site, refusal, pkg?.contractPath)
        ;(isAlternative ? alternate : routes).set(JSON.stringify(route, mapEntries), route)
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
    const analyzedHandoffs = new Set<string>()
    for (const route of routes.values())
      for (const step of route) {
        if (step.kind === 'call' && step.caller === target.id)
          analyzedHandoffs.add(JSON.stringify(step.site))
        if (step.kind === 'effect' && step.owner === target.id && step.operation === 'writeFile')
          writes.delete(JSON.stringify(step.site))
      }
    const fileWrites = evidence.size ? [...writes.values()] : []
    const repeatedCalls = evidence.size ? [...repeats.values()] : []
    const authoredHandoffs = evidence.size
      ? [...authored]
          .filter(([key]) => !analyzedHandoffs.has(key))
          .map(([, candidate]) => candidate)
      : []
    const visibleAuthored = limitAuthoredPriorExits(
      authoredHandoffs.slice(0, BEHAVIOR_LIMITS.authoredHandoffs),
    )
    return {
      target: target.id,
      routes: [...routes.values()],
      alternatives: [...alternate.values()],
      gaps: [...evidence.values()],
      ...(authoredHandoffs.length ? { authoredHandoffs: visibleAuthored.handoffs } : {}),
      ...(authoredHandoffs.length > BEHAVIOR_LIMITS.authoredHandoffs
        ? { authoredHandoffsOmitted: authoredHandoffs.length - BEHAVIOR_LIMITS.authoredHandoffs }
        : {}),
      ...(visibleAuthored.omitted ? { authoredPriorExitsOmitted: visibleAuthored.omitted } : {}),
      ...(fileWrites.length
        ? { authoredFileWrites: fileWrites.slice(0, BEHAVIOR_LIMITS.authoredFileWrites) }
        : {}),
      ...(fileWrites.length > BEHAVIOR_LIMITS.authoredFileWrites
        ? { authoredFileWritesOmitted: fileWrites.length - BEHAVIOR_LIMITS.authoredFileWrites }
        : {}),
      ...(repeatedCalls.length
        ? { authoredRepeats: repeatedCalls.slice(0, BEHAVIOR_LIMITS.authoredRepeats) }
        : {}),
      ...(repeatedCalls.length > BEHAVIOR_LIMITS.authoredRepeats
        ? { authoredRepeatsOmitted: repeatedCalls.length - BEHAVIOR_LIMITS.authoredRepeats }
        : {}),
      ...(!handoff
        ? authoredContext(
            target,
            new Set([...analyzedHandoffs, ...authored.keys()]),
            evidence.size > 0,
          )
        : {}),
    }
  }

  function authoredContext(
    target: BehaviorTarget,
    represented: ReadonlySet<string>,
    fallback: boolean,
  ) {
    const showDecisions = target.id === focus || application
    const slots =
      focus !== undefined && !showDecisions
        ? new Map([...target.slots].filter(([, destination]) => destination === focus))
        : target.slots
    const selectSites = showDecisions || (focus !== undefined && slots.size > 0)
    const showReferences = fallback && (showDecisions || packagePath !== undefined)
    const callReferences =
      slots.size > 0 && (selectSites || showReferences)
        ? sourceFor(target)?.callReferences(slots, represented, {
            limit: BEHAVIOR_LIMITS.authoredHandoffs,
            fallback: showReferences,
            focused: selectSites,
          })
        : undefined
    const selected = callReferences?.selected
    const selectedSlots = new Map<string, Set<string>>()
    for (const { slot } of (showDecisions ? selected?.sites : undefined) ?? []) {
      const child = targets.get(target.slots.get(slot) ?? '')
      if (!child) continue
      const slots = selectedSlots.get(child.implementation) ?? new Set<string>()
      slots.add(slot)
      selectedSlots.set(child.implementation, slots)
    }
    const related = []
    for (const [implementation, slots] of selectedSlots) {
      const uses = { slots: [...slots], calls: [] as RelatedCall[], omitted: 0 }
      for (const caller of targets.values()) {
        for (const [otherSlot, destination] of caller.slots) {
          if (
            (caller.id === target.id && slots.has(otherSlot)) ||
            targets.get(destination)?.implementation !== implementation
          )
            continue
          if (uses.calls.length < BEHAVIOR_LIMITS.focusedRelatedCalls)
            uses.calls.push({ caller: caller.id, slot: otherSlot, target: destination })
          else uses.omitted++
        }
      }
      if (uses.calls.length || uses.slots.length > 1) related.push(uses)
    }
    return {
      ...(callReferences?.references.length ? { callReferences: callReferences.references } : {}),
      ...(callReferences?.omitted ? { callReferencesOmitted: callReferences.omitted } : {}),
      ...(selected?.sites.length ? { callSelections: { ...selected, related } } : {}),
    }
  }

  function sourceFor(target: BehaviorTarget): SourceIndex | undefined {
    const existing = sources.get(target.implementation)
    if (existing) return existing
    const pkg = input.packages.get(target.implementation)
    if (pkg === undefined || pkg.unavailable !== undefined) return undefined
    const source = new SourceIndex(target.implementation, pkg)
    sources.set(target.implementation, source)
    return source
  }

  function evaluate(
    target: BehaviorTarget,
    argument: Value,
    depth: number,
    active: ReadonlySet<string>,
    budget: AnalysisBudget,
    handoff: Handoff | undefined,
    recordAuthoredContinuation?: (item: AuthoredContinuation) => void,
  ): State[] {
    budget.check()
    if (active.has(target.id) || depth >= BEHAVIOR_LIMITS.depth) return []
    const index = sourceFor(target)
    if (index === undefined) return []
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
        return continuations(
          target.id,
          callee,
          slot,
          selected,
          value,
          site,
          childDepth,
          chain,
          budget,
          next,
        )
      },
      true,
      recordAuthoredContinuation,
    ).run(depth)
  }

  function continuations(
    caller: string,
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
    const inputSummary = inputFacts(argument)
    const choice = (
      mode: ChildResult['mode'],
      value: Value,
      result: string,
      prefix: readonly BehaviorStep[],
      assumptions: readonly BehaviorAssumption[],
      guards: readonly BehaviorGuard[] = [],
      childPath?: number,
    ): ChildResult => {
      const step: Call = {
        kind: 'call',
        site,
        caller,
        slot,
        target,
        result,
        completion:
          mode === 'throw' ? 'if-failed' : assumptions.length ? 'if-returned' : 'source-return',
        ...(assumptions.length ? { assumptions } : {}),
        ...(guards.length ? { guards } : {}),
        ...(childPath !== undefined ? { childPath } : {}),
        ...(mode === 'next' ? { returned: returnFacts(value) } : {}),
      }
      if (mode === 'next') resultOrigins.set(value, step)
      return { mode, value, prefix, assumptions, step }
    }
    const newAssumption = (
      kind: BehaviorAssumption['kind'],
      detail: string,
    ): BehaviorAssumption => ({ kind, detail, site, slot })
    const allowSecondary =
      handoff?.caller === caller && handoff.slot === slot && sameSite(handoff.site, site)
    const states = callee ? evaluate(callee, argument, depth, active, budget, handoff) : []
    const pkg = callee && input.packages.get(callee.implementation)
    const values: ChildResult[] = []
    const readFailures = new Set<ChildResult>()
    const opaque: {
      steps: readonly BehaviorStep[]
      assumptions: readonly BehaviorAssumption[]
      guards: readonly BehaviorGuard[]
      childPath: number | undefined
    }[] = []
    if (states.length === 0)
      opaque.push({
        steps: [],
        assumptions: [],
        guards: [],
        childPath: retainChild(inputSummary, []),
      })
    const outcomes = new Set<string>()

    for (const state of states) {
      const { prefix, guards } = callerEvidence(state.steps)
      const refusal =
        state.mode === 'return' && callee ? resultRefusal(state.value, callee, pkg) : undefined
      const childPath = retainChild(
        inputSummary,
        complete(state, callee ? location(callee) : site, refusal, pkg?.contractPath),
      )
      if (state.mode === 'unknown') {
        opaque.push({ steps: prefix, assumptions: state.assumptions, guards, childPath })
        continue
      }
      if (state.mode === 'throw') {
        const failure = choice(
          'throw',
          state.value,
          failureText(state.value),
          prefix,
          state.assumptions,
          guards,
          childPath,
        )
        const failedAt = state.site
        if (
          state.value.kind === 'unknown' &&
          failedAt &&
          state.steps.some(
            (step) =>
              step.kind === 'condition' &&
              step.readOperation &&
              !step.taken &&
              sameSite(step.site, failedAt),
          )
        )
          readFailures.add(failure)
        values.push(failure)
        continue
      }
      if (state.mode !== 'return') continue
      if (refusal !== undefined) {
        values.push(choice('throw', unknown, refusal, prefix, state.assumptions, guards, childPath))
        continue
      }
      const outcome = field(state.value, 'outcome')
      if (outcome.kind !== 'literal' || typeof outcome.value !== 'string') {
        opaque.push({ steps: prefix, assumptions: state.assumptions, guards, childPath })
        continue
      }
      const output = field(state.value, 'output')
      const returned = object([
        ['outcome', outcome],
        ['output', output],
        ['artifacts', unknown],
      ])
      if (state.assumptions.every((fact) => fact.kind === 'opaque-return'))
        outcomes.add(outcome.value)
      values.push(
        choice(
          'next',
          returned,
          resultText(returned),
          prefix,
          state.assumptions,
          guards,
          childPath,
        ),
      )
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
          prefix.childPath,
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
            prefix.childPath,
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
            [],
            retainChild(inputSummary, []),
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
          [],
          retainChild(inputSummary, []),
        ),
      )
    }
    const distinct = new Map<string, ChildResult>()
    for (const result of values) {
      const readFailure = readFailures.has(result)
      const key = JSON.stringify(
        readFailure ? { ...result, step: { ...result.step, guards: undefined } } : result,
        mapEntries,
      )
      const previous = distinct.get(key)
      if (!previous) distinct.set(key, result)
      else if (readFailure) {
        const current = result.step.guards ?? []
        const common: BehaviorGuard[] = []
        for (const [index, guard] of (previous.step.guards ?? []).entries()) {
          if (JSON.stringify(guard) !== JSON.stringify(current[index])) break
          common.push(guard)
        }
        distinct.set(key, {
          ...previous,
          step: { ...previous.step, guards: common, representativeChild: true },
        })
      }
    }
    return budget.variants(
      [...distinct.values()].filter(
        (option) =>
          !allowSecondary ||
          option.assumptions.some(
            (fact) =>
              fact.kind !== 'opaque-return' && fact.slot === slot && sameSite(fact.site, site),
          ),
      ),
    )
  }
}

function sameSite(a: SourceSite, b: SourceSite): boolean {
  return a.path === b.path && a.line === b.line && a.column === b.column
}

function resultRefusal(
  value: Value,
  target: BehaviorTarget,
  pkg: BehaviorPackage | undefined,
): string | undefined {
  if (value.kind === 'unknown') return undefined
  if (value.kind !== 'object') return 'The returned result must be an object.'
  const outcome = field(value, 'outcome')
  if (outcome.kind === 'unknown') return undefined
  if (outcome.kind !== 'literal' || typeof outcome.value !== 'string')
    return 'The result must have a string outcome.'
  if (!target.outcomes.includes(outcome.value))
    return 'The target does not declare outcome ' + describe(outcome) + '.'
  const concrete = toJson(
    object([
      ['outcome', outcome],
      ['output', field(value, 'output')],
    ]),
  )
  if (concrete !== undefined && pkg?.checkResult?.(concrete) === false)
    return 'The known result fails its declared schema.'
  return undefined
}

function completedRoute(
  state: State,
  fallback: SourceSite,
  refusal?: string,
  contractPath?: string,
  forwardedCall = -1,
): Route {
  if (state.mode === 'unknown' && state.steps.at(-1)?.kind === 'end') return state.steps
  if (refusal !== undefined)
    return [
      ...state.steps,
      {
        kind: 'end',
        site: state.site ?? fallback,
        completion: 'rejected',
        detail: refusal,
        ...(contractPath === undefined ? {} : { contractPath }),
      },
    ]
  return [
    ...state.steps,
    {
      kind: 'end',
      site: state.site ?? fallback,
      completion:
        state.mode === 'throw' ? 'throw' : state.mode === 'unknown' ? 'unknown' : 'return',
      detail:
        state.mode === 'return'
          ? resultText(state.value)
          : state.mode === 'throw'
            ? failureText(state.value)
            : state.mode === 'unknown'
              ? 'Continuation unknown'
              : 'Finishes without an explicit return',
      ...(state.mode === 'return' ? { returned: returnFacts(state.value) } : {}),
      ...(forwardedCall < 0 ? {} : { forwardedCall }),
    },
  ]
}

function callerEvidence(steps: Route): { prefix: BehaviorStep[]; guards: BehaviorGuard[] } {
  const prefix: BehaviorStep[] = []
  let guards: BehaviorGuard[] = []
  for (const step of steps) {
    // The child path keeps its reads and their operational checks. A caller
    // needs the child's completion and effects that cross the boundary.
    if (step.kind === 'condition' && step.unresolved && !step.readOperation) guards.push(step)
    if (step.kind === 'call') guards.push(...(step.guards ?? []))
    if (step.kind === 'effect') {
      if (isFileOperation(step) && step.operation !== 'writeFile') continue
      // Conditions seen before a file operation belong to its incoming edge.
      // A later condition stays with the child completion.
      if (isFileOperation(step) && guards.length) {
        prefix.push({ ...step, guards: [...guards, ...(step.guards ?? [])].slice(0, 4) })
        guards = []
      } else prefix.push(step)
    }
    if (step.kind === 'gap') prefix.push(step)
    if (step.kind === 'end' && step.completion === 'unknown')
      prefix.push({ kind: 'gap', site: step.site, detail: step.detail })
  }
  return { prefix, guards: guards.slice(0, 4) }
}

function failureText(value: Value): string {
  const message = value.kind === 'error' ? value.message : value
  return message.kind === 'literal' &&
    typeof message.value === 'string' &&
    message.value.length <= 160 &&
    message.value.length > 0
    ? 'Throws: ' + message.value
    : value.kind === 'error'
      ? 'Throws ' + value.type.base
      : 'Throws'
}

function mapEntries(key: string, value: unknown): unknown {
  // Retaining a representative child path must not change the analysis budget.
  if (key === 'childPath' || key === 'representativeChild' || key === 'forwardedCall')
    return undefined
  if (value instanceof Map) return [...value]
  if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'function')
    return { kind: 'function' }
  return withoutReportingLocations(key, value)
}
