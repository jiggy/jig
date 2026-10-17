import { type ChildProcess, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeSync,
} from 'node:fs'
import {
  type FileHandle,
  link,
  mkdir,
  open,
  readFile,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { connect, type Socket } from 'node:net'
import { posix } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import {
  privateCopyLinuxEvaluationWorkspace,
  privateLinuxEvaluationWorkspaceArguments,
} from './linux-evaluation-workspace.js'
import {
  normalizePrivateBootDeadline,
  type PrivateBootDeadline,
  privateBootRemaining,
  watchPrivateBootDeadline,
} from './native-clock.js'
import {
  normalizePrivateProjectEvaluationWorkspace,
  PRIVATE_EVALUATION_WORKSPACE_PATH,
  type PrivateProjectEvaluationWorkspace,
  privateEvaluationWritableRoots,
} from './project-evaluation-workspace.js'
import { normalizePrivateInputEmptyDirectories } from './read-input-projection.js'

const POLICY = Object.freeze(['--no-env-file', '--no-install', '--config=/dev/null'] as const)
const SANDBOX_BUN = '/jig-runtime/bun'
const SANDBOX_LIBRARY_PATH = '/jig-runtime/lib'
const MAX_CONTROL_BYTES = 64 * 1024
const CORE_DUMP_POLL_MS = 250
// The source checkout executes this file as TypeScript while packed builds
// execute emitted JavaScript. JavaScript is valid TypeScript, so one `.ts`
// destination is safe for both and never causes Bun to parse source TS as JS.
const MODULE_DESTINATION = '/jig/linux-rootless-supervisor.ts'
const DIGEST = /^sha256:[0-9a-f]{64}$/
const OWNER_TOKEN = /^[0-9a-f]{64}$/
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

interface Limits {
  readonly memoryBytes: number
  readonly pids: number
  readonly cpuQuotaMicros: number
  readonly cpuPeriodMicros: number
  readonly deadlineUnixMs: number
  readonly bootDeadline: PrivateBootDeadline
  readonly cancellationGraceMs: number
  readonly cleanupTimeoutMs: number
}

interface Mount {
  readonly source: string
  readonly destination: string
}

interface Configuration {
  readonly delegatedCgroup: string
  readonly runCgroup: string
  readonly ownerStateDirectory: string
  readonly ownerStateAllocationDigest: string
  readonly ownerToken: string
  readonly ownerDigest: string
  readonly mechanismDigest: string
  readonly sealedPlanDigest: string
  readonly limits: Limits
  readonly readOnlyMounts: readonly Mount[]
  readonly command: readonly [string, ...string[]]
  readonly environment: Readonly<Record<string, string>>
  readonly network: 'isolated' | 'inherited'
  readonly nestedUserNamespaces: boolean
  readonly output: boolean
  readonly capturedInputs: readonly {
    readonly fd: number
    readonly destination: string
    readonly bytes: number
    readonly digest: string
  }[]
  readonly inputDirectories: readonly string[]
  readonly inputEmptyDirectories: readonly string[]
  readonly inputAliases: readonly { readonly name: string; readonly target: string }[]
  readonly evaluationWorkspace: {
    readonly phase: 'generate' | 'compile' | 'test'
    readonly emptyDirectories: readonly string[]
  } | null
  readonly evaluationEntries: readonly string[]
  readonly bunPath: string
  readonly bunHostLibraryPath: string
  readonly bubblewrapPath: string
  readonly payloadUid: number
  readonly payloadGid: number
  readonly supervisorPath: string
}

interface Evidence {
  readonly cpuStat: Readonly<Record<string, number>>
  readonly memoryEvents: Readonly<Record<string, number>>
  readonly pidsEvents: Readonly<Record<string, number>>
}

type StopReason =
  | 'cancelled'
  | 'coordinator_lost'
  | 'deadline'
  | 'clock'
  | 'payload_exit'
  | 'core_dump'
  | 'setup_failed'

interface PreparedMessage {
  readonly type: 'prepared'
  readonly runCgroup: string
  readonly supervisorPid: number
}

interface ReadyMessage {
  readonly type: 'ready'
  readonly runCgroup: string
  readonly payloadPid: number
  readonly supervisorPid: number
  readonly outputFd?: number
  readonly outputBackingFd?: number
}

interface TerminalMessage {
  readonly type: 'terminal'
  readonly ownerDigest: string
  readonly runCgroup: string
  readonly supervisorPid: number
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stopReason: StopReason
  readonly fenced: boolean
  readonly cleanupError?: string
  readonly evidence: Evidence
}

async function supervisorMain(controlPath: string, startupTimeoutText: string): Promise<void> {
  requireFixedBunPosture('supervisor')
  if (!absolute(controlPath)) throw new Error('invalid rootless supervisor control path')
  const startupTimeoutMs = Number(startupTimeoutText)
  if (
    !/^[1-9][0-9]*$/.test(startupTimeoutText) ||
    !positiveInteger(startupTimeoutMs) ||
    startupTimeoutMs > 2_147_483_647
  ) {
    throw new Error('invalid rootless supervisor startup timeout')
  }
  const startupDeadlineUnixMs = Date.now() + startupTimeoutMs
  const control = connect(controlPath)
  control.on('error', () => {
    // Socket loss is an ownership event. Cleanup below remains independent.
  })
  try {
    await beforeStartupDeadline(connected(control), startupDeadlineUnixMs, control)
    await superviseConnected(control, startupDeadlineUnixMs)
  } finally {
    control.destroy()
  }
}

async function superviseConnected(control: Socket, startupDeadlineUnixMs: number): Promise<void> {
  const iterator = readJsonLines(control)[Symbol.asyncIterator]()
  const first = await beforeStartupDeadline(iterator.next(), startupDeadlineUnixMs, control)
  if (first.done) return
  const configuration = requireStart(first.value)
  const { limits, runCgroup } = configuration
  const claim = await claimActive(configuration)
  if (claim === 'cancelled') return

  let cgroupCreated = false
  let child: ChildProcess | undefined
  let childExit: ReturnType<typeof childClose> | undefined
  let stopReason: StopReason | undefined
  let admitted = false
  let continued = false
  let readyToContinue = false
  let outputDirectory: FileHandle | undefined
  let outputBacking: FileHandle | undefined
  let resolveAdmission!: () => void
  let rejectAdmission!: (error: Error) => void
  const admission = new Promise<void>((resolve, reject) => {
    resolveAdmission = resolve
    rejectAdmission = reject
  })
  // Stop can reject during asynchronous setup, before the await below. Observe
  // it immediately so an unhandled rejection cannot kill the cleanup owner.
  // Awaiting the original promise still rejects and never permits a launch.
  void admission.catch(() => undefined)
  const killRun = async (): Promise<void> => {
    if (!cgroupCreated) return
    await writeFile(`${runCgroup}/cgroup.kill`, '1\n').catch(ignoreMissing)
  }
  const stop = (reason: StopReason): void => {
    if (stopReason === undefined || stopReason === 'payload_exit') stopReason = reason
    if (!admitted) rejectAdmission(new Error(`rootless launch stopped before admission: ${reason}`))
    child?.kill('SIGKILL')
    void killRun().catch(() => {
      // The authoritative cleanup attempt in `finally` records any failure.
    })
  }
  const controlTask = (async (): Promise<void> => {
    for (;;) {
      const next = await iterator.next()
      if (next.done) return stop('coordinator_lost')
      const type = recordType(next.value)
      if (type === 'admit' && !admitted) {
        admitted = true
        resolveAdmission()
      } else if (type === 'continue' && readyToContinue && stopReason === undefined && !continued) {
        continued = true
        const gate = child?.stdio[4] as Writable | undefined
        if (gate === undefined) return stop('setup_failed')
        gate.end(Buffer.from([1]))
      } else if (type === 'cancel') {
        stop('cancelled')
      } else {
        stop('cancelled')
      }
    }
  })()
  void controlTask.catch(() => stop('coordinator_lost'))
  const clearDeadline = watchPrivateBootDeadline(
    limits.bootDeadline,
    (reason) => stop(reason),
    limits.cancellationGraceMs,
  )

  let exitCode: number | null = null
  let exitSignal: string | null = null
  let evidence = emptyEvidence()
  let terminal: TerminalMessage | undefined
  let coreDumpTimer: ReturnType<typeof setInterval> | undefined
  let coreDumpCheck: Promise<void> | undefined
  let monitoringClosed = false
  try {
    await mkdir(runCgroup, { mode: 0o755 })
    cgroupCreated = true
    await writeFile(`${runCgroup}/memory.max`, `${limits.memoryBytes}\n`)
    if (await exists(`${runCgroup}/memory.swap.max`))
      await writeFile(`${runCgroup}/memory.swap.max`, '0\n')
    await writeFile(`${runCgroup}/pids.max`, `${limits.pids}\n`)
    await writeFile(`${runCgroup}/cpu.max`, `${limits.cpuQuotaMicros} ${limits.cpuPeriodMicros}\n`)
    if (stopReason !== undefined)
      throw new Error(`rootless launch stopped during setup: ${stopReason}`)
    safeSend(control, {
      type: 'prepared',
      runCgroup,
      supervisorPid: process.pid,
    } satisfies PreparedMessage)
    await admission
    if (stopReason !== undefined)
      throw new Error(`rootless launch stopped before spawn: ${stopReason}`)

    restrictInheritedDescriptors(
      configuration.bunHostLibraryPath,
      configuration.capturedInputs.map((file) => file.fd),
    )
    const launched = spawn(
      configuration.bunPath,
      [
        ...POLICY,
        configuration.supervisorPath,
        '--enter',
        runCgroup,
        configuration.ownerStateDirectory,
        configuration.ownerToken,
        configuration.ownerStateAllocationDigest,
        configuration.bubblewrapPath,
        ...bubblewrapArguments(configuration),
      ],
      {
        cwd: '/',
        env: {
          LD_LIBRARY_PATH: configuration.bunHostLibraryPath,
        },
        stdio: [
          'inherit',
          'inherit',
          'inherit',
          'pipe',
          'pipe',
          configuration.output ? 'pipe' : 'ignore',
          ...configuration.capturedInputs.map((file) => file.fd),
        ],
      },
    )
    childExit = childClose(launched)
    child = launched
    // A pipe-based kernel core collector can keep a crashed process alive and
    // hold every waiting launcher until the Run deadline. Observe kernel state,
    // not payload stderr. Stop the exact owned tree; retain its actual signal.
    coreDumpTimer = setInterval(() => {
      if (monitoringClosed || stopReason !== undefined || coreDumpCheck !== undefined) return
      coreDumpCheck = privateHasCoreDumpingProcess(runCgroup, limits.pids)
        .then((dumping) => {
          if (dumping && !monitoringClosed && stopReason === undefined) stop('core_dump')
        })
        .catch(() => {
          if (!monitoringClosed && stopReason === undefined) stop('setup_failed')
        })
        .finally(() => {
          coreDumpCheck = undefined
        })
    }, CORE_DUMP_POLL_MS)
    // Cancellation can close the gate while the coordinator is acknowledging
    // readiness. A failed write must settle through the same cleanup owner.
    ;(launched.stdio[4] as Writable).on('error', () => stop('setup_failed'))
    const ready = await readReady(launched)
    if (configuration.output) {
      const sandboxPid = await readSandboxPid(launched)
      await outputReady(launched)
      // The trusted inner launcher blocks before package code can run.
      // This FD pins the mount, not a replaceable payload pathname.
      if (configuration.evaluationWorkspace !== null) {
        outputBacking = await open(`/proc/${sandboxPid}/root/jig-output`, 0x10000)
        outputDirectory = await open(`/proc/self/fd/${outputBacking.fd}/public`, 0x10000)
        const projectedReady = outputReady(launched)
        ;(launched.stdio[4] as Writable).write(Buffer.from([2]))
        await projectedReady
        const projected = await stat(`/proc/${sandboxPid}/root/jig-output`, { bigint: true })
        const original = await outputDirectory.stat({ bigint: true })
        if (projected.dev !== original.dev || projected.ino !== original.ino)
          throw new Error('output public projection differs from the original directory')
      } else {
        outputDirectory = await open(`/proc/${sandboxPid}/root/jig-output`, 0x10000)
      }
    }
    readyToContinue = true
    safeSend(control, {
      type: 'ready',
      runCgroup,
      payloadPid: ready,
      supervisorPid: process.pid,
      ...(outputDirectory === undefined ? {} : { outputFd: outputDirectory.fd }),
      ...(outputBacking === undefined ? {} : { outputBackingFd: outputBacking.fd }),
    } satisfies ReadyMessage)
    const exit = await childExit
    exitCode = exit.code
    exitSignal = exit.signal
    stopReason ??= 'payload_exit'
  } catch (error) {
    stopReason ??= 'setup_failed'
    if (stopReason === 'setup_failed') process.stderr.write(`${errorText(error)}\n`)
  } finally {
    monitoringClosed = true
    clearInterval(coreDumpTimer)
    clearDeadline()
    const closeErrors: unknown[] = []
    for (const directory of [outputDirectory, outputBacking]) {
      try {
        await directory?.close()
      } catch (error) {
        closeErrors.push(error)
      }
    }
    let cleanupError: string | undefined
    try {
      child?.kill('SIGKILL')
      await killRun()
      if (coreDumpCheck !== undefined)
        await withinTimeout(
          coreDumpCheck,
          limits.cleanupTimeoutMs,
          'core-dump check did not settle',
        )
      // Spawn failure is already a setup failure; settlement still precedes cleanup.
      if (childExit !== undefined) {
        await withinTimeout(
          childExit.catch(() => undefined),
          limits.cleanupTimeoutMs,
          'rootless entry child did not settle',
        )
      }
      if (cgroupCreated) {
        await waitUntilEmpty(runCgroup, limits.cleanupTimeoutMs)
        evidence = await readEvidence(runCgroup)
        await removeEmptyCgroup(runCgroup, limits.cleanupTimeoutMs)
        cgroupCreated = false
      }
    } catch (error) {
      cleanupError = errorText(error)
    }
    if (closeErrors.length !== 0)
      cleanupError = errorText(
        new AggregateError(
          [...closeErrors, ...(cleanupError === undefined ? [] : [cleanupError])],
          'native output descriptors did not close',
        ),
      )
    terminal = Object.freeze({
      type: 'terminal' as const,
      ownerDigest: configuration.ownerDigest,
      runCgroup,
      supervisorPid: process.pid,
      exitCode,
      signal: exitSignal,
      stopReason: stopReason ?? 'setup_failed',
      fenced: cleanupError === undefined && !cgroupCreated,
      ...(cleanupError === undefined ? {} : { cleanupError }),
      evidence,
    })
    if (terminal.fenced) await persistFinal(configuration, terminal)
    safeSend(control, terminal)
    control.end()
  }
}

/** Package-private kernel observation seam; never reads candidate-authored files. */
export async function privateHasCoreDumpingProcess(
  runCgroup: string,
  maxProcesses: number,
  readText: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<boolean> {
  const processes = (await readText(`${runCgroup}/cgroup.procs`)).trim()
  const pids = processes === '' ? [] : processes.split('\n')
  if (
    !positiveInteger(maxProcesses) ||
    pids.length > maxProcesses ||
    pids.some((pid) => !/^[1-9][0-9]*$/.test(pid) || !Number.isSafeInteger(Number(pid)))
  )
    throw new Error('invalid owned process observation')
  const membership = `0::${runCgroup.slice('/sys/fs/cgroup'.length)}`
  for (const pid of pids) {
    try {
      const status = await readText(`/proc/${pid}/status`)
      if (status.length > MAX_CONTROL_BYTES) throw new Error('oversized owned process status')
      // Zombies have no mm and Linux omits CoreDumping from their status.
      // They are reaped through childClose, not treated as inspection failures.
      if (!/^CoreDumping:/m.test(status)) continue
      const dumping = /^CoreDumping:[ \t]+([01])$/m.exec(status)
      if (dumping === null) throw new Error('kernel core-dump observation is unavailable')
      if (dumping[1] !== '1') continue
      // PIDs can disappear or be reused during a scan. A stale foreign PID
      // cannot establish a crash in this owner, and is never signalled directly.
      if ((await readText(`/proc/${pid}/cgroup`)).split('\n').includes(membership)) return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ESRCH') throw error
    }
  }
  return false
}

async function enterMain(arguments_: readonly string[]): Promise<void> {
  requireFixedBunPosture('entry trampoline')
  if (arguments_.length < 7) throw new Error('invalid rootless entry trampoline arguments')
  const [
    runCgroup,
    ownerStateDirectory,
    ownerToken,
    ownerStateAllocationDigest,
    bubblewrap,
    ...bubblewrapArguments_
  ] = arguments_
  if (!absolute(runCgroup!) || !absolute(ownerStateDirectory!) || !absolute(bubblewrap!)) {
    throw new Error('invalid rootless entry trampoline path')
  }
  await writeFile(`${runCgroup}/cgroup.procs`, '0\n')
  const current = readFileSync('/proc/self/cgroup', 'utf8')
    .split('\n')
    .find((line) => line.startsWith('0::'))
    ?.slice(3)
  if (`/sys/fs/cgroup${current ?? ''}` !== runCgroup) {
    throw new Error('rootless entry trampoline did not enter the Run cgroup')
  }
  await requireActiveClaim(ownerStateDirectory!, ownerToken!, ownerStateAllocationDigest!)
  writeSync(3, `${process.pid}\n`)
  closeSync(3)
  const separator = bubblewrapArguments_.indexOf('--')
  if (separator < 0) throw new Error('missing rootless command boundary')
  const envelopeArguments = bubblewrapArguments_.slice(0, separator)
  const output = envelopeArguments.includes('--sync-fd')
  if (!output) {
    // Keep the checked entry PID alive until the coordinator has validated
    // membership. No candidate code starts or receives this private gate.
    const gate = Buffer.alloc(1)
    if (readSync(4, gate, 0, 1, null) !== 1 || gate[0] !== 1) {
      throw new Error('execution ownership was not acknowledged')
    }
    closeSync(4)
  }
  const inputDescriptors = envelopeArguments.flatMap((arg, index) =>
    arg === '--file' ? [Number(envelopeArguments[index + 1])] : [],
  )
  if (inputDescriptors.some((fd, index) => fd !== 6 + index))
    throw new Error('invalid captured input descriptor order')
  restrictInheritedDescriptors(process.env.LD_LIBRARY_PATH, [
    ...(output ? [4, 5] : []),
    ...inputDescriptors,
  ])
  const child = spawn(bubblewrap!, bubblewrapArguments_, {
    cwd: '/',
    env: {},
    stdio: [
      'inherit',
      'inherit',
      'inherit',
      'ignore',
      output ? 4 : 'ignore',
      output ? 5 : 'ignore',
      ...inputDescriptors,
    ],
  })
  for (const fd of inputDescriptors) closeSync(fd)
  if (output) {
    closeSync(4)
    closeSync(5)
  }
  const exit = await childClose(child)
  if (exit.signal !== null) process.kill(process.pid, exit.signal as NodeJS.Signals)
  process.exitCode = exit.code ?? 1
}

async function innerMain(
  command: readonly string[],
  output: boolean,
  capturedInputs: readonly {
    readonly path: string
    readonly bytes: number
    readonly digest: string
  }[],
  projectOutput = false,
  projectedOutput = false,
  payloadEnvironment?: Readonly<Record<string, string>>,
  evaluationWorkspace?: PrivateProjectEvaluationWorkspace,
): Promise<void> {
  if (command.length === 0 || !absolute(command[0]!))
    throw new Error('invalid rootless inner command')
  const nullDevice = statSync('/dev/null')
  const entropyDevice = statSync('/dev/urandom')
  if (
    !nullDevice.isCharacterDevice() ||
    !entropyDevice.isCharacterDevice() ||
    (nullDevice.mode & 0o777) !== 0o666 ||
    (entropyDevice.mode & 0o777) !== 0o666
  ) {
    throw new Error('rootless private devices do not satisfy the required projection')
  }
  for (const file of capturedInputs) {
    const bytes = readFileSync(file.path)
    if (
      bytes.byteLength !== file.bytes ||
      `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== file.digest
    )
      throw new Error('captured input projection does not match its admitted identity')
  }
  if (projectOutput) {
    mkdirSync('/jig-output/public', { mode: 0o700 })
    if (evaluationWorkspace !== undefined) {
      privateCopyLinuxEvaluationWorkspace(evaluationWorkspace)
      for (const root of privateEvaluationWritableRoots(evaluationWorkspace))
        mkdirSync(`/jig-output/public/${root}`, { mode: 0o700 })
    }
    writeSync(4, Buffer.from([1]))
    const custody = Buffer.alloc(1)
    if (readSync(4, custody, 0, 1, null) !== 1 || custody[0] !== 2)
      throw new Error('original output custody was not acquired')
    projectPrivateOutputAndExec(
      command,
      capturedInputs,
      payloadEnvironment ?? {},
      evaluationWorkspace,
    )
  }
  if (projectedOutput) {
    const posture = readFileSync('/proc/self/status', 'utf8')
    for (const name of ['CapEff', 'CapPrm', 'CapInh', 'CapAmb', 'CapBnd'])
      if (!new RegExp(`^${name}:\\s+0+$`, 'm').test(posture))
        throw new Error('private output launcher retained native capabilities')
    if (!/^NoNewPrivs:\s+1$/m.test(posture))
      throw new Error('private output launcher lacks no-new-privileges posture')
  }
  if (output) {
    writeSync(4, Buffer.from([1]))
    const gate = Buffer.alloc(1)
    if (readSync(4, gate, 0, 1, null) !== 1 || gate[0] !== 1) {
      throw new Error('output ownership was not acquired')
    }
    closeSync(4)
  }
  restrictInheritedDescriptors(SANDBOX_LIBRARY_PATH, [])
  const child = spawn(command[0]!, command.slice(1), {
    cwd: '/work',
    env:
      payloadEnvironment === undefined
        ? process.env
        : { ...payloadEnvironment, LD_LIBRARY_PATH: SANDBOX_LIBRARY_PATH },
    stdio: 'inherit',
  })
  const exit = await childClose(child)
  if (exit.signal !== null) process.kill(process.pid, exit.signal as NodeJS.Signals)
  process.exitCode = exit.code ?? 1
}

/** All namespace privilege ends at exec, including privilege on Bun worker threads. */
function projectPrivateOutputAndExec(
  command: readonly string[],
  capturedInputs: readonly {
    readonly path: string
    readonly bytes: number
    readonly digest: string
  }[],
  payloadEnvironment: Readonly<Record<string, string>>,
  evaluationWorkspace?: PrivateProjectEvaluationWorkspace,
): never {
  const ffi = createRequire(import.meta.url)('bun:ffi') as {
    ptr(bytes: Uint8Array): number
    read: { i32(pointer: number): number }
    dlopen(
      path: string,
      symbols: Record<string, { args: string[]; returns: string }>,
    ): {
      symbols: Record<string, (...args: (number | bigint | null)[]) => number>
    }
  }
  const native = ffi.dlopen(posix.join(SANDBOX_LIBRARY_PATH, 'libc.so.6'), {
    unshare: { args: ['i32'], returns: 'i32' },
    mount: { args: ['ptr', 'ptr', 'ptr', 'u64', 'ptr'], returns: 'i32' },
    __errno_location: { args: [], returns: 'ptr' },
    capset: { args: ['ptr', 'ptr'], returns: 'i32' },
    prctl: { args: ['i32', 'u64', 'u64', 'u64', 'u64'], returns: 'i32' },
    execve: { args: ['ptr', 'ptr', 'ptr'], returns: 'i32' },
  })
  // bwrap disables further user namespaces by entering a child user namespace
  // after its mounts are created. The fixed setup thread needs a mount namespace
  // owned by that current user namespace; original supervisor FDs remain on the
  // earlier mount. Exec below ends all other Bun threads and all setup privilege.
  if (native.symbols.unshare!(0x20000) !== 0)
    throw new Error(
      `private output mount namespace is unavailable (${ffi.read.i32(native.symbols.__errno_location!())})`,
    )
  const publicDirectory = openSync('/jig-output/public', 0x10000 | 0x20000)
  try {
    const mount = (source: string | null, destination: string, flags: bigint) => {
      const from = source === null ? null : Buffer.from(`${source}\0`)
      const to = Buffer.from(`${destination}\0`)
      if (
        native.symbols.mount!(
          from === null ? null : ffi.ptr(from),
          ffi.ptr(to),
          null,
          flags,
          null,
        ) !== 0
      )
        throw new Error('closed evaluation mount projection is unavailable')
    }
    if (evaluationWorkspace !== undefined) {
      // Freeze the whole work tree before adding ONLY selected writable roots.
      mount('/work', '/work', 4096n)
      mount(null, '/work', 4096n | 32n | 1n | 2n | 4n)
      for (const root of privateEvaluationWritableRoots(evaluationWorkspace))
        mount(`/proc/self/fd/${publicDirectory}/${root}`, `/work/${root}`, 4096n)
      mount('/tmp', '/work/scratch', 4096n)
    }
    const source = Buffer.from(`/proc/self/fd/${publicDirectory}\0`)
    const destination = Buffer.from('/jig-output\0')
    if (native.symbols.mount!(ffi.ptr(source), ffi.ptr(destination), null, 4096n, null) !== 0)
      throw new Error(
        `private output subtree projection is unavailable (${ffi.read.i32(native.symbols.__errno_location!())})`,
      )
    if (evaluationWorkspace !== undefined) {
      // The collector retains the original unmounted directory, preserving
      // no-XDEV checks. The payload sees a readonly aggregate with root overlays.
      mount(null, '/jig-output', 4096n | 32n | 1n | 2n | 4n)
      for (const root of privateEvaluationWritableRoots(evaluationWorkspace))
        mount(`/work/${root}`, `/jig-output/${root}`, 4096n)
      // Sever the covered writable work mount from the trusted parent's cwd.
      // Otherwise a payload could reach it through that parent's procfs cwd.
      process.chdir('/work')
    }
  } finally {
    closeSync(publicDirectory)
  }
  const args = [
    SANDBOX_BUN,
    ...POLICY,
    MODULE_DESTINATION,
    '--inner-output-projected',
    JSON.stringify(capturedInputs),
    JSON.stringify(payloadEnvironment),
    JSON.stringify(evaluationWorkspace ?? null),
    '--',
    ...command,
  ]
  const env = [`LD_LIBRARY_PATH=${SANDBOX_LIBRARY_PATH}`]
  const strings = [...args, ...env].map((value) => {
    if (value.includes('\0')) throw new Error('private output exec contains NUL')
    return Buffer.from(`${value}\0`)
  })
  const pointers = (from: number, length: number) => {
    const result = Buffer.alloc((length + 1) * 8)
    for (let index = 0; index < length; index++)
      result.writeBigUInt64LE(BigInt(ffi.ptr(strings[from + index]!)), index * 8)
    return result
  }
  const argv = pointers(0, args.length),
    environment = pointers(args.length, env.length)
  // Dropping a bounding bit keeps this setup thread's effective SETPCAP until capset.
  for (let capability = 0; capability <= 40; capability++)
    if (native.symbols.prctl!(24, capability, 0, 0, 0) !== 0)
      throw new Error('private output capability bounding reset is unavailable')
  if (native.symbols.prctl!(47, 4, 0, 0, 0) !== 0 || native.symbols.prctl!(38, 1, 0, 0, 0) !== 0)
    throw new Error('private output no-new-privileges reset is unavailable')
  const header = Buffer.alloc(8),
    capabilities = Buffer.alloc(24)
  header.writeUInt32LE(0x20080522)
  if (native.symbols.capset!(ffi.ptr(header), ffi.ptr(capabilities)) !== 0)
    throw new Error('private output capability reset is unavailable')
  restrictInheritedDescriptors(SANDBOX_LIBRARY_PATH, [4])
  native.symbols.execve!(ffi.ptr(strings[0]!), ffi.ptr(argv), ffi.ptr(environment))
  throw new Error('private output unprivileged launcher exec failed')
}

/** Restrict the next exec without closing this trusted Bun process's live descriptors. */
function restrictInheritedDescriptors(
  libraryDirectory: string | undefined,
  allowed: readonly number[],
): void {
  if (
    libraryDirectory === undefined ||
    !absolute(libraryDirectory) ||
    libraryDirectory.includes(':') ||
    allowed.some((fd) => !Number.isSafeInteger(fd) || fd < 3) ||
    new Set(allowed).size !== allowed.length
  )
    throw new Error('invalid inherited descriptor policy')
  const ffi = createRequire(import.meta.url)('bun:ffi') as {
    dlopen(
      path: string,
      symbols: Record<string, { args: string[]; returns: string }>,
    ): {
      symbols: Record<string, (...args: number[]) => number>
      close(): void
    }
  }
  const controls = ffi.dlopen(posix.join(libraryDirectory, 'libc.so.6'), {
    close_range: { args: ['u32', 'u32', 'u32'], returns: 'i32' },
    fcntl: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
  })
  try {
    // CLOEXEC operates on the shared descriptor table; UNSHARE would leave other
    // Bun threads able to spawn with the old table. Never mutate the coordinator.
    if (controls.symbols.close_range!(3, 0xffffffff, 4) !== 0)
      throw new Error('inherited descriptor restriction is unavailable')
    for (const fd of allowed) {
      const flags = controls.symbols.fcntl!(fd, 1, 0)
      if (flags < 0 || controls.symbols.fcntl!(fd, 2, flags & ~1) !== 0)
        throw new Error('required descriptor handoff is unavailable')
    }
  } finally {
    controls.close()
  }
  // Callers spawn synchronously next, with exactly the allowed setup/input slots.
}

function bubblewrapArguments(configuration: Configuration): string[] {
  const result = [
    '--unshare-all',
    ...(configuration.network === 'inherited' ? ['--share-net'] : []),
    '--unshare-user',
    ...(configuration.nestedUserNamespaces ? [] : ['--disable-userns', '--assert-userns-disabled']),
    '--as-pid-1',
    '--die-with-parent',
    '--new-session',
    '--clearenv',
    '--proc',
    '/proc',
    ...(configuration.nestedUserNamespaces ? [] : ['--remount-ro', '/proc']),
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/run',
    '--dir',
    '/work',
    '--dir',
    '/etc',
    '--dir',
    '/jig',
    '--dir',
    '/jig-runtime',
    '--dir',
    '/jig-runtime/lib',
    '--dir',
    '/lib64',
    '--chdir',
    '/work',
  ]
  for (const mount of configuration.readOnlyMounts)
    result.push('--ro-bind', mount.source, mount.destination)
  if (configuration.inputDirectories.length > 0)
    result.push('--size', String(32 * 1024 * 1024), '--tmpfs', '/jig-input')
  const aliasNames = new Set(configuration.inputAliases.map((alias) => `/jig-input/${alias.name}`))
  for (const path of configuration.inputDirectories)
    if (!aliasNames.has(path)) result.push('--dir', path)
  for (const path of configuration.inputEmptyDirectories) result.push('--dir', path)
  // Copy sealed bytes into named inodes, then freeze the whole private tree.
  // Unlinked bind-data inodes break Bun's module realpath resolution.
  for (const file of configuration.capturedInputs)
    result.push('--perms', '0444', '--file', String(file.fd), file.destination)
  for (const alias of configuration.inputAliases)
    result.push('--symlink', alias.target, `/jig-input/${alias.name}`)
  if (configuration.inputDirectories.length > 0) result.push('--remount-ro', '/jig-input')
  if (configuration.output) {
    result.push('--size', String(16 * 1024 * 1024), '--tmpfs', '/jig-output')
    result.push('--sync-fd', '4', '--json-status-fd', '5')
  }
  if (configuration.evaluationWorkspace !== null) {
    const source = configuration.readOnlyMounts.find(
      (mount) => mount.destination === PRIVATE_EVALUATION_WORKSPACE_PATH,
    )!.source
    result.push(
      ...privateLinuxEvaluationWorkspaceArguments({
        workspace: configuration.evaluationWorkspace,
        source,
        entries: configuration.evaluationEntries,
      }),
    )
  }
  result.push('--ro-bind', configuration.supervisorPath, MODULE_DESTINATION)
  for (const [name, value] of Object.entries(
    configuration.evaluationWorkspace !== null ? {} : configuration.environment,
  ).sort(([a], [b]) => a.localeCompare(b))) {
    result.push('--setenv', name, value)
  }
  result.push(
    '--setenv',
    'LD_LIBRARY_PATH',
    SANDBOX_LIBRARY_PATH,
    '--uid',
    String(configuration.payloadUid),
    '--gid',
    String(configuration.payloadGid),
    '--cap-drop',
    'ALL',
    ...(configuration.evaluationWorkspace !== null
      ? ['--cap-add', 'CAP_SYS_ADMIN', '--cap-add', 'CAP_SETPCAP']
      : []),
    '--',
    SANDBOX_BUN,
    ...POLICY,
    MODULE_DESTINATION,
    configuration.evaluationWorkspace !== null
      ? '--inner-output-project'
      : configuration.output
        ? '--inner-output'
        : '--inner',
    JSON.stringify(
      configuration.capturedInputs.map(({ destination, bytes, digest }) => ({
        path: destination,
        bytes,
        digest,
      })),
    ),
    ...(configuration.evaluationWorkspace !== null
      ? [
          JSON.stringify(configuration.environment),
          JSON.stringify(configuration.evaluationWorkspace),
        ]
      : []),
    '--',
    ...configuration.command,
  )
  return result
}

async function claimActive(configuration: Configuration): Promise<'created' | 'cancelled'> {
  await requireOwnerRecord(configuration)
  const path = `${configuration.ownerStateDirectory}/claim.json`
  try {
    const file = await open(path, 'wx', 0o600)
    try {
      await file.writeFile(
        `${JSON.stringify({
          allocationDigest: configuration.ownerStateAllocationDigest,
          kind: 'private-linux-owner-claim/1',
          state: 'active',
          token: configuration.ownerToken,
        })}\n`,
        'utf8',
      )
      await file.sync()
    } finally {
      await file.close()
    }
    await syncDirectory(configuration.ownerStateDirectory)
    return 'created'
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error
  }
  const claim = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  if (
    claim.allocationDigest !== configuration.ownerStateAllocationDigest ||
    claim.kind !== 'private-linux-owner-claim/1' ||
    claim.token !== configuration.ownerToken ||
    (claim.state !== 'active' && claim.state !== 'cancelled')
  ) {
    throw new Error('rootless owner claim is invalid')
  }
  if (claim.state === 'active') {
    throw new Error('rootless owner claim is already active')
  }
  return 'cancelled'
}

async function requireActiveClaim(
  directory: string,
  token: string,
  allocationDigest: string,
): Promise<void> {
  const claim = JSON.parse(await readFile(`${directory}/claim.json`, 'utf8')) as Record<
    string,
    unknown
  >
  if (
    claim.kind !== 'private-linux-owner-claim/1' ||
    claim.state !== 'active' ||
    claim.token !== token ||
    claim.allocationDigest !== allocationDigest
  ) {
    throw new Error('rootless owner was cancelled before entry')
  }
}

async function requireOwnerRecord(configuration: Configuration): Promise<void> {
  const value = JSON.parse(
    await readFile(`${configuration.ownerStateDirectory}/owner.json`, 'utf8'),
  ) as Record<string, unknown>
  if (
    value.kind !== 'private-linux-owner-state/1' ||
    value.allocationDigest !== configuration.ownerStateAllocationDigest ||
    value.token !== configuration.ownerToken ||
    value.ownerDigest !== configuration.ownerDigest ||
    value.runCgroup !== configuration.runCgroup ||
    value.mechanismDigest !== configuration.mechanismDigest ||
    value.sealedPlanDigest !== configuration.sealedPlanDigest
  ) {
    throw new Error('rootless owner-state record is invalid')
  }
}

async function persistFinal(
  configuration: Configuration,
  terminal: TerminalMessage,
): Promise<void> {
  const directory = configuration.ownerStateDirectory
  const target = `${directory}/final.json`
  const temporary = `${directory}/.final-${randomBytes(8).toString('hex')}`
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(terminal)}\n`, 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    await link(temporary, target)
    await syncDirectory(directory)
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error
    const existing = await readFile(target, 'utf8')
    if (existing !== `${JSON.stringify(terminal)}\n`) {
      throw new Error('rootless cleanup owners produced conflicting fence receipts')
    }
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

function requireStart(value: unknown): Configuration {
  if (
    recordType(value) !== 'start' ||
    value === null ||
    typeof value !== 'object' ||
    !('configuration' in value)
  )
    throw new Error('invalid rootless supervisor start message')
  const configuration = (value as { configuration: Configuration }).configuration
  const keys = [
    'bubblewrapPath',
    'bunHostLibraryPath',
    'bunPath',
    'command',
    'capturedInputs',
    'delegatedCgroup',
    'environment',
    'evaluationWorkspace',
    'evaluationEntries',
    'limits',
    'inputDirectories',
    'inputEmptyDirectories',
    'inputAliases',
    'mechanismDigest',
    'nestedUserNamespaces',
    'network',
    'output',
    'ownerDigest',
    'ownerStateAllocationDigest',
    'ownerStateDirectory',
    'ownerToken',
    'payloadGid',
    'payloadUid',
    'readOnlyMounts',
    'runCgroup',
    'sealedPlanDigest',
    'supervisorPath',
  ]
  const evaluationWorkspace = normalizePrivateProjectEvaluationWorkspace(
    configuration.evaluationWorkspace,
  )
  if (
    !Array.isArray(configuration.evaluationEntries) ||
    (evaluationWorkspace === undefined && configuration.evaluationEntries.length !== 0) ||
    (evaluationWorkspace !== undefined &&
      (!configuration.output ||
        configuration.limits.memoryBytes > 512 * 1024 * 1024 ||
        configuration.network !== 'isolated' ||
        configuration.nestedUserNamespaces ||
        configuration.capturedInputs.length !== 0 ||
        configuration.inputDirectories.length !== 0 ||
        !configuration.readOnlyMounts.some(
          (mount) => mount.destination === PRIVATE_EVALUATION_WORKSPACE_PATH,
        )))
  )
    throw new Error('invalid closed evaluation workspace configuration')
  if (evaluationWorkspace !== undefined)
    privateLinuxEvaluationWorkspaceArguments({
      workspace: evaluationWorkspace,
      source: configuration.readOnlyMounts.find(
        (mount) => mount.destination === PRIVATE_EVALUATION_WORKSPACE_PATH,
      )!.source,
      entries: configuration.evaluationEntries,
    })
  if (
    configuration === null ||
    typeof configuration !== 'object' ||
    Array.isArray(configuration) ||
    Object.keys(configuration).sort().join('\0') !== keys.sort().join('\0') ||
    !absolute(configuration.delegatedCgroup) ||
    !absolute(configuration.bunHostLibraryPath) ||
    !absolute(configuration.runCgroup) ||
    posix.dirname(configuration.runCgroup) !== configuration.delegatedCgroup ||
    !/^jig-run-[a-z0-9][a-z0-9-]{0,47}-[0-9a-f]{24}$/.test(
      posix.basename(configuration.runCgroup),
    ) ||
    !configuration.runCgroup.startsWith('/sys/fs/cgroup/') ||
    !absolute(configuration.ownerStateDirectory) ||
    !absolute(configuration.bunPath) ||
    !absolute(configuration.bubblewrapPath) ||
    !absolute(configuration.supervisorPath) ||
    typeof configuration.mechanismDigest !== 'string' ||
    !DIGEST.test(configuration.mechanismDigest) ||
    typeof configuration.ownerDigest !== 'string' ||
    !DIGEST.test(configuration.ownerDigest) ||
    typeof configuration.sealedPlanDigest !== 'string' ||
    !DIGEST.test(configuration.sealedPlanDigest) ||
    typeof configuration.ownerStateAllocationDigest !== 'string' ||
    !DIGEST.test(configuration.ownerStateAllocationDigest) ||
    typeof configuration.ownerToken !== 'string' ||
    !OWNER_TOKEN.test(configuration.ownerToken) ||
    (configuration.network !== 'isolated' && configuration.network !== 'inherited') ||
    typeof configuration.nestedUserNamespaces !== 'boolean' ||
    typeof configuration.output !== 'boolean' ||
    !Array.isArray(configuration.capturedInputs) ||
    configuration.capturedInputs.length > 64 ||
    !Array.isArray(configuration.inputDirectories) ||
    !Array.isArray(configuration.inputAliases) ||
    configuration.inputAliases.length > 7 ||
    configuration.inputDirectories.length > 8 ||
    configuration.inputDirectories.some(
      (path) =>
        typeof path !== 'string' ||
        path.length > 75 ||
        !/^\/jig-input\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path),
    ) ||
    configuration.capturedInputs.some(
      (file, index) =>
        file === null ||
        typeof file !== 'object' ||
        file.fd !== 6 + index ||
        !absolute(file.destination) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        typeof file.digest !== 'string' ||
        !DIGEST.test(file.digest) ||
        !configuration.inputDirectories.some((path) => file.destination.startsWith(`${path}/`)),
    ) ||
    !positiveInteger(configuration.payloadUid) ||
    !positiveInteger(configuration.payloadGid) ||
    !validLimits(configuration.limits) ||
    !validMounts(configuration.readOnlyMounts) ||
    !validEnvironment(configuration.environment) ||
    !Array.isArray(configuration.command) ||
    configuration.command.length === 0 ||
    !absolute(configuration.command[0]!) ||
    configuration.command.some((part) => typeof part !== 'string' || part.includes('\0'))
  ) {
    throw new Error('invalid rootless supervisor configuration')
  }
  normalizePrivateInputEmptyDirectories(
    configuration.inputEmptyDirectories.map((path) => {
      if (!path.startsWith('/jig-input/')) throw new Error('invalid input directory')
      return path.slice('/jig-input/'.length)
    }),
    configuration.inputDirectories.map((path) => path.slice('/jig-input/'.length)),
    configuration.capturedInputs.map((file) => file.destination.slice('/jig-input/'.length)),
  )
  {
    const aliases = configuration.inputAliases
    const names = new Set(aliases.map((alias) => alias?.name))
    const localName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    if (
      names.size !== aliases.length ||
      aliases.some(
        (alias) =>
          alias === null ||
          typeof alias !== 'object' ||
          Object.keys(alias).sort().join() !== 'name,target' ||
          typeof alias.name !== 'string' ||
          typeof alias.target !== 'string' ||
          alias.name.length > 64 ||
          alias.target.length > 64 ||
          !localName.test(alias.name) ||
          !localName.test(alias.target) ||
          names.has(alias.target) ||
          !configuration.inputDirectories.includes(`/jig-input/${alias.name}`) ||
          !configuration.inputDirectories.includes(`/jig-input/${alias.target}`) ||
          configuration.capturedInputs.some((file) =>
            file.destination.startsWith(`/jig-input/${alias.name}/`),
          ) ||
          !configuration.capturedInputs.some((file) =>
            file.destination.startsWith(`/jig-input/${alias.target}/`),
          ),
      )
    )
      throw new Error('invalid rootless immutable input aliases')
  }
  return configuration
}

function validLimits(value: unknown): value is Limits {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const limits = value as Record<string, unknown>
  const keys = [
    'bootDeadline',
    'cancellationGraceMs',
    'cleanupTimeoutMs',
    'cpuPeriodMicros',
    'cpuQuotaMicros',
    'deadlineUnixMs',
    'memoryBytes',
    'pids',
  ]
  return (
    Object.keys(limits).sort().join('\0') === keys.sort().join('\0') &&
    positiveInteger(limits.memoryBytes) &&
    positiveInteger(limits.pids) &&
    positiveInteger(limits.cpuQuotaMicros) &&
    positiveInteger(limits.cpuPeriodMicros) &&
    nonnegativeInteger(limits.deadlineUnixMs) &&
    positiveInteger(limits.cancellationGraceMs) &&
    positiveInteger(limits.cleanupTimeoutMs) &&
    Number(limits.deadlineUnixMs) + Number(limits.cancellationGraceMs) <= Number.MAX_SAFE_INTEGER &&
    validBootDeadline(limits.bootDeadline)
  )
}

function validBootDeadline(value: unknown): boolean {
  try {
    normalizePrivateBootDeadline(value)
    return true
  } catch {
    return false
  }
}

function validMounts(value: unknown): value is readonly Mount[] {
  return (
    Array.isArray(value) &&
    value.every((mount) => {
      if (mount === null || typeof mount !== 'object' || Array.isArray(mount)) return false
      const record = mount as Record<string, unknown>
      return (
        Object.keys(record).sort().join('\0') === 'destination\0source' &&
        typeof record.source === 'string' &&
        absolute(record.source) &&
        typeof record.destination === 'string' &&
        absolute(record.destination)
      )
    })
  )
}

function validEnvironment(value: unknown): value is Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([name, content]) =>
      ENVIRONMENT_NAME.test(name) &&
      name !== 'BUN_BE_BUN' &&
      name !== 'LD_LIBRARY_PATH' &&
      typeof content === 'string' &&
      !content.includes('\0'),
  )
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function recordType(value: unknown): string | undefined {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'type' in value &&
    typeof value.type === 'string'
    ? value.type
    : undefined
}

async function* readJsonLines(stream: NodeJS.ReadableStream): AsyncIterable<unknown> {
  let buffer = ''
  for await (const chunk of stream) {
    buffer += String(chunk)
    if (Buffer.byteLength(buffer) > MAX_CONTROL_BYTES)
      throw new Error('rootless control stream overflow')
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line !== '') yield JSON.parse(line) as unknown
      newline = buffer.indexOf('\n')
    }
  }
  if (buffer !== '') throw new Error('rootless control stream ended mid-message')
}

function safeSend(stream: NodeJS.WritableStream, value: unknown): void {
  try {
    stream.write(`${JSON.stringify(value)}\n`)
  } catch {
    /* coordinator loss */
  }
}

async function readReady(child: ChildProcess): Promise<number> {
  const stream = child.stdio[3] as Readable | null | undefined
  if (stream === null || stream === undefined)
    throw new Error('rootless entry readiness pipe is unavailable')
  let text = ''
  for await (const chunk of stream) {
    text += String(chunk)
    if (text.length > 32) throw new Error('invalid rootless entry readiness receipt')
  }
  const pid = Number(text.trim())
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('invalid rootless entry readiness receipt')
  return pid
}

async function readSandboxPid(child: ChildProcess): Promise<number> {
  const stream = (child.stdio as readonly unknown[])[5] as Readable | undefined
  if (stream === undefined) throw new Error('missing Bubblewrap status pipe')
  let text = ''
  for await (const chunk of stream.iterator({ destroyOnReturn: false })) {
    text += String(chunk)
    if (text.length > 4096) throw new Error('oversized Bubblewrap status')
    // The parent reports identity before the inner launcher reports readiness.
    const end = text.indexOf('}')
    if (end < 0) continue
    const record = JSON.parse(text.slice(0, end + 1)) as { 'child-pid'?: unknown }
    if (!positiveInteger(record['child-pid'])) throw new Error('invalid Bubblewrap child identity')
    stream.resume()
    return record['child-pid'] as number
  }
  throw new Error('Bubblewrap exited before output handoff')
}

function outputReady(child: ChildProcess): Promise<void> {
  const stream = child.stdio[4] as Readable
  return new Promise((resolve, reject) => {
    stream.once('error', reject)
    stream.once('end', () => reject(new Error('output launcher ended before handoff')))
    stream.once('data', (bytes: Buffer) => {
      if (bytes.length !== 1 || bytes[0] !== 1) reject(new Error('invalid output readiness'))
      else resolve()
    })
  })
}

async function waitUntilEmpty(cgroup: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if ((await readCounters(`${cgroup}/cgroup.events`)).populated === 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('rootless Run cgroup did not become empty')
}

async function removeEmptyCgroup(cgroup: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await rmdir(cgroup)
      return
    } catch (error) {
      if (!hasCode(error, 'EBUSY') || Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

async function readEvidence(cgroup: string): Promise<Evidence> {
  return Object.freeze({
    cpuStat: Object.freeze(await readCounters(`${cgroup}/cpu.stat`)),
    memoryEvents: Object.freeze(await readCounters(`${cgroup}/memory.events`)),
    pidsEvents: Object.freeze(await readCounters(`${cgroup}/pids.events`)),
  })
}

async function readCounters(path: string): Promise<Record<string, number>> {
  const result: Record<string, number> = Object.create(null) as Record<string, number>
  for (const line of (await readFile(path, 'utf8')).trim().split('\n')) {
    if (line === '') continue
    const [name, raw] = line.trim().split(/\s+/, 2)
    const value = Number(raw)
    if (name === undefined || !Number.isSafeInteger(value) || value < 0)
      throw new Error(`invalid counter in ${path}`)
    result[name] = value
  }
  return result
}

function emptyEvidence(): Evidence {
  return Object.freeze({
    cpuStat: Object.freeze({}),
    memoryEvents: Object.freeze({}),
    pidsEvents: Object.freeze({}),
  })
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false
    throw error
  }
}

function ignoreMissing(error: unknown): void {
  if (!hasCode(error, 'ENOENT')) throw error
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error !== null && typeof error === 'object' && (error as NodeJS.ErrnoException).code === code
  )
}

function absolute(path: string): boolean {
  return (
    typeof path === 'string' &&
    path.startsWith('/') &&
    !path.includes('\0') &&
    posix.normalize(path) === path
  )
}

function requireFixedBunPosture(label: string): void {
  const environmentKeys = Object.keys(process.env).sort()
  if (
    process.cwd() !== '/' ||
    environmentKeys.join('\0') !== 'LD_LIBRARY_PATH' ||
    !absolute(process.env.LD_LIBRARY_PATH ?? '') ||
    process.execArgv.length !== POLICY.length ||
    process.execArgv.some((value, index) => value !== POLICY[index])
  ) {
    throw new Error(`rootless ${label} has an invalid startup posture`)
  }
}

function childClose(
  child: ChildProcess,
): Promise<{ readonly code: number | null; readonly signal: string | null }> {
  return new Promise((resolve, reject) => {
    let failure: unknown
    child.on('error', (error) => {
      failure ??= error
    })
    child.once('close', (code, signal) => {
      if (failure === undefined) resolve({ code, signal })
      else reject(failure)
    })
  })
}

function withinTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function connected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
}

function beforeStartupDeadline<T>(
  promise: Promise<T>,
  deadlineUnixMs: number,
  control: Socket,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const remaining = deadlineUnixMs - Date.now()
    if (remaining <= 0) {
      control.destroy()
      reject(new Error('rootless supervisor start timed out'))
      return
    }
    const timer = setTimeout(() => {
      control.destroy()
      reject(new Error('rootless supervisor start timed out'))
    }, remaining)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function main(): Promise<void> {
  const [mode, ...arguments_] = process.argv.slice(2)
  if (mode === '--supervisor') {
    if (arguments_.length !== 2) throw new Error('invalid rootless supervisor arguments')
    return await supervisorMain(arguments_[0]!, arguments_[1]!)
  }
  if (mode === '--enter') return await enterMain(arguments_)
  if (
    ['--inner', '--inner-output', '--inner-output-project', '--inner-output-projected'].includes(
      mode ?? '',
    )
  ) {
    const privateProjection =
      mode === '--inner-output-project' || mode === '--inner-output-projected'
    const separator = privateProjection ? 3 : 1
    if (arguments_[separator] !== '--') throw new Error('invalid rootless inner separator')
    let payloadEnvironment: Readonly<Record<string, string>> | undefined
    if (privateProjection) {
      const decoded: unknown = JSON.parse(arguments_[1]!)
      if (!validEnvironment(decoded)) throw new Error('invalid inert payload environment')
      payloadEnvironment = decoded
      if (
        Object.keys(process.env).sort().join('\0') !==
          (mode === '--inner-output-project' ? 'LD_LIBRARY_PATH\0PWD' : 'LD_LIBRARY_PATH') ||
        (mode === '--inner-output-project' && process.env.PWD !== '/work') ||
        process.env.LD_LIBRARY_PATH !== SANDBOX_LIBRARY_PATH ||
        process.execArgv.length !== POLICY.length ||
        process.execArgv.some((value, index) => value !== POLICY[index])
      )
        throw new Error('private output launcher has an invalid startup posture')
    }
    let capturedInputs: { path: string; bytes: number; digest: string }[]
    try {
      capturedInputs = JSON.parse(arguments_[0]!)
    } catch {
      throw new Error('invalid rootless captured input identity')
    }
    if (
      !Array.isArray(capturedInputs) ||
      capturedInputs.length > 64 ||
      capturedInputs.some(
        (file) =>
          file === null ||
          typeof file !== 'object' ||
          Object.keys(file).sort().join(',') !== 'bytes,digest,path' ||
          typeof file.path !== 'string' ||
          !file.path.startsWith('/jig-input/') ||
          !Number.isSafeInteger(file.bytes) ||
          file.bytes < 0 ||
          typeof file.digest !== 'string' ||
          !DIGEST.test(file.digest),
      )
    )
      throw new Error('invalid rootless captured input identity')
    return await innerMain(
      arguments_.slice(separator + 1),
      mode !== '--inner',
      capturedInputs,
      mode === '--inner-output-project',
      mode === '--inner-output-projected',
      payloadEnvironment,
      privateProjection
        ? normalizePrivateProjectEvaluationWorkspace(JSON.parse(arguments_[2]!))
        : undefined,
    )
  }
  throw new Error('invalid rootless supervisor mode')
}

if (import.meta.main) {
  void main().catch((error) => {
    process.stderr.write(`jig rootless supervisor failed: ${errorText(error)}\n`)
    process.exitCode = 70
  })
}
