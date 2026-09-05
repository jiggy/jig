import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { admitPrivatePackageResult } from '../src/internal/package-result-admission.js'
import type { JsonValue } from '../src/json.js'
import { checkPackageDirectory, type InspectedPackage } from '../src/package/inspect.js'
import type { RunDiagnostics, RunHostTerminal } from '../src/run/session.js'

const schemaUri = 'https://flow.jig.md/schemas/schema-1.json'
const diagnostics = Object.freeze({
  stderr: 'component diagnostic\n',
  stderrBytes: 21,
  stderrTruncated: false,
}) satisfies RunDiagnostics

describe('private Package/1 result admission', () => {
  test('accepts done and declared custom outcomes without a result schema', async () => {
    await withInspectedPackage(
      {
        'FLOW.md': flowMetadata(`name: outcomes
description: Outcome package.
outcomes:
  waiting: External input is required.`),
      },
      async (inspected) => {
        const done = succeeded('done', { value: 1 })
        const waiting = succeeded('waiting', null)

        expect(admitPrivatePackageResult(inspected, done)).toBe(done)
        expect(admitPrivatePackageResult(inspected, waiting)).toBe(waiting)
      },
    )
  })

  test('rejects undeclared and reserved normal outcomes while preserving diagnostics', async () => {
    await withInspectedPackage(
      {
        'FLOW.md': flowMetadata('name: outcomes\ndescription: Outcome package.'),
      },
      async (inspected) => {
        for (const outcome of ['waiting', 'failed', 'cancelled', 'error']) {
          const admitted = admitPrivatePackageResult(inspected, succeeded(outcome, null))
          expect(admitted).toMatchObject({
            status: 'failed',
            code: 'INVALID_RESULT',
            details: { outcome },
          })
          expect(admitted.diagnostics).toBe(diagnostics)
        }
      },
    )
  })

  test('validates the complete correlated result schema', async () => {
    await withInspectedPackage(
      {
        'FLOW.md': flowMetadata(`name: correlated
description: Correlated result package.
outcomes:
  waiting: External input is required.`),
        'result.schema.json': schemaDocument({
          oneOf: [
            {
              type: 'object',
              properties: {
                outcome: { const: 'done' },
                output: { type: 'string' },
              },
              required: ['outcome', 'output'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                outcome: { const: 'waiting' },
                output: { type: 'null' },
              },
              required: ['outcome', 'output'],
              additionalProperties: false,
            },
          ],
        }),
      },
      async (inspected) => {
        const accepted = succeeded('waiting', null)
        expect(admitPrivatePackageResult(inspected, accepted)).toBe(accepted)

        const rejected = admitPrivatePackageResult(inspected, succeeded('waiting', 'not-null'))
        expect(rejected).toMatchObject({
          status: 'failed',
          code: 'INVALID_RESULT',
          details: {
            code: 'INVALID_RESULT',
            path: 'result.schema.json',
            instancePointer: '',
            schemaPointer: '/oneOf',
            keyword: 'oneOf',
          },
        })
        expect(rejected.diagnostics).toBe(diagnostics)
      },
    )
  })

  test('does not reclassify an existing protocol or execution failure', async () => {
    await withInspectedPackage(
      {
        'FLOW.md': flowMetadata('name: exact\ndescription: Exact package.'),
      },
      async (inspected) => {
        for (const code of ['PROTOCOL_ERROR', 'EXECUTION_FAILED'] as const) {
          const failure = Object.freeze({
            status: 'failed' as const,
            code,
            message: 'existing failure',
            diagnostics,
          })
          expect(admitPrivatePackageResult(inspected, failure)).toBe(failure)
        }
      },
    )
  })
})

function succeeded(outcome: string, output: JsonValue): RunHostTerminal {
  return Object.freeze({
    status: 'succeeded' as const,
    result: Object.freeze({ outcome, output }),
    diagnostics,
  })
}

function flowMetadata(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n`
}

function schemaDocument(schema: Record<string, unknown>): string {
  return JSON.stringify({ $schema: schemaUri, ...schema })
}

async function withInspectedPackage(
  files: Readonly<Record<string, string | Uint8Array>>,
  action: (inspected: InspectedPackage) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'jig-result-admission-test-'))
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, ...path.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
    }
    await action(await checkPackageDirectory(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
