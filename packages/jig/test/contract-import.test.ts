import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importContract } from '../src/internal/contract-import.js'
import { parseInvocationContract } from '../src/invocation-contract.js'
import { main, privateCliRequiresHost } from '../src/cli.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const agreement = JSON.stringify({
  $schema: 'https://flow.jig.md/schemas/channel-contract-1.schema.json',
  id: 'https://example.org/events',
  version: '1.0.0',
  semantics: 'Selected progress.',
  item: true,
})
const descriptor = JSON.stringify({
  $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
  id: 'https://example.org/work',
  version: '1.0.0',
  channels: { events: { direction: 'send', contract: './contracts/events.json' } },
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jig-contract-import-'))
  roots.push(root)
  await mkdir(join(root, 'source/contracts'), { recursive: true })
  await writeFile(join(root, 'source/FLOW.contract.json'), descriptor)
  await writeFile(join(root, 'source/contracts/events.json'), agreement)
  await writeFile(join(root, 'source/FLOW.ts'), 'throw new Error("must not execute")')
  await symlink('/does-not-exist', join(root, 'source/unrelated'))
  return root
}
test('imports an exact complete closure from an installed-style symlink without code or unrelated files', async () => {
  const root = await fixture()
  await symlink('source', join(root, 'installed'))
  const result = await importContract(
    join(root, 'installed/FLOW.contract.json'),
    join(root, 'copied'),
  )
  expect(await readdir(join(root, 'copied'))).toEqual(['FLOW.contract.json', 'contracts'])
  expect(await readFile(join(root, 'copied/FLOW.contract.json'), 'utf8')).toBe(descriptor)
  expect(await readFile(join(root, 'copied/contracts/events.json'), 'utf8')).toBe(agreement)
  expect(result).toMatchObject({
    files: 2,
    digest: parseInvocationContract(
      Buffer.from(descriptor),
      'FLOW.contract.json',
      new Map([['contracts/events.json', Buffer.from(agreement)]]),
    ).digest,
  })
})
test('collisions never replace an existing destination, including an empty directory', async () => {
  const root = await fixture()
  await mkdir(join(root, 'copied'))
  await expect(
    importContract(join(root, 'source/FLOW.contract.json'), join(root, 'copied')),
  ).rejects.toMatchObject({ code: 'CONTRACT_IMPORT_EXISTS' })
  expect(await readdir(join(root, 'copied'))).toEqual([])
  expect((await readdir(root)).filter((name) => name.startsWith('.jig-contract-'))).toEqual([])
})
for (const invalid of ['missing', 'symlink', 'schema', 'traversal']) {
  test(`invalid ${invalid} closure leaves no destination`, async () => {
    const root = await fixture()
    const path = join(root, 'source/contracts/events.json')
    if (invalid === 'missing' || invalid === 'symlink') await rm(path)
    if (invalid === 'symlink') await symlink('../FLOW.contract.json', path)
    if (invalid === 'schema') await writeFile(path, '{}')
    if (invalid === 'traversal')
      await writeFile(
        join(root, 'source/FLOW.contract.json'),
        descriptor.replace('./contracts/events.json', '../outside.json'),
      )
    await expect(
      importContract(join(root, 'source/FLOW.contract.json'), join(root, 'copied')),
    ).rejects.toThrow()
    expect(await readdir(root)).toEqual(['source'])
  })
}
test('pre-cancelled imports create nothing and the CLI needs no execution host', async () => {
  const root = await fixture()
  await expect(
    importContract(
      join(root, 'source/FLOW.contract.json'),
      join(root, 'copied'),
      AbortSignal.abort(),
    ),
  ).rejects.toThrow()
  expect(await readdir(root)).toEqual(['source'])
  expect(privateCliRequiresHost(['import-contract', 'a.json', 'new'])).toBe(false)
  let output = ''
  const code = await main(['import-contract', 'source/FLOW.contract.json', 'copied'], {
    currentDirectory: root,
    writeOutput: (text) => {
      output += text
    },
    host: {
      async acquire() {
        throw new Error('must not acquire host')
      },
    },
  })
  expect(code).toBe(0)
  expect(output).toContain('Imported 2 contract files')
})
