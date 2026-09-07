import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, fstatSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import {
  type PrivateDeliveryConnection,
  type PrivateDeliveryReceipt,
  PrivateFileDeliveryOwner,
} from './file-delivery.js'
import { privateOpenFileRoot } from './linux-file-input.js'
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
interface Marker {
  readonly socket: string
  readonly token: string
}
function marker(): Marker | undefined {
  const text = process.env[MARKER]
  if (text === undefined) return undefined
  const value = JSON.parse(text) as Marker
  if (!/^jig-file-owner-[a-f0-9]{32}$/.test(value.socket) || !/^[a-f0-9]{64}$/.test(value.token))
    throw new Error('invalid file-command owner')
  return value
}
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
  const selected = {
    socket: `jig-file-owner-${randomBytes(16).toString('hex')}`,
    token: randomBytes(32).toString('hex'),
  }
  const cancellation = new AbortController()
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
    connection = socket
    socket.once('close', () => cancellation.abort())
    socket.on('error', () => cancellation.abort())
    task = (async () => {
      for await (const value of messages(socket)) {
        const request = value as Record<string, JsonValue>
        if (request.token !== selected.token) throw new Error('file owner authentication failed')
        try {
          if (request.type === 'prepare') {
            if (typeof request.destination !== 'string' || !Array.isArray(request.roots))
              throw new Error('invalid delivery preparation')
            await owner.prepare(
              request.destination,
              request.pid as number,
              request.roots as number[],
            )
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
            publication = owner
              .publish(
                checkpointRecord(request.record!, checkpoints),
                request.pid as number,
                request.outputFd === null ? undefined : (request.outputFd as number),
                checkpoints?.latest,
                checkpoints !== undefined,
              )
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
    server.listen(`\0${selected.socket}`, resolve)
  })
  const child = spawn(command[0]!, [...command.slice(1), ...arguments_], {
    cwd: process.cwd(),
    env: { ...process.env, [MARKER]: JSON.stringify(selected) },
    stdio: 'inherit',
  })
  let escalation: ReturnType<typeof setTimeout> | undefined
  const completion = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
    },
  )
  const stop = () => {
    cancellation.abort()
    if (escalation !== undefined || child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    // This is our exact trusted child, not the payload tree. Payload fencing
    // remains the independent cgroup owner's responsibility after its loss.
    escalation = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, PRIVATE_FILE_COMMAND_STOP_GRACE_MS)
  }
  signal?.addEventListener('abort', stop, { once: true })
  if (signal?.aborted) stop()
  const timer = setTimeout(stop, lifetimeMs)
  let exit: { exitCode: number | null; signal: NodeJS.Signals | null }
  try {
    exit = await completion
    cancellation.abort()
    connection?.destroy()
    await task
    if (recovery !== undefined && checkpoints !== undefined && publication === undefined) {
      try {
        const recovered = await recoverCommand(command, arguments_, recovery)
        const record = checkpointRecord(
          { ...recovered, ...checkpoints.identity } as JsonValue,
          checkpoints,
        )
        const receipt = await owner.publish(
          record,
          process.pid,
          undefined,
          checkpoints.latest,
          true,
        )
        process.stdout.write(
          `${Buffer.from(canonicalJson({ ...(record as Record<string, JsonValue>), delivery: receipt } as unknown as JsonValue)).toString()}\n`,
        )
        if (receipt.status !== 'written') {
          process.stderr.write(
            `JIG_DELIVERY_FAILED: retained-result publication failed (${receipt.code})\n`,
          )
          recoveryFailed = true
        }
      } catch {
        process.stderr.write(
          'JIG_CHECKPOINT_UNAVAILABLE: cleanup or retained-result delivery could not be confirmed\n',
        )
        recoveryFailed = true
      }
    }
  } finally {
    clearTimeout(timer)
    clearTimeout(escalation)
    signal?.removeEventListener('abort', stop)
    connection?.destroy()
    await task
    checkpoints?.close()
    if (projectFd !== undefined) closeSync(projectFd)
    try {
      await owner.close()
    } catch {
      cleanupFailed = true
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  if (cleanupFailed) {
    process.stderr.write(
      'JIG_DELIVERY_CLEANUP_FAILED: unfinished delivery storage could not be removed\n',
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
  const socket = connect(`\0${selected.socket}`)
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
  const iterator = messages(socket)[Symbol.asyncIterator]()
  let checkpoint: import('./private-run-checkpoint.js').RetainedRunCheckpoint | null | undefined
  const request = async (fields: Record<string, JsonValue>): Promise<Record<string, JsonValue>> => {
    send(socket, { ...fields, token: selected.token, pid: process.pid })
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
    async prepare(destination, roots) {
      await request({ type: 'prepare', destination, roots: [...roots] })
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
    async publish(record, outputFd, signal) {
      const cancel = () => send(socket, { type: 'cancel', token: selected.token, pid: process.pid })
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        const reply = await request({
          type: 'publish',
          record,
          outputFd: outputFd ?? null,
          cancelled: signal?.aborted ?? false,
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
