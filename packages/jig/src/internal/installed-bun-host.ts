import { openPrivateClaudeAgentProvider } from './claude-agent-provider.js'
import {
  openPrivateCodexAgentProvider,
  PrivateCodexExecutableUnavailableError,
  PrivateCodexLoginUnavailableError,
  PrivateCodexSandboxUnavailableError,
} from './codex-agent-provider.js'
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
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
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
  let selectedEnvironment = environment
  let openRouter = false
  if (client === undefined) {
    const hasOpenRouter = ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL'].some(
      (key) => environment[key] !== undefined,
    )
    const hasOpenAI = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL', 'OPENAI_API'].some(
      (key) => environment[key] !== undefined,
    )
    if (hasOpenRouter && hasOpenAI)
      return {
        agentUnavailableHint:
          'choose either OPENROUTER_API_KEY and OPENROUTER_MODEL, or the OPENAI_* endpoint variables; unset the other family before jig review',
      }
    openRouter = hasOpenRouter
    const required = openRouter
      ? (['OPENROUTER_API_KEY', 'OPENROUTER_MODEL'] as const)
      : (['OPENAI_API_KEY', 'OPENAI_MODEL'] as const)
    const missing = required.filter((key) => environment[key] === undefined)
    if (missing.length > 0)
      return {
        agentUnavailableHint:
          !hasOpenRouter && !hasOpenAI
            ? 'export OPENROUTER_API_KEY and OPENROUTER_MODEL, or OPENAI_API_KEY and OPENAI_MODEL, before jig review; Jig reads operator configuration, not project .env files'
            : `export ${missing.join(' and ')} before jig review; Jig reads operator configuration, not project .env files`,
      }
    if (openRouter)
      selectedEnvironment = Object.freeze({
        ...environment,
        OPENAI_API_KEY: environment.OPENROUTER_API_KEY,
        OPENAI_MODEL: environment.OPENROUTER_MODEL,
        OPENAI_BASE_URL: OPENROUTER_BASE_URL,
        OPENAI_API: 'chat-completions',
      })
  }
  try {
    const agentProvider =
      client === undefined
        ? openPrivateOpenAIAgentProvider(installedBunSupport, selectedEnvironment)
        : client === 'codex'
          ? await openPrivateCodexAgentProvider(
              installedBunSupport.releaseRoot,
              selectedEnvironment,
            )
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
        error instanceof PrivateCodexExecutableUnavailableError
          ? "export CODEX_PATH with the absolute path of this operator's installed codex executable, then retry jig review"
          : error instanceof PrivateCodexSandboxUnavailableError
            ? 'install Bubblewrap in a fixed system location or export its absolute JIG_BWRAP_PATH, then retry jig review'
            : error instanceof PrivateCodexLoginUnavailableError
              ? 'configure Codex with cli_auth_credentials_store="file", run codex login as this OS user, and retry jig review; Jig reads CODEX_HOME/auth.json or ~/.codex/auth.json'
              : error instanceof PrivateAgentConfigurationError
                ? `correct the exported ${
                    openRouter
                      ? error.field === 'OPENAI_API_KEY'
                        ? 'OPENROUTER_API_KEY'
                        : error.field === 'OPENAI_MODEL'
                          ? 'OPENROUTER_MODEL'
                          : error.field
                      : error.field
                  } value before jig review`
                : client === undefined
                  ? 'the API Agent could not be opened; check the installed support assets and exported configuration'
                  : `the selected ${client} client could not be opened; check its executable and exported host configuration`,
    }
  }
}
