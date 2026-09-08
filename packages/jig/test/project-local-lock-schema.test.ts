import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

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
          digest: 'sha256:b43fba88de62ef189f54004318e9639df58661bb04b3bf76ecfac70e3a5d098b',
        },
      },
    },
  },
  bindings: {
    configured: {
      packagePath: 'flows/configured',
      settings: { retries: 2 },
      slots: { direct: { kind: 'flow', path: 'flows/direct' } },
    },
  },
}

function changed(value: unknown, mutate: (copy: Record<string, any>) => void): unknown {
  const copy = structuredClone(value) as Record<string, any>
  mutate(copy)
  return copy
}

describe('Jig lock/1 shape schema', () => {
  test('accepts the complete current lock shape', () => {
    expect(() => schema.validate(lock, 'INVALID_JIG_LOCK')).not.toThrow()
  })

  for (const [name, value] of [
    ['a format discriminator', { kind: 'jig-lock/1', ...lock }],
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
      'a different capability contract',
      changed(lock, (item) => {
        item.packages['flows/direct'].uses.agent.id = 'https://example.org/contracts/agent'
      }),
    ],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => schema.validate(value, 'INVALID_JIG_LOCK')).toThrow(SchemaDiagnostic)
    })
  }
})
