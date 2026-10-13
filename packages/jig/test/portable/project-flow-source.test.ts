import { describe, expect, test } from 'bun:test'
import { deriveDirectRunTargetCandidates } from '../../src/project/flow-source.js'
import { SchemaDiagnostic } from '../../src/schema/index.js'

describe('private project Flow source capture', () => {
  test('does not hide schema evaluator failures as direct-target ineligibility', () => {
    const failure = new SchemaDiagnostic('schema work exhausted', {
      code: 'SCHEMA_LIMIT_EXCEEDED',
      instancePointer: '',
      schemaPointer: '',
      path: 'settings.schema.json',
    })
    const source = {
      observations: [],
      members: [
        {
          provenance: { membership: 'exact', projectPath: 'flows/a' },
          captured: { digest: 'sha256:test' },
          inspected: {
            mode: 'run',
            entrypoint: { path: 'FLOW.ts', suffix: 'ts' },
            invocation: {},
            usedContracts: [],
            metadata: { name: 'a', description: 'a', extensions: {}, unknownFields: {} },
            schemas: {
              settings: {
                validate: () => {
                  throw failure
                },
              },
            },
          },
        },
      ],
      dispose: async () => undefined,
    }
    expect(() => deriveDirectRunTargetCandidates(source as never)).toThrow(failure)
  })
})
