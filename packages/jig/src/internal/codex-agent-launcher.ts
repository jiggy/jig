import { closeSync, mkdirSync, openSync, readSync, writeSync } from 'node:fs'

const STARTUP_INPUT_BYTES = 64 * 1024
const CODEX_HOME = '/tmp/codex-home'
const CREDENTIAL_PATH = `${CODEX_HOME}/auth.json`
const ADAPTER_SPECIFIER = './codex-acp.js'

if (import.meta.main) await main()

async function main(): Promise<void> {
  mkdirSync(CODEX_HOME, { mode: 0o700 })
  const startup = process.env.JIG_CODEX_STARTUP_INPUT
  if (startup !== undefined && startup !== 'subscription') {
    throw new Error('Codex startup input mode is invalid')
  }
  if (startup === 'subscription') materializeCredential()
  delete process.env.JIG_CODEX_STARTUP_INPUT
  await import(ADAPTER_SPECIFIER)
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
