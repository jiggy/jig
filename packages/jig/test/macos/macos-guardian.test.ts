const suiteTestUrl = new URL('../' + import.meta.url.split('/').at(-1), import.meta.url).href

import { expect, spyOn, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { readPrivateCapturedOutput } from '../../src/internal/captured-output.js'
import { closePrivateExecutionOutput } from '../../src/internal/execution-output.js'
import { PrivateExecutionPreparationDeadlineError } from '../../src/internal/execution-process.js'
import {
  preparePrivateMacosGuardian,
  recoverPrivateMacosGuardian,
} from '../../src/internal/macos-guardian-client.js'
import {
  type PrivateMacosGuardianRecoveryDiagnostic,
  withPrivateMacosGuardianDiagnostics,
} from '../../src/internal/macos-guardian-diagnostics.js'
import { retainPrivateMacosGuardianOutput } from '../../src/internal/macos-guardian-output.js'
import type { PrivateMacosGuardianStart } from '../../src/internal/macos-native-supervisor.js'
import { accountingFaults, accountingSupervisor } from '.././macos-guardian.fixture.js'

test('transient CPU snapshots preserve exit while sustained and final uncertainty refuse success', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/jig-accounting-guardian-'))
  let cleaned = true
  try {
    for (const fault of accountingFaults) {
      const ownerDirectory = join(root, `${fault}-owner`)
      const scratch = join(root, `${fault}-data`)
      await mkdir(ownerDirectory, { mode: 0o700 })
      await mkdir(scratch)
      const token = randomBytes(32).toString('hex')
      const supervisor = await accountingSupervisor(root, fault)
      const owner = await preparePrivateMacosGuardian({
        bun: process.execPath,
        supervisor,
        configuration: {
          type: 'start',
          ownerDirectory,
          ownerToken: token,
          launcher: fileURLToPath(new URL('../support/macos-exec-universal', suiteTestUrl)),
          cwd: scratch,
          command: [
            process.execPath,
            '--no-env-file',
            '--no-install',
            '--config=/dev/null',
            '-e',
            `await Bun.stdin.text(); await Bun.sleep(${fault === 'sustained' ? 2000 : 150}); process.exit(17)`,
          ],
          environment: {},
          files: {
            readOnlyFiles: [process.execPath],
            readOnlyTrees: [],
            writableTrees: [scratch],
            protectedRoots: [ownerDirectory],
            network: 'isolated',
          },
          limits: {
            memoryBytes: 256 * 1024 * 1024,
            pids: 4,
            cpuQuotaMicros: 50_000,
            cpuPeriodMicros: 100_000,
            deadlineUnixMs: Date.now() + 30_000,
            cleanupTimeoutMs: 5000,
          },
          maxOutputBytes: 4096,
        },
      })
      owner.stdout.resume()
      owner.stderr.resume()
      cleaned = false
      try {
        await owner.admit()
        owner.continue()
        owner.stdin.end()
        if (fault.startsWith('final')) {
          expect(await owner.completion).toEqual({
            result: null,
            outputLost: true,
            recovered: true,
            fenced: true,
          })
        } else {
          const result = await owner.completion
          expect(result.fenced).toBe(true)
          expect(result.result?.reason).toBe(
            fault === 'sustained' ? 'accounting_failed' : 'payload_exit',
          )
          expect(result.result?.evidence.incompleteSamples).toBeGreaterThan(0)
          expect(BigInt(result.result?.evidence.cpuNanoseconds ?? '0')).toBeGreaterThan(0n)
          if (fault !== 'sustained') expect(result.result?.exitCode).toBe(17)
        }
      } finally {
        owner.cancel()
        await owner.completion.catch(() => undefined)
        await recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
        cleaned = true
      }
    }
  } finally {
    if (cleaned) await rm(root, { recursive: true })
    else console.error(`Unconfirmed accounting fixture retained at ${root}`)
  }
}, 60_000)
test('guardian admits native execution through authenticated separate control and payload streams', async () => {
  const build = await realpath(await mkdtemp('/private/tmp/jig-guardian-build-'))
  const launcher = join(build, 'macos-exec'),
    payload = join(build, 'payload')
  try {
    for (const [source, output] of [
      [new URL('../support/macos-exec.c', suiteTestUrl), launcher],
      [new URL('./fixtures/macos-scope-payload.c', suiteTestUrl), payload],
    ] as const) {
      const result = spawnSync(
        '/usr/bin/clang',
        [
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-Wno-deprecated-declarations',
          fileURLToPath(source),
          '-o',
          output,
        ],
        { encoding: 'utf8', timeout: 15_000 },
      )
      expect({ status: result.status, errors: result.stderr }).toEqual({ status: 0, errors: '' })
    }
    for (const mode of [
      'complete',
      'cancel-prepared',
      'cancel-ready',
      'cancel-running',
      'blocked-output',
      'output-limit',
      'guardian-loss',
      'coordinator-loss',
    ]) {
      const ownerDirectory = await realpath(await mkdtemp('/private/tmp/jig-guardian-state-'))
      const scratch = await realpath(await mkdtemp('/private/tmp/jig-guardian-data-'))
      let settled = false
      let owner: Awaited<ReturnType<typeof preparePrivateMacosGuardian>> | undefined
      try {
        const marker = join(scratch, 'started')
        const input: {
          bun: string
          supervisor: string
          configuration: PrivateMacosGuardianStart
        } = {
          bun: process.execPath,
          supervisor: fileURLToPath(
            new URL('../src/internal/macos-native-supervisor.ts', suiteTestUrl),
          ),
          configuration: {
            type: 'start',
            ownerDirectory,
            ownerToken: randomBytes(32).toString('hex'),
            launcher,
            cwd: scratch,
            command: [
              payload,
              mode === 'complete' ? 'echo' : mode.includes('output') ? 'flood' : 'waiting',
              marker,
            ],
            environment: {},
            files: {
              readOnlyFiles: [payload],
              readOnlyTrees: [],
              writableTrees: [scratch],
              protectedRoots: [ownerDirectory],
              network: 'isolated',
            },
            limits: {
              memoryBytes: 32 * 1024 * 1024,
              pids: 4,
              cpuQuotaMicros: 50_000,
              cpuPeriodMicros: 100_000,
              deadlineUnixMs: Date.now() + 30_000,
              cleanupTimeoutMs: 5000,
            },
            maxOutputBytes: mode === 'output-limit' ? 4096 : 8 * 1024 * 1024,
          },
        }
        if (mode === 'coordinator-loss') {
          const path = join(ownerDirectory, 'fixture.json')
          await writeFile(path, JSON.stringify(input), { mode: 0o600, flag: 'wx' })
          const child = spawnSync(
            process.execPath,
            [
              '--no-env-file',
              '--no-install',
              '--config=/dev/null',
              fileURLToPath(new URL('./fixtures/macos-lost-coordinator.ts', suiteTestUrl)),
              path,
            ],
            { env: {}, encoding: 'utf8', timeout: 15_000 },
          )
          expect({ status: child.status, out: child.stdout, err: child.stderr }).toEqual({
            status: 0,
            out: 'coordinator-exiting\n',
            err: '',
          })
          await recoverPrivateMacosGuardian(ownerDirectory, input.configuration.ownerToken, 5000)
          await recoverPrivateMacosGuardian(ownerDirectory, input.configuration.ownerToken, 5000)
          settled = true
          continue
        }
        const recoveryEvents: PrivateMacosGuardianRecoveryDiagnostic[] = []
        owner = await withPrivateMacosGuardianDiagnostics(
          (event) => {
            recoveryEvents.push(event)
            // A failed diagnostic sink must not prevent actual native recovery.
            throw new Error('diagnostic sink failed')
          },
          () => preparePrivateMacosGuardian(input),
        )
        let output = '',
          errors = ''
        if (mode !== 'blocked-output')
          owner.stdout.on('data', (bytes) => {
            output += bytes.toString()
          })
        owner.stderr.on('data', (bytes) => {
          errors += bytes.toString()
        })
        if (mode !== 'blocked-output') owner.stdout.resume()
        owner.stderr.resume()
        expect(
          await access(marker).then(
            () => true,
            () => false,
          ),
        ).toBe(false)
        if (mode === 'cancel-prepared') owner.cancel()
        else {
          const ready = await owner.admit()
          expect(ready.pid).toBeGreaterThan(1)
          expect(
            await access(marker).then(
              () => true,
              () => false,
            ),
          ).toBe(false)
          if (mode === 'cancel-ready') owner.cancel()
          else {
            owner.continue()
            if (mode === 'complete') owner.stdin.end('native-roundtrip\n')
            if (['cancel-running', 'blocked-output', 'guardian-loss'].includes(mode)) {
              const end = performance.now() + 5000
              while (
                !(await access(marker).then(
                  () => true,
                  () => false,
                )) &&
                performance.now() < end
              )
                await Bun.sleep(10)
              await access(marker)
              if (mode === 'guardian-loss') {
                const ffi = createRequire(suiteTestUrl)('bun:ffi')
                const native = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
                  proc_signal_with_audittoken: { args: ['ptr', 'i32'], returns: 'i32' },
                })
                const token = Buffer.alloc(32)
                token.writeUInt32LE(owner.identity.guardianPid, 20)
                token.writeUInt32LE(owner.identity.guardianVersion, 28)
                expect(native.symbols.proc_signal_with_audittoken(ffi.ptr(token), 9)).toBe(0)
                native.close()
              } else {
                if (mode === 'blocked-output') await Bun.sleep(100)
                owner.cancel()
              }
            }
          }
        }
        const result = await owner.completion
        settled = result.fenced
        expect(result.recovered).toBe(mode === 'guardian-loss')
        if (mode === 'guardian-loss') {
          expect(recoveryEvents).toHaveLength(1)
          expect(recoveryEvents[0]).toMatchObject({ phase: 'running', step: 'receive' })
          expect(['CONTROL_EOF', 'CONTROL_SOCKET']).toContain(recoveryEvents[0]!.cause)
        } else expect(recoveryEvents).toEqual([])
        if (mode === 'complete') {
          expect(result.result?.exitCode).toBe(0)
          expect(result.result?.reason).toBe('payload_exit')
          expect(result.outputLost).toBe(false)
          expect(output).toBe('native-roundtrip\n')
          expect(errors).toBe('native-stderr\n')
        } else if (mode === 'cancel-prepared' || mode === 'guardian-loss')
          expect(result.result).toBeNull()
        else expect(result.result?.reason).toBe('cancelled')
        if (['blocked-output', 'output-limit', 'guardian-loss'].includes(mode))
          expect(result.outputLost).toBe(true)
        if (mode === 'output-limit') expect(Buffer.byteLength(output)).toBeLessThanOrEqual(4096)
        owner.stdout.destroy()
        owner.stderr.destroy()
      } finally {
        if (!settled && owner !== undefined) {
          owner.cancel()
          settled = (await owner.completion).fenced
        }
        if (settled) {
          await rm(ownerDirectory, { recursive: true })
          await rm(scratch, { recursive: true })
        } else console.error(`Mac guardian evidence retained at ${ownerDirectory} and ${scratch}`)
      }
    }
  } finally {
    await rm(build, { recursive: true })
  }
}, 90_000)
test('admitted preparation uses the Run deadline rather than the admission wait', async () => {
  const root = await realpath(await mkdtemp('/private/tmp/jig-guardian-deadline-'))
  const launcher = join(root, 'macos-exec')
  const payload = join(root, 'payload')
  const supervisor = join(root, 'slow-supervisor.ts')
  const sourceUrl = new URL('../src/internal/macos-native-supervisor.ts', suiteTestUrl)
  const source = await readFile(sourceUrl, 'utf8')
  const admission = '    await admission\n'
  expect(source.split(admission)).toHaveLength(2)
  // Delay trusted preparation, not the workload; keep cancellation observable.
  await writeFile(
    supervisor,
    source.replaceAll("from './", `from '${fileURLToPath(new URL('.', sourceUrl))}`).replace(
      admission,
      `${admission}
    await new Promise<void>((resolve, reject) => {
      const delay = setTimeout(resolve, 11_000)
      cancellation.signal.addEventListener('abort', () => {
        clearTimeout(delay)
        reject(new Error('delayed preparation cancelled'))
      }, {once: true})
    })
`,
    ),
  )
  try {
    for (const [source, output] of [
      [new URL('../support/macos-exec.c', suiteTestUrl), launcher],
      [new URL('./fixtures/macos-scope-payload.c', suiteTestUrl), payload],
    ] as const) {
      const compiled = spawnSync(
        '/usr/bin/clang',
        [
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-Wno-deprecated-declarations',
          fileURLToPath(source),
          '-o',
          output,
        ],
        { encoding: 'utf8', timeout: 15000 },
      )
      expect({ status: compiled.status, stderr: compiled.stderr }).toEqual({
        status: 0,
        stderr: '',
      })
    }
    for (const expires of [false, true]) {
      const ownerDirectory = await realpath(await mkdtemp('/private/tmp/jig-guardian-owner-'))
      const scratch = await realpath(await mkdtemp('/private/tmp/jig-guardian-scratch-'))
      const owner = await preparePrivateMacosGuardian({
        bun: process.execPath,
        supervisor,
        configuration: {
          type: 'start',
          ownerDirectory,
          ownerToken: randomBytes(32).toString('hex'),
          launcher,
          cwd: scratch,
          command: [payload, 'echo', join(scratch, 'started')],
          environment: {},
          files: {
            readOnlyFiles: [payload],
            readOnlyTrees: [],
            writableTrees: [scratch],
            protectedRoots: [ownerDirectory],
            network: 'isolated',
          },
          limits: {
            memoryBytes: 32 * 1024 * 1024,
            pids: 4,
            cpuQuotaMicros: 50000,
            cpuPeriodMicros: 100000,
            deadlineUnixMs: Date.now() + (expires ? 3000 : 30000),
            cleanupTimeoutMs: 5000,
          },
          maxOutputBytes: 4096,
        },
      })
      owner.stdout.resume()
      owner.stderr.resume()
      let fenced = false
      try {
        if (expires) {
          const started = performance.now()
          const failure = await owner.admit().catch((error: unknown) => error)
          expect(failure).toBeInstanceOf(PrivateExecutionPreparationDeadlineError)
          expect(failure).toMatchObject({
            code: 'EXECUTION_PREPARATION_DEADLINE',
            cause: { code: 'MACOS_GUARDIAN_ADMISSION_OPERATION_DEADLINE' },
          })
          expect(performance.now() - started).toBeLessThan(8000)
        } else {
          await owner.admit()
          owner.continue()
          owner.stdin.end('delayed-roundtrip\n')
        }
        const terminal = await owner.completion
        fenced = terminal.fenced
        expect(terminal.recovered).toBe(false)
        if (expires) expect(terminal.result).toBeNull()
        else
          expect(terminal.result).toMatchObject({
            reason: 'payload_exit',
            exitCode: 0,
            fenced: true,
          })
      } finally {
        owner.cancel()
        fenced = (await owner.completion).fenced
        if (fenced) {
          await rm(ownerDirectory, { recursive: true })
          await rm(scratch, { recursive: true })
        }
      }
    }
  } finally {
    await rm(root, { recursive: true })
  }
}, 60000)
test('guardian preserves native exit evidence when the payload leaves buffered stdin unread', async () => {
  const ownerDirectory = await realpath(await mkdtemp('/private/tmp/jig-guardian-stdin-owner-'))
  const scratch = await realpath(await mkdtemp('/private/tmp/jig-guardian-stdin-data-'))
  let owner: Awaited<ReturnType<typeof preparePrivateMacosGuardian>> | undefined
  let fenced = false
  try {
    owner = await preparePrivateMacosGuardian({
      bun: process.execPath,
      supervisor: fileURLToPath(
        new URL('../src/internal/macos-native-supervisor.ts', suiteTestUrl),
      ),
      configuration: {
        type: 'start',
        ownerDirectory,
        ownerToken: randomBytes(32).toString('hex'),
        launcher: fileURLToPath(new URL('../support/macos-exec-universal', suiteTestUrl)),
        cwd: scratch,
        command: [
          process.execPath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          '-e',
          'console.log("real result"); console.error("real diagnostic"); process.exit(17)',
        ],
        environment: {},
        files: {
          readOnlyFiles: [process.execPath],
          readOnlyTrees: [],
          writableTrees: [scratch],
          protectedRoots: [ownerDirectory],
          network: 'isolated',
        },
        limits: {
          memoryBytes: 256 * 1024 * 1024,
          pids: 4,
          cpuQuotaMicros: 50_000,
          cpuPeriodMicros: 100_000,
          deadlineUnixMs: Date.now() + 30_000,
          cleanupTimeoutMs: 5000,
        },
        maxOutputBytes: 4096,
      },
    })
    const stdout = new Response(Readable.toWeb(owner.stdout) as ReadableStream).text()
    const stderr = new Response(Readable.toWeb(owner.stderr) as ReadableStream).text()
    await owner.admit()
    owner.continue()
    // Exceed the pipe capacity so the writer is still pending when the
    // payload exits. This is private transport input, not a command grant limit.
    owner.stdin.end(Buffer.alloc(1024 * 1024, 120))
    const result = await owner.completion
    fenced = result.fenced
    expect(result).toMatchObject({
      result: { reason: 'payload_exit', exitCode: 17, signal: null, fenced: true },
      outputLost: false,
      recovered: false,
    })
    expect(await stdout).toBe('real result\n')
    expect(await stderr).toBe('real diagnostic\n')
  } finally {
    if (!fenced && owner !== undefined) {
      owner.cancel()
      fenced = (await owner.completion).fenced
    }
    if (fenced) {
      await rm(ownerDirectory, { recursive: true })
      await rm(scratch, { recursive: true })
    }
  }
}, 40_000)
test('terminal cleanup recovery preserves authenticated exit and captured output only after confirmed removal', async () => {
  for (const [persistent, collect] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    const ownerDirectory = await realpath(await mkdtemp('/private/tmp/jig-guardian-terminal-'))
    const scratch = await realpath(await mkdtemp('/private/tmp/jig-guardian-terminal-data-'))
    const token = randomBytes(32).toString('hex')
    const events: PrivateMacosGuardianRecoveryDiagnostic[] = []
    let owner: Awaited<ReturnType<typeof preparePrivateMacosGuardian>> | undefined
    let outputOwner: ReturnType<typeof retainPrivateMacosGuardianOutput> | undefined
    let removed = false
    let injected = 0
    let bootedOut: string | undefined
    const original = childProcess.spawnSync
    const interception = spyOn(childProcess, 'spawnSync').mockImplementation(((
      ...args: unknown[]
    ) => {
      const result = Reflect.apply(original, childProcess, args)
      const commandArgs = args[1] as readonly string[] | undefined
      if (
        owner !== undefined &&
        bootedOut === undefined &&
        args[0] === '/bin/launchctl' &&
        commandArgs?.[0] === 'bootout'
      )
        bootedOut = commandArgs[1]
      if (
        args[0] === '/bin/launchctl' &&
        commandArgs?.[0] === 'print' &&
        owner !== undefined &&
        commandArgs[1] === bootedOut &&
        (persistent || injected === 0)
      ) {
        injected++
        return { ...result, status: 0 }
      }
      return result
    }) as typeof childProcess.spawnSync)
    try {
      owner = await withPrivateMacosGuardianDiagnostics(
        (event) => events.push(event),
        () =>
          preparePrivateMacosGuardian({
            bun: process.execPath,
            supervisor: fileURLToPath(
              new URL('../src/internal/macos-native-supervisor.ts', suiteTestUrl),
            ),
            configuration: {
              type: 'start',
              ownerDirectory,
              ownerToken: token,
              launcher: fileURLToPath(new URL('../support/macos-exec-universal', suiteTestUrl)),
              cwd: collect ? join(scratch, 'work') : scratch,
              command: [
                process.execPath,
                '--no-env-file',
                '--no-install',
                '--config=/dev/null',
                '-e',
                collect
                  ? `await Bun.stdin.text(); await Bun.write(${JSON.stringify(join(scratch, 'output/result.txt'))}, 'retained output');`
                  : 'await Bun.stdin.text(); process.exit(17)',
              ],
              environment: {},
              files: {
                readOnlyFiles: [process.execPath],
                readOnlyTrees: [],
                writableTrees: collect
                  ? ['work', 'tmp', 'output'].map((name) => join(scratch, name))
                  : [scratch],
                protectedRoots: [ownerDirectory],
                network: 'isolated',
              },
              limits: {
                memoryBytes: 256 * 1024 * 1024,
                pids: 4,
                cpuQuotaMicros: 50_000,
                cpuPeriodMicros: 100_000,
                deadlineUnixMs: Date.now() + 30_000,
                cleanupTimeoutMs: 5000,
              },
              maxOutputBytes: 4096,
              ...(collect
                ? {
                    storage: {
                      mountPath: scratch,
                      bytes: 16 * 1024 * 1024,
                      collect: 'output' as const,
                    },
                  }
                : {}),
            },
          }),
      )
      owner.stdout.resume()
      owner.stderr.resume()
      if (collect) outputOwner = retainPrivateMacosGuardianOutput(owner)
      await owner.admit()
      owner.continue()
      owner.stdin.end()
      if (persistent) {
        await expect(owner.completion).rejects.toThrow('macOS guardian job removal is unconfirmed')
        if (outputOwner) await expect(outputOwner.output.ready).rejects.toThrow('cleanup failed')
        expect((await readFile(join(ownerDirectory, 'owner.json'))).length).toBeGreaterThan(0)
      } else {
        const result = await owner.completion
        removed = result.fenced
        expect(result).toMatchObject({
          result: {
            reason: 'payload_exit',
            exitCode: collect ? 0 : 17,
            signal: null,
            fenced: true,
          },
          outputLost: true,
          recovered: true,
          fenced: true,
        })
        if (outputOwner) {
          const captured = await outputOwner.output.ready
          expect(
            readPrivateCapturedOutput(captured).map((file) => [
              file.path,
              file.contents.toString(),
            ]),
          ).toEqual([['result.txt', 'retained output']])
        }
      }
      expect(injected).toBeGreaterThan(0)
      expect(events).toEqual([
        { phase: 'terminal', step: 'terminal-cleanup', cause: 'JOB_REMOVAL_UNCONFIRMED' },
      ])
    } finally {
      interception.mockRestore()
      await closePrivateExecutionOutput(outputOwner?.output)
      if (!removed) {
        owner?.cancel()
        await owner?.completion.catch(() => undefined)
        await recoverPrivateMacosGuardian(ownerDirectory, token, 5000)
        removed = true
      }
      if (removed) {
        await rm(ownerDirectory, { recursive: true })
        if (collect) await expect(access(scratch)).rejects.toMatchObject({ code: 'ENOENT' })
        else await rm(scratch, { recursive: true })
      }
    }
  }
}, 90_000)

if (process.platform !== 'darwin') throw Error('This suite requires a native Mac')
