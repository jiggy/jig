import { closeSync, mkdirSync, openSync, readSync, writeSync, symlinkSync } from 'node:fs'
import { dirname } from 'node:path'

const STARTUP_INPUT_BYTES = 64 * 1024
const CODEX_HOME = '/tmp/codex-home'
const CREDENTIAL_PATH = `${CODEX_HOME}/auth.json`
const ADAPTER_SPECIFIER = './codex-acp.js'

if (import.meta.main) await main()

async function main(): Promise<void> {
  mkdirSync(CODEX_HOME, { mode: 0o700 })
  materializeStartupFeatures()
  const startup = process.env.JIG_CODEX_STARTUP_INPUT
  if (startup !== undefined && startup !== 'subscription') {
    throw new Error('Codex startup input mode is invalid')
  }
  if (startup === 'subscription') materializeCredential()
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
  return `[features]\n${entries.map(([key, value]) => `${key} = ${value}`).join('\n')}\n`
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
  mkdirSync('/jig-output/sessions', { mode: 0o700 })
  // Only rollout history reaches retained anonymous output. Authentication,
  // SQLite, logs and the rest of CODEX_HOME remain disposable private state.
  symlinkSync('/jig-output/sessions', `${CODEX_HOME}/sessions`)
  if (pathBytes === 0) return
  const path = new TextDecoder('utf-8', { fatal: true }).decode(readExactly(pathBytes))
  if (!/^sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[0-9T-]+-[0-9a-f-]{36}\.jsonl(?![\s\S])/.test(path))
    throw new Error('Codex session path is invalid')
  const target = `/jig-output/${path}`
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const descriptor = openSync(target, 'wx', 0o600)
  try {
    writeExactly(descriptor, readExactly(contentBytes))
  } finally {
    closeSync(descriptor)
  }
}

function materializeCredential(): void {
  const header = readExactly(4)
  const size = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0, false)
  if (size === 0 || size > STARTUP_INPUT_BYTES - 4) {
    throw new Error('Codex startup input is invalid')
  }
  const credential = readExactly(size)
  let descriptor: number | undefined
  try {
    descriptor = openSync(CREDENTIAL_PATH, 'wx', 0o600)
    writeExactly(descriptor, credential)
  } finally {
    credential.fill(0)
    if (descriptor !== undefined) closeSync(descriptor)
  }
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
