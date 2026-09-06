import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, readFileSync, readSync, statSync, writeSync } from 'node:fs'
import {
  link,
  mkdir,
  open,
  readFile,
  rmdir,
  stat,
  unlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { posix } from 'node:path'
import type { Readable, Writable } from 'node:stream'

const POLICY = Object.freeze(['--no-env-file', '--no-install', '--config=/dev/null'] as const)
const SANDBOX_BUN = '/jig-runtime/bun'
const SANDBOX_LIBRARY_PATH = '/jig-runtime/lib'
const MAX_CONTROL_BYTES = 64 * 1024
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
  readonly capturedInputs: readonly { readonly fd: number; readonly destination: string }[]
  readonly inputDirectories: readonly string[]
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

type StopReason = 'cancelled' | 'coordinator_lost' | 'deadline' | 'payload_exit' | 'setup_failed'

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
  let outputDirectory: FileHandle | undefined
  let resolveAdmission!: () => void
  let rejectAdmission!: (error: Error) => void
  const admission = new Promise<void>((resolve, reject) => {
    resolveAdmission = resolve
    rejectAdmission = reject
  })
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
      } else if (
        type === 'continue' &&
        configuration.output &&
        outputDirectory !== undefined &&
        !continued
      ) {
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
  const hardDeadlineUnixMs = limits.deadlineUnixMs + limits.cancellationGraceMs
  const deadline = setTimeout(() => stop('deadline'), Math.max(0, hardDeadlineUnixMs - Date.now()))

  let exitCode: number | null = null
  let exitSignal: string | null = null
  let evidence = emptyEvidence()
  let terminal: TerminalMessage | undefined
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
          configuration.output ? 'pipe' : 'ignore',
          configuration.output ? 'pipe' : 'ignore',
          ...configuration.capturedInputs.map((file) => file.fd),
        ],
      },
    )
    childExit = childClose(launched)
    child = launched
    const ready = await readReady(launched)
    if (configuration.output) {
      const sandboxPid = await readSandboxPid(launched)
      await outputReady(launched)
      // The trusted inner launcher blocks before package code can run.
      // This FD pins the mount, not a replaceable payload pathname.
      outputDirectory = await open(`/proc/${sandboxPid}/root/jig-output`, 0x10000)
    }
    safeSend(control, {
      type: 'ready',
      runCgroup,
      payloadPid: ready,
      supervisorPid: process.pid,
      ...(outputDirectory === undefined ? {} : { outputFd: outputDirectory.fd }),
    } satisfies ReadyMessage)
    const exit = await childExit
    exitCode = exit.code
    exitSignal = exit.signal
    stopReason ??= 'payload_exit'
  } catch (error) {
    stopReason ??= 'setup_failed'
    if (stopReason === 'setup_failed') process.stderr.write(`${errorText(error)}\n`)
  } finally {
    clearTimeout(deadline)
    await outputDirectory?.close()
    let cleanupError: string | undefined
    try {
      child?.kill('SIGKILL')
      await killRun()
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
  const output = bubblewrapArguments_.includes('--sync-fd')
  const inputDescriptors = bubblewrapArguments_.flatMap((arg, index) =>
    arg === '--ro-bind-data' ? [Number(bubblewrapArguments_[index + 1])] : [],
  )
  if (inputDescriptors.some((fd, index) => fd !== 6 + index))
    throw new Error('invalid captured input descriptor order')
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

async function innerMain(command: readonly string[], output = false): Promise<void> {
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
  if (output) {
    writeSync(4, Buffer.from([1]))
    const gate = Buffer.alloc(1)
    if (readSync(4, gate, 0, 1, null) !== 1 || gate[0] !== 1) {
      throw new Error('output ownership was not acquired')
    }
    closeSync(4)
  }
  const child = spawn(command[0]!, command.slice(1), {
    cwd: '/work',
    env: process.env,
    stdio: 'inherit',
  })
  const exit = await childClose(child)
  if (exit.signal !== null) process.kill(process.pid, exit.signal as NodeJS.Signals)
  process.exitCode = exit.code ?? 1
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
    result.push('--size', '1048576', '--tmpfs', '/jig-input')
  for (const path of configuration.inputDirectories) result.push('--dir', path)
  for (const file of configuration.capturedInputs)
    result.push('--ro-bind-data', String(file.fd), file.destination)
  if (configuration.inputDirectories.length > 0) result.push('--remount-ro', '/jig-input')
  if (configuration.output)
    result.push(
      '--size',
      String(16 * 1024 * 1024),
      '--tmpfs',
      '/jig-output',
      '--sync-fd',
      '4',
      '--json-status-fd',
      '5',
    )
  result.push('--ro-bind', configuration.supervisorPath, MODULE_DESTINATION)
  for (const [name, value] of Object.entries(configuration.environment).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
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
    '--',
    SANDBOX_BUN,
    ...POLICY,
    MODULE_DESTINATION,
    configuration.output ? '--inner-output' : '--inner',
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
    'limits',
    'inputDirectories',
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
  return configuration
}

function validLimits(value: unknown): value is Limits {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const limits = value as Record<string, unknown>
  const keys = [
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
    Number(limits.deadlineUnixMs) + Number(limits.cancellationGraceMs) - Date.now() <= 2_147_483_647
  )
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
  if (mode === '--inner' || mode === '--inner-output') {
    if (arguments_[0] !== '--') throw new Error('invalid rootless inner separator')
    return await innerMain(arguments_.slice(1), mode === '--inner-output')
  }
  throw new Error('invalid rootless supervisor mode')
}

if (import.meta.main) {
  void main().catch((error) => {
    process.stderr.write(`jig rootless supervisor failed: ${errorText(error)}\n`)
    process.exitCode = 70
  })
}
