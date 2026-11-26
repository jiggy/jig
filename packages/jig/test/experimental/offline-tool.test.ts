import { constants, Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createAttemptClient } from '../../src/client.js'
import { flowSdkRuntimeDirectory } from '../fixtures/flow-dependency.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

const runtime = process.env.JIG_OFFLINE_TOOL_TEST_RUNTIME
if (process.platform !== 'linux' || !runtime)
  throw Error('Supply a provisioned Nix coreutils installation in JIG_OFFLINE_TOOL_TEST_RUNTIME.')

async function missing<T>(operation: Promise<T>): Promise<T | undefined> {
  try {
    return await operation
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

async function processIdentity(pid: number) {
  const stat = await missing(readFile(`/proc/${pid}/stat`, 'utf8'))
  if (stat === undefined) return undefined
  const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')
  return { state: fields[0], start: fields[19] }
}

async function waitForTool(scope: string, runtime: string) {
  const deadline = performance.now() + 25_000
  while (performance.now() < deadline) {
    for (const name of (await readdir(scope)).filter((item) => item.startsWith('jig-run-'))) {
      const group = join(scope, name)
      const tasks = await missing(readFile(join(group, 'cgroup.procs'), 'utf8'))
      if (!tasks?.trim()) continue
      const observed = await Promise.all(
        tasks
          .trim()
          .split('\n')
          .map(async (value) => {
            const pid = Number(value)
            const command = await missing(readFile(`/proc/${pid}/cmdline`, 'utf8'))
            const executable = command?.split('\0')[0]
            return { pid, executable, identity: await processIdentity(pid) }
          }),
      )
      const tools = observed.filter(
        ({ executable, identity }) =>
          identity !== undefined &&
          [`${runtime}/bin/timeout`, `${runtime}/bin/sleep`].includes(executable ?? ''),
      )
      if (new Set(tools.map(({ executable }) => executable)).size === 2) return { group, tools }
    }
    await Bun.sleep(25)
  }
  throw new Error('The timeout tool and its sleep child were not observed in the same cgroup')
}

async function verifyToolCleanup(scope: string, active: Awaited<ReturnType<typeof waitForTool>>) {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    const groups = (await readdir(scope)).filter((name) => name.startsWith('jig-run-'))
    const original = await missing(readFile(join(active.group, 'cgroup.events'), 'utf8'))
    const live = await Promise.all(
      active.tools.map(async ({ pid, identity }) => {
        const current = await processIdentity(pid)
        return current?.start === identity?.start && current?.state !== 'Z'
      }),
    )
    if (!groups.length && original === undefined && !live.some(Boolean)) return
    await Bun.sleep(25)
  }
  throw new Error('The tool cgroup or an observed task survived settlement')
}

function acceptedRunCount(root: string): number {
  const state = Database.open(
    join(root, '.jig/jig.sqlite3'),
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
  )
  try {
    state.exec('PRAGMA busy_timeout = 1000')
    return state.query<{ count: number }, []>('SELECT count(*) AS count FROM root_runs').get()!
      .count
  } finally {
    state.close()
  }
}

async function verifyInterruption(cli: string, root: string, runtime: string) {
  const scope = process.env.AGENT_DELEGATED_CGROUP
  if (!scope?.startsWith('/sys/fs/cgroup/')) throw new Error('Missing trial cgroup delegation')
  const client = createAttemptClient({ executable: cli, cwd: root, timeoutMs: 90_000 })
  const target = 'binding:long'
  const inspected = await client.inspect({ target })
  if (!inspected || typeof inspected.approval !== 'string') throw new Error('Missing tool approval')
  const approval = inspected.approval
  const prepare = () =>
    client.prepare({
      expectedApproval: approval,
      target,
      input: {},
      files: [{ port: 'source', source: join(root, 'source'), selection: [] }],
      constraints: { durationMs: 90_000, resultBytes: 65_536, artifactBytes: 1_048_576 },
      outputIntent: { packet: true, receive: ['report'] },
    })

  const cancelled = await prepare()
  const owner = await client.submit({
    ticket: cancelled.ticket,
    request: cancelled.canonicalRequest,
  })
  try {
    expect(owner.role).toBe('owner')
    const active = await waitForTool(scope, runtime)
    expect(await client.cancel({ ticket: cancelled.ticket })).toMatchObject({ acknowledged: true })
    expect(await owner.completion).toMatchObject({
      receipt: { runId: owner.receipt.runId },
      cleanup: 'confirmed',
      terminal: { status: 'failed', code: 'CANCELLED' },
    })
    await verifyToolCleanup(scope, active)
    expect((await client.result({ ticket: cancelled.ticket })).artifactResults).toEqual([
      { name: 'report', availability: 'unavailable' },
    ])
    console.log(
      'Cancellation verified after both tool processes started, with confirmed cleanup and zero artifacts',
    )
  } finally {
    owner.close()
    await owner.completion.catch(() => undefined)
  }

  const lost = await prepare()
  const coordinator = Bun.spawn([cli, 'attempt', 'submit', '--json'], {
    cwd: root,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new Response(coordinator.stdout).text()
  const stderr = new Response(coordinator.stderr).text()
  let recovered = false
  try {
    coordinator.stdin.write(
      JSON.stringify({
        protocolVersion: 1,
        operation: 'submit',
        request: { ticket: lost.ticket, request: lost.canonicalRequest },
      }) + '\n',
    )
    await coordinator.stdin.flush()
    const active = await waitForTool(scope, runtime)
    const before = await client.lookup({ ticket: lost.ticket })
    expect(before).toMatchObject({ identity: 'accepted', cleanup: 'pending' })
    expect(before.receipt?.runId).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(before.terminal).toBeUndefined()
    const runs = acceptedRunCount(root)
    expect(coordinator.exitCode).toBeNull()
    coordinator.kill('SIGKILL')
    await coordinator.exited
    expect(coordinator.signalCode).toBe('SIGKILL')
    const accepted = (await stdout)
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(accepted).toEqual([
      expect.objectContaining({
        event: 'accepted',
        role: 'owner',
        receipt: expect.objectContaining({
          runId: before.receipt?.runId,
          requestDigest: lost.requestDigest,
        }),
      }),
    ])
    const settled = await client.reconcile({ ticket: lost.ticket })
    expect(settled).toMatchObject({
      receipt: { runId: before.receipt?.runId },
      terminal: { status: 'lost', code: 'COORDINATOR_LOST' },
      cleanup: 'confirmed',
    })
    expect(await client.reconcile({ ticket: lost.ticket })).toEqual(settled)
    await verifyToolCleanup(scope, active)
    expect((await client.result({ ticket: lost.ticket })).artifactResults).toEqual([
      { name: 'report', availability: 'unavailable' },
    ])
    expect(acceptedRunCount(root)).toBe(runs)
    recovered = true
    console.log(
      'Coordinator loss verified after both tool processes started, with the original Run ID, confirmed cleanup and zero artifacts',
    )
  } finally {
    if (coordinator.exitCode === null) coordinator.kill('SIGKILL')
    await coordinator.exited
    await stdout
    const diagnostics = await stderr
    if (!recovered) {
      console.error(diagnostics)
      await client.reconcile({ ticket: lost.ticket }).catch(() => undefined)
    }
  }
}

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
      `import {handle,OperationError} from './sdk/index.js'
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
    if (!(error instanceof OperationError)) throw error
    return {outcome: 'done', output: {code: error.code, message: error.message,
      ...(error.details === undefined ? {} : {details: error.details})}}
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
      long: {
        ...copy,
        executable: `${runtime}/bin/timeout`,
        args: ['180', `${runtime}/bin/sleep`, '180'],
      },
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
    console.log('Binary delivery, changed and restored input, output cap, and deadline verified')
    await verifyInterruption(cli, root, runtime)
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else console.error(`Offline tool consumer evidence retained at ${root}`)
  }
}, 300000)
