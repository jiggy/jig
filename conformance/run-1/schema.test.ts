import { describe, expect, test } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020.js'

import cases from './fixtures/messages.json'
import errorRegistry from '../../docs/flow/spec/machine/run-1-errors.json'
import schema from '../../docs/flow/spec/machine/run-1.schema.json'
import channelContractSchema from '../../docs/flow/spec/machine/channel-contract-1.schema.json'
import capabilityContractSchema from '../../docs/flow/spec/machine/capability-contract-1.schema.json'

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
  test('accepts named channel meaning and capability channel requirements', () => {
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
    const capability = descriptors.compile(capabilityContractSchema)
    const method = {
      input: true,
      output: true,
      errors: {},
      channels: {
        readings: { direction: 'send', contract: './contracts/readings.json', required: false },
      },
    }
    const contract = {
      $schema: capabilityContractSchema.$id,
      flowCapabilityContract: 1,
      id: 'https://example.org/contracts/reader',
      version: '1.0.0',
      methods: { run: method },
    }
    expect(capability(contract), JSON.stringify(capability.errors)).toBe(true)
    expect(
      capability({
        ...contract,
        methods: {
          run: {
            ...method,
            channels: {
              readings: { direction: 'send', schema: true, contract: './contract.json' },
            },
          },
        },
      }),
    ).toBe(false)
  })
  test('keeps invocation context and child requests separate', () => {
    const invocation = cases.valid.find((fixture) => fixture.definition === 'flowRunRequest')!.value
    const child = cases.valid.find((fixture) => fixture.definition === 'childFlowRequest')!.value
    const run = definition('flowRunRequest')
    const runChild = definition('childFlowRequest')
    expect(run({ ...invocation, params: child.params })).toBe(false)
    expect(runChild({ ...child, params: invocation.params })).toBe(false)
    expect(run(child)).toBe(false)
    expect(runChild(invocation)).toBe(false)
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
