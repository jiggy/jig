import { invalid } from '../diagnostics.js'
import { PRIVATE_MAX_CHILD_FLOW_LEVELS } from '../internal/root-operation-limits.js'
import type { GrantedSlot } from './grants.js'
import type { RunTargetIdentity } from './package-project.js'

export const MAX_CHILD_FLOW_LEVELS = PRIVATE_MAX_CHILD_FLOW_LEVELS

interface Node {
  readonly packagePath: string
  readonly declarationPath?: string
  readonly slots: Readonly<Record<string, RunTargetIdentity | GrantedSlot>>
}

/** Validate once per target and return longest descendant paths (edge counts). */
export function validateChildGraph(
  bindings: ReadonlyMap<string, Node>,
  flows: ReadonlyMap<string, Node>,
  consume?: (units: number) => void,
): ReadonlyMap<string, number> {
  const nodes = new Map<string, Node>([
    ...Array.from(bindings, ([id, node]) => [`binding:${id}`, node] as const),
    ...Array.from(flows, ([path, node]) => [`flow:${path}`, node] as const),
  ])
  const depths = new Map<string, number>()
  let work = 0
  const visit = (id: string, path: readonly string[]): number => {
    consume?.(1)
    if (++work > 1_000_000) invalid('PROJECT_PACKAGE_WORK_LIMIT', 'Flow graph work limit exceeded')
    const binding = nodes.get(id)
    if (binding === undefined)
      invalid('PROJECT_BINDING_SLOT_MISSING', 'Flow graph selects an unknown target')
    if (path.includes(id))
      invalid(
        'PROJECT_BINDING_SLOT_RECURSIVE',
        'Flow slot graph contains a cycle',
        binding.declarationPath,
        '/slots',
      )
    const known = depths.get(id)
    if (known !== undefined) {
      if (known + path.length > MAX_CHILD_FLOW_LEVELS)
        invalid(
          'PROJECT_BINDING_SLOT_DEPTH',
          'Flow slot depth exceeds the fixed root resource budget',
          binding.declarationPath,
          '/slots',
        )
      return known
    }
    let depth = 0
    for (const target of Object.values(binding.slots)) {
      if (target.kind === 'grant') continue
      if (path.length >= MAX_CHILD_FLOW_LEVELS)
        invalid(
          'PROJECT_BINDING_SLOT_DEPTH',
          'Flow slot depth exceeds the fixed root resource budget',
          binding.declarationPath,
          '/slots',
        )
      const key = target.kind === 'binding' ? `binding:${target.id}` : `flow:${target.path}`
      depth = Math.max(depth, 1 + visit(key, [...path, id]))
    }
    depths.set(id, depth)
    return depth
  }
  for (const id of nodes.keys()) visit(id, [])
  return depths
}
