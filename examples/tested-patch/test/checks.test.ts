import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadChecks } from '../flows/project/checks.ts'
import { parseInput } from '../flows/repair/policy.ts'
import { input } from './fixture.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'jig-check-sets-'))
  roots.push(root)
  return root
}
const cases = [
  { id: 'custom', args: ['--count'], stdin: '', stdout: '7\n', stderr: '', exitCode: 0 },
]

test('an application adds a new named check set as data, accepted unchanged by the specialist', async () => {
  const root = await directory()
  await writeFile(join(root, 'inventory-cases.json'), JSON.stringify(cases))
  const loaded = await loadChecks('inventory', root)
  expect(loaded).toEqual(cases)
  expect(parseInput({ ...input, cases: loaded }).cases).toEqual(cases)
})

test('invalid check policy is rejected before it reaches a worker', async () => {
  const root = await directory()
  for (const value of [
    [],
    Array(9).fill(cases[0]),
    [...cases, ...cases],
    [{ ...cases[0], exitCode: 256 }],
    [{ ...cases[0], args: [3] }],
    [{ ...cases[0], stdout: '\ud800' }],
    [{ ...cases[0], stdin: '\0' }],
    [{ ...cases[0], extra: true }],
    [{ ...cases[0], stdout: 'x'.repeat(8193) }],
  ]) {
    await writeFile(join(root, 'invalid-cases.json'), JSON.stringify(value))
    await expect(loadChecks('invalid', root)).rejects.toThrow()
  }
  await writeFile(join(root, 'invalid-cases.json'), 'x'.repeat(256 * 1024 + 1))
  await expect(loadChecks('invalid', root)).rejects.toThrow('256 KiB')
})

test('check selection cannot escape the package or follow a symlink', async () => {
  const root = await directory()
  for (const name of ['../outside', '/tmp/check', 'constructor.json', '', null, 3])
    await expect(loadChecks(name, root)).rejects.toThrow('Select a check set')
  await expect(loadChecks('missing', root)).rejects.toThrow('Add the check set')
  await writeFile(join(root, 'real.json'), JSON.stringify(cases))
  await symlink('real.json', join(root, 'linked-cases.json'))
  await expect(loadChecks('linked', root)).rejects.toThrow('Cannot read linked-cases.json')
})
