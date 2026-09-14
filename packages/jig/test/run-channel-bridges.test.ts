import { describe, expect, test } from 'bun:test'
import descriptor from '../../../docs/jig/spec/contracts/agent-run/contracts/acp-public-updates.json' with {
  type: 'json',
}
import { parseChannelContract } from '../src/channel-contract.js'
import { privateFiniteAcpChannelOwnerId } from '../src/internal/root-finite-acp-controller.js'
import {
  channelContractResolver,
  type PrivateChannelContractCache,
  type PrivateRunChannelOutput,
  PrivateRunChannels,
} from '../src/internal/run-channels.js'
import { canonicalJson, type JsonValue } from '../src/json.js'
import type { CapturedPackage } from '../src/package/capture.js'
import type { InspectedPackage } from '../src/package/inspect.js'
import { ChannelBroker, type ResolvedChannelContract } from '../src/run/channels.js'
const parsed = parseChannelContract(canonicalJson(descriptor as JsonValue))
const ACP_PUBLIC_UPDATES: ResolvedChannelContract = {
  identity: { id: parsed.descriptor.id, version: parsed.descriptor.version, digest: parsed.digest },
  schema: parsed.descriptor.item,
  validate(value) {
    parsed.itemSchema.validate(value)
  },
}

describe('ordinary command channel bridges', () => {
  test('Finite resource channel scope keys cannot collide across root, siblings, or delimiters', () => {
    const scopes = [
      privateFiniteAcpChannelOwnerId(undefined, 'a:b'),
      privateFiniteAcpChannelOwnerId('a', 'b'),
      privateFiniteAcpChannelOwnerId('a:b', 'c'),
      privateFiniteAcpChannelOwnerId('a', 'b:c'),
      privateFiniteAcpChannelOwnerId('root', 'a:b'),
      privateFiniteAcpChannelOwnerId('left', 'same'),
      privateFiniteAcpChannelOwnerId('right', 'same'),
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
    const packageFacts = inspected()
    const context = await PrivateRunChannels.open(
      captured(),
      {
        ...packageFacts,
        invocation: {
          ...packageFacts.invocation!,
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
    entrypoint: { path: 'FLOW.ts', suffix: 'ts' },
    metadata: {
      name: 'test',
      description: 'test',
      extensions: {},
      unknownFields: {},
    },
    invocation: {
      channels: { progress: { direction: 'send' } },
      outcomes: {},
      attachments: {},
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
