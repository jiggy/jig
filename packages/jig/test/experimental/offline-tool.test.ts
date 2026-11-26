import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { flowSdkRuntimeDirectory } from '../fixtures/flow-dependency.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

const runtime = process.env.JIG_OFFLINE_TOOL_TEST_RUNTIME
if (process.platform !== 'linux' || !runtime)
  throw Error('Supply a provisioned Nix coreutils installation in JIG_OFFLINE_TOOL_TEST_RUNTIME.')

test('reviewed offline tools preserve binary identity and withhold failed output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-offline-tool-consumer-'))
  let passed = false
  try {
    const cli = join(installedBunLocation.releaseRoot, 'bin', 'jig')
    const invoke = async (...args: string[]) => {
      const process = Bun.spawn([cli, ...args], {
        cwd: root,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exit, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])
      expect(exit, stdout + stderr).toBe(0)
      return stdout
    }
    const put = async (path: string, text: string) => {
      const file = join(root, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, text)
    }
    await put(
      'jig.ts',
      `import {defineJig,discover} from '@jigging/jig'
export default defineJig({flows:discover('flows'),bindings:discover('bindings')})`,
    )
    await put(
      'flows/check/FLOW.meta.json',
      JSON.stringify({
        name: 'check',
        description: 'Exercise reviewed binary file custody.',
        uses: { tool: { contract: './contracts/tool/contract.json' } },
      }),
    )
    await put(
      'flows/check/FLOW.contract.json',
      JSON.stringify({
        $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
        attachments: { source: 'read' },
        artifactResults: ['report'],
      }),
    )
    await put(
      'flows/check/FLOW.ts',
      `import {handle} from './sdk/index.js'
await handle(async run => {
  try {
    const checked = await run.call({
      operationId: 'native-tool',
      slot: 'tool',
      input: {},
      attachments: {source: {read: run.attachments.source.artifact}, deliverables: {create: true}},
    })
    return {outcome: 'done', output: checked.output, artifactResults: {report: checked.artifacts.deliverables}}
  } catch (error) {
    return {outcome: 'done', output: {code: error.code, details: error.details}}
  }
})`,
    )
    await cp(flowSdkRuntimeDirectory, join(root, 'flows/check/sdk'), { recursive: true })
    await mkdir(join(root, 'flows/check/contracts'))
    await invoke('import-contract', 'jig:offline-tool', 'flows/check/contracts/tool')
    const copy = {
      kind: 'tool',
      executable: `${runtime}/bin/cp`,
      runtimeRoots: [runtime],
      args: ['/jig-input/source/input.bin', '/jig-output/result.bin'],
    }
    for (const [name, tool] of Object.entries({
      copy,
      quota: { ...copy, outputBytes: 65536 },
      deadline: { ...copy, executable: `${runtime}/bin/sleep`, args: ['30'], timeoutMs: 1000 },
    })) {
      await put(
        `bindings/${name}.ts`,
        `import {defineBinding} from '@jigging/jig'
export default defineBinding({package: 'flows/check', slots: {tool: ${JSON.stringify(tool)}}})`,
      )
    }
    const source = join(root, 'source', 'input.bin')
    await mkdir(dirname(source))
    const original = Buffer.alloc(192 * 1024, 0x89)
    await writeFile(source, original)
    await invoke('review', '--yes', '--allow-authority-changes')
    const run = async (binding: string, dest: string) =>
      JSON.parse(
        await invoke(
          'run',
          `binding:${binding}`,
          '--attach',
          'source=source',
          '--out',
          dest,
          '--json',
        ),
      )
    const first = await run('copy', 'first')
    const digest = `sha256:${createHash('sha256').update(original).digest('hex')}`
    expect(first.output).toMatchObject({
      cleanup: 'complete',
      inputFiles: [{ path: 'input.bin', bytes: original.length, digest }],
      files: [{ path: 'result.bin', bytes: original.length, digest }],
    })
    expect(await readFile(join(root, 'first/files/report/result.bin'))).toEqual(original)
    const changed = Buffer.from(original)
    changed[0] ^= 1
    await writeFile(source, changed)
    expect((await run('copy', 'changed')).output.inputDigest).not.toBe(first.output.inputDigest)
    await writeFile(source, original)
    expect((await run('copy', 'restored')).output.inputDigest).toBe(first.output.inputDigest)
    expect((await run('quota', 'quota')).output).toMatchObject({ code: 'EXECUTION_FAILED' })
    await expect(readFile(join(root, 'quota/files/report/result.bin'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect((await run('deadline', 'deadline')).output).toMatchObject({
      code: 'DEADLINE_EXCEEDED',
      details: { tool: { cleanup: 'complete', stopReason: 'deadline' } },
    })
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else console.error(`Offline tool consumer evidence retained at ${root}`)
  }
}, 180000)
