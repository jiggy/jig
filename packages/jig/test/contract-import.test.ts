import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, privateCliRequiresHost } from '../src/cli.js'
import { importContract } from '../src/internal/contract-import.js'
import { parseInvocationContract } from '../src/invocation-contract.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const agreement = JSON.stringify({
  $schema: 'https://flow.jig.md/schemas/channel-contract-0.schema.json',
  id: 'https://example.org/events',
  version: '1.0.0',
  semantics: 'Selected progress.',
  item: true,
})
const descriptor = JSON.stringify({
  $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
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
test.each(['project root', 'member-local'])(
  'npm selector imports from a %s installation without a physical path',
  async (layout) => {
    const root = await fixture()
    const member = join(root, 'flows/worker')
    const installedAt = layout === 'project root' ? root : member
    await mkdir(join(member, 'contracts'), { recursive: true })
    await mkdir(join(installedAt, 'node_modules/@jigging'), { recursive: true })
    await symlink(join(root, 'source'), join(installedAt, 'node_modules/@jigging/agent-method'))
    let output = ''
    const code = await main(
      ['import-contract', 'npm:@jigging/agent-method', 'flows/worker/contracts/agent-run'],
      {
        currentDirectory: root,
        writeOutput: (text) => {
          output += text
        },
        host: {
          async acquire() {
            throw new Error('must not acquire host')
          },
        },
      },
    )
    expect(code).toBe(0)
    expect(output).toContain('Imported 2 contract files')
    expect(await readFile(join(member, 'contracts/agent-run/FLOW.contract.json'), 'utf8')).toBe(
      descriptor,
    )
    expect(await readFile(join(member, 'contracts/agent-run/contracts/events.json'), 'utf8')).toBe(
      agreement,
    )
  },
)
test('nearest installed package wins and a missing descriptor does not fall back', async () => {
  const root = await fixture()
  const member = join(root, 'flows/worker')
  await mkdir(join(member, 'contracts'), { recursive: true })
  await mkdir(join(root, 'node_modules/@jigging'), { recursive: true })
  await symlink(join(root, 'source'), join(root, 'node_modules/@jigging/agent-method'))
  await mkdir(join(member, 'node_modules/@jigging/agent-method'), { recursive: true })
  await expect(
    importContract('npm:@jigging/agent-method', join(member, 'contracts/agent-run')),
  ).rejects.toThrow('package has no FLOW.contract.json')
  expect(await readdir(join(member, 'contracts'))).toEqual([])
})
test('missing installed package and malformed selectors remain actionable', async () => {
  const root = await fixture()
  await expect(importContract('npm:@jigging/missing', join(root, 'copied'))).rejects.toMatchObject({
    code: 'CONTRACT_IMPORT_PACKAGE',
    path: 'npm:@jigging/missing',
  })
  await expect(importContract('npm:../source', join(root, 'copied'))).rejects.toMatchObject({
    code: 'CONTRACT_IMPORT_SOURCE',
  })
  expect(await readdir(root)).toEqual(['source'])
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

test('unreadable source and destination errors identify the responsible location', async () => {
  const root = await fixture()
  const missing = join(root, 'missing/FLOW.contract.json')
  await expect(importContract(missing, join(root, 'copied'))).rejects.toMatchObject({
    code: 'CONTRACT_IMPORT_UNAVAILABLE',
    path: missing,
    message: expect.stringContaining('source bundle'),
  })
  const destination = join(root, 'missing/copied')
  await expect(
    importContract(join(root, 'source/FLOW.contract.json'), destination),
  ).rejects.toMatchObject({
    code: 'CONTRACT_IMPORT_UNAVAILABLE',
    path: destination,
    message: expect.stringContaining('destination'),
  })
  expect(await readdir(root)).toEqual(['source'])
})

test('CLI import errors show escaped locations without acquiring a host', async () => {
  const root = await fixture()
  let diagnostics = ''
  const code = await main(['import-contract', 'missing\u001b/FLOW.contract.json', 'copied'], {
    currentDirectory: root,
    writeError: (text) => {
      diagnostics += text
    },
    host: {
      async acquire() {
        throw new Error('must not acquire host')
      },
    },
  })
  expect(code).toBe(2)
  expect(diagnostics).toContain('Location:')
  expect(diagnostics).toContain('missing\\u001b/FLOW.contract.json')
  expect(diagnostics).toContain('existing descriptor file')
  expect(diagnostics).not.toContain('\u001b')
})
