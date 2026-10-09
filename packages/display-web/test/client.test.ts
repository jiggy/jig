import { afterEach, expect, test } from 'bun:test'
import type { DisplayPreviewReply, DisplaySnapshot } from '@jigging/display-model'
import {
  PrivateBrowserClient,
  PrivateRevisionReader,
  privateBrowserCapability,
} from '../src/client.js'

const cap = 'a'.repeat(43)
const artifact = 'a'.repeat(64)
const clients: PrivateBrowserClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.stop()
})

function snapshot(revision: number): DisplaySnapshot {
  return {
    kind: 'snapshot',
    revision,
    mode: 'live-run',
    rootSourceId: 'root',
    workspace: {
      target: 'Original task',
      phase: 'live',
      hostStage: 'Waiting for readable evidence',
      elapsedMs: 1000,
    },
    context: 'Read only',
    omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
    views: [],
    calls: [],
    activities: [],
    journal: [],
    attention: [],
    artifacts: {
      generation: 'capture-1',
      sourceId: 'root',
      permittedAttachments: ['output'],
      provenance: 'verified-delivery',
      phase: 'ready',
      files: [],
    },
  }
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
type Pending = { path: string; init: RequestInit; resolve: (response: Response) => void }
function harness() {
  const requests: Pending[] = []
  const timers: { callback: () => void; milliseconds: number; cancelled: boolean }[] = []
  const fetcher = ((input: string | URL | Request, init: RequestInit) =>
    new Promise<Response>((resolve) => {
      requests.push({ path: String(input), init, resolve })
    })) as typeof fetch
  const client = new PrivateBrowserClient(cap, () => {}, {
    fetch: fetcher,
    random: () => 0,
    schedule(callback, milliseconds) {
      const item = { callback, milliseconds, cancelled: false }
      timers.push(item)
      return item
    },
    cancel(handle) {
      ;(handle as (typeof timers)[number]).cancelled = true
    },
  })
  clients.push(client)
  const take = (path: string) => {
    const index = requests.findIndex((item) => item.path === path)
    expect(index).toBeGreaterThanOrEqual(0)
    return requests.splice(index, 1)[0]!
  }
  const runRetry = () => {
    const item = timers.find((timer) => !timer.cancelled)!
    expect(item).toBeDefined()
    item.cancelled = true
    item.callback()
  }
  return { client, requests, timers, take, runRetry }
}
function events() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })
  return {
    response: new Response(stream),
    send(revision: number) {
      controller.enqueue(new TextEncoder().encode(`event: revision\ndata: ${revision}\n\n`))
    },
    disconnect() {
      controller.error(new Error('Disconnected'))
    },
  }
}
async function connected(revision = 1) {
  const owner = harness()
  const stream = events()
  owner.client.start()
  owner.take('/api/events').resolve(stream.response)
  owner.take('/api/snapshot').resolve(json(snapshot(revision)))
  await flush()
  expect(owner.client.connection).toBe('current')
  return { ...owner, stream }
}
function preview(text: string, generation = 'capture-1'): DisplayPreviewReply {
  return {
    artifactId: artifact,
    captureGeneration: generation,
    provenance: 'verified-delivery',
    state: 'text',
    text,
    bytes: new TextEncoder().encode(text).length,
    clipped: false,
  }
}

test('capability accepts only the exact fragment, never query-shaped alternatives', () => {
  expect(privateBrowserCapability(`#cap=${cap}`)).toBe(cap)
  for (const fragment of [
    `#cap=${cap}&x=1`,
    `#cap=${cap.slice(1)}`,
    `?cap=${cap}`,
    `#cap=${cap}=`,
    '#other=a',
  ])
    expect(privateBrowserCapability(fragment)).toBeUndefined()
})

test('revision parsing coalesces bursts, handles boundaries and rejects oversized or malformed events', () => {
  const parser = new PrivateRevisionReader()
  expect(parser.push('event: rev')).toBeUndefined()
  expect(parser.push('ision\r\ndata: 12\r\n\r\n: heartbeat\n\nevent: revision\ndata: 11\n\n')).toBe(
    12,
  )
  expect(
    parser.push(
      Array.from({ length: 2000 }, (_, i) => `event: revision\ndata: ${i + 1}\n\n`).join(''),
    ),
  ).toBe(2000)
  for (const value of [
    'event: revision\ndata: 0\n\n',
    'event: revision\ndata: 9007199254740992\n\n',
    'event: invented\ndata: 1\n\n',
    ':é\n\n',
    `:${'x'.repeat(512)}\n\n`,
    'x'.repeat(2049),
  ])
    expect(() => new PrivateRevisionReader().push(value)).toThrow()
})

test('equal revision reconnect acknowledges freshness without replacing semantic data', async () => {
  const owner = await connected(2)
  const original = owner.client.body
  owner.stream.disconnect()
  await flush()
  expect(owner.client.connection).toBe('disconnected')
  expect(owner.client.referencesEnabled).toBeFalse()
  expect(owner.timers.filter((item) => !item.cancelled)).toHaveLength(1)
  expect(owner.timers[0]!.milliseconds).toBe(1000)
  owner.runRetry()
  owner.take('/api/events').resolve(events().response)
  const equal = snapshot(2)
  equal.workspace.target = 'Unexpected replacement'
  owner.take('/api/snapshot').resolve(json(equal))
  await flush()
  expect(owner.client.body).toBe(original)
  expect(owner.client.connection).toBe('current')
  expect(owner.client.referencesEnabled).toBeTrue()
})

test('behind responses retain one retry owner and highest committed revision', async () => {
  const owner = harness()
  const stream = events()
  owner.client.start()
  owner.take('/api/events').resolve(stream.response)
  stream.send(3)
  stream.send(4)
  await flush()
  owner.take('/api/snapshot').resolve(json(snapshot(2)))
  await flush()
  expect(owner.client.body?.revision).toBe(2)
  expect(owner.client.referencesEnabled).toBeFalse()
  expect(owner.requests).toHaveLength(0)
  expect(owner.timers.filter((item) => !item.cancelled)).toHaveLength(1)
  stream.send(5)
  await flush()
  expect(owner.requests).toHaveLength(0)
  owner.runRetry()
  owner.take('/api/snapshot').resolve(json(snapshot(5)))
  await flush()
  expect(owner.client.connection).toBe('current')
  expect(owner.client.body?.revision).toBe(5)
})

test('a notification arriving during snapshot decoding is captured afterward', async () => {
  const owner = await connected()
  owner.stream.send(2)
  await flush()
  expect(owner.client.referencesEnabled).toBeFalse()
  const pending = owner.take('/api/snapshot')
  let controller!: ReadableStreamDefaultController<Uint8Array>
  pending.resolve(
    new Response(
      new ReadableStream({
        start(value) {
          controller = value
        },
      }),
    ),
  )
  await flush()
  owner.stream.send(3)
  controller.enqueue(new TextEncoder().encode(JSON.stringify(snapshot(2))))
  controller.close()
  await flush()
  expect(owner.client.connection).toBe('current')
  expect(owner.client.observationFresh).toBeFalse()
  expect(owner.timers.filter((item) => !item.cancelled)).toHaveLength(1)
  owner.runRetry()
  owner.take('/api/snapshot').resolve(json(snapshot(3)))
  await flush()
  expect(owner.client.body?.revision).toBe(3)
})

test('incomplete current causes preserve but fence the last complete body', async () => {
  const owner = await connected()
  const original = owner.client.body
  owner.client.setPreview({
    artifactId: artifact,
    captureGeneration: 'capture-1',
    signature: 'row',
  })
  const pending = owner.take(`/api/artifacts/${artifact}/preview`)
  owner.stream.send(2)
  await flush()
  owner.take('/api/snapshot').resolve(
    json({
      kind: 'incomplete',
      revision: 2,
      mode: 'live-run',
      rootSourceId: 'root',
      reason: 'Projection allowance exceeded',
      workspace: snapshot(2).workspace,
      context: '',
      omissions: snapshot(2).omissions,
      attention: [],
      diagnostics: [],
    }),
  )
  await flush()
  expect(owner.client.body).toBe(original)
  expect(owner.client.current?.kind).toBe('incomplete')
  expect(owner.client.referencesEnabled).toBeFalse()
  expect(owner.client.preview).toBeUndefined()
  pending.resolve(json(preview('Late evidence')))
  await flush()
  expect(owner.client.preview).toBeUndefined()
})

test('A to B to A has one request and discards the first A completion', async () => {
  const owner = await connected()
  const intent = { artifactId: artifact, captureGeneration: 'capture-1', signature: 'A' }
  owner.client.setPreview(intent)
  const first = owner.take(`/api/artifacts/${artifact}/preview`)
  owner.client.setPreview({ ...intent, signature: 'B' })
  owner.client.setPreview({ ...intent })
  expect(first.init.signal?.aborted).toBeTrue()
  expect(owner.requests).toHaveLength(0)
  first.resolve(json(preview('Stale first A')))
  await flush()
  expect(owner.client.preview?.phase).toBe('loading')
  owner.take(`/api/artifacts/${artifact}/preview`).resolve(json(preview('Current A')))
  await flush()
  expect(owner.client.preview?.reply?.text).toBe('Current A')
})

test('preview identity, capture generation and UTF-8 capacity must match', async () => {
  const owner = await connected()
  for (const [signature, reply] of [
    ['generation', preview('Wrong generation', 'capture-2')],
    ['oversized', preview('€'.repeat(22000))],
  ] as const) {
    owner.client.setPreview({ artifactId: artifact, captureGeneration: 'capture-1', signature })
    owner.take(`/api/artifacts/${artifact}/preview`).resolve(json(reply))
    await flush()
    expect(owner.client.preview?.phase).toBe('unavailable')
    expect(owner.client.preview?.reply).toBeUndefined()
  }
  expect(owner.requests).toHaveLength(0)
})

test('capacity responses retry within bounds without submission routes or replay', async () => {
  const owner = harness()
  owner.client.start()
  const stream = events()
  const eventRequest = owner.take('/api/events')
  expect(eventRequest.init.headers).toEqual({ Authorization: `Bearer ${cap}` })
  expect(eventRequest.init.credentials).toBe('omit')
  eventRequest.resolve(stream.response)
  owner
    .take('/api/snapshot')
    .resolve(new Response('{"error":"capacity"}', { status: 429, headers: { 'Retry-After': '1' } }))
  await flush()
  owner.runRetry()
  owner.take('/api/snapshot').resolve(json(snapshot(1)))
  await flush()
  expect(owner.client.connection).toBe('current')
  expect(owner.requests).toHaveLength(0)
  const closing = owner.client.closeInspection()
  const request = owner.take('/api/close')
  expect(request.init.method).toBe('POST')
  expect(request.init.body).toBeUndefined()
  request.resolve(new Response(null, { status: 204 }))
  expect(await closing).toBeTrue()
  expect(owner.client.connection).toBe('closed')
  expect(owner.client.body).toBeUndefined()
  expect(owner.client.preview).toBeUndefined()
})

test('snapshot bounds refuse before JSON acceptance and terminal responses release copies', async () => {
  const owner = harness()
  owner.client.start()
  owner.take('/api/events').resolve(events().response)
  owner.take('/api/snapshot').resolve(new Response(' '.repeat(8 * 1024 * 1024 + 1)))
  await flush()
  expect(owner.client.body).toBeUndefined()
  expect(owner.client.connection).toBe('disconnected')
  owner.runRetry()
  owner.take('/api/snapshot').resolve(new Response('{"error":"closed"}', { status: 410 }))
  await flush()
  expect(owner.client.connection).toBe('closed')
  expect(owner.client.referencesEnabled).toBeFalse()
  expect(owner.timers.every((item) => item.cancelled)).toBeTrue()
})

test('malformed new semantic fields never partly replace an already complete body', async () => {
  const owner = await connected()
  const original = owner.client.body
  owner.stream.send(2)
  await flush()
  owner.take('/api/snapshot').resolve(json({ ...snapshot(2), rootSourceId: undefined }))
  await flush()
  expect(owner.client.body).toBe(original)
  expect(owner.client.connection).toBe('disconnected')
  expect(owner.client.referencesEnabled).toBeFalse()
})

test('preview routes encode producer opaque IDs without depending on a host HMAC scheme', async () => {
  const owner = await connected()
  const opaque = 'producer/opaque?artifact'
  owner.client.setPreview({ artifactId: opaque, captureGeneration: 'capture-1', signature: 'row' })
  owner.take(`/api/artifacts/${encodeURIComponent(opaque)}/preview`).resolve(
    json({
      ...preview('Evidence'),
      artifactId: opaque,
    }),
  )
  await flush()
  expect(owner.client.preview?.phase).toBe('ready')
  expect(owner.client.preview?.reply?.artifactId).toBe(opaque)
})
