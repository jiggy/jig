import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const adapter = fileURLToPath(import.meta.resolve('pi-acp'))
interface AcpResponse {
  readonly id: number
  readonly result?: {
    readonly protocolVersion?: number
    readonly sessionId?: string
    readonly stopReason?: string
  }
  readonly error?: { readonly code: number; readonly message: string }
}

// The actual installed upstream ACP adapter speaks to a local deterministic Pi
// RPC fixture. This checks adapter translation, not genuine Pi/model execution.
async function invoke(scenario: string): Promise<AcpResponse> {
  const root = await mkdtemp(join(tmpdir(), 'jig-pi-acp-failure-'))
  const fixture = join(root, 'fixture-pi')
  await writeFile(
    fixture,
    `#!${process.execPath}\n${await readFile(join(directory, 'fixtures/pi-rpc-failure.ts'), 'utf8')}`,
    { mode: 0o700 },
  )
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', adapter],
    {
      cwd: root,
      env: { HOME: root, PATH: root, PI_ACP_PI_COMMAND: fixture, PI_FAILURE_SCENARIO: scenario },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const deadline = setTimeout(() => child.kill(), 5_000)
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffered = ''
  let bytes = 0
  const stderr = (async (): Promise<string> => {
    let text = ''
    const diagnosticDecoder = new TextDecoder()
    for await (const chunk of child.stderr) {
      if (text.length + chunk.byteLength > 64 * 1024) {
        child.kill()
        return 'Pi adapter diagnostic capacity exceeded'
      }
      text += diagnosticDecoder.decode(chunk, { stream: true })
    }
    return text
  })()
  async function request(id: number, method: string, params: unknown): Promise<AcpResponse> {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    await child.stdin.flush()
    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline >= 0) {
        const frame = JSON.parse(buffered.slice(0, newline))
        buffered = buffered.slice(newline + 1)
        if (frame.id === id) return frame
        continue
      }
      const part = await reader.read()
      if (part.done) throw new Error(`Pi adapter ended before response: ${await stderr}`)
      bytes += part.value.byteLength
      if (bytes > 128 * 1024) throw new Error('Pi adapter fixture exceeded bounded output')
      buffered += decoder.decode(part.value, { stream: true })
    }
  }
  try {
    expect(
      (await request(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} })).result
        ?.protocolVersion,
    ).toBe(1)
    const opened = await request(2, 'session/new', { cwd: root, mcpServers: [] })
    expect(opened.error).toBeUndefined()
    return await request(3, 'session/prompt', {
      sessionId: opened.result?.sessionId,
      prompt: [{ type: 'text', text: 'bounded fixture request' }],
    })
  } finally {
    await child.stdin.end()
    await child.exited
    clearTimeout(deadline)
    await reader.cancel()
    await stderr
    await rm(root, { recursive: true, force: true })
  }
}

for (const scenario of ['rpc-error', 'rpc-error-racing-settlement', 'assistant-error']) {
  test(`Pi ACP preserves ${scenario} as an error, including partial output`, async () => {
    const result = await invoke(scenario)
    expect(result.result).toBeUndefined()
    expect(result.error).toMatchObject({
      code: -32603,
      message: 'Internal error: Pi prompt failed',
    })
    expect(JSON.stringify(result)).not.toContain('private-provider-detail')
  })
}

for (const [scenario, reason] of [
  ['empty-success', 'end_turn'],
  ['recovered-error', 'end_turn'],
  ['assistant-aborted', 'cancelled'],
  ['assistant-length', 'max_tokens'],
]) {
  test(`Pi ACP preserves ${scenario} without an empty-text heuristic`, async () => {
    const result = await invoke(scenario!)
    expect(result.error).toBeUndefined()
    expect(result.result).toEqual({ stopReason: reason })
  })
}
