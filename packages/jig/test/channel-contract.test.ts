import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  CHANNEL_CONTRACT_BYTES,
  CHANNEL_CONTRACT_SCHEMA,
  parseChannelContract,
  parseChannelDeclarations,
  requireChannelReference,
} from '../src/channel-contract.js'
import { CheckError } from '../src/diagnostics.js'
import { INVOCATION_CONTRACT_SCHEMA, parseInvocationContract } from '../src/invocation-contract.js'
import { canonicalJson, type JsonObject, type JsonValue } from '../src/json.js'
import { checkPackageDirectory } from '../src/package/inspect.js'
import { SchemaDiagnostic } from '../src/schema/index.js'

const encoder = new TextEncoder()
const reference = './contracts/public-events.json'

function descriptor(overrides: JsonObject = {}): JsonObject {
  return {
    $schema: CHANNEL_CONTRACT_SCHEMA,
    id: 'https://example.org/channels/public-events',
    version: '1.0.0',
    semantics: 'Each message appends one public text fragment.',
    item: { type: 'string' },
    ...overrides,
  }
}

function bytes(value: JsonValue): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

function invocation(channels: JsonObject): JsonObject {
  return {
    $schema: INVOCATION_CONTRACT_SCHEMA,
    id: 'https://example.org/contracts/worker',
    version: '1.0.0',
    channels,
  }
}

function metadata(fields: JsonObject): string {
  return `---\n${JSON.stringify({ name: 'reader', description: 'Read public events.', ...fields })}\n---\nObserve supplied values.\n`
}

describe('Channel Contract/1', () => {
  test('uses the complete canonical descriptor and a distinct digest domain', () => {
    const value = descriptor()
    const compact = parseChannelContract(bytes(value))
    const spaced = parseChannelContract(encoder.encode(`${JSON.stringify(value, null, 2)}\n`))
    const expected = `sha256:${createHash('sha256').update('FLOW-Channel-Contract/1\0').update(canonicalJson(value)).digest('hex')}`
    expect(compact.digest).toBe(expected)
    expect(spaced.digest).toBe(expected)
    expect(
      parseChannelContract(bytes(descriptor({ semantics: 'Replace the public text.' }))).digest,
    ).not.toBe(expected)
    expect(() => compact.itemSchema.validate('fragment', 'INVALID_INPUT')).not.toThrow()
    expect(() => compact.itemSchema.validate({ text: 'fragment' }, 'INVALID_INPUT')).toThrow(
      SchemaDiagnostic,
    )
    expect(Object.isFrozen(compact)).toBe(true)
    expect(Object.isFrozen(compact.descriptor.item)).toBe(true)
  })

  test('compiles local definitions and rejects unused invalid definitions', () => {
    const valid = descriptor({
      item: { $ref: '#/$defs/Text' },
      $defs: { Text: { type: 'string' } },
    })
    const compiled = parseChannelContract(bytes(valid))
    expect(() => compiled.itemSchema.validate('hello', 'INVALID_INPUT')).not.toThrow()
    expect(() => compiled.itemSchema.validate(1, 'INVALID_INPUT')).toThrow(SchemaDiagnostic)
    for (const overrides of [
      { $defs: { Unused: { type: 'string', pattern: '.*' } } },
      { $defs: { 'Bad-Name': true } },
      { item: { $ref: 'https://example.org/schema' } },
      { item: { $ref: '#/$defs/Missing' } },
      { item: { $ref: '#/$defs/Loop' }, $defs: { Loop: { $ref: '#/$defs/Loop' } } },
    ]) {
      expect(() => parseChannelContract(bytes(descriptor(overrides)))).toThrow(SchemaDiagnostic)
    }
  })

  test('rejects unknown fields and noncanonical identities, versions and shapes', () => {
    for (const overrides of [
      { $schema: 'https://example.org/channel.json' },
      { id: 'http://example.org/channels/events' },
      { id: 'https://Example.org/channels/events' },
      { id: 'https://127.0.0.1/channels/events' },
      { id: 'https://example.org/channels/events?latest' },
      { version: '1.0.0-alpha.1' },
      { version: '01.0.0' },
      { item: [] },
      { item: null },
      { $defs: [] },
      { transport: 'websocket' },
    ]) {
      expect(() => parseChannelContract(bytes(descriptor(overrides)))).toThrow(CheckError)
    }
    for (const field of ['$schema', 'id', 'version', 'semantics', 'item']) {
      const value = descriptor()
      delete value[field]
      expect(() => parseChannelContract(bytes(value))).toThrow(CheckError)
    }
  })

  test('enforces descriptor, UTF-8 semantic, and definition bounds', () => {
    expect(() => parseChannelContract(new Uint8Array(CHANNEL_CONTRACT_BYTES + 1))).toThrow(
      CheckError,
    )
    expect(() => parseChannelContract(bytes(descriptor({ semantics: '' })))).toThrow(CheckError)
    expect(() =>
      parseChannelContract(bytes(descriptor({ semantics: '😀'.repeat(4096) }))),
    ).not.toThrow()
    expect(() => parseChannelContract(bytes(descriptor({ semantics: '😀'.repeat(4097) })))).toThrow(
      CheckError,
    )
    const definitions = Object.fromEntries(
      Array.from({ length: 1024 }, (_, index) => [`D${index}`, true]),
    )
    expect(() => parseChannelContract(bytes(descriptor({ $defs: definitions })))).not.toThrow()
    expect(() =>
      parseChannelContract(bytes(descriptor({ $defs: { ...definitions, Extra: true } }))),
    ).toThrow(CheckError)
  })

  test('rejects invalid JSON/1 before identity or schema interpretation', () => {
    for (const source of [
      '{"item":true,"item":false}',
      JSON.stringify(descriptor({ semantics: '\ud800' })),
      JSON.stringify(descriptor({ item: { const: 9007199254740992 } })),
    ])
      expect(() => parseChannelContract(encoder.encode(source))).toThrow()
  })
})

describe('channel declarations', () => {
  test('keeps generic, inline and named ports simple and deeply immutable', () => {
    const channels: JsonObject = {
      generic: { direction: 'receive' },
      progress: { direction: 'send', schema: { type: 'string' }, required: false },
      events: { direction: 'receive', contract: reference, delivery: 'direct', start: 'suffix' },
      broadcast: { direction: 'send', delivery: 'broadcast' },
      subscriber: { direction: 'receive', delivery: 'broadcast', start: 'suffix' },
    }
    const parsed = parseChannelDeclarations(channels, 'FLOW.md')
    expect(parsed).toEqual(channels)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.progress)).toBe(true)
    expect(Object.isFrozen(parsed.progress!.schema)).toBe(true)
    const operation = parseInvocationContract(
      bytes(invocation(channels)),
      'FLOW.contract.json',
      new Map([['contracts/public-events.json', bytes(descriptor())]]),
    ).invocation!
    expect(operation.channels).toEqual(channels)
    expect(Object.isFrozen(operation.channels!.progress!.schema)).toBe(true)
  })

  test('rejects unsupported delivery and ambiguous or invalid declarations', () => {
    for (const declaration of [
      {},
      { direction: 'duplex' },
      { direction: 'send', required: 'yes' },
      { direction: 'send', delivery: 'websocket' },
      { direction: 'send', contract: reference, schema: true },
      { direction: 'send', start: 'suffix' },
      { direction: 'receive', start: 'latest' },
      { direction: 'send', buffer: 64 },
    ])
      expect(() => parseChannelDeclarations({ events: declaration }, 'FLOW.md')).toThrow(CheckError)
    expect(() =>
      parseChannelDeclarations(
        { events: { direction: 'send', schema: { pattern: '.*' } } },
        'FLOW.md',
      ),
    ).toThrow(SchemaDiagnostic)
    for (const name of ['', 'ACP', 'two--names', 'a'.repeat(65)])
      expect(() => parseChannelDeclarations({ [name]: { direction: 'send' } }, 'FLOW.md')).toThrow(
        CheckError,
      )
    const many = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`n${index}`, { direction: 'send' }]),
    )
    expect(() => parseChannelDeclarations(many, 'FLOW.md')).toThrow(CheckError)
  })

  test('uses canonical Package/1 reference byte and segment bounds', () => {
    expect(requireChannelReference(reference, 'FLOW.md')).toBe(reference)
    expect(requireChannelReference(`./${'é'.repeat(127)}a`, 'FLOW.md')).toBe(
      `./${'é'.repeat(127)}a`,
    )
    for (const reference of [
      'contracts/events.json',
      '/contracts/events.json',
      '../events.json',
      './',
      './contracts/../events.json',
      './contracts//events.json',
      './contracts\\events.json',
      './e\u0301.json',
      `./${'é'.repeat(128)}`,
      `./${'a'.repeat(256)}`,
      `./${Array(65).fill('a').join('/')}`,
      `./${Array(5).fill('a'.repeat(255)).join('/')}`,
    ])
      expect(() => requireChannelReference(reference, 'FLOW.md')).toThrow(CheckError)
  })
})

describe('package channel closure', () => {
  test('captures explicit broadcast declarations through ordinary package inspection', async () => {
    const channels = {
      events: { direction: 'send', delivery: 'broadcast' },
      input: { direction: 'receive', delivery: 'broadcast', start: 'suffix' },
    }
    await withPackage(
      { 'FLOW.md': metadata({}), 'FLOW.contract.json': JSON.stringify(invocation(channels)) },
      async (root) => {
        expect((await checkPackageDirectory(root)).invocation!.channels).toEqual(channels)
      },
    )
  })

  test('loads channel profiles referenced by offered and consumed invocation contracts', async () => {
    const channels = { events: { direction: 'send', required: false, contract: reference } }
    await withPackage(
      {
        'FLOW.md': metadata({
          uses: { worker: { contract: './contracts/worker.json' } },
        }),
        'FLOW.contract.json': JSON.stringify({ $schema: INVOCATION_CONTRACT_SCHEMA, channels }),
        'contracts/worker.json': JSON.stringify(
          invocation({ events: { ...channels.events, contract: './public-events.json' } }),
        ),
        'contracts/public-events.json': JSON.stringify(descriptor()),
      },
      async (root) => {
        const checked = await checkPackageDirectory(root)
        expect(checked.invocation!.channels!.events!.contract).toBe(reference)
        expect(checked.usedContracts[0]!.contract.invocation!.channels!.events!.contract).toBe(
          './public-events.json',
        )
      },
    )
  })

  test('rejects missing optional profiles instead of fetching or ignoring them', async () => {
    for (const fromDependency of [false, true]) {
      const channels = { events: { direction: 'send', required: false, contract: reference } }
      await withPackage(
        {
          'FLOW.md': metadata(
            fromDependency ? { uses: { worker: { contract: './contracts/worker.json' } } } : {},
          ),
          ...(fromDependency
            ? {
                'contracts/worker.json': JSON.stringify(
                  invocation({ events: { ...channels.events, contract: './public-events.json' } }),
                ),
              }
            : { 'FLOW.contract.json': JSON.stringify(invocation(channels)) }),
        },
        async (root) => {
          await expect(checkPackageDirectory(root)).rejects.toMatchObject({
            code: 'PACKAGE_REFERENCE_MISSING',
            path: 'contracts/public-events.json',
          })
        },
      )
    }
  })

  test('rejects equivocal named channel meanings across invocation declarations', async () => {
    const channels = { events: { direction: 'send', contract: './other.json' } }
    await withPackage(
      {
        'FLOW.md': metadata({
          uses: { worker: { contract: './contracts/worker.json' } },
        }),
        'FLOW.contract.json': JSON.stringify({
          $schema: INVOCATION_CONTRACT_SCHEMA,
          channels: { events: { direction: 'receive', contract: reference } },
        }),
        'contracts/worker.json': JSON.stringify(invocation(channels)),
        'contracts/public-events.json': JSON.stringify(descriptor()),
        'contracts/other.json': JSON.stringify(
          descriptor({ semantics: 'Replace rather than append.' }),
        ),
      },
      async (root) => {
        await expect(checkPackageDirectory(root)).rejects.toMatchObject({
          code: 'CHANNEL_EQUIVOCATION',
          path: 'contracts/other.json',
        })
      },
    )
  })
})

async function withPackage(
  files: Record<string, string>,
  operation: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'jig-channel-contract-'))
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), content)
    }
    await operation(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
