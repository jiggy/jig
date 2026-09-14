import { expect, test } from 'bun:test'

/** Synthetic Agent host, real public SDK subprocess. No native-client qualification. */
async function exercise(mode: string) {
  const process = Bun.spawn([Bun.which('bun')!, `${import.meta.dir}/conversation-fixture.ts`], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const errors = new Response(process.stderr).text()
  const timer = setTimeout(() => process.kill(), 5_000)
  const send = (frame: unknown) => {
    process.stdin.write(JSON.stringify(frame) + '\n')
    process.stdin.flush()
  }
  const ok = (request: any, result: unknown) => send({ jsonrpc: '2.0', id: request.id, result })
  const fail = (request: any, code: string) =>
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: code, data: { code } } })
  const queues: any[] = []
  let read: any
  let call: any
  let sequence = 0
  let creates = 0
  let closed = false
  let final: any
  let nativeSettled = false
  const operations: any[] = []
  const item = (value: unknown) => {
    queues.push({ item: { sequence: ++sequence, value } })
    if (read) {
      ok(read, queues.shift())
      read = undefined
    }
  }
  const terminal = (turn: number, type = 'result') =>
    item(
      type === 'result'
        ? { type, turn, result: { outcome: 'done', output: { text: `answer ${turn}` } } }
        : { type, turn },
    )
  send({
    jsonrpc: '2.0',
    id: 'root',
    method: 'flow/run',
    params: {
      protocol: 'run/1',
      input: mode,
      settings: {},
      attachments: {},
      scratch: '/tmp/unused',
      deadlineUnixMs: Date.now() + 4_000,
    },
  })
  try {
    let buffer = ''
    const decoder = new TextDecoder()
    for await (const bytes of process.stdout) {
      buffer += decoder.decode(bytes, { stream: true })
      while (buffer.includes('\n')) {
        const split = buffer.indexOf('\n')
        const request = JSON.parse(buffer.slice(0, split))
        buffer = buffer.slice(split + 1)
        operations.push(request)
        if (request.id === 'root') {
          final = request
          continue
        }
        const p = request.params
        if (request.method === 'channel/create') {
          creates++
          if (mode === 'partial-allocation' && creates === 2) {
            fail(request, 'RESOURCE_EXHAUSTED')
            continue
          }
          const prefix = creates === 1 ? 'commands' : 'replies'
          ok(request, {
            send: { endpoint: `${prefix}:s`, direction: 'send', delivery: 'direct' },
            receive: {
              endpoint: `${prefix}:r`,
              direction: 'receive',
              delivery: 'direct',
              startSequence: 1,
            },
          })
        } else if (request.method === 'flow/call') {
          call = request
          expect(p.channels).toEqual({ commands: 'commands:r', replies: 'replies:s' })
          if (mode === 'unavailable') {
            nativeSettled = true
            fail(call, 'UNAVAILABLE')
          } else if (mode === 'root-cancel') {
            send({ jsonrpc: '2.0', method: 'request/cancel', params: { requestId: 'root' } })
          } else if (mode === 'abandoned') {
            // No result: callback returns while a real invocation remains live.
          } else if (mode === 'malformed')
            item({ type: 'result', turn: 7, result: { outcome: 'done', output: null } })
          else terminal(0)
        } else if (request.method === 'channel/next') {
          read = request
          if (queues.length) {
            ok(read, queues.shift())
            read = undefined
          }
        } else if (request.method === 'channel/send') {
          ok(request, null)
          const command = p.value
          item({ type: 'accepted', command: command.type, turn: command.turn })
          if (command.type === 'prompt') {
            if (mode === 'late-error') {
              nativeSettled = true
              fail(call, 'EXECUTION_FAILED')
            } else if (!['interrupt', 'completion-race'].includes(mode)) terminal(command.turn)
          } else if (command.type === 'interrupt')
            terminal(command.turn, mode === 'interrupt' ? 'cancelled' : 'result')
        } else if (request.method === 'channel/close') {
          expect(p.endpoint).toBe('commands:s')
          closed = true
          ok(request, null)
          if (call && !nativeSettled) {
            nativeSettled = true
            if (p.error) fail(call, 'EXECUTION_FAILED')
            else ok(call, { outcome: 'done', output: { turns: mode === 'callback-error' ? 1 : 2 } })
          }
        } else if (request.method === 'channel/release') {
          expect(['replies:r', ...(mode === 'partial-allocation' ? ['commands:r'] : [])]).toContain(
            p.endpoint,
          )
          if (call) expect(nativeSettled).toBe(true)
          if (mode === 'disposal-error') ok(request, { status: 'failed', code: 'LAGGED' })
          else ok(request, { status: 'released' })
        } else if (request.method === 'request/cancel') {
          if (read && read.id === p.requestId) {
            fail(read, 'CANCELLED')
            read = undefined
          } else if (mode === 'root-cancel' && call && call.id === p.requestId) {
            nativeSettled = true
            fail(call, 'CANCELLED')
          } else
            throw Error('Helper cancelled its invocation waiter instead of awaiting settlement')
        } else throw Error(`unexpected method ${request.method}`)
      }
    }
    expect(await process.exited, await errors).toBe(0)
    if (mode === 'root-cancel') {
      expect(final?.error?.data?.code).toBe('CANCELLED')
      return { output: null, operations }
    }
    expect(final?.result?.outcome).toBe('done')
    expect(closed).toBe(true)
    return { output: final.result.output, operations }
  } finally {
    clearTimeout(timer)
    process.kill()
    await process.exited
  }
}

for (const mode of ['normal', 'interrupt', 'completion-race']) {
  test(`public conversation helper: ${mode}`, async () => {
    const { output } = await exercise(mode)
    expect(output.turns).toHaveLength(2)
    expect(output.value.second.type).toBe(mode === 'interrupt' ? 'cancelled' : 'result')
    expect(output.settlement).toEqual({ outcome: 'done', output: { turns: 2 } })
  })
}
for (const mode of [
  'unavailable',
  'late-error',
  'malformed',
  'partial-allocation',
  'callback-error',
  'abandoned',
  'disposal-error',
]) {
  test(`public conversation helper retains honest ${mode}`, async () => {
    const { output } = await exercise(mode)
    expect(output.errors.length).toBeGreaterThan(0)
    expect(output.turns).toHaveLength(
      mode === 'disposal-error' ? 2 : ['late-error', 'callback-error'].includes(mode) ? 1 : 0,
    )
    if (mode === 'callback-error')
      expect(output.settlement).toEqual({ outcome: 'done', output: { turns: 1 } })
  })
}

test('root cancellation cannot become successful conversation recovery', async () => {
  await exercise('root-cancel')
})
