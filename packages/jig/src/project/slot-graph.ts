import { invalid } from '../diagnostics.js'
import type { GrantedSlot } from './grants.js'
import type { RunTargetIdentity } from './package-project.js'

export const MAX_CHILD_FLOW_LEVELS = 2

interface Node {
  readonly packagePath: string
  readonly declarationPath?: string
  readonly slots: Readonly<Record<string, RunTargetIdentity | GrantedSlot>>
}

/** Apply the same finite graph rules to source linking and retained lock decoding. */
export function validateChildGraph(
  bindings: ReadonlyMap<string, Node>,
  consume?: (units: number) => void,
): void {
  const depths = new Map<string, number>()
  let work = 0
  const visit = (id: string, path: readonly string[]): number => {
    consume?.(1)
    if (++work > 1_000_000) invalid('PROJECT_PACKAGE_WORK_LIMIT', 'Flow graph work limit exceeded')
    const binding = bindings.get(id)
    if (binding === undefined)
      invalid('PROJECT_BINDING_SLOT_MISSING', 'Flow graph selects an unknown Binding')
    if (path.includes(id))
      invalid(
        'PROJECT_BINDING_SLOT_RECURSIVE',
        'Flow slot graph contains a cycle',
        binding.declarationPath,
        '/slots',
      )
    const known = depths.get(id)
    if (known !== undefined && known + path.length <= MAX_CHILD_FLOW_LEVELS) return known
    let depth = 0
    for (const target of Object.values(binding.slots)) {
      if (target.kind === 'grant') continue
      if (path.length >= MAX_CHILD_FLOW_LEVELS)
        invalid(
          'PROJECT_BINDING_SLOT_DEPTH',
          'Flow slots support at most two child levels',
          binding.declarationPath,
          '/slots',
        )
      depth = Math.max(depth, 1 + (target.kind === 'binding' ? visit(target.id, [...path, id]) : 0))
    }
    depths.set(id, depth)
    return depth
  }
  for (const id of bindings.keys()) visit(id, [])
}
