import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { ComponentPeer, type Message } from './harness/peer'

const commands: Array<readonly string[]> = [
  [process.execPath, resolve(import.meta.dir, 'components/channels.ts')],
]
const python = Bun.which('python3')
if (python) commands.push([python, resolve(import.meta.dir, 'components/channels.py')])
else test.skip('Python direct-channel peer unavailable', () => {})

for (const command of commands) {
  for (const failed of [false, true]) {
    test(`${command.at(-1)} exchanges direct data with a separate ${failed ? 'failed stream' : 'result'}`, async () => {
      const peer = new ComponentPeer(command, {
        PYTHONPATH: resolve(import.meta.dir, '../../packages/jiggy-flow/src'),
        PYTHONDONTWRITEBYTECODE: '1',
      })
      const answer = (request: Message, result: unknown) =>
        peer.send({ jsonrpc: '2.0', id: request.id, result })
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
        const create = await peer.receive()
        expect(create.method).toBe('channel/create')
        answer(create, {
          send: { endpoint: 'writer:1', direction: 'send', delivery: 'direct' },
          receive: {
            endpoint: 'reader:1',
            direction: 'receive',
            delivery: 'direct',
            startSequence: 1,
          },
        })
        const concurrent = [await peer.receive(), await peer.receive()]
        const work = concurrent.find((request) => request.method === 'capability/call')!
        const read = concurrent.find((request) => request.method === 'channel/next')!
        expect(work.params).toEqual({
          operationId: 'answer',
          slot: 'worker',
          method: 'run',
          input: null,
          channels: { events: 'writer:1' },
        })
        answer(read, { item: { sequence: 1, value: { sample: 'room', celsius: 21 } } })
        const next = await peer.receive()
        expect(next.method).toBe('channel/next')
        if (failed)
          peer.send({
            jsonrpc: '2.0',
            id: next.id,
            error: {
              code: -32000,
              message: 'observation capacity exceeded',
              data: { code: 'LAGGED' },
            },
          })
        else answer(next, { end: { lastSequence: 1 } })
        answer(work, { value: 'completed' })
        expect(await peer.receive()).toEqual({
          jsonrpc: '2.0',
          id: 'root:1',
          result: {
            outcome: 'done',
            output: {
              complete: !failed,
              values: [{ sample: 'room', celsius: 21 }],
              work: 'completed',
            },
          },
        })
        await peer.finish()
      } finally {
        await peer.dispose()
      }
    })
  }
}
