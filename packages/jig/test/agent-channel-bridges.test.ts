import { describe, expect, test } from 'bun:test'
import * as acp from '@agentclientprotocol/sdk'

import descriptor from '../../../docs/jig/spec/contracts/acp-public-updates.json' with {
  type: 'json',
}
import { runPrivateAcpTurn } from '../src/internal/acp-agent-client.js'
import {
  ACP_PUBLIC_UPDATES,
  PrivateAgentUpdateChannel,
} from '../src/internal/agent-update-channel.js'
import {
  channelContractResolver,
  type PrivateChannelContractCache,
  type PrivateRunChannelOutput,
  PrivateRunChannels,
} from '../src/internal/run-channels.js'
import { privateAgentChannelOwnerId } from '../src/internal/root-agent-run-controller.js'
import { canonicalJson, type JsonValue } from '../src/json.js'
import type { CapturedPackage } from '../src/package/capture.js'
import type { InspectedPackage } from '../src/package/inspect.js'
import { ChannelBroker } from '../src/run/channels.js'

describe('private Agent and command channel bridges', () => {
  test('forwards an unused named writer through a child to its own Agent scope', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root', { resolveContract: () => ACP_PUBLIC_UPDATES })
    const children = ['left', 'right'].map((name) => broker.participant(`flow:${name}`))
    const values = await Promise.all(
      children.map(async (child) => {
        const pair = await root.create({ contract: './events.json' })
        const incoming = root.transfer(
          child,
          { events: pair.send.endpoint },
          {
            events: { direction: 'send', contract: ACP_PUBLIC_UPDATES },
          },
        )
        const agent = broker.participant(privateAgentChannelOwnerId(child.id, 'answer'))
        child.transfer(
          agent,
          { events: incoming.events!.endpoint },
          {
            events: { direction: 'send', contract: ACP_PUBLIC_UPDATES },
          },
        )
        await expect(
          child.send(incoming.events!.endpoint, update('unauthorized')),
        ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
        const updates = new PrivateAgentUpdateChannel(
          agent,
          pair.send.endpoint,
          new AbortController().signal,
        )
        const result = await runPrivateAcpTurn(
          deterministicAgent(async (client, sessionId) => {
            await message(client, sessionId, child.id)
            return 'end_turn'
          }),
          { cwd: '/work', instructions: 'answer', onPublicUpdate: (value) => updates.offer(value) },
        )
        await updates.finish()
        agent.finalize(true)
        child.finalize(true)
        // The creator is still root: leaf completion does not revoke this sealed prefix.
        const observed = await root.next(pair.receive.endpoint)
        expect(await root.next(pair.receive.endpoint)).toEqual({ end: { lastSequence: 1 } })
        return { result, observed }
      }),
    )
    expect(values.map((value) => value.result.text)).toEqual(['flow:left', 'flow:right'])
    expect(values.map((value) => value.observed)).toEqual(
      ['flow:left', 'flow:right'].map((text) => ({
        item: { sequence: 1, value: update(text) },
      })),
    )
    root.finalize(true)
  })

  test('Agent channel scope keys cannot collide across root, siblings, or delimiters', () => {
    const scopes = [
      privateAgentChannelOwnerId(undefined, 'a:b'),
      privateAgentChannelOwnerId('a', 'b'),
      privateAgentChannelOwnerId('a:b', 'c'),
      privateAgentChannelOwnerId('a', 'b:c'),
      privateAgentChannelOwnerId('root', 'a:b'),
      privateAgentChannelOwnerId('left', 'same'),
      privateAgentChannelOwnerId('right', 'same'),
    ]
    expect(new Set(scopes).size).toBe(scopes.length)
  })

  test('an exact child map mismatch leaves all offered rights with its caller', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root', { resolveContract: () => ACP_PUBLIC_UPDATES })
    const child = broker.participant('child')
    const first = await root.create({ schema: { type: 'string' } })
    const second = await root.create({ contract: './events.json' })
    const wrong = {
      ...ACP_PUBLIC_UPDATES,
      identity: { ...ACP_PUBLIC_UPDATES.identity, digest: `sha256:${'0'.repeat(64)}` },
    }
    expect(() =>
      root.transfer(
        child,
        { first: first.send.endpoint, events: second.send.endpoint },
        {
          first: { direction: 'send', schema: { type: 'string' } },
          events: { direction: 'send', contract: wrong },
        },
      ),
    ).toThrow('contract identity differs')
    await root.send(first.send.endpoint, 'still held')
    root.close(first.send.endpoint)
    expect(await root.next(first.receive.endpoint)).toEqual({
      item: { sequence: 1, value: 'still held' },
    })
    expect(await root.next(first.receive.endpoint)).toEqual({ end: { lastSequence: 1 } })
    const corrected = root.transfer(
      child,
      { events: second.send.endpoint },
      {
        events: { direction: 'send', contract: ACP_PUBLIC_UPDATES },
      },
    )
    child.close(corrected.events!.endpoint)
    child.finalize(true)
    expect(await root.next(second.receive.endpoint)).toEqual({ end: { lastSequence: 0 } })
    root.finalize(true)
  })

  test('package-local contract caches share one root bound across child invocations', async () => {
    const contracts: PrivateChannelContractCache = new Map()
    let reads = 0
    const packageAt = (digest: string): CapturedPackage => ({
      ...captured(),
      digest,
      async read(path) {
        reads++
        return captured().read(path)
      },
    })
    for (let i = 0; i < 16; i++)
      await channelContractResolver(packageAt(`package-${i}`), contracts)('./events.json')
    expect(reads).toBe(16)
    await channelContractResolver(packageAt('package-0'), contracts)('./events.json')
    expect(reads).toBe(16)
    expect(() =>
      channelContractResolver(packageAt('package-16'), contracts)('./events.json'),
    ).toThrow('cache limit reached')
    expect(reads).toBe(16)
  })

  test('projects genuine pre-terminal ACP messages through application filtering without a private echo', async () => {
    const records: JsonValue[] = []
    const context = await PrivateRunChannels.open(captured(), inspected(), output(records))
    const pair = await context.root.create({ contract: './events.json' })
    const provider = context.broker.participant('provider')
    context.root.transfer(
      provider,
      { events: pair.send.endpoint },
      { events: { direction: 'send', contract: ACP_PUBLIC_UPDATES } },
    )
    const updates = new PrivateAgentUpdateChannel(
      provider,
      pair.send.endpoint,
      new AbortController().signal,
    )
    const gate = deferred<void>()
    const visible = deferred<void>()
    let complete = false
    const agent = deterministicAgent(async (client, sessionId) => {
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'private thought' },
        },
      })
      await message(client, sessionId, 'hidden')
      await message(client, sessionId, 'visible')
      await gate.promise
      return 'end_turn'
    })
    const work = runPrivateAcpTurn(agent, {
      cwd: '/work',
      instructions: 'answer',
      onPublicUpdate: (value) => updates.offer(value),
    }).then(async (result) => {
      await updates.finish()
      provider.finalize(true)
      complete = true
      return result
    })
    const observing = (async () => {
      for (;;) {
        const record = (await context.root.next(pair.receive.endpoint)) as {
          item?: { value: { content?: { text: string } } }
          end?: unknown
        }
        if (record.end !== undefined) return
        if (record.item?.value.content?.text === 'visible') {
          await context.root.send(context.grants.progress!.endpoint, { text: 'visible' })
          visible.resolve()
        }
      }
    })()
    await visible.promise
    expect(complete).toBe(false)
    gate.resolve()
    const result = await work
    await observing
    expect(result).toEqual({ stopReason: 'end_turn', text: 'hiddenvisible' })
    context.root.finalize(true)
    await context.settle()
    expect(records).toEqual([
      { type: 'begin', channel: 'progress', startSequence: 1 },
      { type: 'data', channel: 'progress', sequence: 1, value: { text: 'visible' } },
      { type: 'end', channel: 'progress', status: 'closed', lastSequence: 1 },
    ])
    expect(JSON.stringify(records)).not.toContain('private thought')
    expect(JSON.stringify(records)).not.toContain('hidden')
  })

  test('bounded native ingress failure does not stall the actual ACP final result', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root', { resolveContract: () => ACP_PUBLIC_UPDATES })
    const provider = broker.participant('provider')
    const pair = await root.create({ contract: './events.json' })
    root.transfer(
      provider,
      { events: pair.send.endpoint },
      { events: { direction: 'send', contract: ACP_PUBLIC_UPDATES } },
    )
    const updates = new PrivateAgentUpdateChannel(
      provider,
      pair.send.endpoint,
      new AbortController().signal,
    )
    const agent = deterministicAgent(async (client, sessionId) => {
      for (let i = 0; i < 48; i++) await message(client, sessionId, 'x')
      return 'end_turn'
    })
    const result = await runPrivateAcpTurn(agent, {
      cwd: '/work',
      instructions: 'answer',
      onPublicUpdate: (value) => updates.offer(value),
    })
    expect(result).toEqual({ stopReason: 'end_turn', text: 'x'.repeat(48) })
    await updates.finish()
    provider.finalize(true)
    await expect(root.next(pair.receive.endpoint)).rejects.toMatchObject({ code: 'LAGGED' })
    root.finalize(true)
  })

  test('root pending-send pressure cannot turn dropped Agent updates into clean EOF', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root', { resolveContract: () => ACP_PUBLIC_UPDATES })
    const provider = broker.participant('provider')
    const blocked = await root.create()
    for (let i = 0; i < 16; i++) await root.send(blocked.send.endpoint, i)
    const pending = Array.from({ length: 16 }, () =>
      root.send(blocked.send.endpoint, 0).catch((error) => error),
    )
    const pair = await root.create({ contract: './events.json' })
    root.transfer(
      provider,
      { events: pair.send.endpoint },
      { events: { direction: 'send', contract: ACP_PUBLIC_UPDATES } },
    )
    for (let i = 0; i < 16; i++) await provider.send(pair.send.endpoint, update('buffered'))
    const updates = new PrivateAgentUpdateChannel(
      provider,
      pair.send.endpoint,
      new AbortController().signal,
    )
    updates.offer(update('not accepted'))
    await updates.finish()
    provider.finalize(true)
    await expect(root.next(pair.receive.endpoint)).rejects.toMatchObject({
      code: 'RESOURCE_EXHAUSTED',
    })
    root.release(blocked.receive.endpoint)
    await Promise.all(pending)
    root.finalize(true)
  })

  test('cancellation settles a blocked native update pump without replay or fake end', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root', { resolveContract: () => ACP_PUBLIC_UPDATES })
    const provider = broker.participant('provider')
    const pair = await root.create({ contract: './events.json' })
    root.transfer(
      provider,
      { events: pair.send.endpoint },
      { events: { direction: 'send', contract: ACP_PUBLIC_UPDATES } },
    )
    const controller = new AbortController()
    const updates = new PrivateAgentUpdateChannel(provider, pair.send.endpoint, controller.signal)
    for (let i = 0; i < 16; i++) await provider.send(pair.send.endpoint, update('before'))
    updates.offer(update('waiting'))
    controller.abort()
    await updates.finish()
    await expect(root.next(pair.receive.endpoint)).rejects.toMatchObject({ code: 'CANCELLED' })
    provider.finalize(false)
    root.finalize(true)
  })

  test('a rejected end write is not followed by a contradictory second end', async () => {
    const records: JsonValue[] = []
    const context = await PrivateRunChannels.open(captured(), inspected(), {
      ...output(records),
      async record(value) {
        records.push(value)
        if ((value as { type?: string }).type === 'end') throw new Error('output disconnected')
      },
    })
    context.root.close(context.grants.progress!.endpoint)
    context.root.finalize(true)
    await expect(context.settle()).rejects.toThrow('output disconnected')
    expect(records.filter((value) => (value as { type?: string }).type === 'end')).toHaveLength(1)
  })

  test('all selected root ports reject before any stream becomes visible', async () => {
    const records: JsonValue[] = []
    await expect(
      PrivateRunChannels.open(captured(), inspected(), {
        ...output(records),
        receive: ['progress', 'missing'],
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(records).toEqual([])
    await expect(PrivateRunChannels.open(captured(), inspected())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  test('a selected broadcast root output subscribes before dispatch and drains independently', async () => {
    const records: JsonValue[] = []
    const visible = deferred<void>()
    const metadata = inspected()
    const context = await PrivateRunChannels.open(
      captured(),
      {
        ...metadata,
        metadata: {
          ...metadata.metadata,
          channels: { progress: { direction: 'send', delivery: 'broadcast' } },
        },
      },
      {
        ...output(records),
        async record(value) {
          records.push(value)
          if ((value as { type?: string }).type === 'data') visible.resolve()
        },
      },
    )
    expect(context.grants.progress!.delivery).toBe('broadcast')
    await context.root.send(context.grants.progress!.endpoint, { phase: 'working' })
    await visible.promise
    expect(records).toContainEqual({
      type: 'data',
      channel: 'progress',
      sequence: 1,
      value: { phase: 'working' },
    })
    context.root.close(context.grants.progress!.endpoint)
    context.root.finalize(true)
    await context.settle()
    expect(records).toEqual([
      { type: 'begin', channel: 'progress', startSequence: 1 },
      { type: 'data', channel: 'progress', sequence: 1, value: { phase: 'working' } },
      { type: 'end', channel: 'progress', status: 'closed', lastSequence: 1 },
    ])
  })
})

function update(text: string): JsonValue {
  return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }
}
function output(records: JsonValue[]): PrivateRunChannelOutput {
  return {
    receive: ['progress'],
    record: async (value) => {
      records.push(value)
    },
    diagnostic: () => undefined,
  }
}
function captured(): CapturedPackage {
  return {
    sourceLabel: 'test captured package',
    files: [],
    digest: 'test',
    async read(path) {
      if (path !== 'events.json') throw new Error('unexpected captured read')
      return canonicalJson(descriptor as JsonValue)
    },
    async readPrefix() {
      throw new Error('unexpected prefix read')
    },
    stream() {
      throw new Error('unexpected stream read')
    },
    async dispose() {},
  }
}
function inspected(): InspectedPackage {
  return {
    digest: 'test',
    mode: 'run',
    metadata: {
      name: 'test',
      description: 'test',
      extensions: {},
      channels: { progress: { direction: 'send' } },
    },
    schemas: {},
    usedContracts: [],
    fileCount: 0,
    contentBytes: 0,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function deterministicAgent(
  turn: (client: acp.AgentContext, sessionId: string) => Promise<acp.StopReason>,
): acp.AgentApp {
  return acp
    .agent({ name: 'jig-channel-test-agent' })
    .onRequest(acp.methods.agent.initialize, ({ params }) => ({
      protocolVersion: params.protocolVersion,
      agentCapabilities: { loadSession: false },
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'test-session' }))
    .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => ({
      stopReason: await turn(client, params.sessionId),
    }))
}
async function message(client: acp.AgentContext, sessionId: string, text: string) {
  await client.notify(acp.methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  })
}
