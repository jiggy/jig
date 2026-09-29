import { closeSync, mkdirSync, openSync, readSync, symlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

const STARTUP_INPUT_BYTES = 64 * 1024
const CODEX_HOME = process.env.JIG_MACOS_AGENT_HOME
  ? `${process.env.JIG_MACOS_AGENT_HOME}/codex-home`
  : '/tmp/codex-home'
const OUTPUT_ROOT = process.env.JIG_OUTPUT_ROOT ?? '/jig-output'
const ADAPTER_SPECIFIER = './codex-acp.js'
const AUTH_BOOTSTRAP = '__JIG_CODEX_AUTH_BOOTSTRAP__'

if (import.meta.main) await main()

async function main(): Promise<void> {
  delete process.env.JIG_MACOS_AGENT_HOME
  delete process.env.JIG_OUTPUT_ROOT
  mkdirSync(CODEX_HOME, { mode: 0o700 })
  materializeStartupFeatures()
  const startup = process.env.JIG_CODEX_STARTUP_INPUT
  if (startup !== undefined && startup !== 'subscription') {
    throw new Error('Codex startup input mode is invalid')
  }
  if (startup === 'subscription') installCredentialBootstrap()
  delete process.env.JIG_CODEX_STARTUP_INPUT
  const session = process.env.JIG_CODEX_SESSION_STATE
  if (session !== undefined && session !== '1') throw new Error('Codex session mode is invalid')
  if (session === '1') materializeSession()
  delete process.env.JIG_CODEX_SESSION_STATE
  // Bun's private loader path must not override the native installation's ABI.
  delete process.env.LD_LIBRARY_PATH
  await import(ADAPTER_SPECIFIER)
}

// CODEX_CONFIG is passed by the adapter to thread creation, after the native
// app server has already initialized optional helpers. Apply the same trusted
// feature flags at startup too, without importing the operator's configuration.
export function codexStartupFeatures(configuration: string): string {
  if (configuration.length > STARTUP_INPUT_BYTES) throw new Error('Codex configuration is invalid')
  const features = JSON.parse(configuration).features
  if (features === null || typeof features !== 'object' || Array.isArray(features))
    throw new Error('Codex features are invalid')
  const entries = Object.entries(features)
  if (
    entries.length > 16 ||
    entries.some(([key, value]) => !/^[a-z_]+(?![\s\S])/.test(key) || typeof value !== 'boolean')
  )
    throw new Error('Codex features are invalid')
  return `cli_auth_credentials_store = "ephemeral"\n\n[features]\n${entries.map(([key, value]) => `${key} = ${value}`).join('\n')}\n`
}

function materializeStartupFeatures(): void {
  const configuration = process.env.CODEX_CONFIG
  if (configuration === undefined) throw new Error('Codex configuration is missing')
  const bytes = new TextEncoder().encode(codexStartupFeatures(configuration))
  const descriptor = openSync(`${CODEX_HOME}/config.toml`, 'wx', 0o600)
  try {
    writeExactly(descriptor, bytes)
  } finally {
    closeSync(descriptor)
  }
}

function materializeSession(): void {
  const header = readExactly(8)
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const pathBytes = view.getUint32(0, false)
  const contentBytes = view.getUint32(4, false)
  if (
    pathBytes > 256 ||
    contentBytes > 8 * 1024 * 1024 ||
    (pathBytes === 0) !== (contentBytes === 0)
  )
    throw new Error('Codex session bootstrap is invalid')
  mkdirSync(`${OUTPUT_ROOT}/sessions`, { mode: 0o700 })
  // Only rollout history reaches retained anonymous output. Authentication,
  // SQLite, logs and the rest of CODEX_HOME remain disposable private state.
  symlinkSync(`${OUTPUT_ROOT}/sessions`, `${CODEX_HOME}/sessions`)
  if (pathBytes === 0) return
  const path = new TextDecoder('utf-8', { fatal: true }).decode(readExactly(pathBytes))
  if (!/^sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[0-9T-]+-[0-9a-f-]{36}\.jsonl(?![\s\S])/.test(path))
    throw new Error('Codex session path is invalid')
  const target = `${OUTPUT_ROOT}/${path}`
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const descriptor = openSync(target, 'wx', 0o600)
  try {
    writeExactly(descriptor, readExactly(contentBytes))
  } finally {
    closeSync(descriptor)
  }
}

function installCredentialBootstrap(): void {
  const header = readExactly(4)
  const size = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0, false)
  if (size === 0 || size > STARTUP_INPUT_BYTES - 4) {
    throw new Error('Codex startup input is invalid')
  }
  const credential = readExactly(size)
  let accessToken = ''
  let accountId = ''
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(credential))
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      parsed.auth_mode !== 'chatgptAuthTokens' ||
      parsed.tokens === null ||
      typeof parsed.tokens !== 'object' ||
      Array.isArray(parsed.tokens) ||
      typeof parsed.tokens.access_token !== 'string' ||
      parsed.tokens.access_token.length === 0 ||
      typeof parsed.tokens.account_id !== 'string' ||
      parsed.tokens.account_id.length === 0
    ) {
      throw new Error('Codex startup input is invalid')
    }
    accessToken = parsed.tokens.access_token
    accountId = parsed.tokens.account_id
  } finally {
    credential.fill(0)
  }
  Object.defineProperty(globalThis, AUTH_BOOTSTRAP, {
    configurable: true,
    enumerable: false,
    value: (): Readonly<{ accessToken: string; chatgptAccountId: string }> => {
      if (accessToken.length === 0 || accountId.length === 0)
        throw new Error('Codex startup input was already consumed')
      const result = Object.freeze({ accessToken, chatgptAccountId: accountId })
      accessToken = ''
      accountId = ''
      return result
    },
    writable: false,
  })
}

function readExactly(size: number): Uint8Array {
  const result = new Uint8Array(size)
  let offset = 0
  while (offset < result.byteLength) {
    const count = readSync(0, result, offset, result.byteLength - offset, null)
    if (count === 0) throw new Error('Codex startup input ended early')
    offset += count
  }
  return result
}

function writeExactly(descriptor: number, value: Uint8Array): void {
  let offset = 0
  while (offset < value.byteLength) {
    offset += writeSync(descriptor, value, offset, value.byteLength - offset, null)
  }
}
