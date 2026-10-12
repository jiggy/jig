import { expect } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CheckError } from '../src/diagnostics.js'

const schemaUri = 'https://flow.jig.md/schemas/schema-0.json'
async function withProject(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'jig-project-flow-test-'))
  try {
    await action(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
async function packageFiles(
  root: string,
  path: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const file = join(root, path, name)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, contents)
  }
}
function metadata(name: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: ${name}.\n${extra.length === 0 ? '' : `${extra}\n`}---\nReturn the supplied input.\n`
}
function schema(value: unknown): string {
  return `${JSON.stringify({ $schema: schemaUri, ...value })}\n`
}
async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await action()
    throw new Error('expected CheckError')
  } catch (error) {
    expect(error).toBeInstanceOf(CheckError)
    expect((error as CheckError).code).toBe(code)
  }
}

export { expectCode, metadata, packageFiles, schema, schemaUri, withProject }
