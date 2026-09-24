import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, fstatSync } from 'node:fs'
import { type FileHandle, open } from 'node:fs/promises'
import { connect, createServer, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { privateCliStderrDiagnostic } from '../cli-presentation.js'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import { requirePrivateCapturedOutput } from './captured-output.js'
import {
  type PrivateDeliveryConnection,
  type PrivateDeliveryReceipt,
  PrivateFileDeliveryOwner,
} from './file-delivery.js'
import { privateOpenFileRoot } from './file-input.js'
import { sendPrivateMacosDescriptors } from './macos-descriptor-handoff.js'
import { createPrivateMacosFileCommand, requirePrivateMacosFilePeer } from './macos-file-command.js'
import {
  PrivateCheckpointRejected,
  PrivateRunCheckpoints,
  type RunCheckpointIdentity,
} from './private-run-checkpoint.js'

const MARKER = 'JIG_PRIVATE_FILE_OWNER'
const RECOVERY = 'JIG_PRIVATE_FILE_RECOVERY'
export interface PrivateFileRecovery {
  readonly project: string
  readonly device: string
  readonly inode: string
  readonly epoch: number
  readonly runId: string
}
export function privateFileRecovery(): PrivateFileRecovery | undefined {
  const text = process.env[RECOVERY]
  if (text === undefined) return undefined
  const value = JSON.parse(text) as PrivateFileRecovery
  if (
    !value.project?.startsWith('/') ||
    !/^sha256:[a-f0-9]{64}$/.test(value.runId) ||
    !/^\d+$/.test(value.device) ||
    !/^\d+$/.test(value.inode) ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 1
  )
    throw new Error('invalid recovery identity')
  return value
}
const MAX_BYTES = 16 * 1024 * 1024
export const PRIVATE_FILE_COMMAND_STOP_GRACE_MS = 250
export const PRIVATE_FILE_COMMAND_SETTLEMENT_MS = 60_000
type Marker =
  | { readonly platform: 'linux'; readonly socket: string; readonly token: string }
  | {
      readonly platform: 'darwin'
      readonly socket: string
      readonly token: string
      readonly peer: { readonly pid: number; readonly version: number }
    }
function marker(): Marker | undefined {
  const text = process.env[MARKER]
  if (text === undefined) return undefined
  if (text.length > 1024) throw new Error('invalid file-command owner')
  const value = JSON.parse(text) as Marker
  if (
    value === null ||
    typeof value !== 'object' ||
    !/^[a-f0-9]{64}$/.test(value.token) ||
    value.platform !== process.platform
  )
    throw new Error('invalid file-command owner')
  if (value.platform === 'linux') {
    if (
      Object.keys(value).sort().join() !== 'platform,socket,token' ||
      !/^jig-file-owner-[a-f0-9]{32}$/.test(value.socket)
    )
      throw new Error('invalid file-command owner')
  } else if (
    value.platform !== 'darwin' ||
    Object.keys(value).sort().join() !== 'peer,platform,socket,token' ||
    !/^\/private\/tmp\/jig-file-owner-[a-zA-Z0-9]+\/control$/.test(value.socket) ||
    value.peer === null ||
    typeof value.peer !== 'object' ||
    Object.keys(value.peer).sort().join() !== 'pid,version' ||
    !Number.isSafeInteger(value.peer.pid) ||
    value.peer.pid < 1 ||
    !Number.isSafeInteger(value.peer.version) ||
    value.peer.version < 1
  )
    throw new Error('invalid file-command owner')
  return value
}
const address = (marker: Marker) =>
  marker.platform === 'linux' ? `\0${marker.socket}` : marker.socket
export function privateNeedsFileOwner(arguments_: readonly string[]): boolean {
  return arguments_[0] === 'run' && arguments_.includes('--out') && marker() === undefined
}

/** Stay outside the delegated execution scope and own only delivery resources. */
export async function privateOwnFileCommand(
  command: readonly string[],
  arguments_: readonly string[],
  signal: AbortSignal | undefined,
  lifetimeMs: number,
  onStaged?: () => Promise<void>,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  if (!['linux', 'darwin'].includes(process.platform))
    throw new Error('no native file-command host')
  const native = process.platform === 'darwin' ? await createPrivateMacosFileCommand() : undefined
  const token = randomBytes(32).toString('hex')
  const selected: Marker =
    native === undefined
      ? { platform: 'linux', socket: `jig-file-owner-${randomBytes(16).toString('hex')}`, token }
      : {
          platform: 'darwin',
          socket: native.socket,
          token,
          peer: { pid: native.peer.pid, version: native.peer.version },
        }
  let childPid: number | undefined
  const cancellation = new AbortController()
  const coordinatorLost = new AbortController()
  const owner = new PrivateFileDeliveryOwner(cancellation.signal, onStaged)
  let publication: Promise<void> | undefined
  let task: Promise<void> | undefined, connection: Socket | undefined
  let cleanupFailed = false
  let prepared = false
  let recoveryFailed = false
  let checkpoints: PrivateRunCheckpoints | undefined
  let recovery: PrivateFileRecovery | undefined
  let projectFd: number | undefined
  const server = createServer((socket) => {
    if (connection !== undefined) {
      socket.destroy()
      return
    }
    let peer: { readonly pid: number; readonly version: number } | undefined
    try {
      if (native !== undefined) {
        if (childPid === undefined) throw new Error('native file coordinator is unavailable')
        peer = requirePrivateMacosFilePeer(socket, { pid: childPid })
      }
    } catch {
      socket.destroy()
      return
    }
    connection = socket
    const lost = () => {
      coordinatorLost.abort()
      cancellation.abort()
    }
    socket.once('close', lost)
    socket.on('error', lost)
    task = (async () => {
      for await (const value of messages(socket)) {
        const request = value as Record<string, JsonValue>
        if (request.token !== selected.token) throw new Error('file owner authentication failed')
        try {
          if (request.type === 'prepare') {
            if (typeof request.destination !== 'string')
              throw new Error('invalid delivery preparation')
            if (native !== undefined) {
              if (Object.hasOwn(request, 'pid') || Object.hasOwn(request, 'roots'))
                throw new Error('native input authority must be transferred')
              await native.roots(
                peer!,
                request.rootCount as number,
                coordinatorLost.signal,
                (roots) => owner.prepare(request.destination as string, roots),
              )
            } else {
              if (!Array.isArray(request.roots)) throw new Error('invalid input roots')
              await withLinuxDirectories(request.pid, request.roots, 8, (roots) =>
                owner.prepare(
                  request.destination as string,
                  roots.map((root) => root.fd),
                ),
              )
            }
            prepared = true
            send(socket, { ok: true })
          } else if (request.type === 'bind-checkpoint') {
            cancellation.signal.throwIfAborted()
            if (
              !prepared ||
              checkpoints !== undefined ||
              typeof request.project !== 'string' ||
              !Number.isSafeInteger(request.epoch) ||
              Number(request.epoch) < 1
            )
              throw new Error('invalid checkpoint binding')
            const selected = new PrivateRunCheckpoints(
              request.identity as unknown as RunCheckpointIdentity,
            )
            projectFd = privateOpenFileRoot(request.project)
            const info = fstatSync(projectFd, { bigint: true })
            recovery = {
              project: request.project,
              device: String(info.dev),
              inode: String(info.ino),
              epoch: Number(request.epoch),
              runId: selected.identity.runId,
            }
            checkpoints = selected
            send(socket, { ok: true })
          } else if (request.type === 'checkpoint') {
            cancellation.signal.throwIfAborted()
            if (checkpoints === undefined || publication !== undefined)
              throw new Error('checkpoint owner unavailable')
            // Replacement is synchronous and bounded. A lost reply cannot undo accepted bytes.
            const receipt = checkpoints.accept(request.input)
            send(socket, { ok: true, receipt: receipt as unknown as JsonValue })
          } else if (request.type === 'publish') {
            if (publication !== undefined) throw new Error('delivery already requested')
            if (request.cancelled === true) cancellation.abort()
            const record = checkpointRecord(request.record!, checkpoints)
            // Only the trusted coordinator publishes, after settling its Run.
            // Cancellation may retain that record, not unfinished output files.
            const interruptedRecord =
              request.cancelled === true &&
              request.output === null &&
              record !== null &&
              typeof record === 'object' &&
              !Array.isArray(record) &&
              !Object.hasOwn(record, 'cleanup')
            const publish = (
              output: import('./file-delivery.js').PrivateDeliveryOutput | undefined,
            ) =>
              owner.publish(
                record,
                output,
                checkpoints?.latest,
                checkpoints !== undefined || interruptedRecord,
                coordinatorLost.signal,
              )
            let delivered: Promise<PrivateDeliveryReceipt>
            if (native !== undefined) {
              if (Object.hasOwn(request, 'pid') || Object.hasOwn(request, 'outputFd'))
                throw new Error('native output authority must be transferred')
              delivered =
                request.output === null
                  ? publish(undefined)
                  : native.output(peer!, request.output, coordinatorLost.signal, (capture) =>
                      publish({ kind: 'snapshot', capture }),
                    )
            } else {
              delivered = withLinuxDirectories(
                request.pid,
                request.output === null ? [] : [request.output],
                1,
                (outputs) =>
                  publish(
                    outputs[0] === undefined
                      ? undefined
                      : { kind: 'linux-directory', fd: outputs[0].fd },
                  ),
              )
            }
            publication = delivered
              .then((receipt) => {
                send(socket, {
                  ok: true,
                  receipt,
                  ...(checkpoints === undefined ? {} : { checkpoint: checkpoints.latest ?? null }),
                } as unknown as JsonValue)
              })
              .catch(() => {
                cancellation.abort()
                socket.destroy()
              })
          } else if (request.type === 'cancel') {
            cancellation.abort()
          } else throw new Error('invalid file owner request')
        } catch {
          send(socket, { ok: false })
          if (request.type !== 'checkpoint') cancellation.abort()
        }
      }
    })()
      .catch(() => {
        cancellation.abort()
        socket.destroy()
      })
      .finally(async () => {
        await publication
      })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(address(selected), resolve)
  })
    .then(() => native?.controlReady())
    .catch(async (error) => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await native?.close()
      throw error
    })
  const child = spawn(command[0]!, [...command.slice(1), ...arguments_], {
    cwd: process.cwd(),
    env: { ...process.env, [MARKER]: JSON.stringify(selected) },
    stdio: 'inherit',
  })
  childPid = child.pid
  let escalation: ReturnType<typeof setTimeout> | undefined
  let escalationDeadline = Infinity
  const completion = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
    },
  )
  const stop = (graceMs: number) => {
    cancellation.abort()
    if (child.exitCode !== null || child.signalCode !== null) return
    const deadline = performance.now() + graceMs
    if (deadline >= escalationDeadline) return
    escalationDeadline = deadline
    if (escalation === undefined) child.kill('SIGTERM')
    clearTimeout(escalation)
    // This is our exact trusted child, not the payload tree. Payload fencing
    // remains the independent cgroup owner's responsibility after its loss.
    escalation = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, graceMs)
  }
  // Do not race cooperative Run cancellation, fencing and publication with
  // the much shorter last-resort grace for an expired command. The absolute
  // command deadline can still shorten this wait; payload deadlines never move.
  const interrupt = () => stop(PRIVATE_FILE_COMMAND_SETTLEMENT_MS)
  signal?.addEventListener('abort', interrupt, { once: true })
  if (signal?.aborted) interrupt()
  const timer = setTimeout(() => stop(PRIVATE_FILE_COMMAND_STOP_GRACE_MS), lifetimeMs)
  let exit: { exitCode: number | null; signal: NodeJS.Signals | null }
  try {
    exit = await completion
    cancellation.abort()
    coordinatorLost.abort()
    connection?.destroy()
    await task
    if (recovery !== undefined && checkpoints !== undefined && publication === undefined) {
      try {
        const recovered = await recoverCommand(command, arguments_, recovery)
        const record = checkpointRecord(
          { ...recovered, ...checkpoints.identity } as JsonValue,
          checkpoints,
        )
        const receipt = await owner.publish(record, undefined, checkpoints.latest, true)
        process.stdout.write(
          `${Buffer.from(canonicalJson({ ...(record as Record<string, JsonValue>), delivery: receipt } as unknown as JsonValue)).toString()}\n`,
        )
        if (receipt.status !== 'written') {
          process.stderr.write(
            privateCliStderrDiagnostic(
              'JIG_DELIVERY_FAILED',
              `Retained-result publication failed (${receipt.code}). Inspect the output destination before starting new work; repeating the command starts a new Run. See https://jig.md/guide/results.`,
            ),
          )
          recoveryFailed = true
        }
      } catch {
        process.stderr.write(
          privateCliStderrDiagnostic(
            'JIG_CHECKPOINT_UNAVAILABLE',
            'Cleanup or retained-result delivery could not be confirmed. Inspect the destination and settle existing work before starting another command. See https://jig.md/guide/results.',
          ),
        )
        recoveryFailed = true
      }
    }
  } finally {
    clearTimeout(timer)
    clearTimeout(escalation)
    signal?.removeEventListener('abort', interrupt)
    connection?.destroy()
    await task
    checkpoints?.close()
    if (projectFd !== undefined) closeSync(projectFd)
    try {
      await owner.close()
    } catch {
      cleanupFailed = true
    }
    try {
      native?.beforeServerClose()
    } catch {
      cleanupFailed = true
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
    try {
      await native?.close()
    } catch {
      cleanupFailed = true
    }
  }
  if (cleanupFailed) {
    process.stderr.write(
      privateCliStderrDiagnostic(
        'JIG_DELIVERY_CLEANUP_FAILED',
        'Unfinished delivery storage could not be removed. Preserve any published result and inspect destination permissions before starting new work. See https://jig.md/guide/results.',
      ),
    )
    return { exitCode: 2, signal: null }
  }
  if (recoveryFailed) return { exitCode: 2, signal: null }
  return exit
}

/** Only the actual coordinator connects, after rootless delegation has settled. */
export async function privateConnectFileOwner(): Promise<
  (PrivateDeliveryConnection & { close(): void; readonly signal: AbortSignal }) | undefined
> {
  const selected = marker()
  if (selected === undefined) return undefined
  delete process.env[MARKER]
  const socket = connect(address(selected))
  const cancellation = new AbortController()
  socket.on('error', () => cancellation.abort())
  socket.once('close', () => cancellation.abort())
  const connectionTimer = setTimeout(
    () => socket.destroy(new Error('file owner connection timed out')),
    5000,
  )
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
  } finally {
    clearTimeout(connectionTimer)
  }
  if (selected.platform === 'darwin') {
    try {
      requirePrivateMacosFilePeer(socket, selected.peer)
    } catch (error) {
      socket.destroy()
      throw error
    }
  }
  const iterator = messages(socket)[Symbol.asyncIterator]()
  let destination: string | undefined
  let checkpoint: import('./private-run-checkpoint.js').RetainedRunCheckpoint | null | undefined
  const request = async (fields: Record<string, JsonValue>): Promise<Record<string, JsonValue>> => {
    send(socket, {
      ...fields,
      token: selected.token,
      ...(selected.platform === 'linux' ? { pid: process.pid } : {}),
    })
    const next = await iterator.next()
    if (
      !next.done &&
      (next.value as Record<string, JsonValue>).ok === false &&
      fields.type === 'checkpoint'
    )
      throw new PrivateCheckpointRejected('checkpoint replacement was rejected')
    if (next.done || (next.value as Record<string, JsonValue>).ok !== true)
      throw new Error('file delivery boundary rejected the request')
    return next.value as Record<string, JsonValue>
  }
  return {
    get checkpoint() {
      return checkpoint
    },
    signal: cancellation.signal,
    close() {
      socket.end()
    },
    async prepare(path, roots) {
      if (selected.platform === 'linux')
        await request({ type: 'prepare', destination: path, roots: [...roots] })
      else {
        if (!Array.isArray(roots) || roots.length > 8) throw new TypeError('invalid input roots')
        const pending = request({ type: 'prepare', destination: path, rootCount: roots.length })
        const transfer = roots.length
          ? sendPrivateMacosDescriptors(
              join(dirname(selected.socket), 'fd-roots'),
              selected.peer,
              roots,
              5000,
              cancellation.signal,
            )
          : Promise.resolve()
        await Promise.all([pending, transfer]).catch((error) => {
          socket.destroy()
          throw error
        })
      }
      destination = path
    },
    async bindCheckpoint(identity, project, epoch) {
      await request({
        type: 'bind-checkpoint',
        identity: identity as unknown as JsonValue,
        project,
        epoch,
      })
    },
    async saveCheckpoint(input) {
      return (await request({ type: 'checkpoint', input: input as unknown as JsonValue }))
        .receipt as unknown as import('./private-run-checkpoint.js').RunCheckpointReceipt
    },
    async publish(record, output, signal) {
      let transferred: ReturnType<typeof requirePrivateCapturedOutput> | undefined
      if (output !== undefined) {
        if (selected.platform === 'linux' && output.kind !== 'linux-directory')
          throw new Error('invalid Linux output lifetime')
        if (selected.platform === 'darwin') {
          if (output.kind !== 'snapshot') throw new Error('invalid native output lifetime')
          try {
            transferred = requirePrivateCapturedOutput(await output.ready)
          } catch {
            return { status: 'failed', destination: destination!, code: 'INVALID_FILES' }
          }
        }
      }
      const cancel = () => send(socket, { type: 'cancel', token: selected.token })
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        const pending = request({
          type: 'publish',
          record,
          output:
            output === undefined
              ? null
              : selected.platform === 'linux'
                ? (output as Extract<typeof output, { kind: 'linux-directory' }>).directory.fd
                : ({
                    bytes: transferred!.bytes,
                    digest: transferred!.digest,
                    files: transferred!.files,
                    directories: transferred!.directories,
                  } as unknown as JsonValue),
          cancelled: signal?.aborted ?? false,
        })
        const transfer =
          selected.platform === 'darwin' && transferred !== undefined
            ? sendPrivateMacosDescriptors(
                join(dirname(selected.socket), 'fd-output'),
                selected.peer,
                [transferred.fd],
                5000,
                cancellation.signal,
              )
            : Promise.resolve()
        const [reply] = await Promise.all([pending, transfer]).catch((error) => {
          socket.destroy()
          throw error
        })
        if (Object.hasOwn(reply, 'checkpoint'))
          checkpoint = reply.checkpoint as unknown as typeof checkpoint
        return reply.receipt as unknown as PrivateDeliveryReceipt
      } finally {
        signal?.removeEventListener('abort', cancel)
      }
    },
  }
}

function checkpointRecord(record: JsonValue, checkpoints?: PrivateRunCheckpoints): JsonValue {
  if (checkpoints === undefined) return record
  const value = record as Record<string, JsonValue>
  if (value.runId !== checkpoints.identity.runId) throw new Error('checkpoint Run mismatch')
  const latest = checkpoints.latest
  return { ...value, checkpoint: latest === undefined ? null : (latest as unknown as JsonValue) }
}

async function recoverCommand(
  command: readonly string[],
  args: readonly string[],
  recovery: PrivateFileRecovery,
): Promise<Record<string, JsonValue>> {
  const child = spawn(command[0]!, [...command.slice(1), ...args], {
    cwd: recovery.project,
    env: { ...process.env, [MARKER]: undefined, [RECOVERY]: JSON.stringify(recovery) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const chunks: Buffer[] = []
  let size = 0,
    overflow = false
  child.stdout.on('data', (chunk: Buffer) => {
    size += chunk.length
    if (size <= MAX_BYTES) chunks.push(chunk)
    else {
      overflow = true
      child.kill('SIGKILL')
    }
  })
  child.stderr.resume()
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    if (code !== 0 || overflow) throw new Error('recovery did not confirm cleanup')
    const record = decodeJson1(Buffer.concat(chunks)) as Record<string, JsonValue>
    if (
      record === null ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      !['failed', 'lost', 'succeeded'].includes(String(record.status))
    )
      throw new Error('invalid recovery result')
    return record
  } finally {
    clearTimeout(timer)
  }
}

function send(socket: Socket, value: JsonValue): void {
  const bytes = canonicalJson(value)
  socket.write(Buffer.concat([bytes, Buffer.from('\n')]))
}
async function* messages(socket: Socket): AsyncGenerator<JsonValue> {
  let chunks: Buffer[] = [],
    size = 0
  for await (const raw of socket) {
    const chunk = Buffer.from(raw)
    let start = 0
    for (let index = 0; index < chunk.length; index++) {
      if (chunk[index] !== 10) continue
      const part = chunk.subarray(start, index)
      if (size + part.length > MAX_BYTES) throw new Error('oversized file-owner message')
      chunks.push(part)
      yield decodeJson1(Buffer.concat(chunks, size + part.length))
      chunks = []
      size = 0
      start = index + 1
    }
    if (start < chunk.length) {
      const remaining = chunk.subarray(start)
      size += remaining.length
      if (size > MAX_BYTES) throw new Error('oversized file-owner message')
      chunks.push(remaining)
    }
  }
  if (size !== 0) throw new Error('truncated file-owner message')
}

/** Linux transport imports remote descriptors before handing local capabilities to delivery. */
async function withLinuxDirectories<T>(
  pid: unknown,
  descriptors: readonly unknown[],
  maximum: number,
  work: (directories: readonly FileHandle[]) => Promise<T>,
): Promise<T> {
  if (
    process.platform !== 'linux' ||
    !Number.isSafeInteger(pid) ||
    Number(pid) < 1 ||
    descriptors.length > maximum ||
    descriptors.some((fd) => !Number.isSafeInteger(fd) || Number(fd) < 0)
  )
    throw new TypeError('invalid Linux file transfer')
  const directories: FileHandle[] = []
  const errors: unknown[] = []
  let result: T | undefined
  try {
    for (const fd of descriptors) {
      const directory = await open(`/proc/${pid}/fd/${fd}`, 0x10000)
      directories.push(directory)
      if (!(await directory.stat()).isDirectory())
        throw new TypeError('file transfer requires directories')
    }
    result = await work(directories)
  } catch (error) {
    errors.push(error)
  } finally {
    const results = await Promise.allSettled(directories.map((directory) => directory.close()))
    errors.push(
      ...results.filter((result) => result.status === 'rejected').map((result) => result.reason),
    )
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length) throw new AggregateError(errors, 'file transfer failed')
  return result as T
}
