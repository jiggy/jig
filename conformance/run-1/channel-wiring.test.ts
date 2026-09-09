import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { ComponentPeer, type Message } from './harness/peer'

const directory = resolve(import.meta.dir, 'components')
const python = Bun.which('python3')
const identity = {
  id: 'https://example.org/contracts/updates',
  version: '1.0.0',
  digest: `sha256:${'a'.repeat(64)}`,
}
const environment = {
  PYTHONPATH: resolve(import.meta.dir, '../../packages/jiggy-flow/src'),
  PYTHONDONTWRITEBYTECODE: '1',
}

function grant(endpoint: string, direction: 'send' | 'receive', named = true) {
  return {
    endpoint,
    direction,
    delivery: 'direct',
    ...(named ? { contract: identity } : {}),
    ...(direction === 'receive' ? { startSequence: 1 } : {}),
  }
}
function start(peer: ComponentPeer, input: unknown, channels: Record<string, unknown> = {}) {
  peer.send({
    jsonrpc: '2.0',
    id: 'root:1',
    method: 'flow/run',
    params: {
      protocol: 'run/1',
      input,
      settings: {},
      attachments: {},
      channels,
      scratch: '/unused',
      deadlineUnixMs: Date.now() + 10_000,
    },
  })
}
function answer(peer: ComponentPeer, request: Message, result: unknown) {
  peer.send({ jsonrpc: '2.0', id: request.id, result })
}
function reject(peer: ComponentPeer, request: Message, code: string) {
  peer.send({
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code: -32000,
      message: 'scripted channel boundary failure',
      data: { code },
    },
  })
}

if (!python) test.skip('Python cross-language channel wiring unavailable', () => {})
else
  for (const rootLanguage of ['ts', 'py'] as const) {
    for (const mode of ['clean', 'lagged', 'stopped', 'no-output'] as const) {
      test(`${rootLanguage} root wires worker and opposite-language monitor: ${mode}`, async () => {
        const command = (language: 'ts' | 'py') => [
          language === 'ts' ? process.execPath : python,
          resolve(directory, `channel-wiring.${language}`),
        ]
        const parent = new ComponentPeer(command(rootLanguage), environment)
        const worker = new ComponentPeer(command(rootLanguage), environment)
        const monitor = new ComponentPeer(command(rootLanguage === 'ts' ? 'py' : 'ts'), environment)
        const selected: unknown[] = []
        try {
          start(
            parent,
            { role: 'root', stop: mode === 'stopped' },
            mode === 'no-output'
              ? {}
              : {
                  progress: grant('parent:output', 'send', false),
                },
          )
          const create = await parent.receive()
          expect(create.method).toBe('channel/create')
          expect(create.params).toEqual({
            contract: './updates.json',
            ...(rootLanguage === 'py' ? { delivery: 'direct' } : {}),
          })
          answer(parent, create, {
            send: grant('parent:writer', 'send'),
            receive: grant('parent:reader', 'receive'),
          })
          const incompatible = await parent.receive()
          expect(incompatible.method).toBe('flow/run-child')
          expect(incompatible.params).toEqual({
            operationId: 'incompatible',
            slot: 'incompatible',
            input: null,
            channels: { events: 'parent:writer' },
          })
          // Scripted pre-dispatch contract rejection: no rights have moved.
          // This proves ordinary recovery, not a production contract resolver.
          reject(parent, incompatible, 'INVALID_INPUT')
          const children = [await parent.receive(), await parent.receive()]
          const work = children.find((request) => (request.params as any).slot === 'worker')!
          const watch = children.find((request) => (request.params as any).slot === 'monitor')!
          expect(work.method).toBe('flow/run-child')
          expect(watch.method).toBe('flow/run-child')
          expect((work.params as any).channels).toEqual({ events: 'parent:writer' })
          expect((watch.params as any).channels).toEqual({
            events: 'parent:reader',
            ...(mode === 'no-output' ? {} : { progress: 'parent:output' }),
          })
          // New invocation-bound references replace the parent's references.
          start(worker, { role: 'worker' }, { events: grant('worker:writer', 'send') })
          start(
            monitor,
            { role: 'monitor', stop: mode === 'stopped' },
            {
              events: grant('monitor:reader', 'receive'),
              ...(mode === 'no-output' ? {} : { progress: grant('monitor:output', 'send', false) }),
            },
          )
          const agent = await worker.receive()
          expect(agent.method).toBe('capability/call')
          expect(agent.params).toEqual({
            operationId: 'answer',
            slot: 'agent',
            method: 'run',
            input: null,
            channels: { events: 'worker:writer' },
          })
          let reads = 0
          let releases = 0
          let monitorResult: unknown
          for (let messages = 0; messages < 10; messages++) {
            const request = await monitor.receive()
            if (request.id === 'root:1') {
              expect(request.error).toBeUndefined()
              monitorResult = request.result
              break
            }
            const params = request.params as Record<string, unknown>
            if (request.method === 'channel/next') {
              expect(params).toEqual({ endpoint: 'monitor:reader' })
              reads++
              if (reads === 1)
                answer(monitor, request, { item: { sequence: 1, value: { stage: 'planning' } } })
              else if (reads === 2)
                answer(monitor, request, {
                  item: { sequence: 2, value: { text: 'Selected text' } },
                })
              else if (mode === 'lagged') reject(monitor, request, 'LAGGED')
              else answer(monitor, request, { end: { lastSequence: 2 } })
            } else if (request.method === 'channel/send') {
              expect(params).toEqual({ endpoint: 'monitor:output', value: 'Selected text' })
              selected.push(params.value)
              answer(monitor, request, null)
            } else if (request.method === 'channel/release') {
              expect(params).toEqual({ endpoint: 'monitor:reader' })
              releases++
              answer(
                monitor,
                request,
                mode === 'stopped'
                  ? { status: 'released' }
                  : mode === 'lagged'
                    ? { status: 'failed', code: 'LAGGED' }
                    : { status: 'ended', lastSequence: 2 },
              )
            } else {
              expect(request.method).toBe('channel/close')
              expect(params).toEqual({ endpoint: 'monitor:output' })
              answer(monitor, request, null)
            }
          }
          expect(monitorResult).toEqual({
            outcome: 'done',
            output: {
              complete: mode !== 'lagged' && mode !== 'stopped',
              selected: ['Selected text'],
            },
          })
          if (mode === 'lagged' || mode === 'stopped') expect(releases).toBe(1)
          expect(selected).toEqual(mode === 'no-output' ? [] : ['Selected text'])
          await monitor.finish()
          answer(parent, watch, monitorResult)
          // EOF, lost observation and deliberate disposal do not finish work.
          // The Agent and its worker still need their separate actual result.
          answer(worker, agent, { value: { answer: 'Actual answer' } })
          const workerTerminal = await worker.receive()
          expect(workerTerminal).toEqual({
            jsonrpc: '2.0',
            id: 'root:1',
            result: {
              outcome: 'done',
              output: { answer: 'Actual answer' },
            },
          })
          await worker.finish()
          answer(parent, work, workerTerminal.result)
          expect(await parent.receive()).toEqual({
            jsonrpc: '2.0',
            id: 'root:1',
            result: {
              outcome: 'done',
              output: { incompatible: true, work: workerTerminal.result, monitor: monitorResult },
            },
          })
          await parent.finish()
        } finally {
          await Promise.all([parent.dispose(), worker.dispose(), monitor.dispose()])
        }
      })
    }
  }
