import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { CHANNEL_CONTRACT_SCHEMA } from '../src/channel-contract.js'
import { CheckError } from '../src/diagnostics.js'
import { INVOCATION_CONTRACT_SCHEMA } from '../src/invocation-contract.js'
import { capturePackageDirectory } from '../src/package/capture.js'
import {
  checkPackageDirectory,
  inspectCapturedPackage,
  packageProfileIssue,
  requireSupportedPackageProfile,
} from '../src/package/inspect.js'
import { SchemaDiagnostic } from '../src/schema/index.js'

const contract = (fields: Record<string, unknown> = {}): string =>
  JSON.stringify({
    $schema: INVOCATION_CONTRACT_SCHEMA,
    ...fields,
  })
const namedContract = (fields: Record<string, unknown> = {}): string =>
  contract({
    id: 'https://example.org/contracts/reviewer',
    version: '1.0.0',
    ...fields,
  })
const channel = (fields: Record<string, unknown> = {}): string =>
  JSON.stringify({
    $schema: CHANNEL_CONTRACT_SCHEMA,
    id: 'https://example.org/contracts/updates',
    version: '1.0.0',
    semantics: 'Progress.',
    item: true,
    ...fields,
  })

describe('aggregate Package/1 inspection', () => {
  test('requires one exact-case FLOW implementation and treats nested files as resources', async () => {
    for (const files of [
      { 'flow.md': 'Prose' },
      { 'FLOW.MD': 'Prose' },
      { 'nested/FLOW.md': 'Prose' },
    ]) {
      await withPackage(files, (root) =>
        expectCheckError(() => checkPackageDirectory(root), 'PACKAGE_ENTRYPOINT_MISSING'),
      )
    }
    await withPackage(
      {
        'FLOW.md': '# Revise the input.',
        'nested/FLOW.ts': 'export {}',
        'metadata.json': 'ordinary content',
      },
      async (root) => {
        const checked = await checkPackageDirectory(root)
        expect(checked.entrypoint).toEqual({ path: 'FLOW.md', suffix: 'md' })
        expect(checked.metadata.name).toBeUndefined()
        expect(checked.invocation).toEqual({})
        expect(checked.contract).toBeUndefined()
      },
    )
    await withPackage({ 'FLOW.md': 'Prose', 'FLOW.ts': 'export {}' }, (root) =>
      expectCheckError(() => checkPackageDirectory(root), 'PACKAGE_ENTRYPOINT_AMBIGUOUS'),
    )
  })

  test('code needs no companion and has exactly one optional JSON metadata owner', async () => {
    await withPackage({ 'FLOW.ts': 'export {};\n' }, async (root) => {
      const captured = await capturePackageDirectory(root)
      try {
        const checked = await inspectCapturedPackage(captured)
        expect(checked.digest).toBe(captured.digest)
        expect(checked.entrypoint).toEqual({ path: 'FLOW.ts', suffix: 'ts' })
        expect(checked.metadata).toEqual({ extensions: {}, unknownFields: {} })
      } finally {
        await captured.dispose()
      }
    })
    await withPackage(
      {
        'FLOW.py': 'pass\n',
        'flow.meta.json': JSON.stringify({
          name: 'exact',
          description: 'Exact.',
          'allowed-tools': 'Read',
        }),
      },
      async (root) => {
        const checked = await checkPackageDirectory(root)
        expect(checked.metadata['allowed-tools']).toBe('Read')
        expect(packageProfileIssue(checked)?.code).toBe('PACKAGE_TOOLS_UNSUPPORTED')
      },
    )
    await withPackage({ 'FLOW.md': 'Prose', 'flow.meta.json': '{}' }, (root) =>
      expectCheckError(() => checkPackageDirectory(root), 'PACKAGE_METADATA_OWNER'),
    )
  })

  test('keeps unknown metadata inspectable for execution qualification', async () => {
    await withPackage({ 'FLOW.md': '---\ncustom-requirement: true\n---\nProse' }, async (root) => {
      const checked = await checkPackageDirectory(root)
      expect(checked.metadata.unknownFields).toEqual({ 'custom-requirement': true })
      expect(packageProfileIssue(checked)?.pointer).toBe('/custom-requirement')
      try {
        requireSupportedPackageProfile(checked, 'flows/reviewer')
        throw new Error('expected unsupported profile')
      } catch (error) {
        expect(error).toMatchObject({
          kind: 'unavailable',
          code: 'PACKAGE_METADATA_UNSUPPORTED',
          path: 'flows/reviewer/FLOW.md',
        })
      }
    })
  })

  test('validates UTF-8 even outside the bounded frontmatter prefix', async () => {
    const prefix = new TextEncoder().encode(`---\nname: exact\n---\n${'a'.repeat(270_000)}`)
    await withPackage({ 'FLOW.md': Uint8Array.from([...prefix, 0xff]) }, (root) =>
      expectCheckError(() => checkPackageDirectory(root), 'METADATA_INVALID_UTF8'),
    )
  })

  test('interprets an Adapter selector only on code implementations', async () => {
    await withPackage({ 'FLOW.ts': '#!/usr/bin/env bun\r\nexport {};\n' }, async (root) => {
      expect((await checkPackageDirectory(root)).entrypoint).toEqual({
        path: 'FLOW.ts',
        suffix: 'ts',
        selector: 'bun',
      })
    })
    await withPackage({ 'FLOW.md': '#!/bin/bash\nThis is authored prose.' }, async (root) => {
      expect((await checkPackageDirectory(root)).entrypoint.selector).toBeUndefined()
    })
    for (const selector of [
      '#!/usr/bin/env -S bun\n',
      '#!/usr/bin/env bun --flag\n',
      '#!/bin/bun\n',
      `#!/usr/bin/env ${'a'.repeat(65)}\n`,
    ]) {
      await withPackage({ 'FLOW.ts': selector }, (root) =>
        expectCheckError(() => checkPackageDirectory(root), 'PACKAGE_SELECTOR'),
      )
    }
  })

  test('compiles optional invocation input/result and independent implementation settings', async () => {
    await withPackage(
      {
        'FLOW.ts': 'export {};\n',
        'FLOW.contract.json': contract({
          input: { type: 'string', minLength: 1 },
          result: {
            type: 'object',
            properties: { outcome: { const: 'done' }, output: true },
            required: ['outcome', 'output'],
            additionalProperties: false,
          },
        }),
        'settings.schema.json': JSON.stringify({
          $schema: 'https://flow.jig.md/schemas/schema-1.json',
          type: 'object',
          maxProperties: 0,
        }),
      },
      async (root) => {
        const checked = await checkPackageDirectory(root)
        checked.schemas.input!.validate('input', 'INVALID_INPUT')
        checked.schemas.settings!.validate({}, 'INVALID_SETTINGS')
        checked.schemas.result!.validate({ outcome: 'done', output: null }, 'INVALID_RESULT')
        expect(checked.schemas.input!.path).toBe('FLOW.contract.json')
        expect(checked.schemas.input!.schemaPointer).toBe('/input')
        expect(() => checked.schemas.input!.validate('', 'INVALID_INPUT')).toThrow(SchemaDiagnostic)
      },
    )
  })

  test('requires invocation declarations to use their sole owner', async () => {
    for (const path of ['input.schema.json', 'result.schema.json']) {
      await withPackage({ 'FLOW.md': 'Prose', [path]: '{}' }, (root) =>
        expectCheckError(() => checkPackageDirectory(root), 'PACKAGE_SCHEMA_OWNER'),
      )
    }
    await withPackage(
      {
        'FLOW.md': 'Prose',
        'FLOW.contract.json': contract({ input: { type: 'string', pattern: '.*' } }),
      },
      async (root) => {
        await expect(checkPackageDirectory(root)).rejects.toBeInstanceOf(SchemaDiagnostic)
      },
    )
  })

  test('retains named-profile validity without selecting a runnable invocation', async () => {
    await withPackage(
      { 'FLOW.ts': 'export {}', 'FLOW.contract.json': contract({ operations: { run: {} } }) },
      async (root) => {
        const checked = await checkPackageDirectory(root)
        expect(checked.contract!.profile).toBe('named')
        expect(checked.invocation).toBeUndefined()
        expect(packageProfileIssue(checked)?.code).toBe('PACKAGE_PROFILE_UNSUPPORTED')
      },
    )
  })

  test('resolves consumed contract bundles relative to each descriptor directory', async () => {
    await withPackage(
      {
        'FLOW.md':
          '---\nuses:\n  reviewer: {contract: ./interfaces/reviewer.json}\n  scratch: {}\n---\nProse',
        'interfaces/reviewer.json': namedContract({
          channels: { updates: { direction: 'send', contract: './contracts/updates.json' } },
        }),
        'interfaces/contracts/updates.json': channel(),
        'contracts/updates.json': 'Unrelated; must not be parsed.',
      },
      async (root) => {
        const checked = await checkPackageDirectory(root)
        expect(checked.usedContracts).toHaveLength(1)
        const used = checked.usedContracts[0]!
        expect(used.path).toBe('interfaces/reviewer.json')
        expect(used.contract.descriptor.id).toBe('https://example.org/contracts/reviewer')
        expect(used.contract.channelContracts.get('contracts/updates.json')!.itemSchema.path).toBe(
          'interfaces/contracts/updates.json',
        )
      },
    )
  })

  test('does not satisfy a dependency expectation with an anonymous descriptor', async () => {
    await withPackage(
      {
        'FLOW.md': '---\nuses: {reviewer: {contract: ./reviewer.json}}\n---\nProse',
        'reviewer.json': contract(),
      },
      (root) => expectCheckError(() => checkPackageDirectory(root), 'CONTRACT_IDENTITY'),
    )
  })

  test('rejects missing invocation and channel references from the captured source', async () => {
    await withPackage(
      { 'FLOW.md': '---\nuses: {reviewer: {contract: ./missing.json}}\n---\nProse' },
      (root) => expectCheckError(() => checkPackageDirectory(root), 'PACKAGE_REFERENCE_MISSING'),
    )
    await withPackage(
      {
        'FLOW.md': 'Prose',
        'FLOW.contract.json': contract({
          channels: { updates: { direction: 'send', contract: './missing.json', required: false } },
        }),
      },
      (root) => expectCheckError(() => checkPackageDirectory(root), 'PACKAGE_REFERENCE_MISSING'),
    )
  })

  test('rejects equivocation among a package offer and its expectations', async () => {
    await withPackage(
      {
        'FLOW.md': '---\nuses: {reviewer: {contract: ./reviewer.json}}\n---\nProse',
        'FLOW.contract.json': namedContract({ input: true }),
        'reviewer.json': namedContract({ input: false }),
      },
      (root) => expectCheckError(() => checkPackageDirectory(root), 'CONTRACT_EQUIVOCATION'),
    )
  })
})

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
