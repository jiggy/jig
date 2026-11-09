const suiteTestUrl = new URL('../' + import.meta.url.split('/').at(-1), import.meta.url).href

import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrivateFiniteAcpPolicy } from '../../src/internal/finite-acp-policy.js'

const directory = dirname(fileURLToPath(suiteTestUrl))
const adapter = fileURLToPath(import.meta.resolve('pi-acp'))
interface AcpResponse {
  readonly id?: number
  readonly result?: {
    readonly protocolVersion?: number
    readonly sessionId?: string
    readonly messageId?: string
    readonly stopReason?: string
  }
  readonly error?: { readonly code: number; readonly message: string }
  readonly method?: string
  readonly params?: any
}
async function invoke(scenario: string): Promise<{
  init: AcpResponse
  opened: AcpResponse
  configured: AcpResponse
  prompt: AcpResponse
  closed: AcpResponse
  notifications: AcpResponse[]
}> {
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
  const notifications: AcpResponse[] = []
  async function readFrame(): Promise<AcpResponse> {
    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline >= 0) {
        const frame = JSON.parse(buffered.slice(0, newline))
        buffered = buffered.slice(newline + 1)
        return frame
      }
      const part = await reader.read()
      if (part.done) throw new Error(`Pi adapter ended before response: ${await stderr}`)
      bytes += part.value.byteLength
      if (bytes > 128 * 1024) throw new Error('Pi adapter fixture exceeded bounded output')
      buffered += decoder.decode(part.value, { stream: true })
    }
  }
  async function request(id: number, method: string, params: unknown): Promise<AcpResponse> {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    await child.stdin.flush()
    for (;;) {
      const frame = await readFrame()
      if (frame.id === id) return frame
      if (frame.method) notifications.push(frame)
    }
  }
  try {
    const init = await request(1, 'initialize', { protocolVersion: 2, capabilities: {} })
    const opened = await request(2, 'session/new', { cwd: root, mcpServers: [] })
    const configured = await request(3, 'session/set_config_option', {
      sessionId: opened.result?.sessionId,
      configId: 'model',
      value: 'fixture/fixture-model',
    })
    const prompt = await request(4, 'session/prompt', {
      sessionId: opened.result?.sessionId,
      prompt: [{ type: 'text', text: 'bounded fixture request' }],
    })
    if (prompt.result?.messageId) {
      while (
        !notifications.some(
          (n) =>
            n.params?.update?.sessionUpdate === 'state_update' &&
            n.params?.update?.state === 'idle',
        )
      ) {
        const frame = await readFrame()
        if (frame.method) notifications.push(frame)
      }
    }
    const closed = await request(5, 'session/close', { sessionId: opened.result?.sessionId })
    return { init, opened, configured, prompt, closed, notifications }
  } finally {
    await child.stdin.end()
    await child.exited
    clearTimeout(deadline)
    await reader.cancel()
    await stderr
    await rm(root, { recursive: true, force: true })
  }
}

for (const scenario of ['rpc-error', 'rpc-error-racing-settlement']) {
  test(`Pi ACP preserves ${scenario} as an error`, async () => {
    const { init, opened, prompt, notifications } = await invoke(scenario)
    expect(init.result?.protocolVersion).toBe(2)
    expect(opened.error).toBeUndefined()
    expect(prompt.result).toBeUndefined()
    expect(prompt.error).toMatchObject({
      code: -32603,
      message: 'Internal error: Pi prompt failed',
    })
    expect(JSON.stringify(prompt)).not.toContain('private-provider-detail')
    expect(notifications.some((n) => n.params?.update?.sessionUpdate === 'user_message')).toBe(
      false,
    )
  })
}

test('Pi ACP preserves assistant-error as turn failure after prompt acceptance', async () => {
  const { init, opened, prompt, notifications } = await invoke('assistant-error')
  expect(init.result?.protocolVersion).toBe(2)
  expect(opened.error).toBeUndefined()
  expect(prompt.error).toBeUndefined()
  expect(typeof prompt.result?.messageId).toBe('string')
  const idle = notifications.find(
    (n) => n.params?.update?.sessionUpdate === 'state_update' && n.params?.update?.state === 'idle',
  )
  expect(idle?.params?.update?.stopReason).toBe('error')
  expect(JSON.stringify(notifications)).not.toContain('private-provider-detail')
})

for (const [scenario, reason] of [
  ['empty-success', 'end_turn'],
  ['recovered-error', 'end_turn'],
  ['assistant-aborted', 'cancelled'],
  ['assistant-length', 'max_tokens'],
]) {
  test(`Pi ACP preserves ${scenario} without an empty-text heuristic`, async () => {
    const { init, opened, configured, prompt, closed, notifications } = await invoke(scenario!)
    expect(init.result?.protocolVersion).toBe(2)
    expect(opened.error).toBeUndefined()
    expect(configured.error).toBeUndefined()
    expect(prompt.error).toBeUndefined()
    expect(typeof prompt.result?.messageId).toBe('string')
    expect(closed.error).toBeUndefined()
    const idle = notifications.find(
      (n) =>
        n.params?.update?.sessionUpdate === 'state_update' && n.params?.update?.state === 'idle',
    )
    expect(idle?.params?.update?.stopReason).toBe(reason)
  })
}

for (const scenario of ['empty-success', 'recovered-error', 'rpc-error'] as const) {
  test(`Pi ACP configuration and turn frames satisfy PrivateFiniteAcpPolicy: ${scenario}`, async () => {
    const encoder = new TextEncoder()
    const policy = new PrivateFiniteAcpPolicy(
      { configuration: [{ configId: 'model', value: 'fixture/fixture-model' }] },
      'pi',
    )
    const root = await mkdtemp(join(tmpdir(), 'jig-pi-acp-policy-'))
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
    const readRawFrame = async (): Promise<{ raw: string; parsed: any }> => {
      for (;;) {
        const newline = buffered.indexOf('\n')
        if (newline >= 0) {
          const raw = buffered.slice(0, newline)
          buffered = buffered.slice(newline + 1)
          return { raw, parsed: JSON.parse(raw) }
        }
        const part = await reader.read()
        if (part.done) throw new Error('Pi adapter ended unexpectedly')
        buffered += decoder.decode(part.value, { stream: true })
      }
    }
    const callThroughPolicy = async (
      frame: unknown,
      wireOverride?: (accepted: any) => unknown,
    ): Promise<any> => {
      const accepted = policy.fromAdapter(encoder.encode(JSON.stringify(frame)))
      const wire = wireOverride ? wireOverride(accepted) : accepted
      child.stdin.write(`${JSON.stringify(wire)}\n`)
      await child.stdin.flush()
      for (;;) {
        const { raw, parsed } = await readRawFrame()
        const delivery = policy.fromClient(encoder.encode(raw))
        if (parsed.id === (frame as { id: number }).id) return delivery.toAdapter
      }
    }
    try {
      const initReply = await callThroughPolicy({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: 2,
          capabilities: {},
          info: { name: 'jig-v2-client', version: '2' },
        },
      })
      expect(initReply.result.protocolVersion).toBe(2)

      const newReply = await callThroughPolicy(
        { jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/work', mcpServers: [] } },
        (accepted) => ({ ...accepted, params: { ...accepted.params, cwd: root } }),
      )
      const sessionId = newReply.result.sessionId as string
      expect(typeof sessionId).toBe('string')

      const configReply = await callThroughPolicy({
        jsonrpc: '2.0',
        id: 3,
        method: 'session/set_config_option',
        params: { sessionId, configId: 'model', type: 'id', value: 'fixture/fixture-model' },
      })
      expect(configReply.result).toEqual({
        configOptions: [
          {
            configId: 'model',
            name: 'model',
            type: 'select',
            currentValue: 'fixture/fixture-model',
            options: [{ value: 'fixture/fixture-model', name: 'fixture/fixture-model' }],
          },
        ],
      })

      const acceptedPrompt = policy.fromAdapter(
        encoder.encode(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 4,
            method: 'session/prompt',
            params: { sessionId, prompt: [{ type: 'text', text: 'bounded fixture request' }] },
          }),
        ),
      )
      child.stdin.write(`${JSON.stringify(acceptedPrompt)}\n`)
      await child.stdin.flush()

      if (scenario === 'rpc-error') {
        for (;;) {
          const { raw, parsed } = await readRawFrame()
          policy.fromClient(encoder.encode(raw))
          if (parsed.id === 4) break
        }
        expect(policy.hasExplicitPromptRejection).toBeTrue()
        expect(policy.hasAcceptedOrInsertedPrompt).toBeFalse()
      } else {
        while (policy.turnActive) {
          const { raw } = await readRawFrame()
          policy.fromClient(encoder.encode(raw))
        }
      }

      const closeReply = await callThroughPolicy({
        jsonrpc: '2.0',
        id: 5,
        method: 'session/close',
        params: { sessionId },
      })
      expect(closeReply.result).toEqual({})
      if (scenario !== 'rpc-error') expect(policy.settledSessionId).toBe(sessionId)
    } finally {
      try {
        await child.stdin.end()
      } catch {
        /* already closed */
      }
      await child.exited
      clearTimeout(deadline)
      await reader.cancel()
      await rm(root, { recursive: true, force: true })
    }
  })
}
