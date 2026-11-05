import type { DisplayComposition } from '@jigging/display-model'
import type { RunTargetIdentity } from './project/package-project.js'
import type { PrivateActivationRequest } from './project/package-resolution.js'

/** Command-private identities are replaced by opaque display IDs before publication. */
export type PrivateRunComposition = DisplayComposition
export type PrivateCompositionLimits = Readonly<{
  nodes: number
  edges: number
  bytes: number
}>
export type PrivateCompositionSource = Readonly<{
  root: RunTargetIdentity
  targets: readonly Readonly<{
    request: Pick<PrivateActivationRequest, 'target' | 'slots'>
  }>[]
}>

const nativeKinds = new Set([
  'http-request',
  'project-command',
  'project-evaluation',
  'finite-acp',
  'run-checkpoint',
  'child-checkpoint',
])
const unavailable = (reason: 'limit' | 'unavailable'): PrivateRunComposition =>
  Object.freeze({ state: 'unavailable', reason })
const targetKey = (target: RunTargetIdentity): string =>
  JSON.stringify([target.kind, target.kind === 'flow' ? target.path : target.id])
function label(target: RunTargetIdentity): string {
  const value = target.kind === 'binding' ? target.id : target.path.split('/').at(-1)!
  const scalars = [...value]
  return scalars.length > 256 ? scalars.slice(0, 246).join('') + ' [clipped]' : value
}

/** Pure projection of an already reacquired Run candidate, never an admission validator. */
export function projectPrivateRunComposition(
  source: PrivateCompositionSource,
  limits: PrivateCompositionLimits,
): PrivateRunComposition {
  // Candidate normalization already bounds this full inventory to 4,096 targets.
  // Selected-root display bounds apply separately, including each native slot.
  const targets = new Map<string, PrivateCompositionSource['targets'][number]['request']>()
  for (const { request } of source.targets) {
    const key = targetKey(request.target)
    if (targets.has(key)) return unavailable('unavailable')
    targets.set(key, request)
  }
  const rootId = targetKey(source.root)
  if (!targets.has(rootId)) return unavailable('unavailable')
  const nodes: Extract<PrivateRunComposition, { state: 'available' }>['nodes'][number][] = []
  const edges: Extract<PrivateRunComposition, { state: 'available' }>['edges'][number][] = []
  const pending = [rootId]
  const selected = new Set(pending)
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index]!
    const request = targets.get(id)!
    nodes.push(Object.freeze({ id, kind: request.target.kind, label: label(request.target) }))
    if (nodes.length > limits.nodes) return unavailable('limit')
    const slots = Object.entries(request.slots).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    for (const [slot, route] of slots) {
      let target: string
      if (route.kind === 'flow') {
        target = targetKey(route.target)
        if (!targets.has(target)) return unavailable('unavailable')
        if (!selected.has(target)) {
          selected.add(target)
          pending.push(target)
          if (selected.size > limits.nodes) return unavailable('limit')
        }
      } else if (route.kind === 'native' && nativeKinds.has(route.native)) {
        target = JSON.stringify(['resource', id, slot])
        nodes.push(
          Object.freeze({ id: target, kind: 'resource', label: slot, resourceKind: route.native }),
        )
        if (nodes.length > limits.nodes) return unavailable('limit')
      } else return unavailable('unavailable')
      edges.push(Object.freeze({ id: JSON.stringify(['slot', id, slot]), source: id, target, slot }))
      if (edges.length > limits.edges) return unavailable('limit')
    }
  }
  const composition: PrivateRunComposition = Object.freeze({
    state: 'available',
    provenance: 'admitted',
    rootId,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  })
  return new TextEncoder().encode(JSON.stringify(composition)).byteLength > limits.bytes
    ? unavailable('limit')
    : composition
}

/** Optional presentation cannot change admission, execution, or recovery. */
export function observePrivateRunComposition(
  source: PrivateCompositionSource,
  limits: PrivateCompositionLimits,
  observer: (composition: PrivateRunComposition) => void,
): void {
  let composition = unavailable('unavailable')
  try {
    composition = projectPrivateRunComposition(source, limits)
  } catch {
    // Projection failure is an observation gap, never an execution failure.
  }
  try {
    observer(composition)
  } catch {
    // Presentation owns no authority over the reacquired Run.
  }
}
