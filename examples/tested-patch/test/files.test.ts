import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  identity,
  inspect,
  readRepairInput,
  unifiedPatch,
  writeRepairDeliverables,
} from '../flows/project/files.ts'
import { digest } from '../flows/repair/policy.ts'
import { input, syntheticRepair } from './fixture.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'jig-project-files-'))
  roots.push(root)
  return root
}
test('root captures bounded text without executing it and shares the documented candidate identity', async () => {
  const root = await directory()
  await mkdir(join(root, 'src'))
  const content = '\ufeffthrow new Error("do not execute"); // 😀\r\n'
  await writeFile(join(root, 'src/code.ts'), content)
  const actual = await readRepairInput({ issue: 'Fix.', editPaths: ['src/code.ts'] }, root)
  expect(actual.files).toEqual({ 'src/code.ts': content })
  expect(identity(actual.files)).toBe(digest(actual.files))
  await symlink('code.ts', join(root, 'src/link.ts'))
  await expect(
    readRepairInput({ issue: 'Fix.', editPaths: ['src/code.ts'] }, root),
  ).rejects.toThrow()
})
test('only verified successful evidence earns a review patch', async () => {
  const root = await directory(),
    { result } = await syntheticRepair()
  await writeRepairDeliverables(root, input, result)
  expect((await readdir(root)).sort()).toEqual(['proposal-1.patch', 'review.patch', 'summary.txt'])
  const patch = await readFile(join(root, 'review.patch'), 'utf8')
  expect(patch).toContain('--- a/src/parse.ts')
  expect(patch).toContain('--- a/src/report.ts')
  expect(patch).not.toContain('--- a/test/')
  await expect(writeRepairDeliverables(root, input, result)).rejects.toThrow()
})
test('failed attempts remain inspectable and are never renamed review-ready', async () => {
  const root = await directory(),
    { result } = await syntheticRepair({ success: false })
  await writeRepairDeliverables(root, input, result)
  expect((await readdir(root)).sort()).toEqual([
    'proposal-1.patch',
    'proposal-2.patch',
    'summary.txt',
  ])
  expect(await readFile(join(root, 'summary.txt'), 'utf8')).toContain('unsuccessful')
})
test('the root rejects contradicted checks or edited evidence before publication', async () => {
  for (const mutate of [
    (v: any) => (v.output.baseDigest = 'wrong'),
    (v: any) => (v.output.acceptanceDigest = 'wrong'),
    (v: any) => (v.output.attempts[0].proposal.replacements[0].content += 'changed'),
    (v: any) => (v.output.attempts[0].proposal.replacements[0].path = 'test/project.test.ts'),
    (v: any) => (v.output.attempts[0].evaluation.commands[1].stdout.text = '{"passed":true}'),
    (v: any) => (v.output.attempts[0].evaluation.commands[1].stdinDigest = 'wrong'),
    (v: any) => (v.output.attempts[0].evaluation.commands[1].stdout.truncated = true),
    (v: any) => (v.output.attempts = []),
  ]) {
    const { result } = await syntheticRepair()
    mutate(result)
    expect(() => inspect(input, result)).toThrow()
  }
})
test('complete-file patches preserve empty files and missing final newlines', () => {
  expect(unifiedPatch('src/a.ts', '', 'a')).toContain(
    '@@ -0,0 +1,1 @@\n+a\n\\ No newline at end of file\n',
  )
  expect(unifiedPatch('src/a.ts', 'a\n', '')).toContain('@@ -1,1 +0,0 @@\n-a\n')
  expect(unifiedPatch('src/a.ts', 'a', 'a')).toBe('')
})
