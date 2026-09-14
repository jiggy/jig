type Client = 'codex' | 'claude' | 'pi'
export type AcpSetupStage = 'executable' | 'installation' | 'sandbox' | 'login' | 'api' | 'model'

/** Only closed stages cross the public boundary; underlying errors may contain secrets. */
export class PrivateAcpSetupError extends Error {
  constructor(readonly stage: AcpSetupStage) {
    super(`native Agent ${stage} configuration is unavailable`)
  }
}

export async function checkAcpSetup<T>(
  stage: AcpSetupStage,
  action: () => T | Promise<T>,
): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof PrivateAcpSetupError) throw error
    throw new PrivateAcpSetupError(stage)
  }
}

const clients = {
  codex: {
    name: 'Codex',
    path: 'CODEX_PATH',
    installation:
      'Use a supported Linux x86-64 Codex installation with its required libraries and sandbox helper.',
    login:
      'Run codex login and use its operator-owned file-backed authentication; an expired credential needs a fresh login.',
    api: 'Configure OPENAI_API_KEY and OPENAI_MODEL for Responses; OPENAI_API, if set, must be responses. Check OPENAI_BASE_URL if overridden.',
    model: 'Set a valid OPENAI_MODEL for API access, or CODEX_MODEL for subscription access.',
  },
  claude: {
    name: 'Claude Code',
    path: 'CLAUDE_PATH',
    installation:
      'Use a supported Linux x86-64 native Claude Code installation with its required libraries.',
    login: 'Configure CLAUDE_CODE_OAUTH_TOKEN with a valid Claude setup token.',
    api: 'Set ANTHROPIC_MODEL and exactly one of ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. Check ANTHROPIC_BASE_URL if overridden.',
    model: 'Set a valid ANTHROPIC_MODEL for API access, or CLAUDE_MODEL for subscription access.',
  },
  pi: {
    name: 'Pi',
    path: 'PI_PATH',
    installation:
      'Use the supported standalone Linux x86-64 Pi 0.84.4 distribution with its package.json and theme directory; a Node/npm launcher is not supported.',
    login:
      'Use valid Pi subscription authentication for PI_PROVIDER in the operator auth.json; check PI_CODING_AGENT_DIR if overridden.',
    api: 'Configure PI_PROVIDER, PI_MODEL and a valid PI_API_KEY for the selected Pi API provider.',
    model: 'Configure PI_PROVIDER and PI_MODEL with valid explicit provider and model names.',
  },
} as const

export function acpSetupCode(client: Client, stage: AcpSetupStage): string {
  return `PROJECT_ACP_${client.toUpperCase()}_${stage.toUpperCase()}`
}

export const ACP_SETUP_HINTS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(clients).flatMap(([client, profile]) => {
      const hints = {
        executable: `Select an executable ${profile.name} installation using ${profile.path} or operator PATH. An explicit ${profile.path} must be an absolute executable file and never falls back to PATH.`,
        installation: profile.installation,
        sandbox:
          'Install an unprivileged Bubblewrap helper supported by the selected Codex installation; do not bypass containment.',
        login: profile.login,
        api: profile.api,
        model: profile.model,
      }
      return Object.entries(hints).map(([stage, hint]) => [
        acpSetupCode(client as Client, stage as AcpSetupStage),
        `${hint} Then retry jig review. No Flow was started by this review.`,
      ])
    }),
  ),
)
