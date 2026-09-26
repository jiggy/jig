import type { PrivateInspectionEnvironmentCheck } from './activation-admission-store.js'
import { inspectPrivateBunDirectIdentity } from './bun-direct-run.js'
import {
  inspectPrivateExecutionBackendSupport,
  type PrivateExecutionBackend,
} from './execution-backend.js'
import { openPrivateHttpGrants } from './http-grants.js'
import { excludePrivateVerificationProject } from './installation-verification.js'
import {
  openPrivateInstalledBunSupport,
  type PrivateInstalledBunLocation,
} from './installed-bun-support.js'
import { PrivateLinuxCgroupBackend } from './linux-rootless-backend.js'
import { PrivateMacosBackend } from './macos-native-backend.js'
import { openPrivateAcpResources } from './private-acp-resources.js'
import type { PrivateProjectSessionHost } from './project-session-controller.js'
import { privateDefaultRootRunTimeout } from './root-run-timeout-policy.js'

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
        support: Awaited<ReturnType<typeof inspectPrivateExecutionBackendSupport>>
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
      return { host, support: await inspectPrivateExecutionBackendSupport(host.backend) }
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
  await excludePrivateVerificationProject(projectDirectory)
  const installedBunSupport = await openPrivateInstalledBunSupport(location)
  let backend: PrivateExecutionBackend
  if (installedBunSupport.platform === 'linux-x64-glibc') {
    backend = new PrivateLinuxCgroupBackend({
      bunPath: installedBunSupport.executablePath,
      bunHostLibraryPath: installedBunSupport.hostLibraryDirectory,
      supervisorPath: installedBunSupport.supervisorPath,
    })
  } else {
    if (installedBunSupport.launcherPath === null)
      throw new Error('installed macOS execution launcher is unavailable')
    backend = new PrivateMacosBackend({
      bunPath: installedBunSupport.executablePath,
      supervisorPath: installedBunSupport.supervisorPath,
      launcherPath: installedBunSupport.launcherPath,
    })
  }
  onStage?.('Preparing operator resource configuration')
  return Object.freeze({
    backend,
    installedBunSupport,
    runTimeoutMs: privateDefaultRootRunTimeout(),
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
