import { type BigIntStats, closeSync, constants, type Dirent } from 'node:fs'
import { type FileHandle, mkdtemp, open, rmdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { getSystemErrorName } from 'node:util'
import { privateMacosCurrentProcessIdentity } from './macos-process-controls.js'

type NativeSymbol =
  | 'openat'
  | 'fcntl'
  | 'fstatat$INODE64'
  | 'fstatfs$INODE64'
  | 'fdopendir$INODE64'
  | 'readdir$INODE64'
  | 'closedir'
  | 'mkdirat'
  | 'unlinkat'
  | 'renameatx_np'
  | 'readlinkat'
  | 'symlinkat'
  | 'linkat'
  | '__error'
type Call = (...args: (number | bigint)[]) => number
interface Native {
  ptr(bytes: Uint8Array): number
  toArrayBuffer(pointer: number, offset: number, bytes: number): ArrayBuffer
  symbols: Record<Exclude<NativeSymbol, 'readlinkat'>, Call> & {
    readlinkat: (...args: (number | bigint)[]) => bigint
  }
}
let native: Native | undefined
let handleClass: Promise<new (fd: number) => FileHandle> | undefined
const CLOEXEC = 0x01000000
const NOFOLLOW_ANY = 0x20000000

function calls(): Native {
  if (native !== undefined) return native
  privateMacosCurrentProcessIdentity() // Exact qualified kernel and architecture.
  if (process.versions.bun !== '1.4.2')
    throw new Error('macOS descriptor adoption requires the qualified Bun runtime')
  const ffi = createRequire(import.meta.url)('bun:ffi')
  const { symbols } = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
    openat: { args: ['i32', 'ptr', 'i32', 'u32'], returns: 'i32' },
    fcntl: { args: ['i32', 'i32', 'u64'], returns: 'i32' },
    fstatat$INODE64: { args: ['i32', 'ptr', 'ptr', 'i32'], returns: 'i32' },
    fstatfs$INODE64: { args: ['i32', 'ptr'], returns: 'i32' },
    fdopendir$INODE64: { args: ['i32'], returns: 'ptr' },
    readdir$INODE64: { args: ['ptr'], returns: 'ptr' },
    closedir: { args: ['ptr'], returns: 'i32' },
    mkdirat: { args: ['i32', 'ptr', 'u32'], returns: 'i32' },
    unlinkat: { args: ['i32', 'ptr', 'i32'], returns: 'i32' },
    renameatx_np: { args: ['i32', 'ptr', 'i32', 'ptr', 'u32'], returns: 'i32' },
    readlinkat: { args: ['i32', 'ptr', 'ptr', 'u64'], returns: 'i64' },
    symlinkat: { args: ['ptr', 'i32', 'ptr'], returns: 'i32' },
    linkat: { args: ['i32', 'ptr', 'i32', 'ptr', 'i32'], returns: 'i32' },
    __error: { args: [], returns: 'ptr' },
  })
  native = { ptr: ffi.ptr, toArrayBuffer: ffi.toArrayBuffer, symbols }
  return native
}
function errnoBytes(): Buffer {
  const { symbols, toArrayBuffer } = calls()
  return Buffer.from(toArrayBuffer(symbols.__error(), 0, 4))
}
function checked(result: number): number {
  if (result >= 0) return result
  const code = getSystemErrorName(-errnoBytes().readInt32LE())
  throw Object.assign(new Error(`macOS descriptor operation failed (${code})`), { code })
}
function nameBytes(value: string | Uint8Array): Buffer {
  const bytes = Buffer.from(value)
  if (
    !bytes.length ||
    bytes.length > 1023 ||
    bytes.includes(0) ||
    bytes.includes(47) ||
    bytes.equals(Buffer.from('.')) ||
    bytes.equals(Buffer.from('..'))
  )
    throw new TypeError('descriptor operation requires one leaf name')
  return Buffer.concat([bytes, Buffer.from([0])])
}

async function handleConstructor(): Promise<new (fd: number) => FileHandle> {
  calls()
  handleClass ??= (async () => {
    const handle = await open('/dev/null', constants.O_RDONLY | CLOEXEC)
    try {
      // Private pinned Bun seam, qualified with real native descriptors. No Node fallback.
      return handle.constructor as new (
        fd: number,
      ) => FileHandle
    } finally {
      await handle.close()
    }
  })()
  return handleClass
}

export async function privateMacosOpenAt(
  parent: number,
  name: string | Uint8Array,
  flags: number,
  mode = 0o600,
): Promise<FileHandle> {
  const Constructor = await handleConstructor()
  const { ptr, symbols } = calls()
  const path = nameBytes(name)
  // Darwin rejects combining O_NOFOLLOW with its stronger O_NOFOLLOW_ANY.
  const fd = checked(
    symbols.openat(
      parent,
      ptr(path),
      (flags & ~constants.O_NOFOLLOW) | CLOEXEC | NOFOLLOW_ANY,
      mode,
    ),
  )
  try {
    return new Constructor(fd)
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

export async function privateMacosDuplicate(fd: number): Promise<FileHandle> {
  const Constructor = await handleConstructor()
  const duplicate = checked(calls().symbols.fcntl(fd, 67, 0)) // F_DUPFD_CLOEXEC, SDK 14.4.
  try {
    return new Constructor(duplicate)
  } catch (error) {
    closeSync(duplicate)
    throw error
  }
}

/** Observation only; never reopen this path in place of a held descriptor. */
export function privateMacosDescriptorPath(fd: number): string {
  const { ptr, symbols } = calls()
  const bytes = Buffer.alloc(1024)
  checked(symbols.fcntl(fd, 50, ptr(bytes))) // F_GETPATH, MAXPATHLEN in SDK 14.4.
  const end = bytes.indexOf(0)
  if (end <= 0) throw new Error('macOS descriptor pathname is unavailable')
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end))
}

/** Native mount evidence from the held directory, not a visible pathname lookup. */
export function privateMacosFilesystem(fd: number) {
  const { ptr, symbols } = calls()
  const bytes = Buffer.alloc(2168)
  checked(symbols.fstatfs$INODE64(fd, ptr(bytes)))
  const string = (start: number, size: number): string => {
    const value = bytes.subarray(start, start + size)
    const end = value.indexOf(0)
    if (end < 0) throw new Error('macOS filesystem identity is invalid')
    return new TextDecoder('utf-8', { fatal: true }).decode(value.subarray(0, end))
  }
  return Object.freeze({
    capacityBytes: BigInt(bytes.readUInt32LE(0)) * bytes.readBigUInt64LE(8),
    owner: bytes.readUInt32LE(56),
    flags: bytes.readUInt32LE(64),
    subtype: bytes.readUInt32LE(68),
    type: string(72, 16),
    mountpoint: string(88, 1024),
    device: string(1112, 1024),
  })
}

/** The reader remains private until its sole writer is closed by the capture owner. */
export async function privateMacosAnonymousBacking(): Promise<
  Readonly<{ writer: FileHandle; reader: FileHandle }>
> {
  calls()
  const path = await mkdtemp('/private/tmp/jig-capture-')
  let directory: FileHandle | undefined
  let writer: FileHandle | undefined
  let reader: FileHandle | undefined
  let named = false
  try {
    directory = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | NOFOLLOW_ANY | CLOEXEC,
    )
    writer = await privateMacosOpenAt(
      directory.fd,
      'data',
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL,
    )
    named = true
    reader = await privateMacosOpenAt(directory.fd, 'data', constants.O_RDONLY)
    const written = await writer.stat({ bigint: true }),
      read = await reader.stat({ bigint: true })
    if (
      !written.isFile() ||
      written.nlink !== 1n ||
      written.dev !== read.dev ||
      written.ino !== read.ino ||
      written.size !== 0n
    )
      throw new Error('macOS anonymous backing identity changed')
    privateMacosUnlinkAt(directory.fd, 'data')
    named = false
    if ((await reader.stat()).nlink !== 0) throw new Error('macOS anonymous backing remains named')
    await rmdir(path)
    const completedDirectory = directory
    directory = undefined
    await completedDirectory.close()
    return Object.freeze({ writer, reader })
  } catch (error) {
    await reader?.close().catch(() => undefined)
    await writer?.close().catch(() => undefined)
    if (named && directory !== undefined) privateMacosUnlinkAt(directory.fd, 'data')
    await rmdir(path).catch(() => undefined)
    throw error
  } finally {
    await directory?.close()
  }
}

export function privateMacosStatAt(parent: number, name: string | Uint8Array): BigIntStats {
  const { ptr, symbols } = calls()
  const path = nameBytes(name),
    bytes = Buffer.alloc(144)
  checked(symbols.fstatat$INODE64(parent, ptr(path), ptr(bytes), 0x20))
  // SDK offsets are independently compiled in macos-file-abi.c and compared to Node stats.
  const mode = BigInt(bytes.readUInt16LE(4))
  const atimeNs = bytes.readBigInt64LE(32) * 1_000_000_000n + bytes.readBigInt64LE(40)
  const mtimeNs = bytes.readBigInt64LE(48) * 1_000_000_000n + bytes.readBigInt64LE(56)
  const ctimeNs = bytes.readBigInt64LE(64) * 1_000_000_000n + bytes.readBigInt64LE(72)
  const birthtimeNs = bytes.readBigInt64LE(80) * 1_000_000_000n + bytes.readBigInt64LE(88)
  const kind = (type: bigint) => (mode & 0xf000n) === type
  return {
    dev: BigInt(bytes.readInt32LE(0)),
    mode,
    nlink: BigInt(bytes.readUInt16LE(6)),
    ino: bytes.readBigUInt64LE(8),
    uid: BigInt(bytes.readUInt32LE(16)),
    gid: BigInt(bytes.readUInt32LE(20)),
    rdev: BigInt(bytes.readInt32LE(24)),
    size: bytes.readBigInt64LE(96),
    blocks: bytes.readBigInt64LE(104),
    blksize: BigInt(bytes.readInt32LE(112)),
    atimeNs,
    mtimeNs,
    ctimeNs,
    birthtimeNs,
    atimeMs: atimeNs / 1_000_000n,
    mtimeMs: mtimeNs / 1_000_000n,
    ctimeMs: ctimeNs / 1_000_000n,
    birthtimeMs: birthtimeNs / 1_000_000n,
    atime: new Date(Number(atimeNs / 1_000_000n)),
    mtime: new Date(Number(mtimeNs / 1_000_000n)),
    ctime: new Date(Number(ctimeNs / 1_000_000n)),
    birthtime: new Date(Number(birthtimeNs / 1_000_000n)),
    isFile: () => kind(0x8000n),
    isDirectory: () => kind(0x4000n),
    isSymbolicLink: () => kind(0xa000n),
    isBlockDevice: () => kind(0x6000n),
    isCharacterDevice: () => kind(0x2000n),
    isFIFO: () => kind(0x1000n),
    isSocket: () => kind(0xc000n),
  }
}

export function privateMacosDirectory(fd: number) {
  const { ptr, symbols, toArrayBuffer } = calls()
  const dot = Buffer.from('.\0')
  // A new open-file description keeps enumeration offsets independent of the borrowed handle.
  const duplicate = checked(
    symbols.openat(
      fd,
      ptr(dot),
      constants.O_RDONLY | constants.O_DIRECTORY | CLOEXEC | NOFOLLOW_ANY,
      0,
    ),
  )
  const stream = symbols.fdopendir$INODE64(duplicate)
  if (!stream) {
    const code = errnoBytes().readInt32LE()
    closeSync(duplicate)
    throw Object.assign(new Error('macOS directory stream unavailable'), {
      code: getSystemErrorName(-code),
    })
  }
  let closed = false
  const read = (): Dirent<Buffer> | null => {
    if (closed) throw new Error('macOS directory stream is closed')
    for (;;) {
      errnoBytes().writeInt32LE(0)
      const entry = symbols.readdir$INODE64(stream)
      if (!entry) {
        if (errnoBytes().readInt32LE() !== 0) checked(-1)
        return null
      }
      const header = Buffer.from(toArrayBuffer(entry, 0, 21))
      const length = header.readUInt16LE(18),
        recordLength = header.readUInt16LE(16),
        type = header[20]
      if (length > 1023 || recordLength < 22 + length || recordLength > 1048)
        throw new Error('invalid macOS directory entry')
      const bytes = Buffer.from(new Uint8Array(toArrayBuffer(entry, 21, length + 1)))
      if (bytes[length] !== 0 || bytes.subarray(0, length).includes(0))
        throw new Error('invalid macOS directory name')
      const name = bytes.subarray(0, length)
      if (name.equals(Buffer.from('.')) || name.equals(Buffer.from('..'))) continue
      return {
        name,
        parentPath: '',
        isFile: () => type === 8,
        isDirectory: () => type === 4,
        isSymbolicLink: () => type === 10,
        isBlockDevice: () => type === 6,
        isCharacterDevice: () => type === 2,
        isFIFO: () => type === 1,
        isSocket: () => type === 12,
      }
    }
  }
  const close = () => {
    if (closed) return
    closed = true
    checked(symbols.closedir(stream))
  }
  return {
    readSync: read,
    closeSync: close,
    async read() {
      return read()
    },
    async close() {
      close()
    },
    async *[Symbol.asyncIterator]() {
      try {
        for (;;) {
          const entry = read()
          if (entry === null) break
          yield entry
        }
      } finally {
        close()
      }
    },
  }
}

export function privateMacosMkdirAt(parent: number, name: string, mode: number): void {
  const { ptr, symbols } = calls(),
    path = nameBytes(name)
  checked(symbols.mkdirat(parent, ptr(path), mode))
}
export function privateMacosUnlinkAt(parent: number, name: string, directory = false): void {
  const { ptr, symbols } = calls(),
    path = nameBytes(name)
  checked(symbols.unlinkat(parent, ptr(path), directory ? 0x80 : 0))
}
export function privateMacosRenameAt(
  source: number,
  from: string,
  target: number,
  to: string,
  exclusive = false,
): void {
  const { ptr, symbols } = calls(),
    old = nameBytes(from),
    next = nameBytes(to)
  checked(symbols.renameatx_np(source, ptr(old), target, ptr(next), exclusive ? 4 : 0))
}
export function privateMacosReadlinkAt(parent: number, name: string): Buffer {
  const { ptr, symbols } = calls(),
    path = nameBytes(name),
    bytes = Buffer.alloc(4097)
  const length = checked(Number(symbols.readlinkat(parent, ptr(path), ptr(bytes), bytes.length)))
  if (length >= bytes.length) throw new Error('macOS link target exceeds its bound')
  return bytes.subarray(0, length)
}

export function privateMacosLinkAt(source: number, from: string, target: number, to: string): void {
  const { ptr, symbols } = calls(),
    old = nameBytes(from),
    next = nameBytes(to)
  checked(symbols.linkat(source, ptr(old), target, ptr(next), 0))
}
export function privateMacosSymlinkAt(parent: number, name: string, target: string): void {
  const { ptr, symbols } = calls(),
    path = nameBytes(name)
  if (!target || Buffer.byteLength(target) > 4096 || target.includes('\0'))
    throw new Error('invalid macOS link target')
  const bytes = Buffer.from(`${target}\0`)
  checked(symbols.symlinkat(ptr(bytes), parent, ptr(path)))
}
