import { afterEach, expect, test } from 'bun:test'
import type { RunContext } from '@jigging/flow'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  identity,
  inspect,
  readRepairInput,
  repairFiles,
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

for (const success of [true, false]) {
  test(`one specialist produces only final ${success ? 'passing' : 'unsuccessful'} deliverables`, async () => {
    const destination = await directory()
    const { result } = await syntheticRepair({ success })
    let calls = 0
    const run = {
      input: { issue: input.issue, editPaths: input.editPaths },
      signal: new AbortController().signal,
      channels: {},
      attachments: {
        source: { access: 'read', path: join(import.meta.dir, '../fixtures/log-report') },
        deliverables: { access: 'read-write', path: destination },
      },
      call: async (request: any) => {
        calls++
        expect(request).toEqual({ operationId: 'repair', slot: 'repair', input })
        return result
      },
    } as unknown as RunContext
    expect(await repairFiles(run)).toEqual(result)
    expect(calls).toBe(1)
    expect((await readdir(destination)).sort()).toEqual(
      success
        ? ['proposal-1.patch', 'review.patch', 'summary.txt']
        : ['proposal-1.patch', 'proposal-2.patch', 'summary.txt'],
    )
  })
}

test('the root passes a requested progress writer to the repair specialist', async () => {
  const destination = await directory()
  const { result } = await syntheticRepair()
  const progress = { direction: 'send', send: async () => {} }
  let observed: unknown
  const run = {
    input: { issue: input.issue, editPaths: input.editPaths },
    signal: new AbortController().signal,
    channels: { progress },
    attachments: {
      source: { access: 'read', path: join(import.meta.dir, '../fixtures/log-report') },
      deliverables: { access: 'read-write', path: destination },
    },
    call: async (request: unknown) => {
      observed = request
      return result
    },
  } as unknown as RunContext
  expect(await repairFiles(run)).toEqual(result)
  expect(observed).toMatchObject({
    operationId: 'repair',
    slot: 'repair',
    channels: { progress },
  })
})

for (const mode of ['uncertain', 'cancelled', 'invalid-evidence']) {
  test(`${mode} work cannot publish a final patch or trigger replay`, async () => {
    const destination = await directory()
    const controller = new AbortController()
    const failure = new Error(mode)
    const { result } = await syntheticRepair()
    let calls = 0
    const run = {
      input: { issue: input.issue, editPaths: input.editPaths },
      signal: controller.signal,
      channels: {},
      attachments: {
        source: { access: 'read', path: join(import.meta.dir, '../fixtures/log-report') },
        deliverables: { access: 'read-write', path: destination },
      },
      call: async () => {
        calls++
        if (mode === 'uncertain') throw failure
        if (mode === 'cancelled') controller.abort(failure)
        if (mode === 'invalid-evidence') (result.output as any).baseDigest = 'wrong'
        return result
      },
    } as unknown as RunContext
    await expect(repairFiles(run)).rejects.toThrow()
    expect(calls).toBe(1)
    expect(await readdir(destination)).toEqual([])
  })
}
