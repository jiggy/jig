import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import contractSchema from '../../docs/flow/spec/machine/channel-contract-1.schema.json'
import fixture from './fixtures/conversation.json'
import { ComponentPeer, type Message } from './harness/peer'

type Role = 'analysis' | 'dataset'
type Port = 'requests' | 'replies'
type Mode = 'clean' | 'shifted' | 'duplicate' | 'unexpected' | 'early-eof' | 'cancel'
type Pending = { role: Role; request: Message }
type Stream = {
  count: number
  queue: unknown[]
  closed: boolean
  released: boolean
  ended: boolean
  pending?: Pending
}
const roles: Role[] = ['analysis', 'dataset']
const ports: Port[] = ['requests', 'replies']
const python = Bun.which(process.env.PYTHON ?? 'python3')
if (process.env.PYTHON && !python) throw new Error('The selected PYTHON interpreter is unavailable')

test('conversation descriptors use the public Channel Contract/1 and Schema/1 profile', () => {
  const validate = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true }).compile(
    contractSchema,
  )
  for (const descriptor of Object.values(fixture.contracts)) {
    expect(validate(descriptor), JSON.stringify(validate.errors)).toBe(true)
    expect(
      validate({
        ...descriptor,
        item: {
          ...descriptor.item,
          properties: {
            ...descriptor.item.properties,
            sample: { ...descriptor.item.properties.sample, pattern: '^s' },
          },
        },
      }),
    ).toBe(false)
  }
})

// The descriptors contain only ASCII strings and small integers. Sorted-key
// JSON is RFC8785-equivalent for this finite fixture, not a general JCS helper.
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sorted(item)]),
    )
  return value
}
function grant(role: Role, port: Port) {
  const descriptor = fixture.contracts[port]
  const direction = (role === 'analysis') === (port === 'requests') ? 'send' : 'receive'
  return {
    endpoint: `${role}:${port}`,
    direction,
    delivery: 'direct',
    contract: {
      id: descriptor.id,
      version: descriptor.version,
      digest: `sha256:${createHash('sha256')
        .update('FLOW-Channel-Contract/1\0')
        .update(JSON.stringify(sorted(descriptor)))
        .digest('hex')}`,
    },
    ...(direction === 'receive' ? { startSequence: 1 } : {}),
  }
}

// A finite two-pipe witness, not Jig's broker: grant admission is scripted.
// Values and adaptive requests come from the real opposite-language processes.
async function exchange(analysisLanguage: 'ts' | 'py', mode: Mode) {
  const readings = fixture.samples.map((value, index) =>
    mode === 'shifted' && index === 4 ? 29 : value,
  )
  const environment = {
    PYTHONPATH: resolve(import.meta.dir, '../../packages/jiggy-flow/src'),
    PYTHONDONTWRITEBYTECODE: '1',
  }
  const command = (language: 'ts' | 'py') => [
    language === 'ts' ? process.execPath : python!,
    resolve(import.meta.dir, `components/conversation.${language}`),
  ]
  const peers = {
    analysis: new ComponentPeer(command(analysisLanguage), environment),
    dataset: new ComponentPeer(command(analysisLanguage === 'ts' ? 'py' : 'ts'), environment),
  }
  const streams: Record<Port, Stream> = {
    requests: { count: 0, queue: [], closed: false, released: false, ended: false },
    replies: { count: 0, queue: [], closed: false, released: false, ended: false },
  }
  const pending = new Map<string, Pending>()
  const terminals: Partial<Record<Role, Message>> = {}
  const transcript: { port: Port; value: any }[] = []
  const closed: Port[] = []
  let frames = 0
  let cancelled = false
  let heldReply: Pending | undefined
  const respond = ({ role, request }: Pending, result: unknown, code?: string) => {
    pending.delete(`${role}/${request.id}`)
    peers[role].send(
      code
        ? { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: code, data: { code } } }
        : { jsonrpc: '2.0', id: request.id, result },
    )
  }
  const deliver = (stream: Stream) => {
    if (!stream.pending) return
    if (stream.queue.length) {
      const read = stream.pending
      delete stream.pending
      const sequence = stream.count - stream.queue.length + 1
      respond(read, { item: { sequence, value: stream.queue.shift() } })
    } else if (stream.closed) {
      const read = stream.pending
      delete stream.pending
      stream.ended = true
      respond(read, { end: { lastSequence: stream.count } })
    }
  }
  const cancelIfWaiting = () => {
    if (mode !== 'cancel' || !heldReply || !streams.replies.pending || cancelled) return
    cancelled = true
    for (const role of roles)
      peers[role].send({
        jsonrpc: '2.0',
        method: 'request/cancel',
        params: { requestId: 'root:1' },
      })
    const replyRead = streams.replies.pending
    delete streams.replies.pending
    respond(replyRead, undefined, 'CANCELLED')
    respond(heldReply, undefined, 'CANCELLED')
    heldReply = undefined
  }
  try {
    for (const role of roles)
      peers[role].send({
        jsonrpc: '2.0',
        id: 'root:1',
        method: 'flow/run',
        params: {
          protocol: 'run/1',
          input: {
            role,
            mode,
            threshold: fixture.threshold,
            samples:
              role === 'analysis'
                ? readings.map((_, index) => `s${index}`)
                : readings.map((celsius, index) => ({ sample: `s${index}`, celsius })),
          },
          settings: {},
          attachments: {},
          channels: { requests: grant(role, 'requests'), replies: grant(role, 'replies') },
          scratch: '/unused',
          deadlineUnixMs: Date.now() + 10_000,
        },
      })
    await Promise.all(
      roles.map(async (role) => {
        while (true) {
          const request = await peers[role].receive()
          expect(++frames).toBeLessThanOrEqual(96)
          if (request.id === 'root:1') {
            expect([...pending.values()].filter((entry) => entry.role === role)).toHaveLength(0)
            terminals[role] = request
            return
          }
          if (request.method === 'request/cancel') continue
          const item = { role, request }
          pending.set(`${role}/${request.id}`, item)
          const params = request.params as Record<string, unknown>
          const port = ports.find((port) => params.endpoint === `${role}:${port}`)
          expect(port).toBeDefined()
          const stream = streams[port!]
          if (request.method === 'channel/send') {
            expect(grant(role, port!).direction).toBe('send')
            if (cancelled || stream.released) {
              respond(item, undefined, cancelled ? 'CANCELLED' : 'DISCONNECTED')
              continue
            }
            expect(stream.closed).toBe(false)
            if (mode === 'cancel' && port === 'replies') {
              heldReply = item
              cancelIfWaiting()
              continue
            }
            expect(++stream.count).toBeLessThanOrEqual(8)
            stream.queue.push(params.value)
            transcript.push({ port: port!, value: params.value })
            respond(item, null)
            deliver(stream)
          } else if (request.method === 'channel/next') {
            expect(grant(role, port!).direction).toBe('receive')
            if (cancelled) {
              respond(item, undefined, 'CANCELLED')
              continue
            }
            expect(stream.pending).toBeUndefined()
            stream.pending = item
            deliver(stream)
            cancelIfWaiting()
          } else if (request.method === 'channel/close') {
            expect(grant(role, port!).direction).toBe('send')
            if (!stream.closed) closed.push(port!)
            stream.closed = true
            respond(item, null)
            deliver(stream)
          } else {
            expect(request.method).toBe('channel/release')
            expect(grant(role, port!).direction).toBe('receive')
            stream.released = true
            stream.queue.length = 0
            if (stream.pending) {
              respond(stream.pending, undefined, 'CANCELLED')
              delete stream.pending
            }
            respond(
              item,
              stream.ended
                ? { status: 'ended', lastSequence: stream.count }
                : { status: 'released' },
            )
          }
        }
      }),
    )
    expect(pending.size).toBe(0)
    await Promise.all(roles.map((role) => peers[role].finish()))
    return { terminals, transcript, closed, cancelled }
  } finally {
    await Promise.all(roles.map((role) => peers[role].dispose()))
  }
}

if (!python) test.skip('cross-language structured conversation requires Python', () => {})
else
  for (const language of ['ts', 'py'] as const) {
    for (const mode of [
      'clean',
      'shifted',
      'duplicate',
      'unexpected',
      'early-eof',
      'cancel',
    ] as const) {
      test(`${language} analysis and opposite-language dataset: ${mode}`, async () => {
        const result = await exchange(language, mode)
        if (mode === 'cancel') {
          expect(result.cancelled).toBe(true)
          for (const role of roles)
            expect((result.terminals[role]!.error as any).data.code).toBe('CANCELLED')
        } else if (mode === 'clean' || mode === 'shifted') {
          const queries = mode === 'clean' ? ['s4', 's2', 's3'] : ['s4', 's6', 's5']
          expect(result.closed).toEqual(['requests', 'replies'])
          expect(
            result.transcript
              .filter((item) => item.port === 'requests')
              .map((item) => item.value.sample),
          ).toEqual(queries)
          expect(result.transcript.map((item) => item.port)).toEqual([
            'requests',
            'replies',
            'requests',
            'replies',
            'requests',
            'replies',
          ])
          expect(result.terminals.analysis!.result).toEqual({
            outcome: 'done',
            output: {
              threshold: 30,
              crossing:
                mode === 'clean'
                  ? { sample: 's4', index: 4, celsius: 31 }
                  : { sample: 's5', index: 5, celsius: 37 },
              observations:
                mode === 'clean'
                  ? [
                      { sample: 's4', celsius: 31 },
                      { sample: 's2', celsius: 23 },
                      { sample: 's3', celsius: 26 },
                    ]
                  : [
                      { sample: 's4', celsius: 29 },
                      { sample: 's6', celsius: 44 },
                      { sample: 's5', celsius: 37 },
                    ],
            },
          })
          expect(result.terminals.dataset!.result).toEqual({
            outcome: 'done',
            output: { served: queries },
          })
        } else {
          expect((result.terminals.analysis!.error as any).data.code).toBe('EXECUTION_FAILED')
          expect(result.terminals.dataset!.result).toBeDefined()
          expect(result.closed).toContain('requests')
          expect(result.closed).toContain('replies')
        }
      })
    }
  }
