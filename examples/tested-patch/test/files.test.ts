import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRepair as inspect } from '../flows/check-repair/evidence.ts'
import { identity } from '../flows/check-repair/identity.ts'
import { patchFiles } from '../flows/export-patch/method.ts'
import { unifiedPatch } from '../flows/export-patch/patch.ts'
import { readProject as readRepairInput } from '../flows/read-project/capture.ts'
import { digest } from '../flows/repair/policy.ts'
import { input, repairResultData } from './fixture.ts'

// Packet values are validator inputs, not evidence that execution occurred.
// File capture exercises actual temporary files. Patch export tests format data.
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
test('single issues select reviewed acceptance data without sending the selector to the specialist', async () => {
  const root = await directory()
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/code.ts'), 'export const value = 0')
  const request = { issue: 'Fix.', editPaths: ['src/code.ts'], checks: 'logs' }
  const actual = await readRepairInput(request, root)
  expect(actual.cases[0]?.id).toBe('client-and-server-errors')
  expect(Object.hasOwn(actual, 'checks')).toBe(false)
  await expect(readRepairInput({ ...request, checks: null }, root)).rejects.toThrow(
    'Select a check set',
  )
})
test('accepted packet data produces complete review file contents', () => {
  const result = repairResultData()
  const files = patchFiles({
    issue: input.issue,
    originals: input.files,
    checked: inspect(input, result),
  })
  expect(Object.keys(files).sort()).toEqual([
    'goal.txt',
    'proposal-1.patch',
    'review.patch',
    'summary.txt',
  ])
  expect(files['goal.txt']).toBe(`${input.issue}\n`)
  const patch = files['review.patch']!
  expect(patch).toContain('--- a/src/parse.ts')
  expect(patch).toContain('--- a/src/report.ts')
  expect(patch).not.toContain('--- a/test/')
})
test('decoded packet data accepts null-prototype records and rejects changed verdicts', () => {
  const decoded = JSON.parse(JSON.stringify(repairResultData()), (_key, value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.assign(Object.create(null), value)
      : value,
  )
  expect(() => inspect(input, decoded)).not.toThrow()
  decoded.output.attempts[0].evaluation.acceptance[0].passed = false
  expect(() => inspect(input, decoded)).toThrow('contradicts collected command behavior')
})
test('the checker rejects replacement commands and extra reviewed-command arguments in packet data', () => {
  for (const [index, invocation] of [
    [0, ['node', 'test', 'test/project.test.ts']],
    [0, ['bun', 'test', 'unrelated.test.ts']],
    [0, ['bun', 'test', 'test/project.test.ts', '--only']],
    [0, ['bun', 'test']],
    [1, ['node', 'src/cli.ts', ...input.cases[0]!.args]],
    [1, ['bun', 'different-cli.ts', ...input.cases[0]!.args]],
    [1, ['bun', 'src/cli.ts', ...input.cases[0]!.args, '--other']],
  ] as const) {
    const altered = structuredClone(repairResultData())
    altered.output.attempts[0]!.evaluation.commands[index]!.invocation = [...invocation]
    expect(() => inspect(input, altered)).toThrow('complete reviewed command')
  }
})
test('unsuccessful packet data retains both proposals without a review patch', () => {
  const files = patchFiles({
    issue: input.issue,
    originals: input.files,
    checked: inspect(input, repairResultData(false)),
  })
  expect(Object.keys(files).sort()).toEqual([
    'goal.txt',
    'proposal-1.patch',
    'proposal-2.patch',
    'summary.txt',
  ])
  expect(files['summary.txt']).toContain('unsuccessful')
})
test('pure inspection rejects contradicted checks or edited packet data', () => {
  for (const mutate of [
    (v: any) => (v.output.baseDigest = 'wrong'),
    (v: any) => (v.output.acceptanceDigest = 'wrong'),
    (v: any) => (v.output.attempts[0].proposal.replacements[0].content += 'changed'),
    (v: any) => (v.output.attempts[0].proposal.replacements[0].path = 'test/project.test.ts'),
    (v: any) => (v.output.attempts[0].evaluation.commands[1].stdout.text = '{"passed":true}'),
    (v: any) => (v.output.attempts[0].evaluation.commands[1].stdinDigest = 'wrong'),
    (v: any) => v.output.attempts[0].evaluation.commands[0].invocation.push('--filter'),
    (v: any) => (v.output.attempts[0].evaluation.commands[1].invocation[1] = 'src/other.ts'),
    (v: any) => (v.output.attempts[0].evaluation.commands[1].stdout.truncated = true),
    (v: any) => (v.output.attempts = []),
  ]) {
    const result = repairResultData()
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
