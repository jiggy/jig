import { constants, Database } from 'bun:sqlite'
import { describe, expect, spyOn, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RootAdministration, StartRootRunReceipt } from '../src/administration/root.js'
import { openPrivateInstalledBunHost } from '../src/internal/installed-bun-host.js'
import { PrivateMacosBackend } from '../src/internal/macos-native-backend.js'
import { projectCommandCandidateDigest } from '../src/internal/private-project-command.js'
import { openPrivateProjectSession } from '../src/internal/project-session-controller.js'
import { PRIVATE_ROOT_RESOURCE_POLICY } from '../src/internal/root-operation-limits.js'
import type { JsonValue } from '../src/json.js'
import {
  fixtureHost,
  MACOS_FIXTURE_ADMISSION_MS,
  MACOS_FIXTURE_SETTLEMENT_MS,
} from './fixtures/agent-fixture-host.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

const proof =
  process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ||
  (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
    ? describe.serial
    : describe.skip

const timeout = process.platform === 'darwin' ? 600_000 : 180_000

proof('contained Project Command effect', () => {
  test(
    'collects real root and leaf command evidence without Agent authority and rejects forged success',
    async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-command-proof-')))
      let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
      let primaryError: unknown
      try {
        await fixture(root)
        const host = fixtureHost(await openPrivateInstalledBunHost(installedBunLocation, {}))
        session = await openPrivateProjectSession({ directory: root, host })
        const plan = await session.plan({ lockMode: 'update' })
        expect(plan.state).toBe('applicable')
        if (plan.state !== 'applicable') throw new Error('command fixture is not reviewable')
        await session.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true })
        const run = async (
          id: string,
          files: Record<string, string>,
          options: Record<string, JsonValue> = {},
          parent = false,
        ) => {
          const receipt = await session!.rootAdministration.startRun({
            submissionId: id,
            target: { kind: 'binding', id: parent ? 'parent' : 'command' },
            input: { command: 'cli', files, ...options },
          })
          return terminal(session!.rootAdministration, receipt)
        }
        const files = {
          'src/value.ts': 'export const prefix = "heard:";',
          'src/cli.ts':
            'import {prefix} from "./value.ts"; console.log(prefix + await Bun.stdin.text()); console.error("diagnostic");',
        }
        const direct = await run('command-direct', files, { stdin: 'hello' })
        expect(direct).toMatchObject({
          state: 'terminal',
          terminal: {
            status: 'succeeded',
            output: {
              candidateDigest: projectCommandCandidateDigest(files),
              invocation: ['bun', 'src/cli.ts'],
              stdout: { text: 'heard:hello\n', truncated: false },
              stderr: { text: 'diagnostic\n', truncated: false },
              exitCode: 0,
              signal: null,
              stopReason: 'exited',
              cleanup: 'complete',
            },
          },
        })
        const nested = await run('command-leaf', files, { stdin: 'child' }, true)
        expect(nested).toMatchObject({
          terminal: { status: 'succeeded', output: { stdout: { text: 'heard:child\n' } } },
        })
        const falsePass = await run('command-false-pass', {
          'src/cli.ts':
            'console.log(JSON.stringify({passed:true})); console.error("actual failure"); process.exit(17);',
        })
        expect(falsePass).toMatchObject({
          terminal: {
            status: 'succeeded',
            output: { stdout: { text: '{"passed":true}\n' }, exitCode: 17, cleanup: 'complete' },
          },
        })
        const isolation = await run('command-isolation', {
          'src/cli.ts': `
        import { existsSync, writeFileSync } from 'node:fs';
        let immutable=false; try { writeFileSync(import.meta.path, 'changed') } catch { immutable=true }
        console.log(JSON.stringify({immutable, key:process.env.OPENAI_API_KEY??null, path:process.env.PATH??null,
          packageVisible:existsSync('/package'), cgroupVisible:existsSync('/sys/fs/cgroup'), controlVisible:existsSync('/run/user')}));
      `,
        })
        expect(isolation).toMatchObject({
          terminal: {
            status: 'succeeded',
            output: {
              stdout: {
                text: '{"immutable":true,"key":null,"path":null,"packageVisible":false,"cgroupVisible":false,"controlVisible":false}\n',
              },
            },
          },
        })
        const args = await run(
          'command-args',
          { 'src/cli.ts': 'console.log(JSON.stringify(process.argv.slice(2)))' },
          { args: ['--preload=/work/missing.ts', '$(touch unwanted)', '--file', '--sync-fd'] },
        )
        expect(args).toMatchObject({
          terminal: {
            status: 'succeeded',
            output: {
              exitCode: 0,
              stdout: {
                text: '["--preload=/work/missing.ts","$(touch unwanted)","--file","--sync-fd"]\n',
              },
            },
          },
        })
        const ordinary = await run(
          'command-tests',
          {
            'package.json': '{"scripts":{"test":"echo unauthorized-script"}}',
            'bunfig.toml': 'preload = ["./preload.ts"]',
            'preload.ts': 'console.log("unauthorized-preload")',
            'test/project.test.ts':
              'import {test,expect} from "bun:test"; test("observed failure",()=>expect(1).toBe(2))',
          },
          { command: 'tests' },
        )
        expect(ordinary).toMatchObject({
          terminal: { status: 'succeeded', output: { exitCode: 1 } },
        })
        expect(JSON.stringify(ordinary)).toContain('observed failure')
        expect(JSON.stringify(ordinary)).not.toContain('unauthorized-')
        const invalid = await run('command-unknown', files, { command: 'shell' })
        expect(invalid).toMatchObject({ terminal: { status: 'failed', code: 'UNAVAILABLE' } })
        const flood = await run('command-flood', {
          'src/cli.ts':
            'process.stdout.write("x".repeat(131072)); process.stderr.write("e".repeat(131072));',
        })
        expect(flood).toMatchObject({
          terminal: {
            status: 'succeeded',
            output: {
              stdout: { truncated: true },
              stderr: { truncated: true },
              cleanup: 'complete',
            },
          },
        })
        await noOwners(root)
        // Deadline enforcement has its own budget; composition must not depend
        // on the product default or spend the full composition budget idle.
        await session.close()
        session = await openPrivateProjectSession({
          directory: root,
          host: { ...host, runTimeoutMs: 30_000 },
        })
        const deadline = await run('command-deadline', {
          'src/cli.ts': `Bun.spawn([process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', 'await Bun.sleep(60000)'], {stdin:'ignore', stdout:'ignore', stderr:'ignore'}); console.log('started'); await Bun.sleep(60000)`,
        })
        expect(deadline).toMatchObject({
          terminal: { status: 'failed', code: 'DEADLINE_EXCEEDED' },
        })
        await noOwners(root)
        await session.close()
        session = await openPrivateProjectSession({ directory: root, host })
        const stopped = await session.rootAdministration.startRun({
          submissionId: 'command-cancel',
          target: { kind: 'binding', id: 'pair' },
          input: { command: 'cli', files: { 'src/cli.ts': 'await Bun.sleep(60000)' } },
        })
        await waitForCommand(root, 2)
        await checkAggregateEnvelopes()
        await session.close()
        session = await openPrivateProjectSession({ directory: root, host })
        expect(await terminal(session.rootAdministration, stopped)).toMatchObject({
          terminal: { status: 'failed', code: 'CANCELLED' },
        })
        await noOwners(root)
      } catch (error) {
        primaryError = error
      }
      try {
        await session?.close()
      } catch (cleanupError) {
        throw new AggregateError([primaryError, cleanupError], 'command test and cleanup failed')
      }
      await rm(root, { recursive: true, force: true })
      if (primaryError !== undefined) throw primaryError
    },
    timeout,
  )

  test(
    'coordinator loss fences two leaf commands and recovers both branches without replay',
    async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-command-loss-')))
      const compositionHost = fixtureHost(
        await openPrivateInstalledBunHost(installedBunLocation, {}),
      )
      // Linux observes owners for up to 30 seconds. Leave time to deliberately
      // kill the coordinator before the Run deadline can settle the work.
      const host = {
        ...compositionHost,
        runTimeoutMs: Math.max(compositionHost.runTimeoutMs, 60_000),
      }
      const fenceFailures: string[] = []
      const originalRecoverFence = PrivateMacosBackend.prototype.recoverFence
      const fenceSpy =
        process.platform === 'darwin'
          ? spyOn(PrivateMacosBackend.prototype, 'recoverFence').mockImplementation(async function (
              this: PrivateMacosBackend,
              owner: unknown,
            ) {
              try {
                return await originalRecoverFence.call(this, owner)
              } catch (error) {
                if (fenceFailures.length < 8) fenceFailures.push(macosFenceFailureKind(error))
                throw error
              }
            })
          : undefined
      const reopen = () =>
        openPrivateProjectSession({
          directory: root,
          host,
          onAcquisitionFailure: (evidence) =>
            console.error(
              'command-loss-acquisition',
              JSON.stringify({ ...evidence, fenceFailures }),
            ),
        })
      let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
      let coordinator: ReturnType<typeof Bun.spawn> | undefined
      let recoveryRequired = false
      let primaryError: unknown
      try {
        await fixture(root)
        session = await openPrivateProjectSession({ directory: root, host })
        const plan = await session.plan({ lockMode: 'update' })
        if (plan.state !== 'applicable') throw new Error('loss fixture is not applicable')
        await session.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true })
        await session.close()
        const program = `
        import { openPrivateProjectSession } from ${JSON.stringify(join(import.meta.dir, '../src/internal/project-session-controller.ts'))};
        import { openPrivateInstalledBunHost } from ${JSON.stringify(join(import.meta.dir, '../src/internal/installed-bun-host.ts'))};
        import { fixtureHost } from ${JSON.stringify(join(import.meta.dir, './fixtures/agent-fixture-host.ts'))};
        import { writeFile } from 'node:fs/promises';
        const session = await openPrivateProjectSession({ directory: ${JSON.stringify(root)},
          host: { ...fixtureHost(await openPrivateInstalledBunHost(${JSON.stringify(installedBunLocation)}, {})),
            runTimeoutMs: ${host.runTimeoutMs} },
          onRootExecutionFailure: evidence =>
            console.error('command-loss-root-execution-failure', JSON.stringify(evidence)) });
        const receipt = await session.rootAdministration.startRun({ submissionId: 'lost-command',
          target: {kind:'binding',id:'pair'}, input:{command:'cli',files:{'src/cli.ts':'await Bun.sleep(60000)'}} });
        await writeFile(${JSON.stringify(join(root, 'receipt.json'))}, JSON.stringify(receipt));
        // Only the parent test may end this coordinator, including on failure.
        await new Promise(() => setInterval(() => {}, 60_000));
      `
        coordinator = Bun.spawn(
          [
            installedBunLocation.executablePath,
            '--no-env-file',
            '--no-install',
            '--config=/dev/null',
            '--eval',
            program,
          ],
          {
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'inherit',
          },
        )
        recoveryRequired = true
        await waitForCommand(root, 2)
        await checkAggregateEnvelopes()
        const receipt = JSON.parse(await readFile(join(root, 'receipt.json'), 'utf8'))
        expect(coordinator.exitCode).toBeNull()
        coordinator.kill('SIGKILL')
        await coordinator.exited
        expect(coordinator.signalCode).toBe('SIGKILL')
        session = await reopen()
        recoveryRequired = false
        expect(await terminal(session.rootAdministration, receipt)).toMatchObject({
          terminal: { status: 'lost', code: 'COORDINATOR_LOST' },
        })
        await noOwners(root)
      } catch (error) {
        primaryError = error
      }
      try {
        if (coordinator?.exitCode === null) coordinator.kill('SIGKILL')
        await coordinator?.exited
        if (recoveryRequired) session = await reopen()
        await session?.close()
        await rm(root, { recursive: true, force: true })
      } catch (cleanupError) {
        fenceSpy?.mockRestore()
        if (primaryError !== undefined)
          throw new AggregateError(
            [primaryError, cleanupError],
            'command recovery and cleanup failed',
          )
        throw cleanupError
      }
      fenceSpy?.mockRestore()
      if (primaryError !== undefined) throw primaryError
    },
    timeout,
  )
})

function macosFenceFailureKind(error: unknown): string {
  let cause = error
  let kind = 'unknown'
  const allowed = new Set([
    'macOS recovery guardian is still alive',
    'macOS recovery fencing is unconfirmed',
    'macOS guardian job removal is unconfirmed',
    'macOS guardian job is still present',
    'macOS storage recovery guardian job is still present',
    'macOS storage recovery is unconfirmed',
    'macOS coalition accounting is unavailable',
    'macOS coalition accounting is invalid',
    'macOS process enumeration is incomplete',
    'macOS owned process signaling failed',
    'macOS recovery boot does not match',
    'macOS guardian storage allocation changed',
    'macOS guardian identity changed',
    'native macOS sealed owner state changed',
    'native macOS recovery mechanism changed',
    'native macOS owner has no recoverable execution',
    'macOS recovery must run outside its former owner',
  ])
  const errno = new Set([
    'EACCES',
    'EBUSY',
    'ECONNREFUSED',
    'ECONNRESET',
    'EIO',
    'EMFILE',
    'ENOENT',
    'ENOSPC',
    'EPERM',
    'ETIMEDOUT',
  ])
  for (let depth = 0; depth < 12 && cause instanceof Error; depth++) {
    const code = (cause as NodeJS.ErrnoException).code
    kind = allowed.has(cause.message)
      ? cause.message
      : typeof code === 'string' && errno.has(code)
        ? `errno:${code}`
        : kind === 'unknown'
          ? cause.name
          : kind
    cause = cause.cause
  }
  return kind
}

async function fixture(root: string) {
  await mkdir(join(root, 'bindings'), { recursive: true })
  for (const name of ['command', 'parent', 'pair']) {
    const flow = join(root, 'flows', name)
    await mkdir(join(flow, 'contracts'), { recursive: true })
    await cp(join(import.meta.dir, '../../flow-sdk/dist'), join(flow, 'sdk'), { recursive: true })
    await writeFile(
      join(flow, 'FLOW.meta.json'),
      JSON.stringify({
        name,
        description: 'Collect bounded project-command evidence.',
        ...(name === 'command'
          ? {
              uses: Object.fromEntries(
                ['cli', 'tests'].map((slot) => [
                  slot,
                  { contract: './contracts/project-command/contract.json' },
                ]),
              ),
            }
          : {}),
      }),
    )
    await writeFile(
      join(flow, 'FLOW.ts'),
      name === 'command'
        ? 'import {handle} from "./sdk/index.js"; await handle(async run=>{const {command,...input}=run.input;return run.call({operationId:"command",slot:command,input})});'
        : name === 'pair'
          ? 'import {handle} from "./sdk/index.js"; await handle(async run=>({outcome:"done",output:await Promise.all(["a","b"].map(operationId=>run.call({operationId,slot:"worker",input:run.input})))}));'
          : 'import {handle} from "./sdk/index.js"; await handle(async run=>run.call({operationId:"worker",slot:"worker",input:run.input}));',
    )
    if (name === 'command')
      await cp(
        join(import.meta.dir, '../../../docs/jig/spec/contracts/project-command'),
        join(flow, 'contracts/project-command'),
        { recursive: true },
      )
  }
  await writeFile(
    join(root, 'jig.ts'),
    'import {defineJig,discover} from "@jigging/jig"; export default defineJig({flows:discover("flows"),bindings:discover("bindings")});',
  )
  await writeFile(
    join(root, 'bindings/command.ts'),
    'import {defineBinding} from "@jigging/jig"; export default defineBinding({package:"flows/command",slots:{cli:{kind:"command",run:"src/cli.ts"},tests:{kind:"command",test:["test/project.test.ts"]}}});',
  )
  await writeFile(
    join(root, 'bindings/parent.ts'),
    'import {defineBinding} from "@jigging/jig"; export default defineBinding({package:"flows/parent",slots:{worker:"binding:command"}});',
  )
  await writeFile(
    join(root, 'bindings/pair.ts'),
    'import {defineBinding} from "@jigging/jig"; export default defineBinding({package:"flows/pair",slots:{worker:"binding:command"}});',
  )
}

async function terminal(administration: RootAdministration, receipt: StartRootRunReceipt) {
  const until = Date.now() + (process.platform === 'darwin' ? MACOS_FIXTURE_SETTLEMENT_MS : 35_000)
  while (Date.now() < until) {
    const status = await administration.runStatus(receipt)
    if (status.state === 'terminal') return status
    await Bun.sleep(20)
  }
  throw new Error('command fixture did not settle')
}

function ownerRows(root: string): number {
  const database = Database.open(
    join(root, '.jig/jig.sqlite3'),
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
  )
  try {
    database.exec('PRAGMA busy_timeout = 2000')
    return (
      database
        .query(
          "SELECT count(*) AS count FROM root_child_owners WHERE sandbox_digest IS NOT NULL AND CAST(allocation_bytes AS TEXT) LIKE '%private-contained-effect-owner/1%'",
        )
        .get() as { count: number }
    ).count
  } finally {
    database.close()
  }
}
async function waitForCommand(root: string, count = 1) {
  // Allow the explicit composition budget to observe both nested owners; this tests
  // loss and recovery, not startup performance.
  const until = Date.now() + (process.platform === 'darwin' ? MACOS_FIXTURE_ADMISSION_MS : 30_000)
  while (Date.now() < until) {
    if (ownerRows(root) >= count) return
    await Bun.sleep(20)
  }
  const database = Database.open(
    join(root, '.jig/jig.sqlite3'),
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
  )
  try {
    const state = database
      .query(
        'SELECT operation_id, sandbox_digest IS NOT NULL AS sealed, fence_digest IS NOT NULL AS fenced FROM root_child_owners',
      )
      .all()
    const terminal = database
      .query(
        'SELECT CAST(terminal_bytes AS TEXT) AS terminal FROM root_terminals ORDER BY rowid DESC LIMIT 1',
      )
      .get()
    throw new Error(`command owner did not start: ${JSON.stringify({ state, terminal })}`)
  } finally {
    database.close()
  }
}
async function checkAggregateEnvelopes() {
  if (process.platform === 'darwin') return
  const delegated = process.env.AGENT_DELEGATED_CGROUP
  if (!delegated?.startsWith('/sys/fs/cgroup/')) throw new Error('missing proof delegation')
  const until = Date.now() + 5_000
  while (Date.now() < until) {
    const groups = (await readdir(delegated)).filter((n) => n.startsWith('jig-run-'))
    if (groups.length === 5) {
      const limits = await Promise.all(
        groups.map(async (name) => ({
          memory: Number(await readFile(join(delegated, name, 'memory.max'), 'utf8')),
          pids: Number(await readFile(join(delegated, name, 'pids.max'), 'utf8')),
          cpu: (await readFile(join(delegated, name, 'cpu.max'), 'utf8'))
            .trim()
            .split(' ')
            .map(Number),
        })),
      )
      if (limits.every((l) => Number.isFinite(l.memory + l.pids + l.cpu[0]!))) {
        expect(limits.reduce((n, l) => n + l.memory, 0)).toBeLessThanOrEqual(
          PRIVATE_ROOT_RESOURCE_POLICY.memoryBytes,
        )
        expect(limits.reduce((n, l) => n + l.pids, 0)).toBeLessThanOrEqual(
          PRIVATE_ROOT_RESOURCE_POLICY.pids,
        )
        expect(limits.reduce((n, l) => n + l.cpu[0]! / l.cpu[1]!, 0)).toBeLessThanOrEqual(
          PRIVATE_ROOT_RESOURCE_POLICY.cpuQuotaMicros /
            PRIVATE_ROOT_RESOURCE_POLICY.cpuPeriodMicros,
        )
        return
      }
    }
    await Bun.sleep(20)
  }
  throw new Error('five independently configured envelopes did not overlap')
}
async function noOwners(root: string) {
  expect(ownerRows(root)).toBe(0)
  expect(
    (await readdir(join(root, '.jig/private-root-owners'))).filter((path) => /^(x-|c-)/.test(path)),
  ).toEqual([])
}
