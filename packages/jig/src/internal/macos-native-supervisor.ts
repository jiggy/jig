import type { FileHandle } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { privateMacosBefore, privateMacosControlChannel } from './macos-control-channel.js'
import {
  createPrivateMacosDescriptorReceiver,
  type PrivateMacosReceivedDescriptors,
  sendPrivateMacosDescriptors,
} from './macos-descriptor-handoff.js'
import {
  type PrivateMacosGuardianStorage,
  preparePrivateMacosGuardianStorage,
  recoverPrivateMacosGuardianStorage,
  requirePrivateMacosGuardianStorage,
} from './macos-guardian-storage.js'
import {
  normalizePrivateMacosInputs,
  type PrivateMacosInputIdentity,
  projectPrivateMacosInputs,
} from './macos-input-projection.js'
import { PRIVATE_MACOS_MAX_OUTPUT_BYTES } from './macos-output-policy.js'
import {
  privateMacosStorageRecoveryToken,
  recordPrivateMacosOwner,
  requirePrivateMacosOwnerDirectory,
} from './macos-owner-state.js'
import { acquirePrivateMacosCoalition, privateMacosPeerIdentity } from './macos-process-controls.js'
import type { PrivateMacosSandboxFiles } from './macos-sandbox-profile.js'
import {
  type PrivateMacosScopeExecution,
  type PrivateMacosScopeLimits,
  type PrivateMacosScopeResult,
  preparePrivateMacosScope,
  requirePrivateMacosScopeLimits,
} from './macos-scope-execution.js'

const POLICY = ['--no-env-file', '--no-install', '--config=/dev/null']
export interface PrivateMacosGuardianStart {
  readonly type: 'start'
  readonly ownerDirectory: string
  readonly ownerToken: string
  readonly launcher: string
  readonly cwd: string
  readonly command: readonly [string, ...string[]]
  readonly environment: Readonly<Record<string, string>>
  readonly files: PrivateMacosSandboxFiles
  readonly limits: PrivateMacosScopeLimits
  readonly maxOutputBytes: number
  readonly storage?: PrivateMacosGuardianStorage
  readonly inputs?: readonly PrivateMacosInputIdentity[]
}
export interface PrivateMacosGuardianRecovery {
  readonly type: 'recover-storage'
  readonly ownerDirectory: string
  readonly ownerToken: string
  readonly targetDirectory: string
  readonly targetToken: string
  readonly deadlineUnixMs: number
}
export type PrivateMacosGuardianConfiguration =
  | PrivateMacosGuardianStart
  | PrivateMacosGuardianRecovery

function object(value: unknown, keys: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== keys.split(',').sort().join()
  )
    throw new Error('invalid macOS guardian message')
  return value as Record<string, unknown>
}
function startMessage(value: unknown): PrivateMacosGuardianConfiguration {
  if ((value as { type?: unknown })?.type === 'recover-storage') {
    const record = object(
      value,
      'type,ownerDirectory,ownerToken,targetDirectory,targetToken,deadlineUnixMs',
    )
    if (
      typeof record.ownerDirectory !== 'string' ||
      typeof record.ownerToken !== 'string' ||
      typeof record.targetDirectory !== 'string' ||
      typeof record.targetToken !== 'string' ||
      record.ownerDirectory !== join(record.targetDirectory, 'recovery') ||
      record.ownerToken !== privateMacosStorageRecoveryToken(record.targetToken) ||
      !Number.isSafeInteger(record.deadlineUnixMs) ||
      (record.deadlineUnixMs as number) <= Date.now() ||
      (record.deadlineUnixMs as number) > Date.now() + 30_000
    )
      throw new Error('invalid macOS storage recovery configuration')
    requirePrivateMacosOwnerDirectory(record.targetDirectory)
    return record as unknown as PrivateMacosGuardianRecovery
  }
  const record = object(
    value,
    `type,ownerDirectory,ownerToken,launcher,cwd,command,environment,files,limits,maxOutputBytes${[
      'storage',
      'inputs',
    ]
      .filter((key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key))
      .map((key) => `,${key}`)
      .join('')}`,
  )
  if (
    record.type !== 'start' ||
    typeof record.ownerDirectory !== 'string' ||
    !record.ownerDirectory.startsWith('/') ||
    typeof record.ownerToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.ownerToken) ||
    typeof record.launcher !== 'string' ||
    typeof record.cwd !== 'string' ||
    !Array.isArray(record.command) ||
    record.environment === null ||
    typeof record.environment !== 'object' ||
    Array.isArray(record.environment) ||
    !Number.isSafeInteger(record.maxOutputBytes) ||
    (record.maxOutputBytes as number) < 1 ||
    (record.maxOutputBytes as number) > PRIVATE_MACOS_MAX_OUTPUT_BYTES
  )
    throw new Error('invalid macOS guardian configuration')
  object(record.files, 'readOnlyFiles,readOnlyTrees,writableTrees,protectedRoots,network')
  object(
    record.limits,
    'memoryBytes,pids,cpuQuotaMicros,cpuPeriodMicros,deadlineUnixMs,cleanupTimeoutMs',
  )
  requirePrivateMacosScopeLimits(record.limits as PrivateMacosScopeLimits)
  if (record.storage !== undefined)
    requirePrivateMacosGuardianStorage(
      record.storage as PrivateMacosGuardianStorage,
      record.files as unknown as PrivateMacosSandboxFiles,
      record.cwd,
    )
  if (record.inputs !== undefined) {
    normalizePrivateMacosInputs(record.inputs)
    if (
      record.storage === undefined ||
      !(record.files as unknown as PrivateMacosSandboxFiles).readOnlyTrees.includes(
        join((record.storage as PrivateMacosGuardianStorage).mountPath, 'inputs'),
      )
    )
      throw new Error('macOS inputs require an immutable bounded projection')
  }
  // preparePrivateMacosScope independently validates every executable grant and limit.
  return record as unknown as PrivateMacosGuardianStart
}

async function connected(path: string, pid: number, version: number): Promise<Socket> {
  const socket = connect(path)
  socket.on('error', () => undefined)
  try {
    await privateMacosBefore(
      new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('error', reject)
      }),
      10_000,
    )
    const peer = privateMacosPeerIdentity(socket)
    if (
      peer.uid !== process.getuid?.() ||
      peer.realUid !== peer.uid ||
      peer.pid !== pid ||
      peer.version !== version
    )
      throw new Error('macOS coordinator identity does not match')
    return socket
  } catch (error) {
    socket.destroy()
    throw error
  }
}

async function supervise(
  path: string,
  coordinatorPid: number,
  coordinatorVersion: number,
): Promise<void> {
  const owner = acquirePrivateMacosCoalition()
  const control = await connected(path, coordinatorPid, coordinatorVersion)
  const channel = privateMacosControlChannel(control)
  const streams: Socket[] = []
  let execution: PrivateMacosScopeExecution | undefined
  let collector: FileHandle | undefined
  let storageRoot: FileHandle | undefined
  let inputReceiver: Awaited<ReturnType<typeof createPrivateMacosDescriptorReceiver>> | undefined
  let inputBundle: PrivateMacosReceivedDescriptors | undefined
  let configuration: PrivateMacosGuardianConfiguration | undefined
  const cancellation = new AbortController()
  let releaseCollection: () => void = () => {}
  const collection = new Promise<void>((resolve) => {
    releaseCollection = resolve
  })
  let stopped: 'cancelled' | 'coordinator_lost' | undefined
  let resolveAdmission: () => void = () => {}
  let rejectAdmission: (error: Error) => void = () => {}
  const admission = new Promise<void>((resolve, reject) => {
    resolveAdmission = resolve
    rejectAdmission = reject
  })
  void admission.catch(() => undefined)
  let phase:
    | 'starting'
    | 'prepared'
    | 'preparing'
    | 'ready'
    | 'running'
    | 'collecting'
    | 'terminal' = 'starting'
  const currentPhase = (): string => phase
  const stop = (reason: 'cancelled' | 'coordinator_lost') => {
    stopped ??= reason
    cancellation.abort()
    releaseCollection()
    rejectAdmission(new Error('macOS guardian admission stopped'))
    execution?.stop(reason)
  }
  control.on('close', () => {
    if (phase !== 'terminal') stop('coordinator_lost')
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    configuration = startMessage(await privateMacosBefore(channel.receive(), 10_000))
    if (stopped !== undefined) throw new Error('macOS guardian coordinator lost during setup')
    recordPrivateMacosOwner(configuration.ownerDirectory, configuration.ownerToken, owner)
    if (configuration.type === 'start' && (configuration.inputs?.length ?? 0) > 0)
      inputReceiver = await createPrivateMacosDescriptorReceiver(dirname(path), 'inputs')
    for (const suffix of ['.in', '.out', '.err']) {
      const stream = await connected(`${path}${suffix}`, coordinatorPid, coordinatorVersion)
      stream.on('error', () => stop('coordinator_lost'))
      streams.push(stream)
    }
    const [stdin, stdout, stderr] = streams as [Socket, Socket, Socket]
    // No child exists before the authenticated journal and explicit admission.
    phase = 'prepared'
    channel.send({ type: 'prepared', identity: owner.identity })
    timer = setTimeout(
      () => stop('cancelled'),
      Math.max(
        0,
        Math.min(
          10_000,
          (configuration.type === 'start'
            ? configuration.limits.deadlineUnixMs
            : configuration.deadlineUnixMs) - Date.now(),
        ),
      ),
    )
    const commands = (async () => {
      for (;;) {
        const next = object(await channel.receive(), 'type')
        if (next.type === 'cancel') stop('cancelled')
        else if (next.type === 'release' && currentPhase() === 'collecting') releaseCollection()
        else if (next.type === 'admit' && phase === 'prepared' && stopped === undefined) {
          phase = 'preparing'
          resolveAdmission()
        } else if (
          next.type === 'continue' &&
          currentPhase() === 'ready' &&
          stopped === undefined
        ) {
          execution?.admit()
          phase = 'running'
        } else throw new Error('invalid macOS guardian transition')
      }
    })()
    void commands.catch(() => stop('coordinator_lost'))
    await admission
    if (stopped !== undefined) throw new Error('macOS guardian stopped before preparation')
    if (configuration.type === 'recover-storage') {
      clearTimeout(timer)
      timer = setTimeout(
        () => stop('cancelled'),
        Math.max(0, configuration.deadlineUnixMs - Date.now()),
      )
      await recoverPrivateMacosGuardianStorage(
        configuration.targetDirectory,
        configuration.targetToken,
        cancellation.signal,
      )
      if (!owner.empty()) throw new Error('macOS recovery tools are not fenced')
      phase = 'terminal'
      stdin.destroy()
      stdout.end()
      stderr.end()
      channel.send({ type: 'terminal', result: null, outputLost: false })
      await privateMacosBefore(new Promise<void>((resolve) => control.end(resolve)), 1000)
      return
    }
    if (inputReceiver !== undefined) {
      inputBundle = await inputReceiver.receive(
        { pid: coordinatorPid, version: coordinatorVersion },
        5000,
        cancellation.signal,
      )
      await inputReceiver.close()
    }
    if (configuration.storage !== undefined) {
      const storage = await preparePrivateMacosGuardianStorage(
        configuration.ownerDirectory,
        configuration.ownerToken,
        configuration.storage,
        cancellation.signal,
      )
      collector = storage.collector
      storageRoot = storage.directory
    }
    if (inputBundle !== undefined) {
      await projectPrivateMacosInputs(
        storageRoot!,
        configuration.inputs!,
        inputBundle,
        cancellation.signal,
      )
      inputBundle.close()
      inputBundle = undefined
    }
    await storageRoot?.close()
    storageRoot = undefined
    cancellation.signal.throwIfAborted()
    execution = await preparePrivateMacosScope({
      ...configuration,
      owner,
      files: {
        ...configuration.files,
        protectedRoots: [
          ...configuration.files.protectedRoots,
          configuration.ownerDirectory,
          dirname(path),
        ],
      },
    })
    clearTimeout(timer)
    if (stopped !== undefined) execution.stop(stopped)
    let outputBytes = 0
    let outputLost = false
    const maxOutputBytes = configuration.maxOutputBytes
    for (const [source, destination] of [
      [execution.stdout, stdout],
      [execution.stderr, stderr],
    ] as const) {
      const bounded = new Transform({
        transform(bytes: Buffer, _encoding, callback) {
          if (outputBytes + bytes.length > maxOutputBytes) {
            callback(new Error('macOS payload output exceeded its limit'))
            return
          }
          outputBytes += bytes.length
          callback(null, bytes)
        },
      })
      bounded.on('error', () => {
        outputLost = true
        stop('cancelled')
        source.unpipe(bounded)
        source.pause()
        destination.end()
      })
      source.pipe(bounded).pipe(destination)
      destination.on('close', () => {
        if (!destination.writableFinished && phase !== 'terminal') {
          outputLost = true
          stop('coordinator_lost')
        }
      })
    }
    stdin.pipe(execution.stdin)
    phase = 'ready'
    channel.send({ type: 'ready', pid: execution.pid, version: execution.version })
    const result = await execution.completion
    stdin.destroy()
    for (const destination of [stdout, stderr]) {
      if (!destination.writableFinished) {
        try {
          await privateMacosBefore(
            new Promise<void>((resolve, reject) => {
              destination.once('finish', resolve)
              destination.once('error', reject)
              destination.once('close', () =>
                reject(new Error('macOS output closed before delivery')),
              )
            }),
            1000,
          )
        } catch {
          outputLost = true
          destination.destroy()
        }
      }
    }
    execution.stdout.destroy()
    execution.stderr.destroy()
    if (configuration.storage !== undefined) {
      phase = 'collecting'
      const collect =
        collector !== undefined &&
        stopped === undefined &&
        !outputLost &&
        result.reason === 'payload_exit' &&
        result.exitCode === 0
      channel.send({ type: 'fenced', result, outputLost, collect })
      if (collect) {
        await sendPrivateMacosDescriptors(
          join(dirname(path), 'fd-output'),
          { pid: coordinatorPid, version: coordinatorVersion },
          [collector!.fd],
          5000,
          cancellation.signal,
        )
        // Client owns a shorter collection deadline and closes its duplicate
        // before release. This bound also settles an unresponsive coordinator.
        await privateMacosBefore(collection, 21_000)
      }
      await collector?.close()
      collector = undefined
      await recoverPrivateMacosGuardianStorage(
        configuration.ownerDirectory,
        configuration.ownerToken,
        AbortSignal.timeout(30_000),
      )
      if (stopped !== undefined) outputLost = true
    }
    phase = 'terminal'
    channel.send({ type: 'terminal', result, outputLost })
    await privateMacosBefore(new Promise<void>((resolve) => control.end(resolve)), 1000)
  } catch (error) {
    cancellation.abort()
    execution?.stop('coordinator_lost')
    let result: PrivateMacosScopeResult | undefined
    if (execution !== undefined) result = await execution.completion
    // Setup tools are descendants too, including interrupted image creation.
    const cleanupBy =
      performance.now() +
      (configuration?.type === 'start' ? configuration.limits.cleanupTimeoutMs : 5000)
    while (!owner.empty()) {
      owner.signalMembers('kill')
      if (performance.now() >= cleanupBy) throw new Error('macOS guardian cleanup is unconfirmed')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (!owner.empty()) throw new Error('macOS guardian cleanup is unconfirmed')
    await storageRoot?.close()
    storageRoot = undefined
    await collector?.close()
    collector = undefined
    if (configuration?.type === 'start' && configuration.storage !== undefined)
      await recoverPrivateMacosGuardianStorage(
        configuration.ownerDirectory,
        configuration.ownerToken,
        AbortSignal.timeout(30_000),
      )
    phase = 'terminal'
    try {
      channel.send({ type: 'terminal', result: result ?? null, outputLost: true })
      await privateMacosBefore(new Promise<void>((resolve) => control.end(resolve)), 1000)
    } catch {
      /* Recovery authenticates the retained journal when the coordinator is lost. */
    }
    if (stopped === undefined) throw error
  } finally {
    clearTimeout(timer)
    inputBundle?.close()
    await inputReceiver?.close()
    await storageRoot?.close()
    await collector?.close()
    for (const socket of streams) socket.destroy()
    channel.close()
  }
}

if (import.meta.main) {
  void (async () => {
    const [mode, path, pid, version, extra] = process.argv.slice(2)
    if (
      mode !== '--guardian' ||
      path === undefined ||
      !path.startsWith('/') ||
      Buffer.byteLength(path) > 98 ||
      !/^[1-9][0-9]*$/.test(pid ?? '') ||
      !/^[0-9]+$/.test(version ?? '') ||
      extra !== undefined ||
      process.cwd() !== '/' ||
      Object.keys(process.env).length !== 0 ||
      process.execArgv.join('\0') !== POLICY.join('\0')
    )
      throw new Error('invalid macOS guardian startup posture')
    await supervise(path, Number(pid), Number(version))
  })().catch(() => {
    process.exitCode = 70
  })
}
