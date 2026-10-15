import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RunContext } from '@jigging/flow'
import { checkRepair } from '../flows/check-repair/evidence.ts'
import { identity } from '../flows/check-repair/identity.ts'
import { checkRepairEvidence as checkEvidence } from '../flows/check-repair/method.ts'
import { exportPatch } from '../flows/export-patch/method.ts'
import { unifiedPatch } from '../flows/export-patch/patch.ts'
import { repairFiles } from '../flows/project/method.ts'
import { readProject } from '../flows/read-project/capture.ts'
import { captureProject as readSource } from '../flows/read-project/method.ts'
import { digest } from '../flows/repair/policy.ts'
import { input, syntheticRepair } from './fixture.ts'

async function exportReview(
  path: string,
  captured: typeof input,
  result: Awaited<ReturnType<typeof syntheticRepair>>['result'],
) {
  return exportPatch({
    input: {
      issue: captured.issue,
      originals: captured.files,
      checked: checkRepair(captured, result),
    },
    attachments: { files: { access: 'read-write', path } },
    signal: new AbortController().signal,
  })
}
async function localStage(run: RunContext, request: Parameters<RunContext['call']>[0]) {
  if (request.slot === 'reader') return readSource(run)
  if (request.slot === 'checker') return checkEvidence({ input: request.input, signal: run.signal })
  if (request.slot === 'exporter')
    return exportPatch({
      input: request.input,
      signal: run.signal,
      attachments: {
        files: { access: 'read-write', path: join(run.attachments.deliverables!.path, 'review') },
      },
    })
  throw new Error('Unknown test stage')
}
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
  const actual = await readProject({ issue: 'Fix.', editPaths: ['src/code.ts'] }, root)
  expect(actual.files).toEqual({ 'src/code.ts': content })
  expect(identity(actual.files)).toBe(digest(actual.files))
  await symlink('code.ts', join(root, 'src/link.ts'))
  await expect(readProject({ issue: 'Fix.', editPaths: ['src/code.ts'] }, root)).rejects.toThrow()
})
test('single issues select reviewed acceptance data without sending the selector to the specialist', async () => {
  const root = await directory()
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/code.ts'), 'export const value = 0')
  const request = { issue: 'Fix.', editPaths: ['src/code.ts'], checks: 'logs' }
  const actual = await readProject(request, root)
  expect(actual.cases[0]?.id).toBe('client-and-server-errors')
  expect(Object.hasOwn(actual, 'checks')).toBe(false)
  await expect(readProject({ ...request, checks: null }, root)).rejects.toThrow(
    'Select a check set',
  )
})

test('only verified successful evidence earns a review patch', async () => {
  const root = await directory(),
    { result } = await syntheticRepair()
  await exportReview(root, input, result)
  expect((await readdir(root)).sort()).toEqual([
    'goal.txt',
    'proposal-1.patch',
    'review.patch',
    'summary.txt',
  ])
  expect(await readFile(join(root, 'goal.txt'), 'utf8')).toBe(`${input.issue}\n`)
  const patch = await readFile(join(root, 'review.patch'), 'utf8')
  expect(patch).toContain('--- a/src/parse.ts')
  expect(patch).toContain('--- a/src/report.ts')
  expect(patch).not.toContain('--- a/test/')
  await expect(exportReview(root, input, result)).rejects.toThrow()
})
test('decoded JSON evidence accepts null-prototype records and rejects changed verdicts', async () => {
  const { result } = await syntheticRepair()
  const decoded = JSON.parse(JSON.stringify(result), (_key, value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.assign(Object.create(null), value)
      : value,
  )
  expect(() => checkRepair(input, decoded)).not.toThrow()
  decoded.output.attempts[0].evaluation.acceptance[0].passed = false
  expect(() => checkRepair(input, decoded)).toThrow('contradicts collected command behavior')
})
test('checker rejects replacement executables, scripts and extra reviewed-command arguments', async () => {
  const { result } = await syntheticRepair()
  for (const [index, invocation] of [
    [0, ['node', 'test', 'test/project.test.ts']],
    [0, ['bun', 'test', 'unrelated.test.ts']],
    [0, ['bun', 'test', 'test/project.test.ts', '--only']],
    [0, ['bun', 'test']],
    [1, ['node', 'src/cli.ts', ...input.cases[0]!.args]],
    [1, ['bun', 'different-cli.ts', ...input.cases[0]!.args]],
    [1, ['bun', 'src/cli.ts', ...input.cases[0]!.args, '--other']],
  ] as const) {
    const altered = structuredClone(result)
    altered.output.attempts[0]!.evaluation.commands[index]!.invocation = [...invocation]
    expect(() => checkRepair(input, altered)).toThrow('complete reviewed command')
  }
})
test('failed attempts remain inspectable and are never renamed review-ready', async () => {
  const root = await directory(),
    { result } = await syntheticRepair({ success: false })
  await exportReview(root, input, result)
  expect((await readdir(root)).sort()).toEqual([
    'goal.txt',
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
    expect(() => checkRepair(input, result)).toThrow()
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
    await mkdir(join(destination, 'review'))
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
        if (request.slot !== 'repair') return localStage(run, request)
        calls++
        expect(request).toEqual({
          operationId: 'repair',
          slot: 'repair',
          intent: 'Reproduce the defect and propose a checked repair',
          input,
        })
        return result
      },
    } as unknown as RunContext
    expect(await repairFiles(run)).toEqual(result)
    expect(calls).toBe(1)
    expect((await readdir(join(destination, 'review'))).sort()).toEqual(
      success
        ? ['goal.txt', 'proposal-1.patch', 'review.patch', 'summary.txt']
        : ['goal.txt', 'proposal-1.patch', 'proposal-2.patch', 'summary.txt'],
    )
  })
}

test('the root passes a requested progress writer to the repair specialist', async () => {
  const destination = await directory()
  await mkdir(join(destination, 'review'))
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
    call: async (request: any) => {
      if (request.slot !== 'repair') return localStage(run, request)
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
    await mkdir(join(destination, 'review'))
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
      call: async (request: any) => {
        if (request.slot !== 'repair') return localStage(run, request)
        calls++
        if (mode === 'uncertain') throw failure
        if (mode === 'cancelled') controller.abort(failure)
        if (mode === 'invalid-evidence') (result.output as any).baseDigest = 'wrong'
        return result
      },
    } as unknown as RunContext
    await expect(repairFiles(run)).rejects.toThrow()
    expect(calls).toBe(1)
    expect(await readdir(join(destination, 'review'))).toEqual([])
  })
}
