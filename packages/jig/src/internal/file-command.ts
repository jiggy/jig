import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { connect, createServer, type Socket } from 'node:net'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import {
  type PrivateDeliveryConnection,
  type PrivateDeliveryReceipt,
  PrivateFileDeliveryOwner,
} from './file-delivery.js'

const MARKER = 'JIG_PRIVATE_FILE_OWNER'
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
            send(socket, { ok: true })
          } else if (request.type === 'publish') {
            if (publication !== undefined) throw new Error('delivery already requested')
            if (request.cancelled === true) cancellation.abort()
            publication = owner
              .publish(
                request.record!,
                request.pid as number,
                request.outputFd === null ? undefined : (request.outputFd as number),
              )
              .then((receipt) => {
                send(socket, { ok: true, receipt } as unknown as JsonValue)
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
          cancellation.abort()
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
  } finally {
    clearTimeout(timer)
    clearTimeout(escalation)
    signal?.removeEventListener('abort', stop)
    connection?.destroy()
    await task
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
  const request = async (fields: Record<string, JsonValue>): Promise<Record<string, JsonValue>> => {
    send(socket, { ...fields, token: selected.token, pid: process.pid })
    const next = await iterator.next()
    if (next.done || (next.value as Record<string, JsonValue>).ok !== true)
      throw new Error('file delivery boundary rejected the request')
    return next.value as Record<string, JsonValue>
  }
  return {
    signal: cancellation.signal,
    close() {
      socket.end()
    },
    async prepare(destination, roots) {
      await request({ type: 'prepare', destination, roots: [...roots] })
    },
    async publish(record, outputFd, signal) {
      const cancel = () => send(socket, { type: 'cancel', token: selected.token, pid: process.pid })
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        return (
          await request({
            type: 'publish',
            record,
            outputFd: outputFd ?? null,
            cancelled: signal?.aborted ?? false,
          })
        ).receipt as unknown as PrivateDeliveryReceipt
      } finally {
        signal?.removeEventListener('abort', cancel)
      }
    },
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
