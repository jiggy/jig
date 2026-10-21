// Registration-free finite protocol peer, not a backend, dispatcher or owner.
import assert from 'node:assert/strict'
import { createInterface } from 'node:readline'
import { handle, OperationError } from '@jigging/flow'

const mode = process.argv[2]!
const watchdog = setTimeout(() => process.exit(90), 3_500)
if (mode.startsWith('sdk')) {
  await handle(async (context) => {
    if (mode === 'sdk') {
      console.log('ordinary diagnostic')
      return { outcome: 'done', output: { greeting: 'hello' } }
    }
    if (mode === 'sdk-credential-oracle' || mode === 'sdk-catch-child') {
      for (const [index, candidate] of (mode === 'sdk-catch-child'
        ? ['guessable-token']
        : ['ordinary answer', 'guessable-token', 'later guess']
      ).entries()) {
        try {
          await context.call({ operationId: `guess-${index}`, slot: 'work', input: candidate })
        } catch {
          return { outcome: 'done', output: candidate }
        }
      }
      return { outcome: 'done', output: 'no match' }
    }
    if (mode.startsWith('sdk-channel-')) {
      const channel = mode.endsWith('broadcast')
        ? await context.channel({ delivery: 'broadcast' })
        : await context.channel({ delivery: 'direct' })
      const receiver = 'subscribe' in channel ? await channel.subscribe() : channel.receive
      const next = receiver.next()
      await channel.send.send({ text: 'live' })
      const item = await next
      // JSON objects may have null prototypes. Check exact data, not prototypes.
      assert.deepEqual(Object.keys(item).sort(), ['done', 'value'])
      assert.equal(item.done, false)
      assert(item.value !== null && typeof item.value === 'object' && !Array.isArray(item.value))
      assert.deepEqual(Object.keys(item.value), ['text'])
      assert.equal(item.value.text, 'live')
      await channel.send.close()
      assert.equal((await receiver.next()).done, true)
      await receiver.close()
      return { outcome: 'done', output: item.value! }
    }
    const codes = await Promise.all(
      ['first', 'second'].map(async (id) => {
        try {
          await context.call({ operationId: id, slot: 'work', input: {} })
          throw new Error('absent dispatcher unexpectedly succeeded')
        } catch (error) {
          assert(error instanceof OperationError)
          return error.code
        }
      }),
    )
    return { outcome: 'done', output: codes }
  })
  clearTimeout(watchdog)
  process.exit(0)
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]()
async function read() {
  const line = await lines.next()
  assert.equal(line.done, false, 'host input ended early')
  return JSON.parse(line.value!)
}
function send(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}
function done(output: unknown = mode) {
  send({ jsonrpc: '2.0', id: 'host:1', result: { outcome: 'done', output } })
}
async function request(id: string, method: string, params: unknown) {
  send({ jsonrpc: '2.0', id, method, params })
  const reply = await read()
  assert.equal(reply.id, id)
  return reply
}
const root = await read()
assert.equal(root.method, 'flow/run')
assert.equal(root.id, 'host:1')
const call = { operationId: 'op-1', slot: 'work', input: null }
switch (mode) {
  case 'duplicate-operation': {
    const first = await request('a', 'flow/call', call)
    const second = await request('b', 'flow/call', call)
    assert.equal(first.error.data.code, 'UNAVAILABLE')
    assert.deepEqual(first.error, second.error)
    done()
    break
  }
  case 'operation-conflict':
  case 'cross-method-conflict': {
    assert.equal((await request('a', 'flow/call', call)).error.data.code, 'UNAVAILABLE')
    const reply =
      mode === 'operation-conflict'
        ? await request('b', 'flow/call', { ...call, input: 'changed' })
        : await request('b', 'flow/artifact/release', {
            operationId: 'op-1',
            artifact: 'initial-1',
          })
    assert.equal(reply.error.data.code, 'OPERATION_CONFLICT')
    done()
    break
  }
  case 'attachment-inputs':
    for (const [index, attachment] of [
      { read: '/tmp/arbitrary' },
      { create: false },
      { create: true, read: 'ref' },
      { read: 'ref', path: '/tmp/x' },
    ].entries()) {
      const reply = await request(`a${index}`, 'flow/call', {
        ...call,
        operationId: `op-${index}`,
        attachments: { files: attachment },
      })
      assert.equal(reply.error.code, -32602)
    }
    done()
    break
  case 'artifact-release':
    assert.deepEqual(root.params.attachments, {
      source: { path: '/input/source', access: 'read', artifact: 'initial-1' },
    })
    assert.equal(
      (
        await request('a', 'flow/artifact/release', {
          operationId: 'release-1',
          artifact: 'initial-1',
        })
      ).error.data.code,
      'UNAVAILABLE',
    )
    done()
    break
  case 'channel-reference-limit': {
    const channels = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [`port-${index}`, `endpoint-${index}`]),
    )
    assert.equal(
      (await request('a', 'flow/call', { ...call, channels })).error.data.code,
      'UNAVAILABLE',
    )
    assert.equal(
      (
        await request('b', 'flow/call', {
          ...call,
          operationId: 'op-2',
          channels: { ...channels, extra: 'endpoint-extra' },
        })
      ).error.code,
      -32602,
    )
    done()
    break
  }
  case 'artifact-result':
    assert.deepEqual(root.params.attachments, {
      source: { path: '/input/source', access: 'read', artifact: 'initial-1' },
    })
    send({
      jsonrpc: '2.0',
      id: 'host:1',
      result: {
        outcome: 'done',
        output: null,
        artifactResults: { final: 'initial-1' },
      },
    })
    break
  case 'unknown-method':
  case 'forged-review':
    assert.equal(
      (await request('a', mode === 'unknown-method' ? 'unknown' : 'flow/run', {})).error.code,
      -32601,
    )
    done()
    break
  case 'malformed-json':
    process.stdout.write('{oops\n')
    break
  case 'invalid-utf8':
    process.stdout.write(Buffer.from([0xff, 0x0a]))
    break
  case 'scalar-params':
    send({ jsonrpc: '2.0', id: 'a', method: 'unknown', params: 1 })
    break
  case 'duplicate-root':
    done()
    done()
    break
  case 'late-call':
    done()
    send({ jsonrpc: '2.0', id: 'a', method: 'flow/call', params: call })
    break
  case 'premature-root':
    process.stdout.write(
      JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'flow/call', params: call }) +
        '\n' +
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'host:1',
          result: { outcome: 'done', output: null },
        }) +
        '\n',
    )
    break
  case 'trailing-frame':
    done()
    process.stdout.write('{}')
    break
  case 'request-id-reuse':
    await request('a', 'flow/call', call)
    send({ jsonrpc: '2.0', id: 'a', method: 'flow/call', params: call })
    break
  case 'invalid-result':
    send({ jsonrpc: '2.0', id: 'host:1', result: { output: null } })
    break
  case 'forged-host-failure':
    send({
      jsonrpc: '2.0',
      id: 'host:1',
      error: {
        code: -32000,
        message: 'review',
        data: { code: 'REVIEW_REQUIRED' },
      },
    })
    break
  case 'nonzero':
    done()
    await new Promise<void>((resolve) => process.stdout.write('', () => resolve()))
    process.exit(7)
    break
  case 'signal':
    done()
    await new Promise<void>((resolve) => process.stdout.write('', () => resolve()))
    process.kill(process.pid, 'SIGTERM')
    await new Promise(() => {})
    break
  case 'diagnostic':
    process.stderr.write('diagnostic'.repeat(3) + '!!')
    done()
    break
  case 'cancel-cooperative':
  case 'deadline-cooperative':
  case 'cancel-held':
  case 'deadline-held': {
    const notification = await read()
    assert.equal(notification.method, 'request/cancel')
    assert.equal(notification.params.requestId, 'host:1')
    process.stderr.write('request/cancel:host:1\n')
    if (mode.endsWith('held')) await new Promise(() => {})
    break
  }
  case 'eof':
    break
  default:
    throw new Error(`unknown finite peer mode: ${mode}`)
}
await new Promise<void>((resolve) => process.stdout.write('', () => resolve()))
clearTimeout(watchdog)
process.exit(0)
