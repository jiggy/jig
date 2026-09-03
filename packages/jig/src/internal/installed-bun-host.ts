import {
  openPrivateInstalledBunSupport,
  type PrivateInstalledBunLocation,
} from "./installed-bun-support.js";
import { PrivateLinuxCgroupBackend } from "./linux-rootless-backend.js";
import type { PrivateProjectSessionHost } from "./project-session-controller.js";
import { PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS } from "./root-run-timeout-policy.js";
import { openPrivateOpenAIAgentProvider } from "./openai-agent-provider.js";
import { openPrivateOpenRouterAgentFlavor } from "./openrouter-agent-flavor.js";

/** Open the one fixed installed alpha host. This is not a public host SPI. */
export async function openPrivateInstalledBunHost(
  location: PrivateInstalledBunLocation,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PrivateProjectSessionHost> {
  const installedBunSupport = await openPrivateInstalledBunSupport(location);
  const nativeAgentProvider = openPrivateOpenAIAgentProvider(installedBunSupport, environment);
  const openRouterAgentProvider = openPrivateOpenRouterAgentFlavor(
    installedBunSupport,
    environment,
  );
  if (nativeAgentProvider !== undefined && openRouterAgentProvider !== undefined) {
    throw new Error("the Agent provider configuration is ambiguous");
  }
  const agentProvider = nativeAgentProvider ?? openRouterAgentProvider;
  return Object.freeze({
    backend: new PrivateLinuxCgroupBackend({
      bunPath: installedBunSupport.executablePath,
      bunHostLibraryPath: installedBunSupport.hostLibraryDirectory,
      supervisorPath: installedBunSupport.supervisorPath,
    }),
    installedBunSupport,
    runTimeoutMs: PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS,
    ...(agentProvider === undefined ? {} : { agentProvider }),
  });
}
