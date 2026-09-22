import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { AGENT_RUN_CONTRACT_DIGEST } from './fixtures/agent-contract.js'
import { compileSchemaFile, SchemaDiagnostic } from '../src/schema/index.js'

const schema = compileSchemaFile(
  await readFile(new URL('../../../docs/jig/spec/machine/jig-lock-1.schema.json', import.meta.url)),
  'jig-lock-1.schema.json',
)

const digest = `sha256:${'a'.repeat(64)}`
const lock = {
  packages: {
    'flows/configured': {
      digest,
      directRun: false,
      uses: {},
    },
    'flows/direct': {
      digest,
      directRun: true,
      uses: {
        agent: {
          id: 'https://jig.md/contracts/agent-run',
          version: '1.0.0',
          digest: AGENT_RUN_CONTRACT_DIGEST,
        },
      },
    },
  },
  bindings: {
    configured: {
      packagePath: 'flows/configured',
      settings: { retries: 2 },
      slots: { direct: { kind: 'flow', path: 'flows/direct' } },
      attachments: {
        reference: {
          source: 'resources/reference',
          digest,
          files: [{ path: 'data', bytes: 4, digest }],
        },
      },
    },
  },
}

function changed(value: unknown, mutate: (copy: Record<string, any>) => void): unknown {
  const copy = structuredClone(value) as Record<string, any>
  mutate(copy)
  return copy
}

describe('Jig lock/1 shape schema', () => {
  test('retains only the qualified explicitly authorized session policy', () => {
    const value = changed(lock, (item) => {
      item.bindings.configured.slots.native = {
        kind: 'grant',
        policy: { kind: 'acp', client: 'codex', retainSessions: true },
      }
    })
    expect(() => schema.validate(value, 'INVALID_JIG_LOCK')).not.toThrow()
    for (const patch of [{ client: 'pi' }, { client: 'claude' }, { retainSessions: false }]) {
      const invalid = changed(value, (item) =>
        Object.assign(item.bindings.configured.slots.native.policy, patch),
      )
      expect(() => schema.validate(invalid, 'INVALID_JIG_LOCK')).toThrow(SchemaDiagnostic)
    }
  })
  test('accepts the complete current lock shape', () => {
    expect(() => schema.validate(lock, 'INVALID_JIG_LOCK')).not.toThrow()
  })

  test('describes retained ordinary routes on a direct Flow without admitting grants', () => {
    const value = changed(lock, (item) => {
      item.packages['flows/direct'].slots = { agent: { kind: 'binding', id: 'configured' } }
    })
    expect(() => schema.validate(value, 'INVALID_JIG_LOCK')).not.toThrow()
    const grant = changed(value, (item) => {
      item.packages['flows/direct'].slots.agent = {
        kind: 'grant',
        policy: { kind: 'command', run: 'index.ts' },
      }
    })
    expect(() => schema.validate(grant, 'INVALID_JIG_LOCK')).toThrow(SchemaDiagnostic)
  })

  test('accepts explicit uncontracted slots and arbitrary exact invocation requirements', () => {
    for (const requirement of [
      {},
      { id: 'https://example.org/contracts/review', version: '2.0.0', digest },
    ]) {
      const value = changed(lock, (item) => {
        item.packages['flows/direct'].uses.agent = requirement
        item.packages['flows/direct'].directRun = false
      })
      expect(() => schema.validate(value, 'INVALID_JIG_LOCK')).not.toThrow()
    }
  })

  test('bounds invocation requirements independently of the number of native implementations', () => {
    const value = changed(lock, (item) => {
      item.packages['flows/direct'].uses = Object.fromEntries(
        Array.from({ length: 256 }, (_, index) => [`slot-${index}`, {}]),
      )
      item.packages['flows/direct'].directRun = false
    })
    expect(() => schema.validate(value, 'INVALID_JIG_LOCK')).not.toThrow()
    const oversized = changed(value, (item) => {
      item.packages['flows/direct'].uses.extra = {}
    })
    expect(() => schema.validate(oversized, 'INVALID_JIG_LOCK')).toThrow(SchemaDiagnostic)
  })

  for (const [name, value] of [
    ['a format discriminator', { kind: 'jig-lock/1', ...lock }],
    [
      'an attachment without retained identity',
      changed(lock, (item) => {
        item.bindings.configured.attachments = { reference: 'resources/reference' }
      }),
    ],
    [
      'an oversized captured file',
      changed(lock, (item) => {
        item.bindings.configured.attachments.reference.files[0].bytes = 8388609
      }),
    ],
    [
      'a missing package map',
      changed(lock, (item) => {
        delete item.packages
      }),
    ],
    [
      'an unknown package field',
      changed(lock, (item) => {
        item.packages['flows/direct'].runtime = 'bun'
      }),
    ],
    [
      'an unknown Binding field',
      changed(lock, (item) => {
        item.bindings.configured.grants = {}
      }),
    ],
    [
      'a plain slot path',
      changed(lock, (item) => {
        item.bindings.configured.slots.direct = 'flows/direct'
      }),
    ],
    [
      'an ambiguous slot identity',
      changed(lock, (item) => {
        item.bindings.configured.slots.direct = {
          kind: 'binding',
          id: 'worker',
          path: 'flows/direct',
        }
      }),
    ],
    [
      'an incomplete invocation identity',
      changed(lock, (item) => {
        delete item.packages['flows/direct'].uses.agent.version
      }),
    ],
    [
      'a malformed invocation digest',
      changed(lock, (item) => {
        item.packages['flows/direct'].uses.agent.digest = 'sha256:bad'
      }),
    ],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => schema.validate(value, 'INVALID_JIG_LOCK')).toThrow(SchemaDiagnostic)
    })
  }
})
