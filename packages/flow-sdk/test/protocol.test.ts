import { describe, expect, test } from 'bun:test'

import {
  parseEnvelope,
  parseChannelGrant,
  parseChannelGrants,
  parseRunResult,
  resultMessage,
  validateChildFlowRequest,
} from '../src/protocol.ts'

describe('JSON-RPC envelope validation', () => {
  test('rejects null and scalar request params', () => {
    for (const params of [null, false, 1, 'value']) {
      expect(() =>
        parseEnvelope({
          jsonrpc: '2.0',
          id: 'host:1',
          method: 'flow/run',
          params,
        }),
      ).toThrow()
    }
  })

  test('rejects null and scalar notification params', () => {
    for (const params of [null, false, 1, 'value']) {
      expect(() =>
        parseEnvelope({
          jsonrpc: '2.0',
          method: 'request/cancel',
          params,
        }),
      ).toThrow()
    }
  })

  test('accepts object and array params', () => {
    expect(
      parseEnvelope({
        jsonrpc: '2.0',
        id: 'host:1',
        method: 'flow/run',
        params: {},
      }).value.params,
    ).toEqual({})
    expect(
      parseEnvelope({
        jsonrpc: '2.0',
        method: 'progress',
        params: ['working'],
      }).value.params,
    ).toEqual(['working'])
  })
})

describe('channel grants', () => {
  test('accepts immutable direct source metadata and exact named identity', () => {
    const contract = {
      id: 'https://example.test/events/public',
      version: '1.0.0',
      digest: `sha256:${'a'.repeat(64)}`,
    }
    expect(
      parseChannelGrant({
        endpoint: 'source:send',
        direction: 'send',
        delivery: 'direct',
        contract,
      }),
    ).toEqual({
      endpoint: 'source:send',
      direction: 'send',
      delivery: 'direct',
      contract,
    })
  })

  test('rejects wrong direction fields, duplicates, unsupported delivery and false start', () => {
    for (const value of [
      { endpoint: 'source:send', direction: 'send', delivery: 'direct', startSequence: 1 },
      { endpoint: 'source:read', direction: 'receive', delivery: 'direct' },
      { endpoint: 'source:read', direction: 'receive', delivery: 'direct', startSequence: 2 },
      { endpoint: 'source:read', direction: 'receive', delivery: 'socket', startSequence: 1 },
      ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((startSequence) => ({
        endpoint: 'source:read',
        direction: 'receive',
        delivery: 'broadcast',
        startSequence,
      })),
    ])
      expect(() => parseChannelGrant(value as never)).toThrow()
    const value = {
      endpoint: 'source:read',
      direction: 'receive',
      delivery: 'direct',
      startSequence: 1,
    }
    expect(() => parseChannelGrants({ one: value, two: value })).toThrow()
  })

  test('rejects noncanonical named identities instead of guessing compatibility', () => {
    for (const id of [
      'https://Example.test/a',
      'https://example.test/a#b',
      'https://example.test/../a',
      'https://example.test/a//b',
      'https://127.0.0.1/events',
    ]) {
      expect(() =>
        parseChannelGrant({
          endpoint: 's:1',
          direction: 'send',
          delivery: 'direct',
          contract: { id, version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` },
        }),
      ).toThrow()
    }
  })

  test('accepts broadcast source metadata and positive safe suffix starts', () => {
    for (const startSequence of [1, 7, Number.MAX_SAFE_INTEGER])
      expect(
        parseChannelGrant({
          endpoint: 'source:read',
          direction: 'receive',
          delivery: 'broadcast',
          startSequence,
        }),
      ).toEqual({
        endpoint: 'source:read',
        direction: 'receive',
        delivery: 'broadcast',
        startSequence,
      })
  })

  test('does not invent a grant-only contract identity length limit', () => {
    const id = `https://example.test/${'long-identity'.repeat(180)}`
    expect(
      parseChannelGrant({
        endpoint: 's:1',
        direction: 'send',
        delivery: 'direct',
        contract: { id, version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` },
      }).contract!.id,
    ).toBe(id)
  })

  test('accepts numeric DNS labels that are not IPv4 addresses', () => {
    for (const id of ['https://1.2/events', 'https://999.2.3.4/events'])
      expect(
        parseChannelGrant({
          endpoint: 's:1',
          direction: 'send',
          delivery: 'broadcast',
          contract: { id, version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` },
        }).contract!.id,
      ).toBe(id)
  })
})

describe('public call validation', () => {
  test('counts intent length in Unicode scalars rather than UTF-16 units', () => {
    expect(() =>
      validateChildFlowRequest({
        operationId: 'unicode:1',
        slot: 'worker',
        intent: '😀'.repeat(10_000),
        input: null,
      }),
    ).not.toThrow()
    expect(() =>
      validateChildFlowRequest({
        operationId: 'unicode:2',
        slot: 'worker',
        intent: 'x'.repeat(16_384),
        input: null,
      }),
    ).not.toThrow()
    expect(() =>
      validateChildFlowRequest({
        operationId: 'unicode:3',
        slot: 'worker',
        intent: 'x'.repeat(16_385),
        input: null,
      }),
    ).toThrow(TypeError)
  })

  test('rejects non-string iterable and array-like intents at runtime', () => {
    for (const intent of [42, ['x'], { 0: 'x', length: 1 }]) {
      expect(() =>
        validateChildFlowRequest({
          operationId: 'invalid:1',
          slot: 'worker',
          intent,
          input: null,
        } as never),
      ).toThrow(TypeError)
    }
  })
})

describe('Run results', () => {
  test('preserves the exact Run/1 result wire shape', () => {
    const result = parseRunResult({
      outcome: 'done',
      output: { nested: [true, null, 'value'] },
    })

    expect(resultMessage('host:1', result)).toEqual({
      jsonrpc: '2.0',
      id: 'host:1',
      result: {
        outcome: 'done',
        output: { nested: [true, null, 'value'] },
      },
    })
  })
})
