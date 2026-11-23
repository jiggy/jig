import type { DisplayProjectRunEvidence } from '@jigging/display-model'
import { compositionObservations, type DisplayComposition } from '@jigging/display-model'
import type { PrivateCallEvent, PrivateCallState } from './cli-run-model.js'
import { PrivateRunModel } from './cli-run-model.js'
import {
  localName,
  type PrivateSavedCalls,
  readPrivateSavedCalls,
  settled,
} from './internal/saved-call-evidence.js'
import { flowSelector } from './project/package-selector.js'

/** Browser comparisons keep a prefix so a retained child keeps its parent index. */
export function privateCallExcerpt(recorded?: PrivateSavedCalls) {
  const calls: DisplayProjectRunEvidence['calls'][number][] = []
  for (const { id: _id, ...call } of recorded?.calls.slice(0, 8) ?? []) {
    // Reserve space for the settlement facts and any separately projected live file paths.
    if (Buffer.byteLength(JSON.stringify([...calls, call])) > 5 * 1024) break
    calls.push(call)
  }
  const callsOmitted = Math.min(
    Number.MAX_SAFE_INTEGER,
    (recorded?.omittedEvents ?? 0) + ((recorded?.calls.length ?? 0) - calls.length),
  )
  return {
    calls,
    callCoverage: callsOmitted ? ('incomplete' as const) : (recorded?.coverage ?? 'unavailable'),
    callsOmitted,
  }
}

function nodeTarget(node: Extract<DisplayComposition, { state: 'available' }>['nodes'][number]) {
  if (node.kind === 'resource') return `resource:${node.resourceKind}`
  // These IDs are created from normalized selectors by projectPrivateRunComposition.
  const [, name] = JSON.parse(node.id) as [string, string]
  return node.kind === 'binding' ? `binding:${name}` : flowSelector(name)
}

/** Shares the live call reducer and attribution rules without using terminal presentation state. */
export class PrivateCallEvidence {
  #source:
    | {
        runId: string
        revision: string
        model: PrivateRunModel
        started: boolean
        incomplete: boolean
      }
    | undefined

  admit(runId: string, revision: string, composition: DisplayComposition): void {
    const incomplete = this.#source?.runId === runId
    const model = new PrivateRunModel()
    model.observeComposition(composition)
    this.#source = { runId, revision, model, started: false, incomplete }
  }

  dispatched(runId: string): void {
    if (this.#source?.runId === runId) this.#source.started = true
  }

  observe(runId: string, event: PrivateCallEvent): void {
    const source = this.#source
    if (source?.runId !== runId || !source.started || event.artifactRelease === true) return
    try {
      const { publisher, operationId, childPublisher, slot, state, time, outcome } = event
      if (!localName(slot) || (outcome !== undefined && !localName(outcome))) {
        source.incomplete = true
        return
      }
      source.model.observeCall({
        publisher,
        operationId,
        ...(childPublisher === undefined ? {} : { childPublisher }),
        slot,
        state,
        time,
        ...(outcome === undefined ? {} : { outcome }),
      })
    } catch {
      source.incomplete = true
    }
  }

  finish(runId: string, root: string, successful: boolean): PrivateSavedCalls {
    const unavailable: PrivateSavedCalls = {
      provenance: 'recorded-claim',
      runId,
      root,
      coverage: 'unavailable',
      omittedEvents: 0,
      calls: [],
    }
    const source = this.#source
    this.#source = undefined
    if (source?.runId !== runId || !source.started) return unavailable
    try {
      const model = source.model
      const calls = [...model.calls.values()]
      const ids = new Map(calls.map((call, index) => [call.key, index + 1]))
      const composition = model.composition
      const matched = compositionObservations({
        mode: 'live-run',
        ...(composition === undefined ? {} : { composition }),
        rootSourceId: 'root',
        calls: calls.map((call) => ({
          id: call.key,
          sourceId: call.publisher,
          slot: call.slot,
          ...(call.parent === undefined ? {} : { parentId: call.parent }),
          ...(call.childPublisher === undefined ? {} : { childSourceId: call.childPublisher }),
        })),
      })
      const targets = new Map(
        composition?.state === 'available'
          ? composition.nodes.map((node) => [node.id, nodeTarget(node)])
          : [],
      )
      const routes = new Map(matched.matches.map((match) => [match.callId, match]))
      const evidence: PrivateSavedCalls = {
        ...unavailable,
        revision: source.revision,
        omittedEvents: model.omissions,
        coverage:
          successful &&
          !source.incomplete &&
          model.omissions === 0 &&
          composition?.state === 'available' &&
          targets.get(composition.rootId) === root &&
          matched.unmatched.length === 0 &&
          calls.every(({ state }) => settled(state))
            ? 'complete'
            : 'incomplete',
        calls: calls.map(({ key, parent, slot, state, outcome }, index) => {
          const parentId = parent === undefined ? undefined : ids.get(parent)
          const match = routes.get(key)
          const caller = match === undefined ? undefined : targets.get(match.sourceNodeId)
          const target = match === undefined ? undefined : targets.get(match.targetNodeId)
          return {
            id: index + 1,
            ...(parentId === undefined ? {} : { parent: parentId }),
            slot,
            state,
            ...(caller === undefined || target === undefined ? {} : { caller, target }),
            ...(outcome === undefined ? {} : { outcome }),
          }
        }),
      }
      return readPrivateSavedCalls(evidence, runId) ?? unavailable
    } catch {
      return unavailable
    }
  }
}
