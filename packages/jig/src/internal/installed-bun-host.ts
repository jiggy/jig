import { openPrivateHttpGrants } from './http-grants.js'
import {
  openPrivateInstalledBunSupport,
  type PrivateInstalledBunLocation,
} from './installed-bun-support.js'
import { PrivateLinuxCgroupBackend } from './linux-rootless-backend.js'
import { openPrivateAcpResources } from './private-acp-resources.js'
import type { PrivateProjectSessionHost } from './project-session-controller.js'
import { PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS } from './root-run-timeout-policy.js'
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
