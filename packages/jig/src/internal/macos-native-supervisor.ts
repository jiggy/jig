import { connect, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { Transform } from 'node:stream'
import { privateMacosBefore, privateMacosControlChannel } from './macos-control-channel.js'
import { recordPrivateMacosOwner } from './macos-owner-state.js'
import { acquirePrivateMacosCoalition, privateMacosPeerIdentity } from './macos-process-controls.js'
import type { PrivateMacosSandboxFiles } from './macos-sandbox-profile.js'
import {
  type PrivateMacosScopeExecution,
  type PrivateMacosScopeLimits,
  type PrivateMacosScopeResult,
  preparePrivateMacosScope,
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
}

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
function startMessage(value: unknown): PrivateMacosGuardianStart {
  const record = object(
    value,
    'type,ownerDirectory,ownerToken,launcher,cwd,command,environment,files,limits,maxOutputBytes',
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
    (record.maxOutputBytes as number) > 64 * 1024 * 1024
  )
    throw new Error('invalid macOS guardian configuration')
  object(record.files, 'readOnlyFiles,readOnlyTrees,writableTrees,protectedRoots,network')
  object(
    record.limits,
    'memoryBytes,pids,cpuQuotaMicros,cpuPeriodMicros,deadlineUnixMs,cleanupTimeoutMs',
  )
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
  let stopped: 'cancelled' | 'coordinator_lost' | undefined
  let resolveAdmission: () => void = () => {}
  let rejectAdmission: (error: Error) => void = () => {}
  const admission = new Promise<void>((resolve, reject) => {
    resolveAdmission = resolve
    rejectAdmission = reject
  })
  void admission.catch(() => undefined)
  let phase: 'starting' | 'prepared' | 'preparing' | 'ready' | 'running' | 'terminal' = 'starting'
  const currentPhase = (): string => phase
  const stop = (reason: 'cancelled' | 'coordinator_lost') => {
    stopped ??= reason
    rejectAdmission(new Error('macOS guardian admission stopped'))
    execution?.stop(reason)
  }
  control.on('close', () => {
    if (phase !== 'terminal') stop('coordinator_lost')
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const configuration = startMessage(await privateMacosBefore(channel.receive(), 10_000))
    if (stopped !== undefined) throw new Error('macOS guardian coordinator lost during setup')
    recordPrivateMacosOwner(configuration.ownerDirectory, configuration.ownerToken, owner)
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
      Math.max(0, Math.min(10_000, configuration.limits.deadlineUnixMs - Date.now())),
    )
    const commands = (async () => {
      for (;;) {
        const next = object(await channel.receive(), 'type')
        if (next.type === 'cancel') stop('cancelled')
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
    for (const [source, destination] of [
      [execution.stdout, stdout],
      [execution.stderr, stderr],
    ] as const) {
      const bounded = new Transform({
        transform(bytes: Buffer, _encoding, callback) {
          if (outputBytes + bytes.length > configuration.maxOutputBytes) {
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
    phase = 'terminal'
    execution.stdout.destroy()
    execution.stderr.destroy()
    channel.send({ type: 'terminal', result, outputLost })
    await privateMacosBefore(new Promise<void>((resolve) => control.end(resolve)), 1000)
  } catch (error) {
    execution?.stop('coordinator_lost')
    let result: PrivateMacosScopeResult | undefined
    if (execution !== undefined) result = await execution.completion
    if (!owner.empty()) throw new Error('macOS guardian cleanup is unconfirmed')
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
