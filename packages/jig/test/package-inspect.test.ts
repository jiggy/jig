import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { CheckError } from '../src/diagnostics.js'
import { capturePackageDirectory } from '../src/package/capture.js'
import { checkPackageDirectory, inspectCapturedPackage } from '../src/package/inspect.js'
import { SchemaDiagnostic } from '../src/schema/index.js'

const schemaUri = 'https://flow.jig.md/schemas/schema-1.json'
const runMetadata = flowMetadata('name: exact\ndescription: Exact.')

describe('aggregate Package/1 inspection', () => {
  test('requires exact-case root FLOW.md', async () => {
    await withPackage({ 'flow.md': runMetadata }, async (root) => {
      await expectCheckError(() => checkPackageDirectory(root), 'PACKAGE_FLOW_MISSING')
    })
  })

  test('classifies invalid frontmatter UTF-8 as invalid during aggregate inspection', async () => {
    const prefix = new TextEncoder().encode('---\nname: exact\ndescription: ')
    const suffix = new TextEncoder().encode('\n---\n')
    await withPackage(
      {
        'FLOW.md': Uint8Array.from([...prefix, 0xff, ...suffix]),
      },
      async (root) => {
        await expectCheckError(() => checkPackageDirectory(root), 'METADATA_INVALID_UTF8')
      },
    )
  })

  test('admits zero or one root implementation and rejects several', async () => {
    await withPackage({ 'FLOW.md': runMetadata }, async (root) => {
      const checked = await checkPackageDirectory(root)
      expect(checked.mode).toBe('run')
      expect(checked.entrypoint).toBeUndefined()
    })

    await withPackage(
      {
        'FLOW.md': runMetadata,
        'flow.ts': 'export {};\n',
        'nested/flow.py': '# ordinary nested resource\n',
        'flow.d.ts': '// ordinary multi-suffix resource\n',
      },
      async (root) => {
        const captured = await capturePackageDirectory(root)
        try {
          const checked = await inspectCapturedPackage(captured)
          expect(checked.digest).toBe(captured.digest)
          expect(checked.entrypoint).toEqual({ path: 'flow.ts', suffix: 'ts' })
        } finally {
          await captured.dispose()
        }
      },
    )

    await withPackage(
      {
        'FLOW.md': runMetadata,
        'flow.ts': 'export {};\n',
        'flow.py': 'pass\n',
      },
      async (root) => {
        await expectCheckError(() => checkPackageDirectory(root), 'PACKAGE_ENTRYPOINT_AMBIGUOUS')
      },
    )
  })

  test('parses only the exact optional Adapter selector grammar', async () => {
    await withPackage(
      {
        'FLOW.md': runMetadata,
        'flow.ts': '#!/usr/bin/env bun\r\nexport {};\n',
      },
      async (root) => {
        expect((await checkPackageDirectory(root)).entrypoint).toEqual({
          path: 'flow.ts',
          suffix: 'ts',
          selector: 'bun',
        })
      },
    )

    for (const selector of [
      '#!/usr/bin/env -S bun\n',
      '#!/usr/bin/env bun --flag\n',
      '#!/bin/bun\n',
      `#!/usr/bin/env ${'a'.repeat(65)}\n`,
    ]) {
      await withPackage({ 'FLOW.md': runMetadata, 'flow.ts': selector }, async (root) => {
        await expectCheckError(() => checkPackageDirectory(root), 'PACKAGE_SELECTOR')
      })
    }
  })

  test('compiles every conventional Run schema during inspection', async () => {
    await withPackage(
      {
        'FLOW.md': runMetadata,
        'input.schema.json': schemaDocument({
          type: 'object',
          properties: { value: { type: 'string', minLength: 1 } },
          required: ['value'],
          additionalProperties: false,
        }),
        'settings.schema.json': schemaDocument({ type: 'object', maxProperties: 0 }),
        'result.schema.json': schemaDocument({
          type: 'object',
          properties: { outcome: { const: 'done' }, output: true },
          required: ['outcome', 'output'],
          additionalProperties: false,
        }),
      },
      async (root) => {
        const schemas = (await checkPackageDirectory(root)).schemas
        schemas.input!.validate({ value: 'ok' }, 'INVALID_INPUT')
        schemas.settings!.validate({}, 'INVALID_SETTINGS')
        schemas.result!.validate({ outcome: 'done', output: null }, 'INVALID_RESULT')
        expect(() => schemas.input!.validate({}, 'INVALID_INPUT')).toThrow(SchemaDiagnostic)
      },
    )
  })

  test('rejects an invalid conventional schema while the package is inert', async () => {
    await withPackage(
      {
        'FLOW.md': runMetadata,
        'input.schema.json': schemaDocument({ type: 'string', pattern: '.*' }),
      },
      async (root) => {
        await expect(checkPackageDirectory(root)).rejects.toBeInstanceOf(SchemaDiagnostic)
      },
    )
  })

  test('loads exact referenced consumed capability contracts', async () => {
    const consumer = capability('https://example.org/contracts/consumer')
    const peer = capability('https://example.org/contracts/peer')
    const metadata = flowMetadata(`name: consumer
description: Consumer.
uses:
  dependency:
    contract: ./contracts/consumer.capability.json
  peer:
    contract: ./contracts/peer.capability.json`)
    await withPackage(
      {
        'FLOW.md': metadata,
        'flow.ts': 'export {};\n',
        'contracts/consumer.capability.json': consumer,
        'contracts/peer.capability.json': peer,
      },
      async (root) => {
        const checked = await checkPackageDirectory(root)
        expect(
          checked.usedContracts.map(({ slot, path, contract }) => ({
            slot,
            path,
            id: contract.descriptor.id,
          })),
        ).toEqual([
          {
            slot: 'dependency',
            path: 'contracts/consumer.capability.json',
            id: 'https://example.org/contracts/consumer',
          },
          {
            slot: 'peer',
            path: 'contracts/peer.capability.json',
            id: 'https://example.org/contracts/peer',
          },
        ])
      },
    )
  })

  test('rejects one package carrying different bytes for the same contract version', async () => {
    const id = 'https://example.org/contracts/equivocal'
    await withPackage(
      {
        'FLOW.md': flowMetadata(`name: consumer
description: Consumer.
uses:
  first:
    contract: ./contracts/first.capability.json
  second:
    contract: ./contracts/second.capability.json`),
        'flow.ts': 'export {};\n',
        'contracts/first.capability.json': capability(id),
        'contracts/second.capability.json': capability(id, false),
      },
      async (root) => {
        await expectCheckError(() => checkPackageDirectory(root), 'CAPABILITY_EQUIVOCATION')
      },
    )
  })

  test('rejects a capability reference absent from the captured package', async () => {
    await withPackage(
      {
        'FLOW.md': flowMetadata(`name: exact
description: Exact.
uses:
  agent:
    contract: ./contracts/missing.capability.json`),
      },
      async (root) => {
        await expectCheckError(() => checkPackageDirectory(root), 'PACKAGE_REFERENCE_MISSING')
      },
    )
  })
})

function flowMetadata(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n`
}

function schemaDocument(schema: Record<string, unknown>): string {
  return JSON.stringify({ $schema: schemaUri, ...schema })
}

function capability(id: string, input: boolean = true): string {
  return JSON.stringify({
    $schema: 'https://flow.jig.md/schemas/capability-contract-1.schema.json',
    flowCapabilityContract: 1,
    id,
    version: '1.0.0',
    methods: {
      call: { input, output: true, errors: {} },
    },
  })
}

async function withPackage(
  files: Readonly<Record<string, string | Uint8Array>>,
  action: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'jig-inspect-test-'))
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, ...path.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
    }
    await action(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function expectCheckError(action: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await action()
    throw new Error('expected CheckError')
  } catch (error) {
    expect(error).toBeInstanceOf(CheckError)
    expect((error as CheckError).code).toBe(code)
  }
}
