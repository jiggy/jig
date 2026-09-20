import type { PackageProjectValue } from '../project/package-project.js'
import { buildPrivateActivationRequests } from '../project/package-resolution.js'
import { privateActivationTargetKey } from './activation-planning.js'
import { privateDomainDigest } from './identity.js'

/** Qualify the already-selected graph. Never select a replacement or run authored code. */
export function privateProjectFeatureFailures(
  project: PackageProjectValue,
): ReadonlyMap<string, string> {
  const requests = buildPrivateActivationRequests(project)
  const byTarget = new Map(
    requests.map((request) => [privateActivationTargetKey(request.target), request]),
  )
  const flows = new Map(project.flows.map((flow) => [flow.provenance.projectPath, flow]))
  const failures = new Map<string, string>()
  const visited = new Set<string>()
  function visit(key: string): string | undefined {
    if (visited.has(key)) return failures.get(key)
    visited.add(key)
    const request = byTarget.get(key)
    if (request === undefined) throw new Error('feature qualification target is missing')
    const flow = flows.get(request.packagePath)!
    const evidence: {
      slot: string
      target: string
      providerRequest: string
      missing?: readonly string[]
      dependency?: string
    }[] = []
    for (const [name, route] of Object.entries(request.slots)) {
      if (route.kind !== 'flow') continue
      const target = privateActivationTargetKey(route.target)
      const provider = byTarget.get(target)
      if (provider === undefined) throw new Error('feature qualification provider is missing')
      const supports = flows.get(provider.packagePath)!.metadata.supports ?? []
      const missing = (flow.uses[name]?.requires ?? []).filter(
        (feature) => !supports.includes(feature),
      )
      const dependency = visit(target)
      if (missing.length > 0 || dependency !== undefined)
        evidence.push({
          slot: name,
          target,
          providerRequest: provider.digest,
          ...(missing.length === 0 ? {} : { missing }),
          ...(dependency === undefined ? {} : { dependency }),
        })
    }
    if (evidence.length > 0)
      failures.set(
        key,
        privateDomainDigest('JIG-Feature-Qualification/1', {
          request: request.digest,
          package: flow.package.digest,
          evidence,
        }),
      )
    return failures.get(key)
  }
  for (const key of byTarget.keys()) visit(key)
  return failures
}
