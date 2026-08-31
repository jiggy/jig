import { openPrivateInstalledBunSupport } from "./installed-bun-support.js";
import { PrivateLinuxCgroupBackend } from "./linux-rootless-backend.js";
import type { PrivateProjectSessionHost } from "./project-session-controller.js";

const RUN_TIMEOUT_MS = 60_000;

/** Open the one fixed installed alpha host. This is not a public host SPI. */
export async function openPrivateInstalledBunHost(
  executablePath: string = process.execPath,
): Promise<PrivateProjectSessionHost> {
  const installedBunSupport = await openPrivateInstalledBunSupport(executablePath);
  return Object.freeze({
    backend: new PrivateLinuxCgroupBackend({
      bunPath: installedBunSupport.executablePath,
      bunHostLibraryPath: installedBunSupport.hostLibraryDirectory,
      supervisorPath: installedBunSupport.supervisorPath,
    }),
    installedBunSupport,
    runTimeoutMs: RUN_TIMEOUT_MS,
  });
}
