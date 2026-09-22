import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import featureCases from '../../../conformance/run-1/fixtures/invocation-features.json'
import { CHANNEL_CONTRACT_SCHEMA } from '../src/channel-contract.js'
import { CheckError } from '../src/diagnostics.js'
import {
  INVOCATION_CONTRACT_LIMITS,
  INVOCATION_CONTRACT_SCHEMA,
  invocationContractChannelPaths,
  parseInvocationContract,
} from '../src/invocation-contract.js'
import { canonicalJson, type JsonValue } from '../src/json.js'
import { SchemaDiagnostic } from '../src/schema/index.js'

const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const descriptor = (fields: Record<string, unknown> = {}) => ({
  $schema: INVOCATION_CONTRACT_SCHEMA,
  ...fields,
})
const named = (fields: Record<string, unknown> = {}) =>
  descriptor({
    id: 'https://example.org/contracts/reviewer',
    version: '1.0.0',
    ...fields,
  })
const channel = (fields: Record<string, unknown> = {}) => ({
  $schema: CHANNEL_CONTRACT_SCHEMA,
  id: 'https://example.org/contracts/updates',
  version: '1.0.0',
  semantics: 'Bounded updates.',
  item: true,
  ...fields,
})

function reject(value: unknown, code?: string): void {
  try {
    parseInvocationContract(bytes(value))
    throw new Error('expected rejection')
  } catch (error) {
    expect(error).toBeInstanceOf(CheckError)
    if (code !== undefined) expect((error as CheckError).code).toBe(code)
  }
}

describe('Invocation Contract/1', () => {
  test.each(featureCases.valid)('preserves exact feature identity: $name', (fixture) => {
    const parsed = parseInvocationContract(bytes(fixture.descriptor))
    expect(parsed.digest).toBe(fixture.digest)
    expect(parsed.descriptor.features).toEqual(fixture.descriptor.features)
    expect(parsed.invocation).not.toHaveProperty('features')
    expect(Object.isFrozen(parsed.descriptor.features ?? parsed.descriptor)).toBe(true)
    expect(
      parseInvocationContract(
        bytes(Object.fromEntries(Object.entries(fixture.descriptor).reverse())),
      ).digest,
    ).toBe(fixture.digest)
  })

  test.each(featureCases.invalidFeatures)('rejects feature catalog: $name', (fixture) => {
    reject(named({ features: fixture.value }))
  })

  test('restricts the catalog to identified single-form contracts', () => {
    reject(descriptor({ features: {} }), 'CONTRACT_FIELD')
    reject(named({ operations: { review: {} }, features: {} }), 'CONTRACT_FIELD')
    reject(named({ operations: { review: { features: {} } } }), 'CONTRACT_FIELD')
    reject(named({ supports: ['conversation'] }), 'CONTRACT_FIELD')
    reject(named({ requires: ['conversation'] }), 'CONTRACT_FIELD')
    expect(parseInvocationContract(bytes(named({ features: {} }))).descriptor.features).toEqual({})
  })

  test('bounds feature names, entries and Unicode scalar descriptions', () => {
    const features = Object.fromEntries(
      Array.from({ length: INVOCATION_CONTRACT_LIMITS.features }, (_, index) => [
        `f-${index}`,
        'F.',
      ]),
    )
    expect(
      Object.keys(parseInvocationContract(bytes(named({ features }))).descriptor.features ?? {}),
    ).toHaveLength(INVOCATION_CONTRACT_LIMITS.features)
    reject(named({ features: { ...features, extra: 'Extra.' } }), 'CONTRACT_LIMIT')
    expect(
      parseInvocationContract(bytes(named({ features: { ['a'.repeat(64)]: 'Valid.' } }))).descriptor
        .features,
    ).toHaveProperty('a'.repeat(64))
    reject(named({ features: { ['a'.repeat(65)]: 'Invalid.' } }), 'CONTRACT_LOCAL_NAME')
    const description = '🔎'.repeat(16_384)
    expect(
      parseInvocationContract(bytes(named({ features: { inspect: description } }))).descriptor
        .features?.inspect,
    ).toBe(description)
    reject(named({ features: { inspect: `${description}x` } }), 'CONTRACT_FIELD')
    expect(() =>
      parseInvocationContract(bytes(named({ features: { inspect: '\ud800' } }))),
    ).toThrow(CheckError)
  })

  test('rejects duplicate catalog keys before parsing loses the evidence', () => {
    const source = JSON.stringify(named()).slice(0, -1)
    for (const duplicate of [
      ',"features":{"events":"First.","events":"Second."}}',
      ',"features":{},"features":{}}',
    ]) {
      expect(() => parseInvocationContract(new TextEncoder().encode(source + duplicate))).toThrow(
        CheckError,
      )
    }
  })

  test('includes feature names and descriptions in the complete channel closure identity', () => {
    const value = named({
      features: { events: 'Public updates.' },
      channels: { events: { direction: 'send', contract: './updates.json', required: false } },
    })
    const documents = new Map([['updates.json', bytes(channel())]])
    const parsed = parseInvocationContract(bytes(value), 'FLOW.contract.json', documents)
    expect(parsed.channelContracts.size).toBe(1)
    expect(parsed.digest).toBe(
      parseInvocationContract(bytes(value), 'moved/FLOW.contract.json', documents).digest,
    )
    expect(parsed.digest).not.toBe(
      parseInvocationContract(
        bytes({ ...value, features: { updates: 'Public updates.' } }),
        'FLOW.contract.json',
        documents,
      ).digest,
    )
    expect(parsed.digest).not.toBe(
      parseInvocationContract(
        bytes(value),
        'FLOW.contract.json',
        new Map([['updates.json', bytes(channel({ semantics: 'Changed.' }))]]),
      ).digest,
    )
  })

  test('supports an anonymous discriminator-only contract without inferred constraints', () => {
    const parsed = parseInvocationContract(bytes(descriptor()))
    expect(parsed.profile).toBe('single')
    expect(parsed.invocation).toEqual({})
    expect(parsed.descriptor.id).toBeUndefined()
    expect(parsed.schemas.size).toBe(0)
    expect(Object.isFrozen(parsed.descriptor)).toBe(true)
    expect(Object.isFrozen(parsed.invocation)).toBe(true)
  })

  test('compiles input and complete results using shared root definitions', () => {
    const parsed = parseInvocationContract(
      bytes(
        named({
          input: { $ref: '#/$defs/Input' },
          result: {
            type: 'object',
            properties: { outcome: { enum: ['done', 'declined'] }, output: true },
            required: ['outcome', 'output'],
            additionalProperties: false,
          },
          outcomes: { declined: 'The reviewer declined.' },
          attachments: { source: 'read', result: 'read-write' },
          $defs: { Input: { type: 'string', minLength: 1 } },
        }),
      ),
    )
    parsed.schemas.get('/input')!.validate('input', 'INVALID_INPUT')
    parsed.schemas.get('/result')!.validate({ outcome: 'declined', output: null }, 'INVALID_RESULT')
    expect(() => parsed.schemas.get('/input')!.validate('', 'INVALID_INPUT')).toThrow(
      SchemaDiagnostic,
    )
    expect(() => parsed.schemas.get('/result')!.validate('text', 'INVALID_RESULT')).toThrow(
      SchemaDiagnostic,
    )
    expect(parsed.invocation!.attachments).toEqual({ source: 'read', result: 'read-write' })
  })

  test('validates the future named form without selecting any operation', () => {
    const parsed = parseInvocationContract(
      bytes(
        descriptor({
          operations: { run: {}, revise: { input: false, outcomes: { declined: 'Declined.' } } },
        }),
      ),
    )
    expect(parsed.profile).toBe('named')
    expect(parsed.invocation).toBeUndefined()
    expect([...parsed.schemas.keys()]).toEqual(['/operations/revise/input'])
    expect(() =>
      parsed.schemas.get('/operations/revise/input')!.validate(null, 'INVALID_INPUT'),
    ).toThrow(SchemaDiagnostic)
    reject(descriptor({ operations: { run: {} }, input: true }), 'CONTRACT_FIELD')
    reject(descriptor({ operations: {} }), 'CONTRACT_LIMIT')
  })

  test('uses one exact domain-separated descriptor and offline closure digest', () => {
    const value = named({ input: true })
    const parsed = parseInvocationContract(bytes(value))
    const canonical = canonicalJson({ descriptor: value, channelContracts: {} } as JsonValue)
    expect(parsed.digest).toBe(
      `sha256:${createHash('sha256').update('FLOW-Invocation-Contract/1\0').update(canonical).digest('hex')}`,
    )
    expect(parsed.digest).toBe(
      parseInvocationContract(new TextEncoder().encode(JSON.stringify(value, null, 2))).digest,
    )
    expect(parsed.digest).not.toBe(parseInvocationContract(bytes(named())).digest)
    expect(parsed.digest).not.toBe(
      parseInvocationContract(bytes(named({ input: true, outcomes: {} }))).digest,
    )
    expect(parsed.digest).not.toBe(
      parseInvocationContract(bytes(named({ input: { description: 'Any value.' } }))).digest,
    )
  })

  test('relocates complete bundles unchanged while retaining descriptor-relative pointers', () => {
    const source = bytes(
      named({
        channels: {
          updates: { direction: 'send', contract: './contracts/updates.json', required: false },
        },
      }),
    )
    const documents = new Map([['contracts/updates.json', bytes(channel())]])
    const root = parseInvocationContract(source, 'FLOW.contract.json', documents)
    const relocated = parseInvocationContract(
      source,
      'interfaces/reviewer/FLOW.contract.json',
      documents,
    )
    expect(root.digest).toBe(relocated.digest)
    expect(relocated.channelContracts.get('contracts/updates.json')!.itemSchema.path).toBe(
      'interfaces/reviewer/contracts/updates.json',
    )
    const changed = new Map([['contracts/updates.json', bytes(channel({ semantics: 'Changed.' }))]])
    expect(parseInvocationContract(source, 'FLOW.contract.json', changed).digest).not.toBe(
      root.digest,
    )
    expect(() => parseInvocationContract(source)).toThrow(CheckError)
  })

  test('includes optional ports and every unselected named operation in the closure', () => {
    const source = bytes(
      descriptor({
        operations: {
          first: { channels: { a: { direction: 'send', contract: './a.json', required: false } } },
          second: {
            channels: {
              duplicate: { direction: 'receive', contract: './a.json' },
              other: { direction: 'send', contract: './b.json' },
            },
          },
        },
      }),
    )
    expect(invocationContractChannelPaths(source)).toEqual(['a.json', 'b.json'])
    const documents = new Map([
      ['a.json', bytes(channel())],
      ['b.json', bytes(channel())],
    ])
    expect(
      parseInvocationContract(source, 'FLOW.contract.json', documents).channelContracts.size,
    ).toBe(2)
  })

  test('preserves declaration omission rather than inserting channel defaults', () => {
    const plain = descriptor({ channels: { events: { direction: 'receive', schema: true } } })
    const explicit = descriptor({
      channels: {
        events: { direction: 'receive', schema: true, required: true, start: 'beginning' },
      },
    })
    const parsed = parseInvocationContract(bytes(plain))
    expect(parsed.descriptor.channels!.events).toEqual({ direction: 'receive', schema: true })
    expect(parsed.digest).not.toBe(parseInvocationContract(bytes(explicit)).digest)
  })

  test('inline channel schemas share the graph but cannot reference descriptor definitions', () => {
    reject(
      descriptor({
        channels: { events: { direction: 'send', schema: { $ref: '#/$defs/Value' } } },
        $defs: { Value: true },
      }),
      'CONTRACT_CHANNEL_SCHEMA',
    )
    reject(
      descriptor({
        channels: {
          events: {
            direction: 'send',
            schema: { properties: { nested: { $defs: { Value: true } } } },
          },
        },
      }),
      'CONTRACT_CHANNEL_SCHEMA',
    )
    const parsed = parseInvocationContract(
      bytes(
        descriptor({
          channels: {
            events: {
              direction: 'send',
              schema: {
                type: 'object',
                properties: { $ref: { type: 'string' }, $defs: true },
                examples: [{ $ref: '#/$defs/OrdinaryData', $defs: { OrdinaryData: true } }],
              },
            },
          },
        }),
      ),
    )
    parsed.schemas
      .get('/channels/events/schema')!
      .validate({ $ref: 'literal', $defs: null }, 'INVALID_CHANNEL_ITEM')
  })

  test('checks unused definitions and limits the whole invocation schema graph', () => {
    expect(() =>
      parseInvocationContract(
        bytes(descriptor({ $defs: { Unused: { $ref: '#/$defs/Missing' } } })),
      ),
    ).toThrow(SchemaDiagnostic)
    expect(() =>
      parseInvocationContract(
        bytes(descriptor({ $defs: { A: { $ref: '#/$defs/B' }, B: { $ref: '#/$defs/A' } } })),
      ),
    ).toThrow(SchemaDiagnostic)
    const operations: Record<string, unknown> = {}
    for (let index = 0; index < 256; index++) {
      operations[`op-${index}`] = {
        input: { allOf: Array.from({ length: 15 }, () => true) },
        channels: { events: { direction: 'send', schema: true } },
      }
    }
    expect(() => parseInvocationContract(bytes(descriptor({ operations })))).toThrow(
      SchemaDiagnostic,
    )
  })

  test('enforces closure path count and aggregate encoded preimage bounds', () => {
    const channels: Record<string, unknown> = {}
    for (let index = 0; index <= INVOCATION_CONTRACT_LIMITS.channelPaths; index++) {
      channels[`c-${index}`] = { direction: 'send', contract: `./c-${index}.json` }
    }
    reject(descriptor({ channels }), 'CONTRACT_LIMIT')
    const boundedChannels = Object.fromEntries(Object.entries(channels).slice(0, 5))
    const documents = new Map(
      Array.from({ length: 5 }, (_, index) => [
        `c-${index}.json`,
        bytes(channel({ item: { description: 'a'.repeat(220_000) } })),
      ]),
    )
    expect(() =>
      parseInvocationContract(
        bytes(descriptor({ channels: boundedChannels })),
        'FLOW.contract.json',
        documents,
      ),
    ).toThrow('preimage exceeds')
  })

  test.each([
    '../channel.json',
    './a/../channel.json',
    './a//channel.json',
    './a\\channel.json',
    'https://example.org/channel.json',
    './a\u0000.json',
    './',
  ])('rejects unsafe channel reference %j before reading', (contract) => {
    reject(descriptor({ channels: { events: { direction: 'send', contract } } }))
  })

  test.each([
    'http://example.org/contracts/x',
    'https://localhost/contracts/x',
    'https://Example.org/contracts/x',
    'https://example.org:443/contracts/x',
    'https://user@example.org/contracts/x',
    'https://127.0.0.1/contracts/x',
    'https://example.org/contracts//x',
    'https://example.org/contracts/../x',
    'https://example.org/contracts/x%20y',
    'https://example.org/contracts/x?version=1',
    'https://example.org/contracts/x#fragment',
    'https://example.org/contracts/x\n',
    'https://example.org\n/contracts/x',
  ])('rejects noncanonical identity %s', (id) => reject(named({ id }), 'CONTRACT_ID'))

  test.each(['1', 'v1.0.0', '01.0.0', '1.01.0', '1.0.01', '1.0.0-rc.1', '1.0.0+x', '1.0.0\n'])(
    'rejects non-core version %s',
    (version) => reject(named({ version }), 'CONTRACT_VERSION'),
  )

  test.each(
    [
      null,
      true,
      [],
      {},
      descriptor({ id: 'https://example.org/contracts/x' }),
      descriptor({ version: '1.0.0' }),
      descriptor({ surprise: true }),
      descriptor({ operations: null }),
      descriptor({ outcomes: null }),
      descriptor({ outcomes: { done: 'Reserved.' } }),
      descriptor({ outcomes: { good: '' } }),
      descriptor({ outcomes: { Bad: 'Bad name.' } }),
      descriptor({ attachments: { source: 'write' } }),
      descriptor({ outcomes: { 'bad\n': 'Bad name.' } }),
      descriptor({ channels: { 'bad\n': { direction: 'send' } } }),
    ].map((value) => [value] as const),
  )('rejects invalid descriptor shape %#', (value) => reject(value))

  test('preserves duplicate-key, UTF-8 and encoded byte rejection', () => {
    expect(() =>
      parseInvocationContract(
        new TextEncoder().encode(
          `{"$schema":"${INVOCATION_CONTRACT_SCHEMA}","input":true,"input":false}`,
        ),
      ),
    ).toThrow(CheckError)
    expect(() => parseInvocationContract(Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d))).toThrow(
      CheckError,
    )
    expect(() => parseInvocationContract(Uint8Array.of(0xff))).toThrow(CheckError)
    expect(() =>
      parseInvocationContract(new Uint8Array(INVOCATION_CONTRACT_LIMITS.bytes + 1)),
    ).toThrow(CheckError)
  })
})
