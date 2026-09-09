import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { ComponentPeer, type Message } from './harness/peer'

const commands: Array<readonly string[]> = [
  [process.execPath, resolve(import.meta.dir, 'components/broadcast.ts')],
]
const python = Bun.which('python3')
if (python) commands.push([python, resolve(import.meta.dir, 'components/broadcast.py')])
else test.skip('Python broadcast-channel peer unavailable', () => {})

for (const command of commands) {
  for (const lagged of [false, true]) {
    test(`${command.at(-1)} receives a broadcast suffix with ${lagged ? 'isolated lag' : 'independent intervals'}`, async () => {
      const peer = new ComponentPeer(command, {
        PYTHONPATH: resolve(import.meta.dir, '../../packages/jiggy-flow/src'),
        PYTHONDONTWRITEBYTECODE: '1',
      })
      const answer = (request: Message, result: unknown) =>
        peer.send({ jsonrpc: '2.0', id: request.id, result })
      const next = async (method: string, params: unknown) => {
        const request = await peer.receive()
        expect(request.method).toBe(method)
        expect(request.params).toEqual(params)
        return request
      }
      try {
        peer.send({
          jsonrpc: '2.0',
          id: 'root:1',
          method: 'flow/run',
          params: {
            protocol: 'run/1',
            input: null,
            settings: {},
            attachments: {},
            scratch: '/unused',
            deadlineUnixMs: Date.now() + 10_000,
          },
        })
        answer(await next('channel/create', { delivery: 'broadcast' }), {
          send: { endpoint: 'writer:1', direction: 'send', delivery: 'broadcast' },
          source: 'source:1',
        })
        answer(await next('channel/subscribe', { source: 'source:1' }), {
          endpoint: 'early:1',
          direction: 'receive',
          delivery: 'broadcast',
          startSequence: 1,
        })
        answer(await next('channel/send', { endpoint: 'writer:1', value: 'before-late' }), null)
        answer(await next('channel/subscribe', { source: 'source:1' }), {
          endpoint: 'late:1',
          direction: 'receive',
          delivery: 'broadcast',
          startSequence: 2,
        })
        answer(await next('channel/send', { endpoint: 'writer:1', value: 'after-late' }), null)
        answer(await next('channel/close', { endpoint: 'writer:1' }), null)
        const received = new Map<string, number>([
          ['early:1', 0],
          ['late:1', 0],
        ])
        for (;;) {
          const request = await peer.receive()
          if (request.id === 'root:1') {
            expect(request.result).toEqual({
              outcome: 'done',
              output: {
                early: {
                  start: 1,
                  values: lagged ? [] : ['before-late', 'after-late'],
                  complete: !lagged,
                },
                late: { start: 2, values: ['after-late'], complete: true },
              },
            })
            break
          }
          expect(request.method).toBe('channel/next')
          const endpoint = (request.params as { endpoint: string }).endpoint
          expect(received.has(endpoint)).toBe(true)
          const count = received.get(endpoint)!
          received.set(endpoint, count + 1)
          if (endpoint === 'early:1' && lagged) {
            expect(count).toBe(0)
            peer.send({
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: -32000,
                message: 'subscription capacity exceeded',
                data: { code: 'LAGGED' },
              },
            })
          } else if (endpoint === 'early:1' && count < 2) {
            answer(request, {
              item: { sequence: count + 1, value: count === 0 ? 'before-late' : 'after-late' },
            })
          } else if (endpoint === 'late:1' && count === 0) {
            answer(request, { item: { sequence: 2, value: 'after-late' } })
          } else answer(request, { end: { lastSequence: 2 } })
        }
        await peer.finish()
      } finally {
        await peer.dispose()
      }
    })
  }
}
