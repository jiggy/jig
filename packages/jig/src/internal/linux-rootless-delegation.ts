import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants, realpathSync } from 'node:fs'
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises'
import { createServer, connect, type Server, type Socket } from 'node:net'
import { isAbsolute, posix } from 'node:path'
import { privateLinuxHostToolCandidates } from './linux-host-paths.js'

import {
  acquirePrivateRootlessLinux,
  PrivateRootlessLinuxAcquisitionError,
  type PrivateRootlessLinuxAcquisitionObservation,
} from './linux-rootless-acquisition.js'
import {
  PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS,
  PRIVATE_ROOTLESS_COMMAND_OVERHEAD_ALLOWANCE_MS,
} from './root-run-timeout-policy.js'

const CGROUP_ROOT = '/sys/fs/cgroup'
const CGROUP2_SUPER_MAGIC = 0x6367_7270n
const CHILD_NAME = 'jig'
const MANAGER_CANDIDATES = privateLinuxHostToolCandidates('systemd-run')
const CONTROL_CANDIDATES = privateLinuxHostToolCandidates('systemctl')
const REQUIRED_CONTROLLERS = Object.freeze(['cpu', 'memory', 'pids'] as const)
const UNIT = /^jig-[0-9a-f]{24}\.scope$/
const TOKEN = /^[0-9a-f]{64}$/
const READY_SOCKET = /^jig-rootless-acquisition-[0-9a-f]{32}$/
const SCOPE_VARIABLE = 'JIG_PRIVATE_ROOTLESS_SCOPE'
const SOCKET_VARIABLE = 'JIG_PRIVATE_ROOTLESS_READY_SOCKET'
const TOKEN_VARIABLE = 'JIG_PRIVATE_ROOTLESS_READY_TOKEN'
const READY_TIMEOUT_MS = 5_000
const STARTUP_TIMEOUT_MS = 5_000
const COMMAND_LIFETIME_MS = 5 * 60_000
const MAX_COMMAND_LIFETIME_MS =
  PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS + PRIVATE_ROOTLESS_COMMAND_OVERHEAD_ALLOWANCE_MS
const CONTROL_TIMEOUT_MS = 2_000
const CONTROL_OUTPUT_BYTES = 16 * 1024
const COLLECTION_TIMEOUT_MS = 2_000
const MAX_MOVE_ROUNDS = 32
const BUN_POLICY = Object.freeze(['--no-env-file', '--no-install', '--config=/dev/null'] as const)

interface PrivateFileInformation {
  readonly uid: number
  readonly mode: number
  isDirectory(): boolean
  isFile(): boolean
}

interface DelegationMarker {
  readonly unit: string
  readonly socketPath: string
  readonly token: string
}

export interface PrivateRootlessLinuxScopeDependencies {
  readonly uid: () => number | undefined
  readonly pid: () => number
  readonly readText: (path: string) => Promise<string>
  readonly listDirectories: (path: string) => Promise<readonly string[]>
  readonly information: (path: string) => Promise<PrivateFileInformation>
  readonly filesystemType: (path: string) => Promise<number | bigint>
  readonly resolve: (path: string) => Promise<string>
  readonly requireAccess: (path: string, mode: number) => Promise<void>
  readonly makeDirectory: (path: string) => Promise<void>
  readonly writeText: (path: string, value: string) => Promise<void>
}

/** Test seam only. This is not a public launcher or sandbox SPI. */
export interface PrivateRootlessLinuxDelegationDependencies {
  readonly acquire: () => Promise<PrivateRootlessLinuxAcquisitionObservation>
  readonly environment: () => NodeJS.ProcessEnv
  readonly currentCommand: () => readonly [string, ...string[]]
  readonly currentDirectory: () => string
  readonly nonce: (bytes: number) => string
  readonly resolveManager: () => Promise<string>
  readonly prepareScope: (unit: string) => Promise<void>
  readonly acknowledgeReady: (marker: DelegationMarker, delegatedCgroup: string) => Promise<void>
  readonly reexecute: (
    managerPath: string,
    unit: string,
    command: readonly [string, ...string[]],
    directory: string,
    environment: NodeJS.ProcessEnv,
    commandLifetimeMs: number,
  ) => Promise<PrivateRootlessLinuxReexecution>
}

export interface PrivateRootlessLinuxReady {
  readonly kind: 'private-rootless-linux-ready/1'
  readonly observation: PrivateRootlessLinuxAcquisitionObservation
}

export interface PrivateRootlessLinuxReexecution {
  readonly kind: 'private-rootless-linux-reexecuted/1'
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

export type PrivateRootlessLinuxDelegation =
  | PrivateRootlessLinuxReady
  | PrivateRootlessLinuxReexecution

/**
 * Continue inside an exact inherited delegation or run this exact command once
 * in one transient delegated user scope.
 *
 * A caller which receives `reexecuted` must terminate with that child outcome;
 * it must not continue the original command in the undelegated process.
 */
export async function acquireOrReexecutePrivateRootlessLinux(
  input: {
    readonly commandLifetimeMs?: number
    readonly dependencies?: PrivateRootlessLinuxDelegationDependencies
  } = {},
): Promise<PrivateRootlessLinuxDelegation> {
  const dependencies = input.dependencies ?? systemDependencies
  const commandLifetimeMs = input.commandLifetimeMs ?? COMMAND_LIFETIME_MS
  if (
    !Number.isSafeInteger(commandLifetimeMs) ||
    commandLifetimeMs < 100 ||
    commandLifetimeMs > MAX_COMMAND_LIFETIME_MS
  ) {
    throw new PrivateRootlessLinuxAcquisitionError()
  }
  try {
    const observation = await dependencies.acquire()
    return ready(observation)
  } catch {
    // A strict miss is the only reason to attempt the one fixed acquisition.
  }

  try {
    const environment = dependencies.environment()
    const marker = parseMarker(environment)
    if (marker !== undefined) {
      await dependencies.prepareScope(marker.unit)
      const observation = await dependencies.acquire()
      requirePreparedObservation(observation, marker.unit)
      await dependencies.acknowledgeReady(marker, observation.delegatedCgroup)
      delete environment[SCOPE_VARIABLE]
      delete environment[SOCKET_VARIABLE]
      delete environment[TOKEN_VARIABLE]
      return ready(observation)
    }

    const managerPath = await dependencies.resolveManager()
    const unit = `jig-${dependencies.nonce(12)}.scope`
    if (!UNIT.test(unit)) throw new Error('invalid transient scope identity')
    const command = requireCommand(dependencies.currentCommand())
    const directory = dependencies.currentDirectory()
    if (!isAbsolute(directory) || directory.includes('\0')) {
      throw new Error('invalid current directory')
    }
    return await dependencies.reexecute(
      managerPath,
      unit,
      command,
      directory,
      environment,
      commandLifetimeMs,
    )
  } catch {
    throw new PrivateRootlessLinuxAcquisitionError()
  }
}

/** Test seam for the small cgroup mutation performed inside the transient scope. */
export async function preparePrivateRootlessLinuxScope(
  unit: string,
  dependencies: PrivateRootlessLinuxScopeDependencies = scopeDependencies,
): Promise<void> {
  if (!UNIT.test(unit)) throw new Error('invalid transient scope identity')
  const uid = dependencies.uid()
  const pid = dependencies.pid()
  if (
    !Number.isSafeInteger(uid) ||
    uid === undefined ||
    uid <= 0 ||
    !Number.isSafeInteger(pid) ||
    pid <= 0
  ) {
    throw new Error('unprivileged process identity is unavailable')
  }
  if (BigInt(await dependencies.filesystemType(CGROUP_ROOT)) !== CGROUP2_SUPER_MAGIC) {
    throw new Error('unified cgroup v2 is unavailable')
  }

  const relative = parseCurrentCgroup(await dependencies.readText('/proc/self/cgroup'))
  const scope = `${CGROUP_ROOT}${relative}`
  if (
    posix.basename(scope) !== unit ||
    posix.dirname(scope) === CGROUP_ROOT ||
    (await dependencies.resolve(scope)) !== scope
  ) {
    throw new Error('the process is not in the requested transient scope')
  }
  const information = await dependencies.information(scope)
  if (!information.isDirectory() || information.uid !== uid) {
    throw new Error('the transient scope is not owned by the current user')
  }
  await dependencies.requireAccess(scope, constants.W_OK | constants.X_OK)
  await dependencies.requireAccess(`${scope}/cgroup.procs`, constants.R_OK | constants.W_OK)
  await dependencies.requireAccess(
    `${scope}/cgroup.subtree_control`,
    constants.R_OK | constants.W_OK,
  )
  await dependencies.requireAccess(`${scope}/cgroup.kill`, constants.W_OK)
  requireWords(await dependencies.readText(`${scope}/cgroup.controllers`), REQUIRED_CONTROLLERS)
  if ((await dependencies.listDirectories(scope)).length !== 0) {
    throw new Error('the transient scope already contains a child cgroup')
  }

  const child = `${scope}/${CHILD_NAME}`
  await dependencies.makeDirectory(child)
  let sawSelf = false
  for (let round = 0; round < MAX_MOVE_ROUNDS; round += 1) {
    const processes = parseProcesses(await dependencies.readText(`${scope}/cgroup.procs`))
    if (processes.length === 0) break
    if (round === 0) sawSelf = processes.includes(pid)
    const ordered = [
      ...processes.filter((candidate) => candidate !== pid),
      ...processes.filter((candidate) => candidate === pid),
    ]
    for (const processId of ordered) {
      await dependencies.writeText(`${child}/cgroup.procs`, `${processId}\n`)
    }
    if (round === MAX_MOVE_ROUNDS - 1) {
      throw new Error('the transient scope did not become empty')
    }
  }
  if (!sawSelf || (await dependencies.readText(`${scope}/cgroup.procs`)).trim() !== '') {
    throw new Error('the transient scope process set was not moved completely')
  }
  await dependencies.writeText(
    `${scope}/cgroup.subtree_control`,
    REQUIRED_CONTROLLERS.map((controller) => `+${controller}`).join(' ') + '\n',
  )
}

function ready(observation: PrivateRootlessLinuxAcquisitionObservation): PrivateRootlessLinuxReady {
  return Object.freeze({
    kind: 'private-rootless-linux-ready/1' as const,
    observation,
  })
}

function parseMarker(environment: NodeJS.ProcessEnv): DelegationMarker | undefined {
  const unit = environment[SCOPE_VARIABLE]
  const socketPath = environment[SOCKET_VARIABLE]
  const token = environment[TOKEN_VARIABLE]
  if (unit === undefined && socketPath === undefined && token === undefined) return undefined
  if (
    unit === undefined ||
    socketPath === undefined ||
    token === undefined ||
    !UNIT.test(unit) ||
    !TOKEN.test(token) ||
    !READY_SOCKET.test(socketPath)
  ) {
    throw new Error('invalid transient acquisition marker')
  }
  return Object.freeze({ unit, socketPath, token })
}

function requirePreparedObservation(
  observation: PrivateRootlessLinuxAcquisitionObservation,
  unit: string,
): void {
  const delegated = observation.delegatedCgroup
  if (
    !delegated.startsWith(`${CGROUP_ROOT}/`) ||
    posix.normalize(delegated) !== delegated ||
    posix.basename(delegated) !== unit ||
    observation.currentCgroup !== `${delegated}/${CHILD_NAME}`
  ) {
    throw new Error('strict acquisition did not observe the prepared scope')
  }
}

function requireCommand(command: readonly [string, ...string[]]): readonly [string, ...string[]] {
  if (
    command.length === 0 ||
    !isAbsolute(command[0]) ||
    command.some((value) => value.includes('\0'))
  ) {
    throw new Error('the current command is invalid')
  }
  return Object.freeze([...command]) as readonly [string, ...string[]]
}

function parseCurrentCgroup(input: string): string {
  const lines = input.split('\n').filter((line) => line !== '')
  if (lines.length !== 1 || !lines[0]!.startsWith('0::')) {
    throw new Error('the process is not in one unified cgroup')
  }
  const relative = lines[0]!.slice(3)
  if (
    !relative.startsWith('/') ||
    relative === '/' ||
    relative.endsWith('/') ||
    relative.includes('\0') ||
    relative.includes('\\') ||
    posix.normalize(relative) !== relative
  ) {
    throw new Error('the current cgroup path is invalid')
  }
  return relative
}

function parseProcesses(input: string): readonly number[] {
  const values = input.split('\n').filter((value) => value !== '')
  const result: number[] = []
  const seen = new Set<number>()
  for (const value of values) {
    if (!/^[1-9][0-9]*$/.test(value)) throw new Error('invalid cgroup process identifier')
    const processId = Number(value)
    if (!Number.isSafeInteger(processId) || seen.has(processId)) {
      throw new Error('invalid cgroup process set')
    }
    seen.add(processId)
    result.push(processId)
  }
  return Object.freeze(result)
}

function requireWords(input: string, expected: readonly string[]): void {
  const actual = new Set(
    input
      .trim()
      .split(/\s+/)
      .filter((value) => value !== ''),
  )
  for (const value of expected) {
    if (!actual.has(value)) throw new Error(`required cgroup controller is unavailable: ${value}`)
  }
}

async function resolveManager(): Promise<string> {
  for (const candidate of MANAGER_CANDIDATES) {
    try {
      const resolved = await realpath(candidate)
      const information = await stat(resolved)
      if (
        isAbsolute(resolved) &&
        information.isFile() &&
        (information.mode & 0o111) !== 0 &&
        (information.mode & 0o6000) === 0
      ) {
        return resolved
      }
    } catch {
      // The closed candidate list deliberately has no ambient fallback.
    }
  }
  throw new Error('the fixed user service manager client is unavailable')
}

/** Test seam only. Production reaches this through the closed startup path above. */
export async function reexecutePrivateRootlessLinuxCommand(
  managerPath: string,
  unit: string,
  command: readonly [string, ...string[]],
  directory: string,
  environment: NodeJS.ProcessEnv,
  startupTimeoutMs = STARTUP_TIMEOUT_MS,
  commandLifetimeMs = COMMAND_LIFETIME_MS,
): Promise<PrivateRootlessLinuxReexecution> {
  if (
    !UNIT.test(unit) ||
    !Number.isSafeInteger(startupTimeoutMs) ||
    startupTimeoutMs < 100 ||
    startupTimeoutMs > 60_000 ||
    !Number.isSafeInteger(commandLifetimeMs) ||
    commandLifetimeMs < 100 ||
    commandLifetimeMs > MAX_COMMAND_LIFETIME_MS
  ) {
    throw new Error('invalid transient scope timing policy')
  }
  const controlPath = await resolveControl()
  const socketPath = `jig-rootless-acquisition-${randomBytes(16).toString('hex')}`
  const token = randomBytes(32).toString('hex')
  const ready = readinessServer(socketPath, token)
  const lifetimeTimer = `${unit.slice(0, -'.scope'.length)}-lifetime`
  const controlEnvironment = { ...environment }
  let child: ReturnType<typeof spawn> | undefined
  let completion:
    | Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>
    | undefined
  let lifetimeTimerStarted = false
  let scopeSettled = false
  try {
    await ready.listening
    lifetimeTimerStarted = true
    await startLifetimeTimer(
      managerPath,
      controlPath,
      lifetimeTimer,
      unit,
      commandLifetimeMs,
      controlEnvironment,
    )
    const launched = spawn(
      managerPath,
      [
        '--user',
        '--scope',
        '--collect',
        '--quiet',
        '-p',
        'Delegate=yes',
        `--unit=${unit}`,
        '--',
        command[0],
        ...command.slice(1),
      ],
      {
        cwd: directory,
        env: {
          ...controlEnvironment,
          [SCOPE_VARIABLE]: unit,
          [SOCKET_VARIABLE]: socketPath,
          [TOKEN_VARIABLE]: token,
        },
        stdio: 'inherit',
        windowsHide: true,
      },
    )
    child = launched
    completion = childOutcome(launched)
    const startup = await waitForStartup(ready.acknowledged, completion, startupTimeoutMs)
    if (startup !== 'acknowledged') {
      throw new Error('the transient scope did not acknowledge acquisition')
    }
    const lifetime = await Promise.race([
      completion.then((outcome) => ({ kind: 'completed' as const, outcome })),
      ready.lifetimeEnded.then(() => ({ kind: 'lifetime-ended' as const })),
    ])
    let outcome: { readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }
    if (lifetime.kind === 'lifetime-ended') {
      await terminateTransientScope(controlPath, unit, controlEnvironment, launched, completion)
      outcome = await completion
    } else {
      outcome = lifetime.outcome
    }
    try {
      await requireUnitCollected(controlPath, unit, controlEnvironment, COLLECTION_TIMEOUT_MS)
    } catch (error) {
      await terminateTransientScope(controlPath, unit, controlEnvironment, launched, completion)
      throw error
    }
    scopeSettled = true
    await ready.close()
    await stopLifetimeTimer(controlPath, lifetimeTimer, controlEnvironment)
    lifetimeTimerStarted = false
    return Object.freeze({
      kind: 'private-rootless-linux-reexecuted/1' as const,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
    })
  } finally {
    try {
      await ready.close()
    } finally {
      try {
        if (child !== undefined && !scopeSettled) {
          await terminateTransientScope(controlPath, unit, controlEnvironment, child, completion)
        }
      } finally {
        child?.removeAllListeners()
        if (lifetimeTimerStarted) {
          await stopLifetimeTimer(controlPath, lifetimeTimer, controlEnvironment)
        }
      }
    }
  }
}

function waitForStartup(
  acknowledged: Promise<boolean>,
  completion: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>,
  timeoutMs: number,
): Promise<'acknowledged' | 'exited' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve('timeout')
    }, timeoutMs)
    const finish = (value: 'acknowledged' | 'exited'): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    void acknowledged.then((value) => {
      if (value) finish('acknowledged')
    })
    void completion.then(
      () => finish('exited'),
      () => finish('exited'),
    )
  })
}

async function resolveControl(): Promise<string> {
  for (const candidate of CONTROL_CANDIDATES) {
    try {
      const resolved = await realpath(candidate)
      const information = await stat(resolved)
      if (
        isAbsolute(resolved) &&
        information.isFile() &&
        (information.mode & 0o111) !== 0 &&
        (information.mode & 0o6000) === 0
      ) {
        return resolved
      }
    } catch {
      // The closed candidate list deliberately has no ambient fallback.
    }
  }
  throw new Error('the fixed user service manager control is unavailable')
}

async function startLifetimeTimer(
  managerPath: string,
  controlPath: string,
  lifetimeTimer: string,
  unit: string,
  delayMs: number,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await executeControl(
    managerPath,
    [
      '--user',
      '--collect',
      '--quiet',
      `--on-active=${delayMs}ms`,
      `--unit=${lifetimeTimer}`,
      '--timer-property=AccuracySec=1ms',
      '--timer-property=RandomizedDelaySec=0',
      '--',
      controlPath,
      '--user',
      '--wait',
      'kill',
      '--kill-whom=all',
      '--signal=KILL',
      unit,
    ],
    environment,
  )
  const timer = `${lifetimeTimer}.timer`
  const deadline = Date.now() + CONTROL_TIMEOUT_MS
  for (;;) {
    const state = await unitProperties(controlPath, timer, environment)
    if (state.loadState === 'loaded' && state.activeState === 'active') return
    if (Date.now() >= deadline) throw new Error('the transient lifetime timer was not retained')
    await delay(20)
  }
}

async function stopLifetimeTimer(
  controlPath: string,
  lifetimeTimer: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  for (const suffix of ['.timer', '.service'] as const) {
    await executeControl(
      controlPath,
      ['--user', 'stop', `${lifetimeTimer}${suffix}`],
      environment,
    ).catch(() => undefined)
  }
  await Promise.all([
    requireUnitCollected(controlPath, `${lifetimeTimer}.timer`, environment, CONTROL_TIMEOUT_MS),
    requireUnitCollected(controlPath, `${lifetimeTimer}.service`, environment, CONTROL_TIMEOUT_MS),
  ])
}

async function terminateTransientScope(
  controlPath: string,
  unit: string,
  environment: NodeJS.ProcessEnv,
  child?: ReturnType<typeof spawn>,
  completion?: Promise<{
    readonly exitCode: number | null
    readonly signal: NodeJS.Signals | null
  }>,
): Promise<void> {
  const controlGroup = await observeControlGroup(controlPath, unit, environment, 250)
  await killTransientScope(controlPath, unit, environment)
  if (child !== undefined && completion !== undefined && !(await childSettled(completion, 250))) {
    child.kill('SIGKILL')
    await settleChild(completion)
    // A manager request which crossed with wrapper termination may have
    // materialized the scope after the first kill request.
    await killTransientScope(controlPath, unit, environment)
  }
  await requireUnitCollected(controlPath, unit, environment, COLLECTION_TIMEOUT_MS)
  if (controlGroup !== undefined) await requirePathAbsent(controlGroup, COLLECTION_TIMEOUT_MS)
}

async function killTransientScope(
  controlPath: string,
  unit: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await executeControl(
    controlPath,
    ['--user', '--wait', 'kill', '--kill-whom=all', '--signal=KILL', unit],
    environment,
  ).catch(() => undefined)
}

async function observeControlGroup(
  controlPath: string,
  unit: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const state = await unitProperties(controlPath, unit, environment)
    if (state.controlGroup !== '') {
      const relative = state.controlGroup
      if (
        !relative.startsWith('/') ||
        relative.endsWith('/') ||
        relative.includes('\0') ||
        relative.includes('\\') ||
        posix.normalize(relative) !== relative ||
        posix.basename(relative) !== unit
      ) {
        throw new Error('the user manager returned an invalid transient scope path')
      }
      const path = `${CGROUP_ROOT}${relative}`
      if ((await realpath(path)) !== path)
        throw new Error('the transient scope path is not canonical')
      return path
    }
    if (state.loadState === 'not-found' && Date.now() >= deadline) return undefined
    if (Date.now() >= deadline) return undefined
    await delay(20)
  }
}

async function requireUnitCollected(
  controlPath: string,
  unit: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const state = await unitProperties(controlPath, unit, environment)
    if (state.loadState === 'not-found') return
    if (Date.now() >= deadline)
      throw new Error(`transient user-manager unit was not collected: ${unit}`)
    await delay(20)
  }
}

async function requirePathAbsent(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await stat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (Date.now() >= deadline) throw new Error('the transient scope cgroup was not collected')
    await delay(20)
  }
}

async function unitProperties(
  controlPath: string,
  unit: string,
  environment: NodeJS.ProcessEnv,
): Promise<{
  readonly loadState: string
  readonly activeState: string
  readonly controlGroup: string
}> {
  const result = await executeControl(
    controlPath,
    ['--user', 'show', '--property=LoadState,ActiveState,ControlGroup', unit],
    environment,
  )
  const properties = new Map<string, string>()
  for (const line of result.stdout.trim().split('\n')) {
    const separator = line.indexOf('=')
    if (separator > 0) properties.set(line.slice(0, separator), line.slice(separator + 1))
  }
  const loadState = properties.get('LoadState')
  const activeState = properties.get('ActiveState')
  const controlGroup = properties.get('ControlGroup') ?? ''
  if (loadState === undefined || activeState === undefined) {
    throw new Error('the user manager returned an invalid unit observation')
  }
  return { loadState, activeState, controlGroup }
}

function executeControl(
  path: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      path,
      [...arguments_],
      {
        cwd: '/',
        env: environment,
        encoding: 'utf8',
        maxBuffer: CONTROL_OUTPUT_BYTES,
        timeout: CONTROL_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

async function settleChild(
  completion: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>,
): Promise<void> {
  await Promise.race([
    completion.then(
      () => undefined,
      () => undefined,
    ),
    delay(COLLECTION_TIMEOUT_MS).then(() => {
      throw new Error('the scope manager process did not settle')
    }),
  ])
}

async function childSettled(
  completion: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>,
  timeoutMs: number,
): Promise<boolean> {
  return await Promise.race([
    completion.then(
      () => true,
      () => true,
    ),
    delay(timeoutMs).then(() => false),
  ])
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function readinessServer(
  socketPath: string,
  token: string,
): {
  readonly listening: Promise<Server>
  readonly acknowledged: Promise<boolean>
  readonly lifetimeEnded: Promise<void>
  readonly close: () => Promise<void>
} {
  let resolveAcknowledged!: (value: boolean) => void
  let resolveLifetimeEnded!: () => void
  let settled = false
  let lifetimeSettled = false
  let lifetimeSocket: Socket | undefined
  const acknowledged = new Promise<boolean>((resolve) => {
    resolveAcknowledged = resolve
  })
  const lifetimeEnded = new Promise<void>((resolve) => {
    resolveLifetimeEnded = resolve
  })
  const server = createServer((socket) => {
    let input = ''
    socket.setEncoding('utf8')
    socket.on('error', () => {
      // Close is the lifetime signal; diagnostics stay private.
    })
    socket.on('data', (chunk) => {
      if (lifetimeSocket === socket) return socket.destroy()
      input += chunk
      if (input === `${token}\n` && !settled) {
        settled = true
        lifetimeSocket = socket
        resolveAcknowledged(true)
        socket.write('ready\n')
      } else if (Buffer.byteLength(input) >= 65) {
        socket.destroy()
      }
    })
    socket.on('close', () => {
      if (lifetimeSocket === socket && !lifetimeSettled) {
        lifetimeSettled = true
        resolveLifetimeEnded()
      }
    })
  })
  const listening = new Promise<Server>((resolve, reject) => {
    server.once('error', reject)
    server.listen(`\0${socketPath}`, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
  return {
    listening,
    acknowledged,
    lifetimeEnded,
    close: async () => {
      if (!settled) {
        settled = true
        resolveAcknowledged(false)
      }
      lifetimeSocket?.destroy()
      if (!lifetimeSettled) {
        lifetimeSettled = true
        resolveLifetimeEnded()
      }
      await closeServer(server)
    },
  }
}

const retainedLifetimeSockets = new Set<Socket>()

async function acknowledgeReady(marker: DelegationMarker, delegatedCgroup: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect(`\0${marker.socketPath}`)
    let input = ''
    let acknowledged = false
    const timeout = setTimeout(
      () => socket.destroy(new Error('rootless acquisition acknowledgement timed out')),
      READY_TIMEOUT_MS,
    )
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(`${marker.token}\n`))
    socket.on('data', (chunk) => {
      input += chunk
      if (input === 'ready\n' && !acknowledged) {
        acknowledged = true
        clearTimeout(timeout)
        retainedLifetimeSockets.add(socket)
        socket.unref()
        resolve()
      } else if (Buffer.byteLength(input) >= 7) {
        socket.destroy(new Error('invalid rootless acquisition acknowledgement'))
      }
    })
    socket.once('error', (error) => {
      if (!acknowledged) reject(error)
    })
    socket.once('close', () => {
      clearTimeout(timeout)
      retainedLifetimeSockets.delete(socket)
      if (!acknowledged) {
        reject(new Error('rootless acquisition lifetime closed before acknowledgement'))
        return
      }
      void writeFile(`${delegatedCgroup}/cgroup.kill`, '1\n').catch(() => undefined)
    })
  })
}

function childOutcome(child: ReturnType<typeof spawn>): Promise<{
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
  })
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  })
}

const scopeDependencies: PrivateRootlessLinuxScopeDependencies = Object.freeze({
  uid: () => process.getuid?.(),
  pid: () => process.pid,
  readText: (path: string) => readFile(path, 'utf8'),
  listDirectories: async (path: string) =>
    (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  information: (path: string) => stat(path),
  filesystemType: async (path: string) => (await statfs(path)).type,
  resolve: (path: string) => realpath(path),
  requireAccess: (path: string, mode: number) => access(path, mode),
  makeDirectory: (path: string) => mkdir(path, { mode: 0o755 }),
  writeText: (path: string, value: string) => writeFile(path, value),
})

const systemDependencies: PrivateRootlessLinuxDelegationDependencies = Object.freeze({
  acquire: () => acquirePrivateRootlessLinux(),
  environment: () => process.env,
  currentCommand: currentCommand,
  currentDirectory: () => process.cwd(),
  nonce: (bytes: number) => randomBytes(bytes).toString('hex'),
  resolveManager,
  prepareScope: (unit: string) => preparePrivateRootlessLinuxScope(unit),
  acknowledgeReady,
  reexecute: (
    managerPath: string,
    unit: string,
    command: readonly [string, ...string[]],
    directory: string,
    environment: NodeJS.ProcessEnv,
    commandLifetimeMs: number,
  ) =>
    reexecutePrivateRootlessLinuxCommand(
      managerPath,
      unit,
      command,
      directory,
      environment,
      STARTUP_TIMEOUT_MS,
      commandLifetimeMs,
    ),
})

function currentCommand(): [string, ...string[]] {
  if (
    process.argv[0] === process.execPath &&
    process.argv[1]?.endsWith('/libexec/installed-cli.js') &&
    isAbsolute(process.argv[1]) &&
    realpathSync(process.argv[1]) === process.argv[1] &&
    realpathSync(process.execPath) === process.execPath &&
    process.execArgv.length === BUN_POLICY.length &&
    process.execArgv.every((value, index) => value === BUN_POLICY[index])
  ) {
    return [process.execPath, ...BUN_POLICY, ...process.argv.slice(1)]
  }
  throw new Error('the installed Jig command cannot be reexecuted exactly')
}
