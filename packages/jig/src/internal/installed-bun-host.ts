import { privateAcpAgentRuntime } from './acp-agent-provider.js'
import type { PrivateInspectionEnvironmentCheck } from './activation-admission-store.js'
import { inspectPrivateBunDirectIdentity } from './bun-direct-run.js'
import { openPrivateClaudeAgentProvider } from './claude-agent-provider.js'
import {
  openPrivateCodexAgentProvider,
  PrivateCodexExecutableUnavailableError,
  PrivateCodexLoginUnavailableError,
  PrivateCodexRuntimeUnavailableError,
  PrivateCodexSandboxUnavailableError,
} from './codex-agent-provider.js'
import { excludePrivateVerificationProject } from './installation-verification.js'
import {
  openPrivateInstalledBunSupport,
  type PrivateInstalledBunLocation,
} from './installed-bun-support.js'
import { PrivateLinuxCgroupBackend } from './linux-rootless-backend.js'
import { PrivateNativeAgentExecutableUnavailableError } from './native-agent-executable.js'
import {
  openPrivateOpenAIAgentProvider,
  PrivateAgentConfigurationError,
} from './openai-agent-provider.js'
import { readPrivateAgentChoice, writePrivateAgentChoice } from './operator-agent-choice.js'
import { openPrivatePiAgentProvider } from './pi-agent-provider.js'
import type { PrivateProjectSessionHost } from './project-session-controller.js'
import { PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS } from './root-run-timeout-policy.js'

const AGENT_CLIENT = 'JIG_AGENT_CLIENT'
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export interface PrivateAgentChoice {
  readonly id: string
  readonly label: string
  readonly unavailable?: string
}

interface AgentSelection {
  readonly agentProvider?: PrivateProjectSessionHost['agentProvider']
  readonly agentUnavailableHint?: string | undefined
  readonly agentExecutable?: { readonly client: string; readonly path: string } | undefined
}

/** Read-only, command-local inspection. Never opens project state or a session. */
export function privateInstalledEnvironmentCheck(
  location: PrivateInstalledBunLocation,
  environment: Readonly<Record<string, string | undefined>>,
  projectDirectory: string,
): PrivateInspectionEnvironmentCheck {
  const operatorEnvironment = Object.freeze({ ...environment })
  let evidence:
    | Promise<{
        host: Awaited<ReturnType<typeof openPrivateInstalledBunHost>>
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
        agentProvider: host.agentProvider,
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
  selection?: {
    readonly choose?: (
      choices: readonly PrivateAgentChoice[],
      signal: AbortSignal,
    ) => Promise<string | undefined>
    readonly remember: boolean
  },
): Promise<PrivateProjectSessionHost & AgentSelection> {
  let operatorEnvironment = Object.freeze({ ...environment })
  await excludePrivateVerificationProject(projectDirectory)
  let preferenceFailure = false
  if (selection !== undefined && operatorEnvironment.JIG_AGENT_CLIENT === undefined) {
    try {
      const remembered = await readPrivateAgentChoice(operatorEnvironment, projectDirectory)
      if (remembered !== undefined)
        operatorEnvironment = Object.freeze({
          ...operatorEnvironment,
          JIG_AGENT_CLIENT: remembered,
        })
    } catch {
      preferenceFailure = true
    }
  }
  const installedBunSupport = await openPrivateInstalledBunSupport(location)
  onStage?.('Verifying Agent configuration and runtime')
  let agent = await tryOpenAgentProvider(installedBunSupport, operatorEnvironment, projectDirectory)
  return Object.freeze({
    backend: new PrivateLinuxCgroupBackend({
      bunPath: installedBunSupport.executablePath,
      bunHostLibraryPath: installedBunSupport.hostLibraryDirectory,
      supervisorPath: installedBunSupport.supervisorPath,
    }),
    installedBunSupport,
    runTimeoutMs: PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS,
    get agentProvider() {
      return agent.agentProvider
    },
    get agentUnavailableHint() {
      return agent.agentUnavailableHint
    },
    get agentExecutable() {
      return agent.agentExecutable
    },
    async prepareAgent(signal: AbortSignal) {
      if (preferenceFailure) {
        agent = {
          agentUnavailableHint:
            'the saved Agent choice could not be read safely; set JIG_AGENT_CLIENT=codex, claude, pi, or api explicitly and retry jig review',
        }
        return undefined
      }
      if (
        agent.agentProvider !== undefined ||
        operatorEnvironment.JIG_AGENT_CLIENT !== undefined ||
        selection?.choose === undefined
      )
        return agent.agentProvider
      const candidates: { choice: PrivateAgentChoice; opened: AgentSelection }[] = []
      for (const id of ['codex', 'claude', 'pi', 'api']) {
        signal.throwIfAborted()
        const opened = await tryOpenAgentProvider(
          installedBunSupport,
          { ...operatorEnvironment, JIG_AGENT_CLIENT: id },
          projectDirectory,
        )
        const label =
          id === 'api'
            ? 'API endpoint — final result only'
            : `${id === 'codex' ? 'Codex' : id === 'claude' ? 'Claude Code' : 'Pi'} — final result and live updates`
        candidates.push({
          choice: {
            id,
            label,
            ...(opened.agentProvider === undefined
              ? { unavailable: opened.agentUnavailableHint ?? 'Client unavailable' }
              : {}),
          },
          opened,
        })
      }
      signal.throwIfAborted()
      const chosen = await selection.choose(
        candidates.map(({ choice }) => choice),
        signal,
      )
      signal.throwIfAborted()
      const candidate = candidates.find(
        ({ choice, opened }) => choice.id === chosen && opened.agentProvider !== undefined,
      )
      if (candidate === undefined) {
        agent = {
          agentUnavailableHint:
            'no Agent was selected; run jig review in a terminal to choose, or set JIG_AGENT_CLIENT=codex, claude, pi, or api explicitly',
        }
        return undefined
      }
      if (selection.remember) {
        try {
          await writePrivateAgentChoice(operatorEnvironment, projectDirectory, candidate.choice.id)
        } catch {
          agent = {
            agentUnavailableHint:
              'the Agent choice could not be saved safely; set JIG_AGENT_CLIENT=codex, claude, pi, or api explicitly and retry jig review',
          }
          return undefined
        }
      }
      agent = candidate.opened
      return agent.agentProvider
    },
  })
}

async function tryOpenAgentProvider(
  installedBunSupport: Awaited<ReturnType<typeof openPrivateInstalledBunSupport>>,
  environment: Readonly<Record<string, string | undefined>>,
  projectDirectory: string,
): Promise<AgentSelection> {
  const client = environment[AGENT_CLIENT]
  if (client === undefined)
    return {
      agentUnavailableHint:
        'no Agent client is selected; run jig review in a terminal to choose, or set JIG_AGENT_CLIENT=codex, claude, pi, or api explicitly; API clients currently support final results only',
    }
  if (!['codex', 'claude', 'pi', 'api'].includes(client))
    return {
      agentUnavailableHint: 'JIG_AGENT_CLIENT must be codex, claude, pi, or api',
    }
  let selectedEnvironment = environment
  let openRouter = false
  if (client === 'api') {
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
      client === 'api'
        ? openPrivateOpenAIAgentProvider(installedBunSupport, selectedEnvironment)
        : client === 'codex'
          ? await openPrivateCodexAgentProvider(
              installedBunSupport.releaseRoot,
              selectedEnvironment,
              projectDirectory,
            )
          : client === 'claude'
            ? await openPrivateClaudeAgentProvider(
                installedBunSupport.releaseRoot,
                environment,
                projectDirectory,
              )
            : client === 'pi'
              ? await openPrivatePiAgentProvider(
                  installedBunSupport.releaseRoot,
                  environment,
                  projectDirectory,
                )
              : (() => {
                  throw new Error('the native Agent client is unsupported')
                })()
    return {
      agentProvider,
      ...(client === 'api' || agentProvider?.kind !== 'private-acp-agent-provider/1'
        ? {}
        : {
            agentExecutable: {
              client,
              path: privateAcpAgentRuntime(agentProvider).executablePath,
            },
          }),
    }
  } catch (error) {
    // Provider support is target-scoped; Agent-bearing recipe planning rejects its absence.
    return {
      agentUnavailableHint:
        error instanceof PrivateCodexExecutableUnavailableError ||
        error instanceof PrivateNativeAgentExecutableUnavailableError
          ? `install the native ${client} client on the operator PATH outside the project, or export ${(error instanceof PrivateNativeAgentExecutableUnavailableError ? error.client : 'codex').toUpperCase()}_PATH with its absolute executable path, then retry jig review; an invalid explicit override must be corrected or unset`
          : error instanceof PrivateCodexSandboxUnavailableError
            ? 'make an unprivileged bwrap available on operator PATH or install Codex with its bundled codex-resources/bwrap, then retry jig review'
            : error instanceof PrivateCodexRuntimeUnavailableError
              ? 'the selected Codex installation has unsupported or missing runtime files; install a complete native Linux x86-64 Codex package, then retry jig review'
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
                  : client === 'api'
                    ? 'the API Agent could not be opened; check the installed support assets and exported configuration'
                    : `the selected ${client} client could not be opened; check its executable and exported host configuration`,
    }
  }
}
