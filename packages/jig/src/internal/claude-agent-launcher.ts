import { readSync } from 'node:fs'

const STARTUP_INPUT_BYTES = 64 * 1024
const MAX_TOKEN_BYTES = 16 * 1024
const MAX_OUTPUT_TOKENS = '1024'
const ADAPTER_SPECIFIER = './claude-agent-acp.js'
const decoder = new TextDecoder('utf-8', { fatal: true })

if (import.meta.main) await main()

async function main(): Promise<void> {
  const startup = process.env.JIG_CLAUDE_STARTUP_INPUT
  if (startup !== 'subscription' && startup !== 'api-key' && startup !== 'auth-token') {
    throw new Error('Claude startup input mode is invalid')
  }
  const bytes = readFramedToken()
  try {
    const token = decoder.decode(bytes)
    if (token.trim() !== token || token.length === 0 || token.includes('\0')) {
      throw new Error('Claude startup input is invalid')
    }
    projectPrivateClaudeCredential(process.env, startup, token)
  } finally {
    bytes.fill(0)
  }
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS
  delete process.env.JIG_CLAUDE_STARTUP_INPUT
  await import(ADAPTER_SPECIFIER)
}

/** Project exactly one credential scheme into the otherwise empty client environment. */
export function projectPrivateClaudeCredential(
  environment: Record<string, string | undefined>,
  startup: 'subscription' | 'api-key' | 'auth-token',
  token: string,
): void {
  delete environment.CLAUDE_CODE_OAUTH_TOKEN
  delete environment.ANTHROPIC_API_KEY
  delete environment.ANTHROPIC_AUTH_TOKEN
  if (startup === 'subscription') {
    environment.CLAUDE_CODE_OAUTH_TOKEN = token
  } else if (startup === 'api-key') {
    environment.ANTHROPIC_API_KEY = token
  } else {
    // Bearer-token endpoints require the API-key channel to be explicitly
    // blank so Claude Code cannot select it by precedence.
    environment.ANTHROPIC_API_KEY = ''
    environment.ANTHROPIC_AUTH_TOKEN = token
  }
}

function readFramedToken(): Uint8Array {
  const header = readExactly(4)
  const size = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0, false)
  if (size === 0 || size > MAX_TOKEN_BYTES || size > STARTUP_INPUT_BYTES - 4) {
    throw new Error('Claude startup input is invalid')
  }
  return readExactly(size)
}

function readExactly(size: number): Uint8Array {
  const result = new Uint8Array(size)
  let offset = 0
  while (offset < result.byteLength) {
    const count = readSync(0, result, offset, result.byteLength - offset, null)
    if (count === 0) throw new Error('Claude startup input ended early')
    offset += count
  }
  return result
}
