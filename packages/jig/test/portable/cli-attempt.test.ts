import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'

import { ATTEMPT_REQUEST_BYTES } from '../../src/attempt-contract.js'
import {
  main,
  privateCliAttemptOperation,
  privateCliCommandLifetimeMs,
  privateCliRequiresHost,
} from '../../src/cli.js'

const operations = ['inspect', 'prepare', 'submit', 'lookup', 'cancel', 'result', 'export'] as const

describe('installed attempt command grammar and framing', () => {
  test('only a complete submit grammar requests the execution host', () => {
    for (const operation of operations) {
      const arguments_ = ['attempt', operation, '--json']
      expect(privateCliAttemptOperation(arguments_)).toBe(operation)
      expect(privateCliRequiresHost(arguments_)).toBe(operation === 'submit')
      for (const invalid of [
        ['attempt', operation],
        ['attempt', operation, '--json', 'ticket-must-not-be-an-argument'],
        ['attempt', operation, '--json', '--json'],
        ['attempt', operation, '--input', '{}'],
        ['attempt', '--json', operation],
      ]) {
        expect(privateCliAttemptOperation(invalid)).toBeUndefined()
        expect(privateCliRequiresHost(invalid)).toBe(false)
      }
    }
    expect(privateCliRequiresHost(['attempt', 'retry', '--json'])).toBe(false)
    expect(privateCliCommandLifetimeMs(['attempt', 'submit', '--json'])).toBe(
      privateCliCommandLifetimeMs(['run', 'flow:flows/example', '--timeout', '24h']),
    )
    expect(privateCliCommandLifetimeMs(['attempt', 'lookup', '--json'])).toBe(300_000)
  })

  test('help never consumes stdin or acquires a host', async () => {
    for (const arguments_ of [
      ['attempt', '--help'],
      ...operations.map((operation) => ['attempt', operation, '--help']),
    ]) {
      const input = new PassThrough()
      let output = ''
      try {
        expect(
          await main(arguments_, {
            interactive: false,
            attemptInputStream: input,
            writeOutput: (text) => {
              output += text
            },
            host: {
              acquire: async () => {
                throw new Error('help acquired execution authority')
              },
            },
          }),
        ).toBe(0)
        expect(output).toContain('prepare|submit|lookup|cancel|result|export')
        expect(output).toContain('not permission')
        expect(input.listenerCount('data')).toBe(0)
        expect(privateCliRequiresHost(arguments_)).toBe(false)
      } finally {
        input.destroy()
      }
    }
  })

  test('malformed machine input produces a bounded typed record without invoking the adapter', async () => {
    for (const request of [
      'not-json\n',
      '{"protocolVersion":1,"protocolVersion":1}\n',
      '{"protocolVersion":2,"operation":"lookup","request":{"ticket":"secret-marker"}}\n',
      '{"protocolVersion":1,"operation":"submit","request":{}}\n',
    ]) {
      const input = new PassThrough()
      let output = ''
      let invoked = false
      const pending = main(['attempt', 'lookup', '--json'], {
        interactive: false,
        attemptInputStream: input,
        writeRecord: async (text) => {
          output += text
        },
        executeAttempt: async () => {
          invoked = true
          return 0
        },
      })
      input.end(request)
      try {
        expect(await pending).toBe(1)
        expect(invoked).toBe(false)
        expect(JSON.parse(output)).toMatchObject({
          protocolVersion: 1,
          operation: 'lookup',
          event: 'error',
          code: 'INVALID_REQUEST',
        })
        expect(output).not.toContain('secret-marker')
        expect(output.trim().split('\n')).toHaveLength(1)
        expect(input.listenerCount('data')).toBe(0)
      } finally {
        input.destroy()
      }
    }
  })

  test('lookup consumes finite input without acquiring execution authority', async () => {
    const input = new PassThrough()
    let output = ''
    let invoked = false
    const pending = main(['attempt', 'lookup', '--json'], {
      interactive: false,
      attemptInputStream: input,
      host: {
        acquire: async () => {
          throw new Error('lookup acquired execution authority')
        },
      },
      writeRecord: async (text) => {
        output += text
      },
      executeAttempt: async ({ operation, request, writeRecord }) => {
        invoked = true
        expect(operation).toBe('lookup')
        expect(request).toEqual({ ticket: 'opaque-test-ticket' })
        await writeRecord({
          protocolVersion: 1,
          operation: 'lookup',
          event: 'result',
          value: { identity: 'prepared', dispatch: 'not-dispatched' },
        })
        return 0
      },
    })
    input.end(
      `${JSON.stringify({
        protocolVersion: 1,
        operation: 'lookup',
        request: { ticket: 'opaque-test-ticket' },
      })}\n`,
    )
    try {
      expect(await pending).toBe(0)
      expect(invoked).toBe(true)
      expect(JSON.parse(output).value).toEqual({ identity: 'prepared', dispatch: 'not-dispatched' })
      expect(input.listenerCount('data')).toBe(0)
    } finally {
      input.destroy()
    }
  })

  test('submit request completion does not prematurely close its owning connection', async () => {
    const input = new PassThrough()
    let entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    let finished = false
    const pending = main(['attempt', 'submit', '--json'], {
      interactive: false,
      attemptInputStream: input,
      writeRecord: async () => {},
      executeAttempt: async ({ clientClosed }) => {
        expect(clientClosed.aborted).toBe(false)
        entered()
        await new Promise<void>((resolve) => {
          clientClosed.addEventListener('abort', () => resolve(), { once: true })
        })
        finished = true
        return 0
      },
    })
    input.write(
      `${JSON.stringify({
        protocolVersion: 1,
        operation: 'submit',
        request: {
          ticket: 'opaque-test-ticket',
          request: {
            expectedApproval: `sha256:${'a'.repeat(64)}`,
            target: 'binding:producer',
            input: {},
            files: [],
            constraints: { durationMs: 1000, resultBytes: 1024, artifactBytes: 0 },
            outputIntent: { packet: false, receive: [] },
          },
        },
      })}\n`,
    )
    try {
      await ready
      expect(finished).toBe(false)
      input.end()
      expect(await pending).toBe(0)
      expect(finished).toBe(true)
    } finally {
      input.destroy()
    }
  })

  test('input byte limits and malformed backend frames fail closed before public disclosure', async () => {
    for (const oversized of [true, false]) {
      const input = new PassThrough()
      let output = ''
      let invoked = false
      const pending = main(['attempt', 'lookup', '--json'], {
        interactive: false,
        attemptInputStream: input,
        writeRecord: async (text) => {
          output += text
        },
        executeAttempt: async ({ writeRecord }) => {
          invoked = true
          await writeRecord({
            protocolVersion: 1,
            operation: 'lookup',
            event: 'result',
            value: { privateState: 'secret-marker' },
          })
          return 0
        },
      })
      input.end(
        oversized
          ? `"${'x'.repeat(ATTEMPT_REQUEST_BYTES)}"\n`
          : '{"protocolVersion":1,"operation":"lookup","request":{"ticket":"opaque-test-ticket"}}\n',
      )
      try {
        expect(await pending).toBe(1)
        expect(invoked).toBe(!oversized)
        expect(JSON.parse(output)).toMatchObject({
          operation: 'lookup',
          event: 'error',
          code: oversized ? 'INVALID_REQUEST' : 'INTERNAL',
        })
        expect(output).not.toContain('secret-marker')
      } finally {
        input.destroy()
      }
    }
  })
})
