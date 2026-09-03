import {
  openPrivateInstalledBunSupport,
  type PrivateInstalledBunLocation,
} from "./installed-bun-support.js";
import { PrivateLinuxCgroupBackend } from "./linux-rootless-backend.js";
import type { PrivateProjectSessionHost } from "./project-session-controller.js";
import { PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS } from "./root-run-timeout-policy.js";
import { openPrivateOpenAIAgentProvider } from "./openai-agent-provider.js";
import { openPrivateOpenRouterAgentFlavor } from "./openrouter-agent-flavor.js";
import { openPrivateCodexAgentProvider } from "./codex-agent-provider.js";
import { openPrivateClaudeAgentProvider } from "./claude-agent-provider.js";
import { openPrivatePiAgentProvider } from "./pi-agent-provider.js";

const AGENT_CLIENT = "JIG_AGENT_CLIENT";

/** Open the one fixed installed alpha host. This is not a public host SPI. */
export async function openPrivateInstalledBunHost(
  location: PrivateInstalledBunLocation,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PrivateProjectSessionHost> {
  const installedBunSupport = await openPrivateInstalledBunSupport(location);
  const agentProvider = await tryOpenAgentProvider(installedBunSupport, environment);
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

async function tryOpenAgentProvider(
  installedBunSupport: Awaited<ReturnType<typeof openPrivateInstalledBunSupport>>,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<PrivateProjectSessionHost["agentProvider"]> {
  try {
    const client = environment[AGENT_CLIENT];
    return client === undefined
      ? openApiAgentProvider(installedBunSupport, environment)
      : client === "codex"
        ? await openPrivateCodexAgentProvider(installedBunSupport.releaseRoot, environment)
        : client === "claude"
          ? await openPrivateClaudeAgentProvider(installedBunSupport.releaseRoot, environment)
          : client === "pi"
            ? await openPrivatePiAgentProvider(installedBunSupport.releaseRoot, environment)
            : (() => { throw new Error("the native Agent client is unsupported"); })();
  } catch {
    // Provider support is target-scoped; Agent-bearing recipe planning rejects its absence.
    return undefined;
  }
}

function openApiAgentProvider(
  installedBunSupport: Awaited<ReturnType<typeof openPrivateInstalledBunSupport>>,
  environment: Readonly<Record<string, string | undefined>>,
) {
  const nativeAgentProvider = openPrivateOpenAIAgentProvider(installedBunSupport, environment);
  const openRouterAgentProvider = openPrivateOpenRouterAgentFlavor(
    installedBunSupport,
    environment,
  );
  if (nativeAgentProvider !== undefined && openRouterAgentProvider !== undefined) {
    throw new Error("the Agent provider configuration is ambiguous");
  }
  return nativeAgentProvider ?? openRouterAgentProvider;
}
