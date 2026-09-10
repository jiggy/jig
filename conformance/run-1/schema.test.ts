import { describe, expect, test } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020.js'
import sessionContract from '../../docs/flow/spec/examples/invocation-contracts/session-store.contract.json'
import ticketContract from '../../docs/flow/spec/examples/schema-files/FLOW.contract.json'
import channelContractSchema from '../../docs/flow/spec/machine/channel-contract-1.schema.json'
import invocationContractSchema from '../../docs/flow/spec/machine/invocation-contract-1.schema.json'
import schema from '../../docs/flow/spec/machine/run-1.schema.json'
import errorRegistry from '../../docs/flow/spec/machine/run-1-errors.json'
import cases from './fixtures/messages.json'

const ajv = new Ajv2020({ allErrors: true, strict: true })
ajv.addSchema(schema)

describe('Run/1 message schemas', () => {
  test('separates broadcast subscription authority from endpoint grants', () => {
    const send = { endpoint: 'send:1', direction: 'send', delivery: 'broadcast' }
    const receive = {
      endpoint: 'receive:1',
      direction: 'receive',
      delivery: 'broadcast',
      startSequence: 7,
    }
    expect(definition('channelCreateParams')({ delivery: 'broadcast' })).toBe(true)
    expect(definition('channelBroadcast')({ send, source: 'source:1' })).toBe(true)
    expect(definition('channelBroadcast')({ send, source: 'source:1', receive })).toBe(false)
    expect(definition('channelPair')({ send, receive })).toBe(false)
    expect(definition('channelSubscription')(receive)).toBe(true)
    expect(definition('channelSubscription')({ receive })).toBe(false)
    expect(definition('channelGrant')({ source: 'source:1' })).toBe(false)
    expect(definition('channelReceiverGrant')({ ...receive, delivery: 'direct' })).toBe(false)
    expect(definition('channelReceiverGrant')({ ...receive, startSequence: 0 })).toBe(false)
    const subscribe = {
      jsonrpc: '2.0',
      id: 'sdk:1',
      method: 'channel/subscribe',
      params: { source: 'source:1' },
    }
    expect(definition('channelSubscribeRequest')(subscribe)).toBe(true)
    expect(
      definition('channelSubscribeRequest')({ ...subscribe, params: { endpoint: 'source:1' } }),
    ).toBe(false)
    expect(
      definition('channelSuccessResponse')({ jsonrpc: '2.0', id: 'sdk:1', result: receive }),
    ).toBe(true)
  })
  test('uses canonical named identity syntax on endpoint grants', () => {
    const validate = definition('channelContractIdentity')
    const identity = { version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` }
    for (const id of [
      'https://example.org/channels/readings',
      'https://123.456/channel',
      `https://example.org/${'a'.repeat(2049)}`,
    ])
      expect(validate({ ...identity, id })).toBe(true)
    for (const id of [
      'https://127.0.0.1/channel',
      'https://example.org/../channel',
      'https://example.org/channel/',
      'https://EXAMPLE.org/channel',
      'https://example/channel',
    ])
      expect(validate({ ...identity, id })).toBe(false)
  })
  test('accepts named channel meaning and invocation channel requirements', () => {
    const descriptors = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
    const channel = descriptors.compile(channelContractSchema)
    const value = {
      $schema: channelContractSchema.$id,
      id: 'https://example.org/channels/readings',
      version: '1.0.0',
      semantics: 'Each item reports one Celsius reading for the named sample.',
      item: {
        type: 'object',
        properties: { sample: { type: 'string' }, celsius: { type: 'number' } },
        required: ['sample', 'celsius'],
        additionalProperties: false,
      },
    }
    expect(channel(value), JSON.stringify(channel.errors)).toBe(true)
    expect(channel({ ...value, transport: 'websocket' })).toBe(false)
    expect(channel({ ...value, version: '01.0.0' })).toBe(false)
    const invocation = descriptors.compile(invocationContractSchema)
    const operation = {
      input: true,
      result: true,
      channels: {
        readings: { direction: 'send', contract: './contracts/readings.json', required: false },
      },
    }
    const contract = {
      $schema: invocationContractSchema.$id,
      id: 'https://example.org/contracts/reader',
      version: '1.0.0',
      ...operation,
    }
    expect(invocation(contract), JSON.stringify(invocation.errors)).toBe(true)
    expect(
      invocation({
        ...contract,
        channels: {
          readings: { direction: 'send', schema: true, contract: './FLOW.contract.json' },
        },
      }),
    ).toBe(false)
  })
  test('keeps incoming invocation context and outgoing calls separate', () => {
    const invocation = cases.valid.find((fixture) => fixture.definition === 'flowRunRequest')!.value
    const child = cases.valid.find((fixture) => fixture.definition === 'flowCallRequest')!.value
    const run = definition('flowRunRequest')
    const runChild = definition('flowCallRequest')
    expect(run({ ...invocation, params: child.params })).toBe(false)
    expect(runChild({ ...child, params: invocation.params })).toBe(false)
    expect(run(child)).toBe(false)
    expect(runChild(invocation)).toBe(false)
  })

  test('requires paired identity and disjoint single or named invocation shapes', () => {
    const descriptors = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
    const validate = descriptors.compile(invocationContractSchema)
    const anonymous = { $schema: invocationContractSchema.$id, input: true, result: true }
    const identity = { id: 'https://example.org/contracts/read', version: '1.0.0' }
    expect(validate(anonymous)).toBe(true)
    expect(validate({ ...anonymous, ...identity })).toBe(true)
    expect(validate({ ...anonymous, id: identity.id })).toBe(false)
    expect(validate({ ...anonymous, version: identity.version })).toBe(false)
    expect(validate({ ...anonymous, unknown: true })).toBe(false)
    // Structural recognition is not initial-profile execution support.
    const named = {
      $schema: invocationContractSchema.$id,
      operations: { read: { input: true, result: true } },
    }
    expect(validate(named)).toBe(true)
    expect(validate({ ...named, input: true })).toBe(false)
    expect(validate({ ...named, operations: {} })).toBe(false)
    for (const reserved of ['done', 'failed', 'cancelled', 'error']) {
      expect(validate({ ...anonymous, outcomes: { [reserved]: 'Reserved.' } })).toBe(false)
    }
    expect(validate({ ...anonymous, outcomes: { 'not-found': 'No item exists.' } })).toBe(true)
  })

  test('keeps inline channel schemas reference-free in keyword positions', () => {
    const descriptors = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
    const validate = descriptors.compile(invocationContractSchema)
    const contract = (item: unknown) => ({
      $schema: invocationContractSchema.$id,
      channels: { events: { direction: 'send', schema: item } },
    })
    expect(validate(contract({ type: 'object', properties: { $ref: { type: 'string' } } }))).toBe(
      true,
    )
    expect(validate(contract({ $ref: '#/$defs/Event' }))).toBe(false)
    expect(validate(contract({ type: 'array', items: { $ref: '#/$defs/Event' } }))).toBe(false)
    expect(validate(contract({ $defs: { Event: true } }))).toBe(false)
    for (const reference of ['./../channel.json', './channel.json\n', './a\\b.json']) {
      expect(
        validate({
          $schema: invocationContractSchema.$id,
          channels: { events: { direction: 'send', contract: reference } },
        }),
      ).toBe(false)
    }
  })

  test('accepts both public invocation descriptor examples', () => {
    const descriptors = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
    const validate = descriptors.compile(invocationContractSchema)
    for (const example of [sessionContract, ticketContract]) {
      expect(validate(example), JSON.stringify(validate.errors)).toBe(true)
    }
  })

  test('public result schemas constrain the complete correlated result', () => {
    const descriptors = new Ajv2020({ allErrors: true, strict: true })
    const validate = descriptors.compile({
      ...sessionContract.result,
      $defs: sessionContract.$defs,
    })
    expect(validate({ outcome: 'done', output: { sessionId: 'session:1' } })).toBe(true)
    expect(validate({ outcome: 'not-found', output: { sessionId: 'session:1' } })).toBe(true)
    expect(validate({ outcome: 'not-found', output: {} })).toBe(false)
    expect(validate({ outcome: 'undeclared', output: { sessionId: 'session:1' } })).toBe(false)
    expect(validate({ sessionId: 'session:1' })).toBe(false)
  })

  for (const fixture of cases.valid) {
    test(`accepts ${fixture.name}`, () => {
      const validate = definition(fixture.definition)
      expect(validate(fixture.value), JSON.stringify(validate.errors)).toBe(true)
    })
  }

  for (const fixture of cases.invalid) {
    test(`rejects ${fixture.name}`, () => {
      const validate = definition(fixture.definition)
      expect(validate(fixture.value)).toBe(false)
    })
  }

  test('enforces the fixed attachment bound', () => {
    const validate = definition('flowRunRequest')
    const attachments = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [
        `a-${index}`,
        { path: `/a/${index}`, access: 'read' },
      ]),
    )
    expect(
      validate({
        jsonrpc: '2.0',
        id: 'host:1',
        method: 'flow/run',
        params: {
          protocol: 'run/1',
          input: null,
          settings: {},
          attachments,
          scratch: '/tmp',
          deadlineUnixMs: 0,
        },
      }),
    ).toBe(false)
  })

  test('enforces the error-message scalar bound', () => {
    const validate = definition('flowErrorResponse')
    expect(
      validate({
        jsonrpc: '2.0',
        id: 'host:1',
        error: {
          code: -32000,
          message: 'x'.repeat(1_025),
          data: { code: 'EXECUTION_FAILED' },
        },
      }),
    ).toBe(false)
  })

  test('requires null only for parse errors', () => {
    const validate = definition('standardErrorResponse')
    expect(validate(standardError(-32700, 'host:1'))).toBe(false)
    expect(validate(standardError(-32602, null))).toBe(false)
    expect(validate(standardError(-32700, null))).toBe(true)
    expect(validate(standardError(-32602, 'host:1'))).toBe(true)
  })

  test('keeps the schema and error registry code sets identical', () => {
    const definition = schema.$defs.flowErrorCode as { enum: string[] }
    expect(definition.enum).toEqual(errorRegistry.wire)
  })
})

function standardError(code: number, id: string | null) {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message: 'error' },
  }
}

function definition(name: string) {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`)
  if (!validate) throw new Error(`schema definition not found: ${name}`)
  return validate
}
