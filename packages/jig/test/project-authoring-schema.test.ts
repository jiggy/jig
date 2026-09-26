import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { defineBinding, defineJig, discover } from '../src/index.js'
import { compileSchemaFile, SchemaDiagnostic } from '../src/schema/index.js'

const schema = compileSchemaFile(
  await readFile(
    new URL('../../../docs/jig/spec/machine/project-authoring-1.schema.json', import.meta.url),
  ),
  'project-authoring-1.schema.json',
)

const project = defineJig({
  entrypoint: "binding:review --input @job.json --timeout 8m",
  flows: discover('./flows'),
  bindings: ['./bindings/review.ts'],
  defaultProviders: { 'https://example.org/contracts/review': 'binding:review' },
})
const binding = defineBinding({
  package: './flows/review',
  settings: { retries: 2 },
  slots: { child: 'flow:./flows/child', reviewer: 'binding:reviewer' },
  attachments: { reference: './resources/reference' },
})

function changed(value: unknown, mutate: (copy: Record<string, any>) => void): unknown {
  const copy = structuredClone(value) as Record<string, any>
  mutate(copy)
  return copy
}

describe('Project Authoring SDK/1 shape schema', () => {
  test('retention policy is explicit and confined to the qualified native client', () => {
    const value = changed(binding, (item) => {
      item.slots.native = { kind: 'acp', client: 'codex', retainSessions: true }
    })
    expect(() => schema.validate(value, 'INVALID_PROJECT_AUTHORING')).not.toThrow()
    for (const patch of [{ client: 'pi' }, { client: 'claude' }, { retainSessions: false }]) {
      const invalid = changed(value, (item) => Object.assign(item.slots.native, patch))
      expect(() => schema.validate(invalid, 'INVALID_PROJECT_AUTHORING')).toThrow(SchemaDiagnostic)
    }
  })
  test('accepts the complete direct-alpha authoring surface', () => {
    expect(() => schema.validate(project, 'INVALID_PROJECT_AUTHORING')).not.toThrow()
    expect(() => schema.validate(binding, 'INVALID_PROJECT_AUTHORING')).not.toThrow()
  })

  for (const [name, value] of [
    [
      'object default selector',
      changed(project, (item) => {
        item.defaultProviders = {
          'https://example.org/contracts/review': { kind: 'binding', id: 'review' },
        }
      }),
    ],
    [
      'oversized default list',
      changed(project, (item) => {
        item.defaultProviders = Object.fromEntries(
          Array.from({ length: 257 }, (_, i) => [
            `https://example.org/contracts/review-${i}`,
            'binding:review',
          ]),
        )
      }),
    ],
    [
      'unknown project field',
      changed(project, (item) => {
        item.extra = {}
      }),
    ],
    [
      'unknown source kind',
      changed(project, (item) => {
        item.flows.kind = 'glob'
      }),
    ],
    [
      'missing discovery roots',
      changed(project, (item) => {
        delete item.flows.roots
      }),
    ],
    [
      'unknown Binding field',
      changed(binding, (item) => {
        item.grants = {}
      }),
    ],
    [
      'non-path Binding attachments',
      changed(binding, (item) => {
        item.attachments = { source: { path: 'data' } }
      }),
    ],
    [
      'missing normalized settings',
      changed(binding, (item) => {
        delete item.settings
      }),
    ],
    [
      'missing normalized slots',
      changed(binding, (item) => {
        delete item.slots
      }),
    ],
    [
      'slot identity object',
      changed(binding, (item) => {
        item.slots.child = { kind: 'flow', path: 'flows/child' }
      }),
    ],
    [
      'oversized target selector',
      changed(binding, (item) => {
        item.slots.child = `flow:${'a'.repeat(1025)}`
      }),
    ],
    [
      'oversized project path',
      changed(binding, (item) => {
        item.package = 'a'.repeat(1025)
      }),
    ],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => schema.validate(value, 'INVALID_PROJECT_AUTHORING')).toThrow(SchemaDiagnostic)
    })
  }
})
