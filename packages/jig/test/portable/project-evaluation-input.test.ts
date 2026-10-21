import { expect, test } from 'bun:test'
import { closeSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  capturePrivateOutput,
  type PrivateCapturedOutput,
} from '../../src/internal/captured-output.js'
import { privateOpenFileRoot } from '../../src/internal/file-input.js'
import {
  capturePrivateProjectEvaluationWorkspace,
  PrivateProjectEvaluationReviewRequiredError,
  requirePrivateProjectEvaluationCandidate,
} from '../../src/internal/project-evaluation-input.js'
import { normalizePrivateProjectEvaluationCompiler } from '../../src/internal/project-evaluation-policy.js'
import { createCapturedPackage } from '../../src/package/capture.js'
import { packageDigest } from '../../src/package/digest.js'

async function memoryPackage(contents: Record<string, string>) {
  const files = Object.entries(contents).map(([path, value]) => ({
    path,
    size: Buffer.byteLength(value),
  }))
  const stream = async function* (path: string) {
    yield Buffer.from(contents[path]!)
  }
  return createCapturedPackage(
    'test immutable package',
    files,
    await packageDigest(files, (file) => stream(file.path)),
    { stream, async dispose() {} },
  )
}
async function snapshot(
  contents: Record<string, string>,
  work: (snapshot: PrivateCapturedOutput) => Promise<void>,
  directories: readonly string[] = [],
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-evaluation-input-')))
  let fd: number | undefined
  let captured: PrivateCapturedOutput | undefined
  try {
    for (const path of directories) await mkdir(join(root, path), { recursive: true })
    for (const [path, value] of Object.entries(contents)) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), value)
    }
    fd = privateOpenFileRoot(root)
    captured = capturePrivateOutput(fd)
    await work(captured)
  } finally {
    captured?.close()
    if (fd !== undefined) closeSync(fd)
    await rm(root, { recursive: true, force: true })
  }
}
const reviewedContents = { 'package.json': '{"name":"evaluation"}', 'bun.lock': 'reviewed lock' }

test('candidate loader configuration remains ordinary inert data', async () => {
  const reviewed = await memoryPackage(reviewedContents)
  await snapshot(
    {
      '.env': 'untrusted',
      'tsconfig.json': '{"compilerOptions":{"plugins":["evil"]}}',
      'bunfig.toml': 'preload=["evil"]',
      'src/parser.ts': 'export const value=1',
    },
    async (candidate) => {
      await requirePrivateProjectEvaluationCandidate(candidate, reviewed)
      await expect(
        requirePrivateProjectEvaluationCandidate({ ...candidate }, reviewed),
      ).rejects.toThrow('not authentic')
    },
  )
})

test('candidate cannot shadow host-owned roots even through an empty case variant', async () => {
  const reviewed = await memoryPackage(reviewedContents)
  await snapshot(
    {},
    async (candidate) => {
      await expect(requirePrivateProjectEvaluationCandidate(candidate, reviewed)).rejects.toThrow(
        'host-owned root',
      )
    },
    ['Generated'],
  )
})

test('candidate manifest drift requires review rather than dependency installation', async () => {
  const reviewed = await memoryPackage(reviewedContents)
  await snapshot({ 'package.json': '{"name":"changed"}' }, async (candidate) => {
    await expect(
      requirePrivateProjectEvaluationCandidate(candidate, reviewed),
    ).rejects.toBeInstanceOf(PrivateProjectEvaluationReviewRequiredError)
  })
  await snapshot(reviewedContents, async (candidate) => {
    await requirePrivateProjectEvaluationCandidate(candidate, reviewed)
  })
})

test('merged compiler workspace uses reviewed config and immutable prior generation', async () => {
  const reviewed = await memoryPackage(reviewedContents)
  const dependencies = await memoryPackage({
    ...reviewedContents,
    'node_modules/typescript/lib/tsc.js': 'reviewed compiler',
    'node_modules/typescript/package.json': '{"version":"5.7.3"}',
  })
  const compiler = normalizePrivateProjectEvaluationCompiler({}, new Set())
  await snapshot(
    { 'src/parser.ts': 'export const parser=1', 'tsconfig.json': 'candidate data' },
    async (candidate) =>
      snapshot(
        { 'generated/types.ts': 'export type Value=number', 'reports/codegen.txt': 'old' },
        async (prior) => {
          const compile = await capturePrivateProjectEvaluationWorkspace({
            candidate,
            reviewed,
            dependencies,
            compiler,
            phase: 'compile',
            prior: [prior],
            signal: new AbortController().signal,
          })
          try {
            expect(Buffer.from(await compile.read('generated/types.ts')).toString()).toBe(
              'export type Value=number',
            )
            expect(Buffer.from(await compile.read('tsconfig.json')).toString()).toBe(
              'candidate data',
            )
            expect(
              JSON.parse(Buffer.from(await compile.read('.jig-evaluation.json')).toString()),
            ).toEqual(compiler)
            expect(Buffer.from(await compile.read('package.json')).toString()).toBe(
              reviewedContents['package.json'],
            )
            expect(compile.files.some((file) => file.path === 'reports/codegen.txt')).toBe(true)
          } finally {
            await compile.dispose()
          }
          const tested = await capturePrivateProjectEvaluationWorkspace({
            candidate,
            reviewed,
            dependencies,
            compiler,
            phase: 'test',
            prior: [prior],
            signal: new AbortController().signal,
          })
          try {
            expect(tested.files.some((file) => file.path.startsWith('reports/'))).toBe(false)
            expect(tested.files.some((file) => file.path.startsWith('generated/'))).toBe(true)
          } finally {
            await tested.dispose()
          }
        },
      ),
  )
})

test('closed merged workspace refuses a missing retained compiler closure', async () => {
  const reviewed = await memoryPackage(reviewedContents)
  const dependencies = await memoryPackage({})
  await snapshot({ 'src/main.ts': '' }, async (candidate) => {
    await expect(
      capturePrivateProjectEvaluationWorkspace({
        candidate,
        reviewed,
        dependencies,
        compiler: {},
        phase: 'compile',
        prior: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('TypeScript closure')
  })
})

test('empty directory intent metadata comes from the authentic candidate manifest', async () => {
  const reviewed = await memoryPackage(reviewedContents)
  const dependencies = await memoryPackage({ 'node_modules/typescript/lib/tsc.js': 'compiler' })
  await snapshot(
    { 'src/main.ts': '' },
    async (candidate) => {
      const workspace = await capturePrivateProjectEvaluationWorkspace({
        candidate,
        reviewed,
        dependencies,
        compiler: {},
        phase: 'compile',
        prior: [],
        signal: new AbortController().signal,
      })
      try {
        expect(workspace.emptyDirectories).toEqual(['data', 'data/empty'])
      } finally {
        await workspace.dispose()
      }
    },
    ['data/empty'],
  )
})
