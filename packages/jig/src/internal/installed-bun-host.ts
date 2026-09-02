import {
  openPrivateInstalledBunSupport,
  type PrivateInstalledBunLocation,
} from "./installed-bun-support.js";
import { PrivateLinuxCgroupBackend } from "./linux-rootless-backend.js";
import type { PrivateProjectSessionHost } from "./project-session-controller.js";
import { PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS } from "./root-run-timeout-policy.js";

/** Open the one fixed installed alpha host. This is not a public host SPI. */
export async function openPrivateInstalledBunHost(
  location: PrivateInstalledBunLocation,
): Promise<PrivateProjectSessionHost> {
  const installedBunSupport = await openPrivateInstalledBunSupport(location);
  return Object.freeze({
    backend: new PrivateLinuxCgroupBackend({
      bunPath: installedBunSupport.executablePath,
      bunHostLibraryPath: installedBunSupport.hostLibraryDirectory,
      supervisorPath: installedBunSupport.supervisorPath,
    }),
    installedBunSupport,
    runTimeoutMs: PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS,
  });
}
