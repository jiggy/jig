import type { DisplaySnapshot } from './types.js'

export type DisplayCompositionMatch = Readonly<{
  callId: string
  edgeId: string
  sourceNodeId: string
  targetNodeId: string
}>
export type DisplayCompositionUnmatched = Readonly<{
  callId: string
  reason:
    | 'composition-unavailable'
    | 'caller-unobserved'
    | 'slot-unavailable'
    | 'identity-conflict'
}>
export type DisplayCompositionObservations = Readonly<{
  matches: readonly DisplayCompositionMatch[]
  unmatched: readonly DisplayCompositionUnmatched[]
}>

type Call = DisplaySnapshot['calls'][number]
type Resolution =
  | { match: DisplayCompositionMatch }
  | { reason: DisplayCompositionUnmatched['reason'] }

/** Match retained requests in a validated snapshot, without inferring execution or sequence. */
export function compositionObservations(snapshot: DisplaySnapshot): DisplayCompositionObservations {
  const composition = snapshot.composition
  if (snapshot.mode !== 'live-run' || composition?.state !== 'available')
    return {
      matches: [],
      unmatched: snapshot.calls.map((call) => ({
        callId: call.id,
        reason: 'composition-unavailable',
      })),
    }

  const routes = new Map<string, Map<string, (typeof composition.edges)[number]>>()
  for (const edge of composition.edges) {
    let slots = routes.get(edge.source)
    if (!slots) routes.set(edge.source, (slots = new Map()))
    slots.set(edge.slot, edge)
  }
  const calls = new Map(snapshot.calls.map((call) => [call.id, call]))
  const owners = new Map<string, Call | null>()
  for (const call of snapshot.calls) {
    if (call.childSourceId !== undefined)
      owners.set(call.childSourceId, owners.has(call.childSourceId) ? null : call)
  }
  const resolved = new Map<string, Resolution>()
  const resolving = new Set<string>()

  const resolveCall = (call: Call): Resolution => {
    const prior = resolved.get(call.id)
    if (prior) return prior
    if (resolving.has(call.id)) return { reason: 'identity-conflict' }
    resolving.add(call.id)
    const result = resolveRequest(call)
    resolving.delete(call.id)
    resolved.set(call.id, result)
    return result
  }
  const resolveRequest = (call: Call): Resolution => {
    if (
      call.childSourceId !== undefined &&
      (call.childSourceId === snapshot.rootSourceId ||
        call.childSourceId === call.sourceId ||
        owners.get(call.childSourceId) === null)
    )
      return { reason: 'identity-conflict' }
    if (call.parentId !== undefined) {
      if (call.sourceId === snapshot.rootSourceId) return { reason: 'identity-conflict' }
      const owner = owners.get(call.sourceId)
      if (owner && owner.id !== call.parentId) return { reason: 'identity-conflict' }
      const parent = calls.get(call.parentId)
      if (parent?.childSourceId === undefined) return { reason: 'caller-unobserved' }
      if (parent.childSourceId !== call.sourceId) return { reason: 'identity-conflict' }
    }

    let sourceNodeId = composition.rootId
    if (call.sourceId !== snapshot.rootSourceId) {
      const owner = owners.get(call.sourceId)
      if (owner === null) return { reason: 'identity-conflict' }
      if (owner === undefined) return { reason: 'caller-unobserved' }
      const parent = resolveCall(owner)
      if ('reason' in parent)
        return {
          reason: parent.reason === 'identity-conflict' ? 'identity-conflict' : 'caller-unobserved',
        }
      sourceNodeId = parent.match.targetNodeId
    }
    const edge = routes.get(sourceNodeId)?.get(call.slot)
    return edge
      ? {
          match: {
            callId: call.id,
            edgeId: edge.id,
            sourceNodeId,
            targetNodeId: edge.target,
          },
        }
      : { reason: 'slot-unavailable' }
  }

  const matches: DisplayCompositionMatch[] = []
  const unmatched: DisplayCompositionUnmatched[] = []
  for (const call of snapshot.calls) {
    const result = resolveCall(call)
    if ('match' in result) matches.push(result.match)
    else unmatched.push({ callId: call.id, reason: result.reason })
  }
  return { matches, unmatched }
}
