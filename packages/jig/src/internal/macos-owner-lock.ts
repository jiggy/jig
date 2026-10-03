import { constants, fstatSync } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { createRequire } from 'node:module'
import {
  duplicatePrivateDirectory,
  openPrivateChild,
  statPrivateChild,
} from './descriptor-files.js'
import { privateMacosCurrentProcessIdentity } from './macos-process-controls.js'

export interface PrivateMacosOwnerLock {
  readonly identity: Readonly<{ device: string; inode: string }>
  close(): Promise<void>
}
interface Held {
  directory: FileHandle
  file: FileHandle
  directoryDevice: bigint
  directoryInode: bigint
  closed: boolean
}
const locks = new WeakMap<object, Held>()

export class PrivateMacosOwnerBusyError extends Error {
  constructor() {
    super('native execution owner is still held by another coordinator')
  }
}

/** The coordinator holds this through admission and settlement. Its death releases
 * the lock, letting recovery exclude a late start before removing ownership state. */
export async function acquirePrivateMacosOwnerLock(
  parent: FileHandle,
): Promise<PrivateMacosOwnerLock> {
  privateMacosCurrentProcessIdentity()
  const directory = await duplicatePrivateDirectory(parent)
  let file: FileHandle | undefined
  try {
    const info = await directory.stat({ bigint: true })
    if (
      !info.isDirectory() ||
      info.nlink === 0n ||
      info.uid !== BigInt(process.getuid!()) ||
      (info.mode & 0o077n) !== 0n
    )
      throw new Error('native lock owner is not a private directory')
    file = await openPrivateChild(
      directory,
      'coordinator.lock',
      constants.O_RDWR | constants.O_CREAT,
      0o600,
    )
    const opened = await file.stat({ bigint: true })
    if (
      !opened.isFile() ||
      opened.uid !== BigInt(process.getuid!()) ||
      opened.nlink !== 1n ||
      opened.size !== 0n ||
      (opened.mode & 0o7777n) !== 0o600n
    )
      throw new Error('native coordinator lock file is unsafe')
    const { dlopen, read } = createRequire(import.meta.url)('bun:ffi')
    const native = dlopen('/usr/lib/libSystem.B.dylib', {
      flock: { args: ['i32', 'i32'], returns: 'i32' },
      __error: { args: [], returns: 'ptr' },
    })
    try {
      // SDK sys/fcntl.h: LOCK_EX=2, LOCK_NB=4; never block the coordinator.
      if (native.symbols.flock(file.fd, 6) !== 0) {
        if (read.i32(native.symbols.__error()) === 35) throw new PrivateMacosOwnerBusyError()
        throw new Error('native coordinator lock is unavailable')
      }
    } finally {
      native.close()
    }
    const held: Held = {
      directory,
      file,
      directoryDevice: info.dev,
      directoryInode: info.ino,
      closed: false,
    }
    const lock = Object.freeze({
      identity: Object.freeze({ device: String(opened.dev), inode: String(opened.ino) }),
      async close() {
        if (held.closed) return
        held.closed = true
        const results = await Promise.allSettled([held.file.close(), held.directory.close()])
        const errors = results
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason)
        if (errors.length)
          throw new AggregateError(errors, 'native coordinator lock closure failed')
      },
    })
    locks.set(lock, held)
    await requirePrivateMacosOwnerLock(lock)
    return lock
  } catch (error) {
    const results = await Promise.allSettled([file?.close(), directory.close()])
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (failures.length)
      throw new AggregateError([error, ...failures], 'native coordinator lock acquisition failed')
    throw error
  }
}

/** Borrowed private directory; durable owner records must bind the lock identity. */
export async function requirePrivateMacosOwnerLock(
  lock: PrivateMacosOwnerLock,
): Promise<FileHandle> {
  const held = lock !== null && typeof lock === 'object' ? locks.get(lock) : undefined
  if (held === undefined || held.closed) throw new Error('native coordinator lock is not active')
  const directory = fstatSync(held.directory.fd, { bigint: true })
  const file = fstatSync(held.file.fd, { bigint: true })
  const named = await statPrivateChild(held.directory, 'coordinator.lock')
  if (
    directory.dev !== held.directoryDevice ||
    directory.ino !== held.directoryInode ||
    directory.nlink === 0n ||
    directory.uid !== BigInt(process.getuid!()) ||
    (directory.mode & 0o077n) !== 0n ||
    file.dev !== named.dev ||
    file.ino !== named.ino ||
    String(file.dev) !== lock.identity.device ||
    String(file.ino) !== lock.identity.inode ||
    !file.isFile() ||
    file.nlink !== 1n ||
    file.size !== 0n ||
    (file.mode & 0o7777n) !== 0o600n
  )
    throw new Error('native coordinator lock identity changed')
  return held.directory
}
