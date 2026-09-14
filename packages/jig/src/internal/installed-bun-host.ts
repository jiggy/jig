import type { PrivateInspectionEnvironmentCheck } from './activation-admission-store.js'
import { inspectPrivateBunDirectIdentity } from './bun-direct-run.js'
import { openPrivateHttpGrants } from './http-grants.js'
import {
  openPrivateInstalledBunSupport,
  type PrivateInstalledBunLocation,
} from './installed-bun-support.js'
import { PrivateLinuxCgroupBackend } from './linux-rootless-backend.js'
import { openPrivateAcpResources } from './private-acp-resources.js'
import type { PrivateProjectSessionHost } from './project-session-controller.js'
import { PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS } from './root-run-timeout-policy.js'

/** Read-only comparison against the same resource-aware identity used by planning. */
export function privateInstalledEnvironmentCheck(
  location: PrivateInstalledBunLocation,
  environment: Readonly<Record<string, string | undefined>>,
  projectDirectory: string,
): PrivateInspectionEnvironmentCheck {
  const operatorEnvironment = Object.freeze({ ...environment })
  let evidence:
    | Promise<{
        host: PrivateProjectSessionHost
        support: Awaited<ReturnType<PrivateLinuxCgroupBackend['inspectSupport']>>
      }>
    | undefined
  return async (target) => {
    if (target.disposition.state !== 'ready') return 'unchecked'
    evidence ??= (async () => {
      const host = await openPrivateInstalledBunHost(
        location,
        operatorEnvironment,
        projectDirectory,
      )
      return { host, support: await host.backend.inspectSupport() }
    })()
    const { host, support } = await evidence
    const identity = await inspectPrivateBunDirectIdentity(
      {
        request: target.request,
        execution: target.disposition.execution,
        installedSupport: host.installedBunSupport,
        httpGrants: host.httpGrants,
        acpResources: host.acpResources,
      },
      support,
    )
    return identity.digest === target.disposition.recipeDigest &&
      identity.observationDigest === target.disposition.observationDigest
      ? 'environment-matches'
      : 'review-required'
  }
}
/** Open the one fixed installed alpha host. This is not a public host SPI. */
export async function openPrivateInstalledBunHost(
  location: PrivateInstalledBunLocation,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  projectDirectory: string = process.cwd(),
  onStage?: (stage: string) => void,
): Promise<PrivateProjectSessionHost> {
  const operatorEnvironment = Object.freeze({ ...environment })
  const installedBunSupport = await openPrivateInstalledBunSupport(location)
  onStage?.('Preparing operator resource configuration')
  return Object.freeze({
    backend: new PrivateLinuxCgroupBackend({
      bunPath: installedBunSupport.executablePath,
      bunHostLibraryPath: installedBunSupport.hostLibraryDirectory,
      supervisorPath: installedBunSupport.supervisorPath,
    }),
    installedBunSupport,
    runTimeoutMs: PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS,
    acpResources: openPrivateAcpResources(
      installedBunSupport,
      operatorEnvironment,
      projectDirectory,
    ),
    httpGrants: (() => {
      try {
        return openPrivateHttpGrants(operatorEnvironment)
      } catch {
        return undefined
      }
    })(),
  })
}
