#!/jig-runtime/bun

import { closeSync, mkdirSync, openSync, readSync, writeFileSync, writeSync } from 'node:fs'
import { spawn } from 'node:child_process'

const STARTUP_INPUT_BYTES = 64 * 1024
const PI_HOME = '/tmp/pi-home'
const PI_AGENT_DIR = '/tmp/pi-agent'
const CREDENTIAL_PATH = `${PI_AGENT_DIR}/auth.json`
const SETTINGS_PATH = `${PI_AGENT_DIR}/settings.json`
const MODELS_PATH = `${PI_AGENT_DIR}/models.json`
const NATIVE_PI_PATH = '/agent/pi'
const ADAPTER_SPECIFIER = './pi-acp.js'
const MAX_OUTPUT_TOKENS = 4_096
const PROVIDER = /^[a-z0-9][a-z0-9._-]{0,127}$/
const SELECTION = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,255}$/
const decoder = new TextDecoder('utf-8', { fatal: true })

export const PRIVATE_PI_NATIVE_ARGUMENTS = Object.freeze([
  '--mode',
  'rpc',
  '--no-session',
  '--no-tools',
  '--no-extensions',
  '--no-skills',
  '--no-prompt-templates',
  '--no-themes',
  '--no-context-files',
  '--no-approve',
  '--offline',
] as const)

export const PRIVATE_PI_SETTINGS = Object.freeze({
  defaultProjectTrust: 'never',
  enableAnalytics: false,
  enableInstallTelemetry: false,
  enableSkillCommands: false,
  extensions: Object.freeze([]),
  packages: Object.freeze([]),
  prompts: Object.freeze([]),
  quietStartup: true,
  retry: Object.freeze({
    enabled: false,
    maxRetries: 0,
    provider: Object.freeze({ maxRetries: 0 }),
  }),
  skills: Object.freeze([]),
  themes: Object.freeze([]),
  compaction: Object.freeze({ enabled: false }),
  images: Object.freeze({ blockImages: true }),
})

if (import.meta.main) await main()

async function main(): Promise<void> {
  const startup = process.env.JIG_PI_STARTUP_INPUT
  if (startup === undefined) {
    await launchNativePi()
    return
  }
  if (startup !== 'api-key' && startup !== 'subscription') {
    throw new Error('Pi startup input mode is invalid')
  }

  const provider = requireProvider(process.env.JIG_PI_PROVIDER)
  const model = requireSelection(process.env.JIG_PI_MODEL, 'Pi model')
  mkdirSync(PI_HOME, { recursive: false, mode: 0o700 })
  mkdirSync(PI_AGENT_DIR, { recursive: false, mode: 0o700 })
  materializeCredential(provider, startup === 'api-key' ? 'api_key' : 'oauth')
  writeFileSync(SETTINGS_PATH, JSON.stringify(PRIVATE_PI_SETTINGS), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  writeFileSync(MODELS_PATH, JSON.stringify(privatePiModels(provider, model)), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })

  delete process.env.JIG_PI_STARTUP_INPUT
  await import(ADAPTER_SPECIFIER)
}

export function privatePiModels(provider: string, model: string): unknown {
  return {
    providers: {
      [requireProvider(provider)]: {
        modelOverrides: {
          [requireSelection(model, 'Pi model')]: { maxTokens: MAX_OUTPUT_TOKENS },
        },
      },
    },
  }
}

function materializeCredential(provider: string, type: 'api_key' | 'oauth'): void {
  const header = readExactly(4)
  const size = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0, false)
  if (size === 0 || size > STARTUP_INPUT_BYTES - 4) {
    throw new Error('Pi startup input is invalid')
  }
  const credential = readExactly(size)
  let descriptor: number | undefined
  try {
    const parsed = JSON.parse(decoder.decode(credential)) as unknown
    if (!isRecord(parsed) || !exactKeys(parsed, [provider])) {
      throw new Error('Pi startup input is invalid')
    }
    const entry = parsed[provider]
    if (!isRecord(entry) || entry.type !== type) {
      throw new Error('Pi startup input is invalid')
    }
    descriptor = openSync(CREDENTIAL_PATH, 'wx', 0o600)
    writeExactly(descriptor, credential)
  } catch {
    throw new Error('Pi startup input is invalid')
  } finally {
    credential.fill(0)
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

async function launchNativePi(): Promise<void> {
  if (process.argv.slice(2).join('\0') !== ['--mode', 'rpc', '--no-themes'].join('\0')) {
    throw new Error('pi-acp native invocation is invalid')
  }
  const provider = requireProvider(process.env.JIG_PI_PROVIDER)
  const model = requireSelection(process.env.JIG_PI_MODEL, 'Pi model')
  const child = spawn(
    NATIVE_PI_PATH,
    [...PRIVATE_PI_NATIVE_ARGUMENTS, '--provider', provider, '--model', model],
    {
      cwd: '/work',
      env: process.env,
      stdio: 'inherit',
    },
  )
  const forward = (signal: NodeJS.Signals): void => {
    if (!child.killed) child.kill(signal)
  }
  process.once('SIGINT', forward)
  process.once('SIGTERM', forward)
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal === null ? 1 : 128)))
  })
  process.removeListener('SIGINT', forward)
  process.removeListener('SIGTERM', forward)
  process.exitCode = exitCode
}

function readExactly(size: number): Uint8Array {
  const result = new Uint8Array(size)
  let offset = 0
  while (offset < result.byteLength) {
    const count = readSync(0, result, offset, result.byteLength - offset, null)
    if (count === 0) throw new Error('Pi startup input ended early')
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

function requireProvider(value: unknown): string {
  if (typeof value !== 'string' || !PROVIDER.test(value)) {
    throw new Error('Pi provider is invalid')
  }
  return value
}

function requireSelection(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SELECTION.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
