import { describe, expect, test } from 'bun:test'
import { FiniteAcpFrames, fragmentFiniteAcpFrame } from '@jigging/agent-acp/transport'
import type { PrivateAcpAgentRuntime } from '../src/internal/acp-agent-provider.js'
import {
  PRIVATE_FINITE_ACP_CHANNELS,
  runPrivateFiniteAcpResource,
} from '../src/internal/finite-acp-resource.js'
import type {
  PrivateLinuxComponentProcess,
  PrivateLinuxConfirmedEnforcementReceipt,
} from '../src/internal/linux-rootless-backend.js'
import type { JsonObject, JsonValue } from '../src/json.js'
import { ChannelBroker } from '../src/run/channels.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const runtime: PrivateAcpAgentRuntime = {
  adapterPath: '/private/adapter',
  sandboxAdapterPath: '/adapter',
  adapterExecutable: false,
  executablePath: '/private/client',
  sandboxExecutablePath: '/client',
  environment: {},
  configuration: [],
  nestedUserNamespaces: false,
  readOnlyMounts: [],
}

class Queue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiters: ((value: IteratorResult<T>) => void)[] = []
  private ended = false
  push(item: T): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ done: false, value: item })
    else this.items.push(item)
  }
  close(): void {
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined })
  }
  async next(): Promise<IteratorResult<T>> {
    if (this.items.length) return { done: false, value: this.items.shift()! }
    if (this.ended) return { done: true, value: undefined }
    return new Promise((resolve) => this.waiters.push(resolve))
  }
  [Symbol.asyncIterator]() {
    return this
  }
}

interface FakeOptions {
  hangOnClose?: boolean
  closeDelayMs?: number
  hangPrompt?: boolean
  malformed?: boolean
  failedAuth?: boolean
  wrongInitializeId?: boolean
  hangAuth?: boolean
}
function component(options: FakeOptions = {}) {
  const stdout = new Queue<Uint8Array>()
  const stderr = new Queue<Uint8Array>()
  const writes: JsonObject[] = []
  const bootstrap: string[] = []
  let terminated = 0
  let permissionCount = 0
  let ended = false
  let inputClosed!: () => void
  const closing = new Promise<void>((resolve) => {
    inputClosed = resolve
  })
  let authenticationStarted!: () => void
  const authenticating = new Promise<void>((resolve) => {
    authenticationStarted = resolve
  })
  let resolve!: (receipt: PrivateLinuxConfirmedEnforcementReceipt) => void
  const enforcement = new Promise<PrivateLinuxConfirmedEnforcementReceipt>((done) => {
    resolve = done
  })
  const emit = (value: unknown): void => stdout.push(encoder.encode(`${JSON.stringify(value)}\n`))
  const settle = (closed: boolean): void => {
    if (ended) return
    ended = true
    stdout.close()
    stderr.close()
    // Deliberately fake receipt: this suite proves transport, not kernel fencing.
    resolve({
      stopReason: closed ? 'cancelled' : 'payload_exit',
      exitCode: closed ? null : 0,
      signal: closed ? 'SIGTERM' : null,
    } as PrivateLinuxConfirmedEnforcementReceipt)
  }
  const process = {
    stdout,
    stderr,
    enforcement,
    async write(bytes: Uint8Array) {
      const text = decoder.decode(bytes)
      if (text === 'private-bootstrap\n') {
        bootstrap.push(text)
        return
      }
      const value = JSON.parse(text) as JsonObject
      writes.push(value)
      if (options.malformed) {
        stdout.push(encoder.encode('not-json\n'))
        return
      }
      const reply = (result: unknown) => emit({ jsonrpc: '2.0', id: value.id, result })
      switch (value.method) {
        case 'initialize':
          if (options.wrongInitializeId) {
            emit({
              jsonrpc: '2.0',
              id: 'unrequested',
              result: { protocolVersion: 1, authMethods: [{ id: 'token' }] },
            })
            break
          }
          reply({
            protocolVersion: 1,
            agentCapabilities: {},
            authMethods: [{ id: 'token', description: 'private-auth-description' }],
            _meta: { secret: 'private-server-meta' },
          })
          break
        case 'authenticate':
          authenticationStarted()
          if (options.hangAuth) break
          if (options.failedAuth)
            emit({
              jsonrpc: '2.0',
              id: value.id,
              error: { code: -1, message: 'secret-auth-failure' },
            })
          else reply({})
          break
        case 'session/new':
          reply({ sessionId: 'owned', _meta: { secret: 'private-session' } })
          break
        case 'session/prompt':
          if (options.hangPrompt) break
          emit({
            jsonrpc: '2.0',
            id: permissionCount++ === 0 ? 'permission' : `permission-${permissionCount}`,
            method: 'session/request_permission',
            params: { sessionId: 'foreign', options: [{ optionId: 'allow' }] },
          })
          emit({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'owned',
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'answer', _meta: { secret: 'not-public' } },
              },
            },
          })
          reply({ stopReason: 'end_turn', _meta: { secret: 'private-result' } })
          break
      }
    },
    async closeInput() {
      inputClosed()
      if (!options.hangOnClose) {
        if (options.closeDelayMs) setTimeout(() => settle(false), options.closeDelayMs)
        else settle(false)
      }
    },
    async terminate() {
      terminated++
      settle(true)
    },
  } as unknown as PrivateLinuxComponentProcess
  return {
    process,
    writes,
    bootstrap,
    emit,
    stdout,
    authenticating,
    closing,
    terminated: () => terminated,
  }
}

async function fixture(options: FakeOptions = {}, selected = runtime, maxTurns = 1) {
  const broker = new ChannelBroker()
  const app = broker.participant('app', {
    resolveContract: (path) =>
      PRIVATE_FINITE_ACP_CHANNELS[path === './requests.json' ? 'requests' : 'responses']!.contract!,
  })
  const owner = broker.participant('resource')
  const requests = await app.create({ contract: './requests.json' })
  const responses = await app.create({ contract: './responses.json' })
  const grants = app.transfer(
    owner,
    { requests: requests.receive.endpoint, responses: responses.send.endpoint },
    PRIVATE_FINITE_ACP_CHANNELS,
  )
  const native = component(options)
  const abort = new AbortController()
  const resource = runPrivateFiniteAcpResource(
    native.process,
    selected,
    { owner, requests: grants.requests!.endpoint, responses: grants.responses!.endpoint },
    abort.signal,
    maxTurns,
  )
  void resource.catch(() => undefined)
  const frames = new FiniteAcpFrames('responses')
  const exposed: JsonValue[] = []
  const next = async (): Promise<JsonObject | undefined> => {
    for (;;) {
      const record = (await app.next(responses.receive.endpoint)) as JsonObject
      if (record.end !== undefined) {
        frames.finish()
        return undefined
      }
      const item = (record.item as JsonObject).value as JsonObject
      exposed.push(item)
      if (item.kind === 'ready') return item
      const text = frames.accept(item)
      if (text !== undefined) return JSON.parse(text)
    }
  }
  const send = async (value: unknown): Promise<void> => {
    for (const fragment of fragmentFiniteAcpFrame(JSON.stringify(value)))
      await app.send(requests.send.endpoint, fragment as unknown as JsonValue)
  }
  const request = (id: number, method: string, params: unknown) =>
    send({ jsonrpc: '2.0', id, method, params })
  const initialize = async (): Promise<void> => {
    expect((await next())?.kind).toBe('ready')
    await request(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} })
    expect((await next())?.result).toEqual({ protocolVersion: 1, agentCapabilities: {} })
    expect(
      (native.writes.find((frame) => frame.method === 'initialize')!.params as JsonObject)
        .clientCapabilities,
    ).toMatchObject({
      _meta: { jetbrains: { air: { version: 1, capabilities: ['sessionFailure'] } } },
    })
    await request(2, 'session/new', { cwd: '/work', mcpServers: [] })
    expect((await next())?.result).toEqual({ sessionId: 'owned' })
  }
  const prompt = async (): Promise<void> => {
    await request(3, 'session/prompt', {
      sessionId: 'owned',
      prompt: [{ type: 'text', text: 'Answer once.' }],
    })
    expect((await next())?.method).toBe('session/update')
    expect((await next())?.result).toEqual({ stopReason: 'end_turn' })
  }
  return {
    app,
    requests,
    responses,
    native,
    abort,
    resource,
    next,
    send,
    request,
    initialize,
    prompt,
    exposed,
  }
}

describe('finite ACP resource transport (fake native process)', () => {
  test('idle cancellation is consumed before a granted follow-up, never forwarded into it', async () => {
    const f = await fixture({}, runtime, 2)
    await f.initialize()
    await f.prompt()
    await f.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'owned' } })
    await f.request(4, 'session/prompt', {
      sessionId: 'owned',
      prompt: [{ type: 'text', text: 'Follow-up.' }],
    })
    expect((await f.next())?.method).toBe('session/update')
    expect((await f.next())?.result).toEqual({ stopReason: 'end_turn' })
    f.app.close(f.requests.send.endpoint)
    await f.resource
    expect(f.native.writes.filter((frame) => frame.method === 'session/prompt')).toHaveLength(2)
    expect(f.native.writes.some((frame) => frame.method === 'session/cancel')).toBe(false)
  })

  test('unsettled interruption fences native work within its control deadline', async () => {
    const f = await fixture({ hangPrompt: true }, runtime, 2)
    await f.initialize()
    await f.request(3, 'session/prompt', {
      sessionId: 'owned',
      prompt: [{ type: 'text', text: 'Wait.' }],
    })
    await f.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'owned' } })
    await expect(f.resource).rejects.toThrow()
    expect(f.native.writes.filter((frame) => frame.method === 'session/prompt')).toHaveLength(1)
  }, 10_000)

  test('ordinary dialogue retains private bootstrap/authentication and denies native permissions', async () => {
    const f = await fixture(
      {},
      {
        ...runtime,
        startupInput: () => encoder.encode('private-bootstrap\n'),
        sessionMeta: { trusted: 'private-session-policy' },
        authentication: {
          request: { methodId: 'token', _meta: { bearer: 'secret-token' } },
          clientAuthCapabilities: {},
          identity: {},
        },
      },
    )
    await f.initialize()
    await f.prompt()
    f.app.close(f.requests.send.endpoint)
    expect(await f.next()).toBeUndefined()
    expect(await f.resource).toMatchObject({
      closed: false,
      fence: { exitCode: 0, signal: null, stopReason: 'payload_exit' },
    })
    expect(f.native.bootstrap).toEqual(['private-bootstrap\n'])
    expect(f.native.writes.find((x) => x.method === 'authenticate')?.params).toEqual({
      methodId: 'token',
      _meta: { bearer: 'secret-token' },
    })
    expect(
      (f.native.writes.find((x) => x.method === 'session/new')?.params as JsonObject)._meta,
    ).toEqual({ trusted: 'private-session-policy' })
    expect(f.native.writes.find((x) => x.id === 'permission')).toEqual({
      jsonrpc: '2.0',
      id: 'permission',
      result: { outcome: { outcome: 'cancelled' } },
    })
    expect(JSON.stringify(f.exposed)).not.toMatch(/secret|private|authenticate|token/)
    expect(f.native.terminated()).toBe(0)
  })

  test('clean native shutdown can finish beyond half a second without controlled termination', async () => {
    const f = await fixture({ closeDelayMs: 650 })
    await f.initialize()
    await f.prompt()
    f.app.close(f.requests.send.endpoint)
    expect(await f.next()).toBeUndefined()
    expect(await f.resource).toMatchObject({
      closed: false,
      fence: { exitCode: 0, signal: null, stopReason: 'payload_exit' },
    })
    expect(f.native.terminated()).toBe(0)
  })

  test('settled request EOF permits bounded controlled close, preserving actual termination', async () => {
    const f = await fixture({ hangOnClose: true })
    await f.initialize()
    await f.prompt()
    f.app.close(f.requests.send.endpoint)
    expect(await f.next()).toBeUndefined()
    expect(await f.resource).toMatchObject({
      closed: true,
      fence: { exitCode: null, signal: 'SIGTERM', stopReason: 'cancelled' },
    })
    expect(f.native.terminated()).toBe(1)
  })

  for (const method of ['authenticate', 'session/load', 'session/fork', 'session/set_model']) {
    test(`rejects adapter ${method} before a native write`, async () => {
      const f = await fixture()
      await f.initialize()
      await f.request(3, method, { sessionId: 'owned' })
      await expect(f.resource).rejects.toThrow('not permitted')
      expect(f.native.writes.some((x) => x.method === method)).toBe(false)
      expect(f.native.terminated()).toBeGreaterThan(0)
    })
  }

  test('a second prompt is not forwarded after a successful first prompt', async () => {
    const f = await fixture()
    await f.initialize()
    await f.prompt()
    await f.request(4, 'session/prompt', {
      sessionId: 'owned',
      prompt: [{ type: 'text', text: 'Another.' }],
    })
    await expect(f.resource).rejects.toThrow('not available')
    expect(f.native.writes.filter((x) => x.method === 'session/prompt')).toHaveLength(1)
  })

  test('partial request EOF fails and terminates without dispatching a frame', async () => {
    const f = await fixture()
    await f.next()
    await f.app.send(f.requests.send.endpoint, { kind: 'data', text: '{', end: false })
    f.app.close(f.requests.send.endpoint)
    await expect(f.resource).rejects.toThrow('inside a frame')
    expect(f.native.writes).toEqual([])
  })

  test('native malformed output fails instead of manufacturing an Agent result', async () => {
    const f = await fixture({ malformed: true })
    await f.next()
    await f.request(1, 'initialize', { protocolVersion: 1 })
    await expect(f.resource).rejects.toThrow()
    expect(f.native.terminated()).toBeGreaterThan(0)
  })

  test('a failed private authentication never becomes a public response', async () => {
    const f = await fixture(
      { failedAuth: true },
      { ...runtime, authentication: { request: { methodId: 'token' }, identity: {} } },
    )
    await f.next()
    await f.request(1, 'initialize', { protocolVersion: 1 })
    await expect(f.resource).rejects.toThrow('Native ACP authentication failed')
    expect(f.exposed).toHaveLength(1)
    expect(f.native.writes.some((x) => x.method === 'session/new')).toBe(false)
  })

  test('an unsolicited initialization response cannot trigger private authentication', async () => {
    const f = await fixture(
      { wrongInitializeId: true },
      {
        ...runtime,
        authentication: {
          request: { methodId: 'token', _meta: { bearer: 'secret-token' } },
          identity: {},
        },
      },
    )
    await f.next()
    await f.request(1, 'initialize', { protocolVersion: 1 })
    await expect(f.resource).rejects.toThrow('matching request')
    expect(f.native.writes.some((x) => x.method === 'authenticate')).toBe(false)
  })

  test('an adapter cannot dispatch session creation while private authentication is pending', async () => {
    const f = await fixture(
      { hangAuth: true },
      { ...runtime, authentication: { request: { methodId: 'token' }, identity: {} } },
    )
    await f.next()
    await f.request(1, 'initialize', { protocolVersion: 1 })
    await f.native.authenticating
    await f.request(2, 'session/new', { cwd: '/work', mcpServers: [] })
    await expect(f.resource).rejects.toThrow('authentication is not settled')
    expect(f.native.writes.some((x) => x.method === 'session/new')).toBe(false)
  })

  test('whole invocation cancellation terminates pending native work', async () => {
    const f = await fixture({ hangPrompt: true })
    await f.initialize()
    await f.request(3, 'session/prompt', {
      sessionId: 'owned',
      prompt: [{ type: 'text', text: 'Wait.' }],
    })
    f.abort.abort()
    await expect(f.resource).rejects.toThrow()
    expect(f.native.terminated()).toBeGreaterThan(0)
  })

  test('cancellation interrupts natural-close grace without waiting for its timeout', async () => {
    const f = await fixture({ hangOnClose: true })
    await f.initialize()
    await f.prompt()
    f.app.close(f.requests.send.endpoint)
    await f.native.closing
    const started = Date.now()
    f.abort.abort()
    await expect(f.resource).rejects.toThrow()
    expect(f.native.terminated()).toBeGreaterThan(0)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  test('essential response disposal terminates native work', async () => {
    const f = await fixture()
    await f.initialize()
    f.app.release(f.responses.receive.endpoint)
    await f.request(3, 'session/prompt', {
      sessionId: 'owned',
      prompt: [{ type: 'text', text: 'Answer.' }],
    })
    await expect(f.resource).rejects.toThrow()
    expect(f.native.terminated()).toBeGreaterThan(0)
  })
})
