import { closeSync, fstatSync, readFileSync, statfsSync, writeSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, posix, resolve } from 'node:path'
import { getSystemErrorName } from 'node:util'
import {
  PRIVATE_CAPTURE_LIMITS,
  PRIVATE_FILE_LIMITS,
  PrivateFileInputError,
  privateFilePath,
  privateRequireUnprotected,
  sha256,
} from './file-input-policy.js'
import { resolvePrivateLinuxHostLoaderSync } from './linux-host-paths.js'

const CLOSED_SEALS = 0x0f
const F_DUPFD_CLOEXEC = 1030
const O_PATH = 0x200000
const O_CLOEXEC = 0x80000
const O_DIRECTORY = 0x10000
const NO_SYMLINKS = 0x04
const BENEATH = 0x08
const NO_XDEV = 0x01
const filesystemTypes = new Set([0xef53, 0x58465342, 0x9123683e, 0x01021994])

type NativeFunction = (...args: (number | Uint8Array | bigint)[]) => number
interface Ffi {
  dlopen(
    path: string,
    declarations: Record<string, { args: string[]; returns: string }>,
  ): { symbols: Record<string, NativeFunction> }
  ptr(value: Uint8Array): number
  read: { i32(pointer: number): number }
}
let native: { ffi: Ffi; symbols: Record<string, NativeFunction> } | undefined
function calls() {
  if (native !== undefined) return native
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error('Linux x64 file controls are unavailable')
  const ffi = createRequire(import.meta.url)('bun:ffi') as Ffi
  try {
    const libc = posix.join(dirname(resolvePrivateLinuxHostLoaderSync()), 'libc.so.6')
    const { symbols } = ffi.dlopen(libc, {
      syscall: { args: ['i64', 'i32', 'ptr', 'ptr', 'u64'], returns: 'i32' },
      memfd_create: { args: ['ptr', 'u32'], returns: 'i32' },
      fcntl: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
      renameat2: { args: ['i32', 'ptr', 'i32', 'ptr', 'u32'], returns: 'i32' },
      __errno_location: { args: [], returns: 'ptr' },
    })
    native = { ffi, symbols }
    return native
  } catch {
    throw new PrivateFileInputError('native')
  }
}
function result(value: number): number {
  if (value >= 0) return value
  const { ffi, symbols } = calls()
  const code = getSystemErrorName(-ffi.read.i32(symbols.__errno_location!()))
  const reason = {
    ELOOP: 'symlink',
    ENOENT: 'missing',
    EACCES: 'access',
    EXDEV: 'cross-mount',
    ENOSYS: 'kernel',
  } as const
  if (Object.hasOwn(reason, code))
    throw new PrivateFileInputError(reason[code as keyof typeof reason])
  throw Object.assign(new Error(`file boundary operation failed (${code})`), { code })
}
function cString(value: string): Buffer {
  if (value.includes('\0')) throw new TypeError('file path contains NUL')
  return Buffer.from(`${value}\0`)
}

export function privateLinuxOpenAt(
  directory: number,
  path: string,
  flags: number,
  beneath = true,
): number {
  const { ffi, symbols } = calls()
  const name = cString(path)
  const how = Buffer.alloc(24)
  how.writeBigUInt64LE(BigInt(flags | O_CLOEXEC), 0)
  how.writeBigUInt64LE(BigInt(NO_SYMLINKS | (beneath ? BENEATH | NO_XDEV : 0)), 16)
  return result(symbols.syscall!(437, directory, ffi.ptr(name), ffi.ptr(how), 24))
}

export function privateLinuxPublishDirectory(
  parent: number,
  staged: string,
  destination: string,
): void {
  privateFilePath(staged)
  privateFilePath(destination)
  if (staged.includes('/') || destination.includes('/'))
    throw new TypeError('publication requires two leaf names')
  const { ffi, symbols } = calls()
  const source = cString(staged),
    target = cString(destination)
  result(symbols.renameat2!(parent, ffi.ptr(source), parent, ffi.ptr(target), 1))
}

/** Resolve an operator-selected root, rejecting symlinks and protected aliases. */
export function privateLinuxOpenFileRoot(path: string): number {
  const absolute = resolve(path)
  const fd = privateLinuxOpenAt(-100, absolute, O_PATH | O_DIRECTORY, false)
  try {
    if (!filesystemTypes.has(statfsSync(`/proc/self/fd/${fd}`).type))
      throw new PrivateFileInputError('filesystem')
    privateRequireUnprotected(absolute)
    // A bind-mounted alias retains its source root in mountinfo. Inspect that
    // root as well as the visible spelling before accepting the descriptor.
    const mountId = /^mnt_id:\s+(\d+)$/m.exec(readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8'))?.[1]
    const mount = readFileSync('/proc/self/mountinfo', 'utf8')
      .split('\n')
      .find((line) => line.split(' ')[0] === mountId)
      ?.split(' ')
    if (mount === undefined) throw new PrivateFileInputError('mount')
    const decodeMountPath = (text: string) =>
      text.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))
    const root = decodeMountPath(mount[3]!),
      point = decodeMountPath(mount[4]!)
    const relative = posix.relative(point, absolute)
    if (relative.startsWith('../') || posix.isAbsolute(relative))
      throw new PrivateFileInputError('mount')
    privateRequireUnprotected(posix.join(root, relative))
    return fd
  } catch (error) {
    closeSync(fd)
    throw error
  }
}
export function privateLinuxSealedBytes(bytes: Uint8Array): number {
  const { ffi, symbols } = calls()
  const name = cString('jig-input')
  const fd = result(symbols.memfd_create!(ffi.ptr(name), 3))
  try {
    let offset = 0
    while (offset < bytes.length) {
      const count = writeSync(fd, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) throw new Error('captured input write made no progress')
      offset += count
    }
    result(symbols.fcntl!(fd, 1033, CLOSED_SEALS))
    return fd
  } catch (error) {
    closeSync(fd)
    throw error
  }
}
export function privateVerifyLinuxSealedFile(
  fd: number,
  bytes: number,
  digest: string,
  maximumBytes = PRIVATE_FILE_LIMITS.bytes,
): void {
  if (
    !Object.values(PRIVATE_CAPTURE_LIMITS).includes(maximumBytes) ||
    !Number.isSafeInteger(fd) ||
    fd < 0 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > maximumBytes ||
    !/^sha256:[0-9a-f]{64}$/.test(digest)
  )
    throw new TypeError('invalid captured input identity')
  const info = fstatSync(fd)
  if (
    !info.isFile() ||
    info.nlink !== 0 ||
    info.size !== bytes ||
    (result(calls().symbols.fcntl!(fd, 1034, 0)) & CLOSED_SEALS) !== CLOSED_SEALS ||
    sha256(readFileSync(`/proc/self/fd/${fd}`)) !== digest
  )
    throw new TypeError('captured input descriptor changed')
}
/** Keep spawn's source descriptors above all destination slots to avoid remapping collisions. */
export function privateDuplicateInputForStdio(fd: number, minimum: number): number {
  if (!Number.isSafeInteger(fd) || fd < 0 || !Number.isSafeInteger(minimum) || minimum < 6)
    throw new TypeError('invalid captured input descriptor handoff')
  return result(calls().symbols.fcntl!(fd, F_DUPFD_CLOEXEC, minimum))
}
