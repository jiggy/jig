import { isAbsolute } from 'node:path'
import type { AcpGrant } from '../project/grants.js'
import type { InvocationSlots } from '../project/invocation-slots.js'
import {
  type PrivateAcpAgentProvider,
  requirePrivateAcpAgentProvider,
} from './acp-agent-provider.js'
import { openPrivateClaudeAgentProvider } from './claude-agent-provider.js'
import { openPrivateCodexAgentProvider } from './codex-agent-provider.js'
import {
  type PrivateInstalledBunSupport,
  requirePrivateInstalledBunSupport,
} from './installed-bun-support.js'
import { openPrivatePiAgentProvider } from './pi-agent-provider.js'

/** Private operator authority, not a provider registry or a Flow-visible resource. */
export interface PrivateAcpResources {
  readonly kind: 'private-acp-resources/1'
}

/** Package-private fault injection; never selected by project code or exported by Jig. */
export type PrivateAcpClientOpener = (
  client: AcpGrant['client'],
  support: PrivateInstalledBunSupport,
  environment: Readonly<Record<string, string | undefined>>,
  projectDirectory: string,
) => Promise<PrivateAcpAgentProvider>

export class PrivateAcpResourceUnavailableError extends Error {
  constructor(slot: string, client: AcpGrant['client']) {
    super(`ACP slot ${JSON.stringify(slot)} could not open its selected ${client} runtime`)
    this.name = 'PrivateAcpResourceUnavailableError'
  }
}

interface ResourceOwner {
  readonly support: PrivateInstalledBunSupport
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly projectDirectory: string
  readonly clients: Map<AcpGrant['client'], Promise<PrivateAcpAgentProvider>>
  readonly openClient: PrivateAcpClientOpener
}
const owners = new WeakMap<PrivateAcpResources, ResourceOwner>()
const CLIENT_IDENTITIES = {
  codex: 'openai-codex',
  claude: 'anthropic-claude-code',
  pi: 'pi',
} as const

/** Capture operator settings before project loading; do not discover any client yet. */
export function openPrivateAcpResources(
  installedSupport: PrivateInstalledBunSupport,
  environment: Readonly<Record<string, string | undefined>>,
  projectDirectory: string,
  openClient: PrivateAcpClientOpener = openQualifiedClient,
): PrivateAcpResources {
  const support = requirePrivateInstalledBunSupport(installedSupport)
  if (!isAbsolute(projectDirectory) || projectDirectory.includes('\0'))
    throw new TypeError('ACP resources require the fixed absolute project directory')
  const owner = Object.freeze({ kind: 'private-acp-resources/1' as const })
  owners.set(owner, {
    support,
    environment: Object.freeze({ ...environment }),
    projectDirectory,
    clients: new Map(),
    openClient,
  })
  return owner
}

/** Resolve only this target's admitted clients, without falling back to a global selection. */
export async function selectPrivateAcpResources(
  owner: PrivateAcpResources | undefined,
  slots: InvocationSlots,
  installedSupport: PrivateInstalledBunSupport,
): Promise<Readonly<Record<string, PrivateAcpAgentProvider>>> {
  const selected: Record<string, PrivateAcpAgentProvider> = Object.create(null)
  for (const [name, route] of Object.entries(slots).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (route.kind !== 'native' || route.native !== 'finite-acp') continue
    const state = owner === undefined ? undefined : owners.get(owner)
    if (
      state === undefined ||
      state.support !== requirePrivateInstalledBunSupport(installedSupport) ||
      route.grant?.kind !== 'acp' ||
      !['codex', 'claude', 'pi'].includes(route.grant.client)
    )
      throw new TypeError('the selected ACP resource has no matching private operator owner')
    const client = route.grant.client
    let provider: PrivateAcpAgentProvider
    try {
      let pending = state.clients.get(client)
      if (pending === undefined) {
        pending = state.openClient(client, state.support, state.environment, state.projectDirectory)
        state.clients.set(client, pending)
      }
      provider = requirePrivateAcpAgentProvider(await pending)
    } catch {
      // Native errors may include private paths or host configuration. Publish only the selection.
      throw new PrivateAcpResourceUnavailableError(name, client)
    }
    if (provider.client !== CLIENT_IDENTITIES[client])
      throw new TypeError('the selected ACP client does not match')
    selected[name] = provider
  }
  return Object.freeze(selected)
}

async function openQualifiedClient(
  client: AcpGrant['client'],
  support: PrivateInstalledBunSupport,
  environment: Readonly<Record<string, string | undefined>>,
  projectDirectory: string,
): Promise<PrivateAcpAgentProvider> {
  const open =
    client === 'codex'
      ? openPrivateCodexAgentProvider
      : client === 'claude'
        ? openPrivateClaudeAgentProvider
        : openPrivatePiAgentProvider
  return await open(support.releaseRoot, environment, projectDirectory)
}
