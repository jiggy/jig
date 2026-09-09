import {
  type PrivateActivationRequest,
  requirePrivateActivationRequest,
} from '../project/package-resolution.js'
import type { PrivateAgentProvider } from './agent-provider.js'
import {
  type PrivateBunDirectRecipe,
  planPrivateBunDirectRun,
  requirePrivateBunDirectRecipe,
} from './bun-direct-run.js'
import type { PrivateBunExecutionArtifact } from './bun-execution-layout.js'
import {
  type PrivateInstalledBunSupport,
  requirePrivateInstalledBunSupport,
} from './installed-bun-support.js'
import type { PrivateLinuxCgroupBackend } from './linux-rootless-backend.js'

export type PrivateDirectRunRecipe = PrivateBunDirectRecipe
export type PrivateDirectRunInstalledSupport = PrivateInstalledBunSupport

/** Plan the one exact Bun recipe fixed by the alpha host. */
export async function planPrivateDirectRun(input: {
  readonly request: PrivateActivationRequest
  readonly installedSupport: PrivateDirectRunInstalledSupport
  readonly backend: PrivateLinuxCgroupBackend
  readonly execution?: PrivateBunExecutionArtifact
  readonly agentProvider?: PrivateAgentProvider | undefined
}): Promise<PrivateDirectRunRecipe> {
  const request = requirePrivateActivationRequest(input.request)
  if (request.entrypoint.path !== 'flow.ts') {
    throw new TypeError(`no exact Bun direct recipe for ${request.entrypoint.path}`)
  }
  return await planPrivateBunDirectRun({
    ...input,
    request,
    installedSupport: requirePrivateInstalledBunSupport(input.installedSupport),
  })
}

export function requirePrivateDirectRunRecipe(value: unknown): PrivateDirectRunRecipe {
  return requirePrivateBunDirectRecipe(value)
}
