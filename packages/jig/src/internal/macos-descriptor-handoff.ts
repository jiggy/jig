import { closeSync, constants, fstatSync, lstatSync, realpathSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { getSystemErrorName } from 'node:util'
import { privateMacosStatAt, privateMacosUnlinkAt } from './macos-descriptor-files.js'
import {
  privateMacosCurrentProcessIdentity,
  privateMacosDescriptorPeerIdentity,
} from './macos-process-controls.js'

const MAX_DESCRIPTORS = 64
// Darwin externalizes rights before copying ancillary bytes to userspace. The
// buffer must fit a complete kernel control mbuf (2048 bytes on qualified XNU),
// even when refusing more than our 64-descriptor protocol limit.
const CONTROL_BYTES = 4096
const MAX_WAIT_MS = 10_000
const MAGIC = Buffer.from('JFD1')
type Peer = Readonly<{ pid: number; version: number }>
type NativeFunction = (...arguments_: number[]) => number
interface Native {
  ptr(bytes: Uint8Array): number
  read: { i32(pointer: number): number }
  symbols: Record<string, NativeFunction>
}
let native: Native | undefined
function calls(): Native {
  if (native !== undefined) return native
  privateMacosCurrentProcessIdentity()
  const ffi = createRequire(import.meta.url)('bun:ffi') as Native & {
    dlopen(
      path: string,
      declarations: Record<string, { args: string[]; returns: string }>,
    ): {
      symbols: Native['symbols']
    }
  }
  const { symbols } = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
    socket: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
    bind: { args: ['i32', 'ptr', 'u32'], returns: 'i32' },
    listen: { args: ['i32', 'i32'], returns: 'i32' },
    accept: { args: ['i32', 'ptr', 'ptr'], returns: 'i32' },
    connect: { args: ['i32', 'ptr', 'u32'], returns: 'i32' },
    poll: { args: ['ptr', 'u32', 'i32'], returns: 'i32' },
    getsockopt: { args: ['i32', 'i32', 'i32', 'ptr', 'ptr'], returns: 'i32' },
    sendmsg: { args: ['i32', 'ptr', 'i32'], returns: 'i64' },
    recvmsg: { args: ['i32', 'ptr', 'i32'], returns: 'i64' },
    send: { args: ['i32', 'ptr', 'u64', 'i32'], returns: 'i64' },
    recv: { args: ['i32', 'ptr', 'u64', 'i32'], returns: 'i64' },
    shutdown: { args: ['i32', 'i32'], returns: 'i32' },
    fcntl: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
    __error: { args: [], returns: 'ptr' },
  })
  native = { symbols, ptr: ffi.ptr, read: ffi.read }
  return native
}
function errno(): number {
  const { symbols, read } = calls()
  return read.i32(symbols.__error!())
}
function checked(value: number): number {
  if (value >= 0) return value
  throw Object.assign(new Error('macOS descriptor handoff operation failed'), {
    code: getSystemErrorName(-errno()),
  })
}
function socket(): number {
  const fd = checked(calls().symbols.socket!(1, 1, 0)) // AF_UNIX, SOCK_STREAM
  try {
    configure(fd)
    return fd
  } catch (error) {
    closeSync(fd)
    throw error
  }
}
function configure(fd: number): void {
  const { symbols } = calls()
  checked(symbols.fcntl!(fd, 2, 1)) // FD_CLOEXEC, before any await or child spawn.
  checked(symbols.fcntl!(fd, 4, checked(symbols.fcntl!(fd, 3, 0)) | 4)) // O_NONBLOCK
}
function address(path: string): Buffer {
  const encoded = Buffer.from(path)
  if (
    !path.startsWith('/') ||
    path.includes('\0') ||
    encoded.length > 103 ||
    encoded.toString('utf8') !== path
  )
    throw new Error('macOS descriptor handoff path is invalid')
  const bytes = Buffer.alloc(106)
  bytes[0] = encoded.length + 3
  bytes[1] = 1
  encoded.copy(bytes, 2)
  return bytes
}
function authenticate(fd: number, expected: Peer): void {
  if (
    !Number.isSafeInteger(expected.pid) ||
    expected.pid < 1 ||
    !Number.isSafeInteger(expected.version) ||
    expected.version < 1
  )
    throw new Error('macOS descriptor handoff peer is invalid')
  const actual = privateMacosDescriptorPeerIdentity(fd)
  if (
    actual.uid !== process.getuid?.() ||
    actual.realUid !== actual.uid ||
    actual.pid !== expected.pid ||
    actual.version !== expected.version
  )
    throw new Error('macOS descriptor handoff peer does not match')
}
function budget(timeoutMs: number, signal?: AbortSignal): () => Promise<void> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_WAIT_MS)
    throw new Error('macOS descriptor handoff deadline is invalid')
  const deadline = performance.now() + timeoutMs
  return async () => {
    signal?.throwIfAborted()
    if (performance.now() >= deadline) throw new Error('macOS descriptor handoff timed out')
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    signal?.throwIfAborted()
  }
}
function retry(value: number): boolean {
  return value < 0 && [4, 35].includes(errno()) // EINTR, EAGAIN
}
function message(body: Buffer, control: Buffer) {
  const { ptr } = calls()
  const vector = Buffer.alloc(16),
    header = Buffer.alloc(48)
  vector.writeBigUInt64LE(BigInt(ptr(body)), 0)
  vector.writeBigUInt64LE(BigInt(body.length), 8)
  header.writeBigUInt64LE(BigInt(ptr(vector)), 16)
  header.writeInt32LE(1, 24)
  header.writeBigUInt64LE(BigInt(ptr(control)), 32)
  header.writeUInt32LE(control.length, 40)
  return { header, vector, body, control }
}

export interface PrivateMacosReceivedDescriptors {
  /** Borrowed until close(). Callers must not close these numbers separately. */
  readonly descriptors: readonly number[]
  close(): void
}

/** Receive exactly one bundle from the kernel-authenticated trusted sender.
 * The caller owns the canonical private directory, outside all payload grants.
 * Receipt establishes transfer provenance, not file identity, writer fencing or
 * capture immutability; the owning protocol must validate those independently.
 */
export async function createPrivateMacosDescriptorReceiver(
  directory: string,
  leaf: 'inputs' | 'output' | 'roots',
): Promise<{
  readonly path: string
  receive(
    peer: Peer,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<PrivateMacosReceivedDescriptors>
  close(): Promise<void>
}> {
  privateMacosCurrentProcessIdentity()
  if (!['inputs', 'output', 'roots'].includes(leaf))
    throw new Error('invalid descriptor handoff role')
  const parent = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | 0x20000000 | 0x01000000,
  )
  let listener: number | undefined
  let identity: { dev: bigint; ino: bigint } | undefined
  let closed = false,
    receiving = false,
    consumed = false
  const path = join(directory, `fd-${leaf}`)
  const name = `fd-${leaf}`
  const sameParent = () => {
    const held = fstatSync(parent.fd, { bigint: true }),
      visible = lstatSync(directory, { bigint: true })
    if (
      !held.isDirectory() ||
      held.dev !== visible.dev ||
      held.ino !== visible.ino ||
      held.uid !== BigInt(process.getuid!()) ||
      (held.mode & 0o077n) !== 0n ||
      realpathSync(directory) !== directory
    )
      throw new Error('macOS descriptor handoff owner changed')
  }
  const close = async () => {
    if (closed) return
    closed = true
    try {
      if (listener !== undefined) {
        closeSync(listener)
        listener = undefined
      }
      if (identity !== undefined) {
        const entry = privateMacosStatAt(parent.fd, name)
        if (!entry.isSocket() || entry.dev !== identity.dev || entry.ino !== identity.ino)
          throw new Error('macOS descriptor handoff socket changed')
        privateMacosUnlinkAt(parent.fd, name)
      }
    } finally {
      await parent.close()
    }
  }
  try {
    sameParent()
    const sockaddr = address(path),
      { symbols, ptr } = calls()
    listener = socket()
    checked(symbols.bind!(listener, ptr(sockaddr), sockaddr[0]!))
    // Never unlink a name after bind failure; it may belong to another owner.
    sameParent()
    const entry = privateMacosStatAt(parent.fd, name)
    if (!entry.isSocket() || entry.uid !== BigInt(process.getuid!()))
      throw new Error('macOS descriptor handoff socket is invalid')
    identity = { dev: entry.dev, ino: entry.ino }
    checked(symbols.listen!(listener, 1))
    return Object.freeze({
      path,
      close,
      async receive(peer: Peer, timeoutMs: number, signal?: AbortSignal) {
        if (closed || receiving || consumed)
          throw new Error('macOS descriptor receiver is unavailable')
        const delay = budget(timeoutMs, signal)
        const wait = async () => {
          if (closed) throw new Error('macOS descriptor receiver is closed')
          await delay()
          if (closed) throw new Error('macOS descriptor receiver is closed')
        }
        receiving = true
        let connection: number | undefined
        try {
          for (;;) {
            signal?.throwIfAborted()
            if (closed) throw new Error('macOS descriptor receiver is closed')
            const accepted = symbols.accept!(listener!, 0, 0)
            if (accepted >= 0) {
              connection = accepted
              break
            }
            if (!retry(accepted)) checked(accepted)
            await wait()
          }
          configure(connection)
          authenticate(connection, peer)
          consumed = true
          return await receive(connection, wait)
        } finally {
          if (connection !== undefined) closeSync(connection)
          receiving = false
        }
      },
    })
  } catch (error) {
    await close()
    throw error
  }
}

async function receive(
  fd: number,
  wait: () => Promise<void>,
): Promise<PrivateMacosReceivedDescriptors> {
  const { ptr, symbols } = calls()
  const descriptors: number[] = [],
    body = Buffer.alloc(9)
  let used = 0,
    delivered = false
  try {
    for (;;) {
      const packet = message(body.subarray(used), Buffer.alloc(CONTROL_BYTES))
      const count = Number(symbols.recvmsg!(fd, ptr(packet.header), 0x80))
      if (retry(count)) {
        await wait()
        continue
      }
      checked(count)
      const controlBytes = packet.header.readUInt32LE(40)
      // Kernel-produced ancillary headers must still be bounded. Close every
      // received right on malformed frames, EOF, cancellation or truncation.
      let offset = 0
      while (offset + 12 <= controlBytes && controlBytes <= packet.control.length) {
        const length = packet.control.readUInt32LE(offset)
        if (
          length < 12 ||
          length > controlBytes - offset ||
          (length - 12) % 4 !== 0 ||
          packet.control.readInt32LE(offset + 4) !== 0xffff ||
          packet.control.readInt32LE(offset + 8) !== 1
        )
          throw new Error('invalid macOS descriptor control frame')
        for (let index = offset + 12; index < offset + length; index += 4) {
          const received = packet.control.readInt32LE(index)
          if (received < 0) throw new Error('invalid macOS received descriptor')
          descriptors.push(received)
          checked(symbols.fcntl!(received, 2, 1))
        }
        offset += length
      }
      if (
        offset !== controlBytes ||
        // Darwin preserves the caller's MSG_DONTWAIT in returned msg_flags.
        (packet.header.readInt32LE(44) & ~0x80) !== 0 ||
        descriptors.length > MAX_DESCRIPTORS
      )
        throw new Error('truncated macOS descriptor frame')
      used += count
      if (used > 8) throw new Error('trailing macOS descriptor data')
      if (count === 0) break
    }
    if (
      used !== 8 ||
      !body.subarray(0, 4).equals(MAGIC) ||
      descriptors.length === 0 ||
      descriptors.length !== body.readUInt32LE(4)
    )
      throw new Error('invalid macOS descriptor frame')
    for (const descriptor of descriptors) {
      const info = fstatSync(descriptor)
      if (
        (!info.isFile() && !info.isDirectory()) ||
        (checked(symbols.fcntl!(descriptor, 3, 0)) & 3) !== 0
      )
        throw new Error('macOS handoff requires read-only files or directories')
    }
    const ack = Buffer.from('A')
    if (checked(Number(symbols.send!(fd, ptr(ack), 1, 0x80000))) !== 1)
      throw new Error('macOS descriptor acknowledgement failed')
    let closed = false
    const result = Object.freeze({
      descriptors: Object.freeze([...descriptors]),
      close() {
        if (closed) return
        closed = true
        for (const descriptor of descriptors.splice(0)) closeSync(descriptor)
      },
    })
    delivered = true
    return result
  } finally {
    if (!delivered) for (const descriptor of descriptors.splice(0)) closeSync(descriptor)
  }
}

/** Send duplicates. The caller must retain every original until this settles. */
export async function sendPrivateMacosDescriptors(
  path: string,
  peer: Peer,
  descriptors: readonly number[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (
    !Array.isArray(descriptors) ||
    descriptors.length < 1 ||
    descriptors.length > MAX_DESCRIPTORS ||
    descriptors.some((fd) => !Number.isSafeInteger(fd) || fd < 0)
  )
    throw new Error('invalid macOS descriptor bundle')
  const selected = [...descriptors],
    wait = budget(timeoutMs, signal),
    sockaddr = address(path)
  const { symbols, ptr } = calls(),
    fd = socket()
  try {
    signal?.throwIfAborted()
    const connected = symbols.connect!(fd, ptr(sockaddr), sockaddr[0]!)
    if (connected < 0) {
      if (![4, 35, 36].includes(errno())) checked(connected)
      const poll = Buffer.alloc(8)
      poll.writeInt32LE(fd)
      poll.writeInt16LE(4, 4)
      while (checked(symbols.poll!(ptr(poll), 1, 0)) === 0) await wait()
      const error = Buffer.alloc(4),
        size = Buffer.alloc(4)
      size.writeUInt32LE(4)
      checked(symbols.getsockopt!(fd, 0xffff, 0x1007, ptr(error), ptr(size)))
      if (error.readInt32LE() !== 0) throw new Error('macOS descriptor connection failed')
    }
    authenticate(fd, peer)
    const body = Buffer.alloc(8),
      control = Buffer.alloc(12 + selected.length * 4)
    MAGIC.copy(body)
    body.writeUInt32LE(selected.length, 4)
    control.writeUInt32LE(control.length)
    control.writeInt32LE(0xffff, 4)
    control.writeInt32LE(1, 8)
    selected.forEach((descriptor, index) => {
      control.writeInt32LE(descriptor, 12 + index * 4)
    })
    const packet = message(body, control)
    if (checked(Number(symbols.sendmsg!(fd, ptr(packet.header), 0x80080))) !== body.length)
      throw new Error('macOS descriptor send was incomplete')
    checked(symbols.shutdown!(fd, 1))
    const ack = Buffer.alloc(2)
    for (;;) {
      const count = Number(symbols.recv!(fd, ptr(ack), ack.length, 0x80))
      if (retry(count)) {
        await wait()
        continue
      }
      if (checked(count) !== 1 || ack[0] !== 65)
        throw new Error('macOS descriptor receipt is unconfirmed')
      return
    }
  } finally {
    closeSync(fd)
  }
}
