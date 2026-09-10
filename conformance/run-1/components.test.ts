import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import schema from '../../docs/flow/spec/machine/run-1.schema.json'
import goldenTrace from './fixtures/golden-trace.json'
import { ComponentPeer, type Message } from './harness/peer'

const root = resolve(import.meta.dir, '../..')
const typescriptComponent = [process.execPath, resolve(import.meta.dir, 'components/flow.ts')]
const pythonComponent = findPythonComponent()
const ajv = new Ajv2020({ allErrors: true, strict: true })
ajv.addSchema(schema)

describe('Run/1 SDK parity', () => {
  test('TypeScript follows the golden full-duplex conversation', async () => {
    expect(await runGoldenConversation(typescriptComponent)).toEqual(goldenTrace)
  })

  if (pythonComponent) {
    test('Python follows the golden full-duplex conversation', async () => {
      expect(await runGoldenConversation(pythonComponent)).toEqual(goldenTrace)
    })
  } else {
    test.skip('Python parity (python3 or need launcher unavailable)', () => {})
  }
})

async function runGoldenConversation(command: readonly string[]) {
  const scratch = await mkdtemp(join(tmpdir(), 'flow-run-1-'))
  const peer = new ComponentPeer(command, {
    PYTHONPATH: resolve(root, 'packages/jiggy-flow/src'),
  })
  const trace: Array<Record<string, unknown>> = []

  try {
    // Cancellation is deliberately racy and idempotent. These unknown targets
    // must not poison the following valid root request.
    peer.send(cancel('stale:1'))
    peer.send(cancel('stale:1'))

    peer.send({
      jsonrpc: '2.0',
      id: 'host:1',
      method: 'flow/run',
      params: {
        protocol: 'run/1',
        input: { subject: 'football' },
        settings: {},
        attachments: {},
        scratch,
        deadlineUnixMs: Date.now() + 60_000,
      },
    })
    trace.push({ direction: 'host->component', kind: 'request', method: 'flow/run' })

    const first = await peer.receive()
    const second = await peer.receive()
    const outbound = [request(first), request(second)]

    for (const item of [...outbound].sort(byConcurrentCall)) {
      assertSchema('flowCallRequest', item)
      trace.push({
        direction: 'component->host',
        kind: 'request',
        method: item.method,
        operationId: params(item).operationId,
      })
    }

    const flowCall = outbound.find((item) => params(item).slot === 'research')
    const effectCall = outbound.find((item) => params(item).slot === 'artifact-write')
    expect(flowCall).toBeDefined()
    expect(effectCall).toBeDefined()
    expect(flowCall!.params).toEqual({
      operationId: 'research:1',
      slot: 'research',
      intent: 'Find a useful comparison target.',
      input: { subject: 'football' },
    })
    expect(effectCall!.params).toEqual({
      operationId: 'store:1',
      slot: 'artifact-write',
      input: { source: 'research' },
    })

    peer.send({
      jsonrpc: '2.0',
      id: effectCall!.id,
      result: { outcome: 'done', output: { uri: 'artifact://1' } },
    })
    trace.push({ direction: 'host->component', kind: 'result', for: 'flow/call' })

    peer.send({
      jsonrpc: '2.0',
      id: flowCall!.id,
      result: {
        outcome: 'done',
        output: { answer: 'Fifa 99' },
      },
    })
    trace.push({ direction: 'host->component', kind: 'result', for: 'flow/call' })

    const missing = request(await peer.receive())
    expect(missing.method).toBe('flow/call')
    assertSchema('flowCallRequest', missing)
    expect(missing.params).toEqual({
      operationId: 'missing:1',
      slot: 'artifact-read',
      input: { uri: 'artifact://missing' },
    })
    trace.push({
      direction: 'component->host',
      kind: 'request',
      method: missing.method,
      operationId: 'missing:1',
    })

    peer.send({
      jsonrpc: '2.0',
      id: missing.id,
      result: {
        outcome: 'not-found',
        output: { uri: 'artifact://missing' },
      },
    })
    trace.push({
      direction: 'host->component',
      kind: 'result',
      for: 'flow/call',
      outcome: 'not-found',
    })

    const rootResponse = await peer.receive()
    assertSchema('runSuccessResponse', rootResponse)
    expect(rootResponse).toEqual({
      jsonrpc: '2.0',
      id: 'host:1',
      result: {
        outcome: 'done',
        output: {
          research: {
            outcome: 'done',
            output: { answer: 'Fifa 99' },
          },
          stored: { outcome: 'done', output: { uri: 'artifact://1' } },
          missing: { outcome: 'not-found', output: { uri: 'artifact://missing' } },
        },
      },
    })
    trace.push({ direction: 'component->host', kind: 'result', for: 'flow/run' })

    await peer.finish()
    return trace
  } finally {
    await peer.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}

function byConcurrentCall(left: Request, right: Request): number {
  const rank = { research: 0, 'artifact-write': 1 } as const
  return (
    (rank[left.params.slot as keyof typeof rank] ?? 2) -
    (rank[right.params.slot as keyof typeof rank] ?? 2)
  )
}

function cancel(requestId: string): Message {
  return {
    jsonrpc: '2.0',
    method: 'request/cancel',
    params: { requestId },
  }
}

interface Request extends Message {
  id: string
  method: string
  params: Record<string, unknown>
}

function request(message: Message): Request {
  if (
    typeof message.id !== 'string' ||
    typeof message.method !== 'string' ||
    message.params === null ||
    typeof message.params !== 'object' ||
    Array.isArray(message.params)
  ) {
    throw new Error(`expected request, received ${JSON.stringify(message)}`)
  }
  return message as Request
}

function params(message: Request): Record<string, unknown> {
  return message.params
}

function findPythonComponent(): readonly string[] | undefined {
  const component = resolve(import.meta.dir, 'components/flow.py')
  const python = Bun.which('python3')
  if (python) return [python, component]
  const need = Bun.which('need')
  if (need) return [need, 'run', 'python3', '--', 'python3', component]
  return undefined
}

function assertSchema(definition: string, value: unknown): void {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`)
  if (!validate) throw new Error(`schema definition not found: ${definition}`)
  if (!validate(value)) {
    throw new Error(`${definition} failed: ${JSON.stringify(validate.errors)}`)
  }
}
