import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PRIVATE_CODEX_REQUIREMENTS } from '../src/internal/codex-agent-provider.js'
import type { openPrivateInstalledBunHost } from '../src/internal/installed-bun-host.js'
import { selectPrivateAcpResources } from '../src/internal/private-acp-resources.js'
import {
  FINITE_ACP_CONTRACT_DIGEST,
  FINITE_ACP_CONTRACT_ID,
  FINITE_ACP_CONTRACT_VERSION,
} from '../src/internal/private-finite-acp-contract.js'
import { nativeElf } from './fixtures/native-elf.js'

const temporary = new Set<string>()
const encoder = new TextEncoder()
async function selectCodex(host: Awaited<ReturnType<typeof openPrivateInstalledBunHost>>) {
  const resources = await selectPrivateAcpResources(
    host.acpResources,
    {
      session: {
        kind: 'native',
        native: 'finite-acp',
        contract: {
          id: FINITE_ACP_CONTRACT_ID,
          version: FINITE_ACP_CONTRACT_VERSION,
          digest: FINITE_ACP_CONTRACT_DIGEST,
        },
        grant: { kind: 'acp', client: 'codex' },
      },
    },
    host.installedBunSupport,
  )
  const provider = resources.session
  if (!provider) throw new Error('The test did not select its ACP session resource.')
  return provider
}
async function files(parent = tmpdir()): Promise<{
  readonly root: string
  readonly launcherPath: string
  readonly adapterPath: string
  readonly executablePath: string
  readonly nativeBubblewrapPath: string
  readonly nativeBubblewrapSource: 'bundled'
  readonly runtimeMounts: readonly []
  readonly certificatesPath: string
  readonly requirementsPath: string
}> {
  const root = await realpath(await mkdtemp(join(parent, 'jig-codex-provider-')))
  temporary.add(root)
  const launcherPath = join(root, 'codex-agent-launcher.js')
  const adapterPath = join(root, 'codex-acp.js')
  const nativeRoot = join(root, 'native')
  const executablePath = join(nativeRoot, 'bin', 'codex')
  const nativeBubblewrapPath = join(nativeRoot, 'codex-resources', 'bwrap')
  const certificatesPath = join(root, 'ca-certificates.crt')
  const requirementsPath = join(root, 'requirements.toml')
  await Promise.all([
    mkdir(join(nativeRoot, 'bin'), { recursive: true }),
    mkdir(join(nativeRoot, 'codex-resources'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(launcherPath, 'launcher\n'),
    writeFile(adapterPath, 'adapter\n'),
    writeFile(executablePath, nativeElf(), { mode: 0o700 }),
    writeFile(nativeBubblewrapPath, nativeElf(), { mode: 0o700 }),
    writeFile(certificatesPath, 'certificates\n'),
    writeFile(requirementsPath, PRIVATE_CODEX_REQUIREMENTS),
  ])
  return {
    root,
    launcherPath,
    adapterPath,
    executablePath,
    nativeBubblewrapPath,
    nativeBubblewrapSource: 'bundled',
    runtimeMounts: [],
    certificatesPath,
    requirementsPath,
  }
}
function credentialBytes(accountId: string, secret: string): Uint8Array {
  return encoder.encode(JSON.stringify(credentialValue(accountId, secret)))
}
function credentialValue(
  accountId: string,
  secret: string,
  options: {
    readonly authMode?: string
    readonly refreshToken?: string
    readonly expiresAt?: number
    readonly claimAccountId?: string
  } = {},
) {
  const accessToken = jwt({
    exp: Math.floor((options.expiresAt ?? Date.now() + 60 * 60_000) / 1_000),
    'https://api.openai.com/auth': {
      chatgpt_account_id: options.claimAccountId ?? accountId,
    },
    marker: secret,
  })
  return {
    OPENAI_API_KEY: null,
    auth_mode: options.authMode ?? 'chatgptAuthTokens',
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: accessToken,
      account_id: accountId,
      id_token: accessToken,
      refresh_token: options.refreshToken ?? '',
    },
  }
}
function jwt(claims: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'signature',
  ].join('.')
}

export { credentialBytes, credentialValue, encoder, files, jwt, selectCodex, temporary }
