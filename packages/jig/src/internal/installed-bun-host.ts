import { openPrivateClaudeAgentProvider } from './claude-agent-provider.js'
import { openPrivateCodexAgentProvider } from './codex-agent-provider.js'
import {
  openPrivateInstalledBunSupport,
  type PrivateInstalledBunLocation,
} from './installed-bun-support.js'
import { PrivateLinuxCgroupBackend } from './linux-rootless-backend.js'
import {
  openPrivateOpenAIAgentProvider,
  PrivateAgentConfigurationError,
} from './openai-agent-provider.js'
import { openPrivatePiAgentProvider } from './pi-agent-provider.js'
import type { PrivateProjectSessionHost } from './project-session-controller.js'
import { PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS } from './root-run-timeout-policy.js'

const AGENT_CLIENT = 'JIG_AGENT_CLIENT'
interface AgentSelection {
  readonly agentProvider?: PrivateProjectSessionHost['agentProvider']
  readonly agentUnavailableHint?: string
}

/** Open the one fixed installed alpha host. This is not a public host SPI. */
export async function openPrivateInstalledBunHost(
  location: PrivateInstalledBunLocation,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PrivateProjectSessionHost & AgentSelection> {
  const installedBunSupport = await openPrivateInstalledBunSupport(location)
  const agent = await tryOpenAgentProvider(installedBunSupport, environment)
  return Object.freeze({
    backend: new PrivateLinuxCgroupBackend({
      bunPath: installedBunSupport.executablePath,
      bunHostLibraryPath: installedBunSupport.hostLibraryDirectory,
      supervisorPath: installedBunSupport.supervisorPath,
    }),
    installedBunSupport,
    runTimeoutMs: PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS,
    ...agent,
  })
}

async function tryOpenAgentProvider(
  installedBunSupport: Awaited<ReturnType<typeof openPrivateInstalledBunSupport>>,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<AgentSelection> {
  const client = environment[AGENT_CLIENT]
  if (client !== undefined && !['codex', 'claude', 'pi'].includes(client))
    return {
      agentUnavailableHint:
        'JIG_AGENT_CLIENT must be codex, claude, or pi; unset it to use the configured API endpoint',
    }
  if (client === undefined) {
    const missing = ['OPENAI_API_KEY', 'OPENAI_MODEL'].filter(
      (key) => environment[key] === undefined,
    )
    if (missing.length > 0)
      return {
        agentUnavailableHint: `export ${missing.join(' and ')} before jig review; Jig reads operator configuration, not project .env files`,
      }
  }
  try {
    const agentProvider =
      client === undefined
        ? openPrivateOpenAIAgentProvider(installedBunSupport, environment)
        : client === 'codex'
          ? await openPrivateCodexAgentProvider(installedBunSupport.releaseRoot, environment)
          : client === 'claude'
            ? await openPrivateClaudeAgentProvider(installedBunSupport.releaseRoot, environment)
            : client === 'pi'
              ? await openPrivatePiAgentProvider(installedBunSupport.releaseRoot, environment)
              : (() => {
                  throw new Error('the native Agent client is unsupported')
                })()
    return { agentProvider }
  } catch (error) {
    // Provider support is target-scoped; Agent-bearing recipe planning rejects its absence.
    return {
      agentUnavailableHint:
        error instanceof PrivateAgentConfigurationError
          ? `correct the exported ${error.field} value before jig review`
          : client === undefined
            ? 'the API Agent could not be opened; check the installed support assets and exported configuration'
            : `the selected ${client} client could not be opened; check its executable and exported host configuration`,
    }
  }
}
