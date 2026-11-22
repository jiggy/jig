import type { JsonValue } from '../json.js'
import type { CapturedFlowMember } from '../project/flow-source.js'
import type { PackageProjectInspection } from '../project/package-project.js'
import { selectFlowContext } from './flow-inspection-scope.js'
import { PRIVATE_FLOW_NAVIGATION_LIMITS as limits } from './inspection-policy.js'

type NavigationTarget = {
  id: string
  packagePath: string
  description?: string
  declaration?: string
  entrySource?: string
}
type Handoff = { caller: NavigationTarget; slot: string; target: NavigationTarget }
type Location = { path: string; line: number }

export type FlowNavigationSearch = {
  revision: string
  phrase: string
  matches: readonly (Handoff & { locations: readonly Location[] })[]
  independent: readonly NavigationTarget[]
  handoffs: readonly Handoff[]
  omitted: number
}

/** Search the same exact targets and routes as the configured navigation index. */
export async function findFlowNavigation(
  topology: JsonValue,
  linked: PackageProjectInspection,
  members: readonly CapturedFlowMember[],
  phrase: string,
  signal?: AbortSignal,
): Promise<FlowNavigationSearch> {
  const { snapshot, included, edges } = selectFlowContext(topology, { all: true })
  const flows = new Map(linked.flows.map((flow) => [flow.provenance.projectPath, flow]))
  const bindings = new Map(linked.bindings.map((binding) => ['binding:' + binding.id, binding]))
  const byPackage = new Map(members.map((member) => [member.provenance.projectPath, member]))
  const targets = new Map(
    included.map((item) => {
      const id = String(item.target)
      const packagePath = String(item.package)
      const entry = byPackage.get(packagePath)?.inspected.entrypoint.path
      const description = flows.get(packagePath)?.metadata.description
      const declaration = bindings.get(id)?.declarationPath
      const target: NavigationTarget = {
        id,
        packagePath,
        ...(description === undefined ? {} : { description }),
        ...(declaration === undefined ? {} : { declaration }),
        ...(entry === undefined || packagePath.startsWith('npm:')
          ? {}
          : { entrySource: packagePath + '/' + entry }),
      }
      return [id, target]
    }),
  )
  const handoffs: Handoff[] = edges.flatMap((edge) =>
    typeof edge.target === 'string'
      ? [
          {
            caller: targets.get(edge.from)!,
            slot: String(edge.slot),
            target: targets.get(edge.target)!,
          },
        ]
      : [],
  )
  const query = phrase.toLowerCase()
  const matchesText = (value: string) => value.toLowerCase().includes(query)
  const rank = (target: NavigationTarget, slot = '') =>
    [slot, target.id, target.packagePath].some(matchesText)
      ? 0
      : target.description && matchesText(target.description)
        ? 1
        : 2
  const selected = handoffs
    .map((edge) => ({ edge, rank: rank(edge.target, edge.slot) }))
    .filter((match) => match.rank < 2)
    .sort((a, b) => a.rank - b.rank)
  const called = new Set(handoffs.map(({ target }) => target.id))
  const independent = [...targets.values()]
    .filter((target) => !called.has(target.id) && rank(target) < 2)
    .sort((a, b) => rank(a) - rank(b))

  const sources = new Map<string, ReadonlyMap<string, readonly string[]>>()
  const matches = []
  for (const { edge } of selected.slice(0, limits.matches)) {
    const { caller, slot } = edge
    let callerSource = sources.get(caller.packagePath)
    if (callerSource === undefined) {
      callerSource = await readCallerSource(byPackage.get(caller.packagePath), signal)
      sources.set(caller.packagePath, callerSource)
    }
    const singleQuoted = `'${slot}'`
    const doubleQuoted = JSON.stringify(slot)
    const locations: Location[] = []
    for (const [path, lines] of callerSource) {
      for (const [index, line] of lines.entries()) {
        if (line.includes(singleQuoted) || line.includes(doubleQuoted)) {
          locations.push({ path, line: index + 1 })
          if (locations.length === limits.locationsPerHandoff) break
        }
      }
      if (locations.length === limits.locationsPerHandoff) break
    }
    matches.push({ ...edge, locations })
  }
  return {
    revision: String(snapshot.revision),
    phrase,
    matches,
    independent: independent.slice(0, limits.matches - matches.length),
    handoffs,
    omitted: Math.max(0, selected.length + independent.length - limits.matches),
  }
}

/** These are textual references in captured code, independent of behavior analysis. */
async function readCallerSource(member: CapturedFlowMember | undefined, signal?: AbortSignal) {
  const sources = new Map<string, string[]>()
  if (!member || member.provenance.projectPath.startsWith('npm:')) return sources
  const entry = member.inspected.entrypoint
  const files = member.captured.files.filter(
    ({ path }) => path.endsWith('.' + entry.suffix) && !path.endsWith('.d.ts'),
  )
  let remaining = limits.sourceBytesPerCaller
  for (const file of files.slice(0, limits.sourceFilesPerCaller)) {
    signal?.throwIfAborted()
    if (file.size > remaining) continue
    const data = await member.captured.read(file.path, remaining)
    remaining -= data.byteLength
    sources.set(
      member.provenance.projectPath + '/' + file.path,
      new TextDecoder().decode(data).split(/\r\n?|\n|\u2028|\u2029/u),
    )
  }
  return sources
}
