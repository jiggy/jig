import { describe, expect, test } from 'bun:test'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { FiniteAcpFrames, fragmentFiniteAcpFrame } from '@jigging/agent-acp/transport'
import {
  PrivateFiniteAcpPolicy,
  PrivateFiniteAcpPolicyError,
} from '../../src/internal/finite-acp-policy.js'
import { assertPrivateFiniteAcpPublicOutput } from '../../src/internal/finite-acp-resource.js'
import type { JsonObject } from '../../src/json.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

const encoder = new TextEncoder()
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value))

// The resource API requires a genuine native component and branded enforcement
// receipt. Ordinary children cannot enter that API. These tests cover its
// production policy/framing dependencies, never native-resource completion.
function peer(mode = 'dialogue', client?: string, maxTurns = 1) {
  const child = Bun.spawn(
    [installedBunLocation.executablePath, `${import.meta.dir}/../finite-acp-peer.fixture.ts`, mode],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  )
  let expired = false
  const watchdog = setTimeout(() => {
    expired = true
    child.kill('SIGKILL')
  }, 4_000)
  const completion = child.exited.then((exitCode) => {
    clearTimeout(watchdog)
    return { exitCode, signal: child.signalCode, fenced: false }
  })
  const stderr = new Response(child.stderr).text()
  const lines = createInterface({ input: Readable.fromWeb(child.stdout) })
  const iterator = lines[Symbol.asyncIterator]()
  const policy = new PrivateFiniteAcpPolicy({ maxTurns }, client)
  const exposed: JsonObject[] = []
  async function write(value: unknown) {
    child.stdin.write(`${JSON.stringify(value)}\n`)
    await child.stdin.flush()
  }
  async function request(id: number, method: string, params: unknown) {
    await write(policy.fromAdapter(bytes({ jsonrpc: '2.0', id, method, params })))
  }
  async function next() {
    const line = await iterator.next()
    if (line.done) return undefined
    const delivery = policy.fromClient(encoder.encode(line.value))
    if (delivery.toClient) await write(delivery.toClient)
    if (delivery.toAdapter) {
      // Exercise the actual finite channel frame codec without a replacement broker.
      const frames = new FiniteAcpFrames('responses')
      let decoded: string | undefined
      for (const fragment of fragmentFiniteAcpFrame(JSON.stringify(delivery.toAdapter)))
        decoded = frames.accept(fragment)
      frames.finish()
      if (decoded === undefined) throw new Error('response frame did not finish')
      expect(JSON.parse(decoded)).toEqual(delivery.toAdapter)
      exposed.push(delivery.toAdapter)
    }
    return delivery
  }
  async function initialize() {
    await request(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} })
    expect((await next())?.toAdapter?.result).toEqual({
      protocolVersion: 1,
      agentCapabilities: {},
    })
    await request(2, 'session/new', { cwd: '/work', mcpServers: [] })
    expect((await next())?.toAdapter?.result).toEqual({ sessionId: 'owned' })
  }
  async function prompt(id = 3) {
    await request(id, 'session/prompt', {
      sessionId: 'owned',
      prompt: [{ type: 'text', text: 'Answer once.' }],
    })
    expect((await next())?.toClient?.result).toEqual({ outcome: { outcome: 'cancelled' } })
    expect((await next())?.toAdapter?.method).toBe('session/update')
    expect((await next())?.toAdapter?.result).toEqual({ stopReason: 'end_turn' })
  }
  return {
    child,
    completion,
    stderr,
    policy,
    exposed,
    request,
    next,
    initialize,
    prompt,
    async close() {
      await child.stdin.end()
      return completion
    },
    async dispose() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await completion
      lines.close()
      await stderr
      expect(expired).toBe(false)
    },
  }
}

describe('finite ACP resource dependencies with actual bounded wire peers', () => {
  test('rejects literal and JSON-escaped credentials in nested public projections', () => {
    const secret = 'credential-"\\-é'
    const escaped = JSON.stringify(secret).slice(1, -1)
    const patterns = [encoder.encode(secret), encoder.encode(escaped)]
    try {
      for (const text of [secret, escaped]) {
        expect(() => assertPrivateFiniteAcpPublicOutput({ content: { text } }, patterns)).toThrow(
          'Native ACP output contained a private credential',
        )
      }
      expect(() =>
        assertPrivateFiniteAcpPublicOutput({ content: { text: 'ordinary answer' } }, patterns),
      ).not.toThrow()
      expect(() => assertPrivateFiniteAcpPublicOutput({ [secret]: 'value' }, patterns)).toThrow()
    } finally {
      for (const pattern of patterns) pattern.fill(0)
    }
  })

  for (const client of ['openai-codex', 'other-client']) {
    test(`native ${client} identity controls configuration-failure projection`, async () => {
      const p = peer('failed-new', client)
      try {
        await p.request(1, 'initialize', {
          protocolVersion: 1,
          clientInfo: { name: 'openai-codex' },
        })
        await p.next()
        await p.request(2, 'session/new', { cwd: '/work', mcpServers: [] })
        expect((await p.next())?.toAdapter?.error).toEqual({
          code: -32603,
          message: 'Native ACP request failed',
          ...(client === 'openai-codex'
            ? { data: { reason: 'managed-preferences-unavailable' } }
            : {}),
        })
        p.policy.assertSettled()
        expect(JSON.stringify(p.exposed)).not.toMatch(/secret-token|\/private/)
        expect(await p.close()).toEqual({ exitCode: 0, signal: null, fenced: false })
      } finally {
        await p.dispose()
      }
    })
  }
  test('ordinary dialogue denies peer permissions and strips private metadata without claiming fencing', async () => {
    const p = peer()
    try {
      await p.initialize()
      await p.prompt()
      expect(p.policy.settledSessionId).toBe('owned')
      expect(JSON.stringify(p.exposed)).not.toMatch(/secret|private|authenticate|token/)
      expect(await p.close()).toEqual({ exitCode: 0, signal: null, fenced: false })
      expect(await p.stderr).toBe('permission denied\n')
    } finally {
      await p.dispose()
    }
  })
  test('actual delayed clean exit is still not native fencing', async () => {
    const p = peer('slow-close')
    try {
      await p.initialize()
      await p.prompt()
      const started = performance.now()
      expect(await p.close()).toEqual({ exitCode: 0, signal: null, fenced: false })
      expect(performance.now() - started).toBeGreaterThanOrEqual(600)
    } finally {
      await p.dispose()
    }
  })
  test('a native session failure retains its closed policy cause without leaking private text', async () => {
    const p = peer('session-failure')
    try {
      await p.initialize()
      await p.request(3, 'session/prompt', {
        sessionId: 'owned',
        prompt: [{ type: 'text', text: 'Wait.' }],
      })
      const error = await p.next().catch((error: unknown) => error)
      expect(error).toBeInstanceOf(PrivateFiniteAcpPolicyError)
      expect((error as PrivateFiniteAcpPolicyError).reason).toBe('native-session')
      expect((error as PrivateFiniteAcpPolicyError).nativeCategory).toBe('connection')
      expect(String(error)).not.toContain('secret-token')
      expect(JSON.stringify(error)).not.toMatch(/secret-token|private-action/)
      expect(JSON.stringify(p.exposed)).not.toContain('secret-token')
    } finally {
      await p.dispose()
    }
  })
  for (const method of ['authenticate', 'session/load', 'session/fork', 'session/set_model']) {
    test(`rejects adapter ${method} before writing to an actual peer`, async () => {
      const p = peer()
      try {
        await p.initialize()
        await expect(p.request(3, method, { sessionId: 'owned' })).rejects.toThrow('not permitted')
        expect(await p.close()).toEqual({ exitCode: 0, signal: null, fenced: false })
      } finally {
        await p.dispose()
      }
    })
  }
  test('a second prompt is not available after the single allowed turn', async () => {
    const p = peer()
    try {
      await p.initialize()
      await p.prompt()
      await expect(p.prompt(4)).rejects.toThrow('not available')
      expect(await p.close()).toEqual({ exitCode: 0, signal: null, fenced: false })
    } finally {
      await p.dispose()
    }
  })
  for (const mode of ['malformed', 'wrong-id']) {
    test(`actual ${mode} output refuses policy advancement`, async () => {
      const p = peer(mode)
      try {
        await p.request(1, 'initialize', { protocolVersion: 1 })
        await expect(p.next()).rejects.toThrow(
          mode === 'wrong-id' ? 'matching request' : 'Invalid ACP JSON frame',
        )
        expect(p.exposed).toEqual([])
      } finally {
        await p.dispose()
      }
    })
  }
  test('actual signalled exit leaves the prompt unsettled and reports no fencing', async () => {
    const p = peer('signal')
    try {
      await p.initialize()
      await p.request(3, 'session/prompt', {
        sessionId: 'owned',
        prompt: [{ type: 'text', text: 'Wait.' }],
      })
      expect(await p.next()).toBeUndefined()
      expect(() => p.policy.assertSettled()).toThrow('not settled')
      expect(await p.completion).toMatchObject({ signal: 'SIGTERM', fenced: false })
    } finally {
      await p.dispose()
    }
  })
  test('partial channel frame EOF fails without producing a policy request', () => {
    const frames = new FiniteAcpFrames('requests')
    expect(frames.accept({ kind: 'data', text: '{', end: false })).toBeUndefined()
    expect(() => frames.finish()).toThrow()
  })
})
