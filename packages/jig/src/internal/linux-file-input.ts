import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  opendirSync,
  readFileSync,
  readSync,
  realpathSync,
  statfsSync,
  writeSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, posix, resolve } from 'node:path'
import { getSystemErrorName } from 'node:util'

/** Private Linux-x64 file boundary. No application or provider code runs here. */
export const PRIVATE_FILE_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  files: 64,
  entries: 256,
  pathBytes: 512,
  depth: 16,
  captureMs: 10_000,
  deliveryMs: 20_000,
})
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CLOSED_SEALS = 0x0f
const O_PATH = 0x200000
const O_CLOEXEC = 0x80000
const O_DIRECTORY = 0x10000
const NO_SYMLINKS = 0x04
const BENEATH = 0x08
const NO_XDEV = 0x01
const filesystemTypes = new Set([0xef53, 0x58465342, 0x9123683e, 0x01021994])
const protectedParts = new Set(['.jig'])
// biome-ignore lint/suspicious/noControlCharactersInRegex: The file boundary must reject control characters.
const FILE_CONTROLS = /[\x00-\x1f\x7f]/

/** Only these locally authored messages may cross the CLI diagnostic boundary. */
export class PrivateFileInputError extends Error {
  constructor(
    readonly reason:
      | 'filesystem'
      | 'path'
      | 'protected'
      | 'linked'
      | 'changed'
      | 'bytes'
      | 'files'
      | 'entries'
      | 'deadline',
    readonly limit?: number,
  ) {
    super(
      {
        filesystem: 'use a local ext4, XFS, Btrfs, or tmpfs filesystem',
        path: 'select a relative path without traversal or links, within 16 components and 512 UTF-8 bytes',
        protected: 'Jig state and host control files cannot be selected as input',
        linked: 'select only singly linked regular files',
        changed: 'selected input changed during capture; capture a stable source tree',
        bytes: `selected file exceeds the remaining ${limit ?? 0}-byte input budget; select less data`,
        files: 'input exceeds 64 files; narrow the selection with --select',
        entries: 'input exceeds 256 tree entries; narrow the selection with --select',
        deadline: 'input capture exceeded its 10-second budget; select a smaller local tree',
      }[reason],
    )
  }
}

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
  const libc = posix.join(dirname(realpathSync('/lib64/ld-linux-x86-64.so.2')), 'libc.so.6')
  const { symbols } = ffi.dlopen(libc, {
    syscall: { args: ['i64', 'i32', 'ptr', 'ptr', 'u64'], returns: 'i32' },
    memfd_create: { args: ['ptr', 'u32'], returns: 'i32' },
    fcntl: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
    renameat2: { args: ['i32', 'ptr', 'i32', 'ptr', 'u32'], returns: 'i32' },
    __errno_location: { args: [], returns: 'ptr' },
  })
  native = { ffi, symbols }
  return native
}
function result(value: number): number {
  if (value >= 0) return value
  const { ffi, symbols } = calls()
  const code = getSystemErrorName(-ffi.read.i32(symbols.__errno_location!()))
  throw Object.assign(new Error(`file boundary operation failed (${code})`), { code })
}
function cString(value: string): Buffer {
  if (value.includes('\0')) throw new TypeError('file path contains NUL')
  return Buffer.from(`${value}\0`)
}

export function privateOpenAt(
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

export function privatePublishDirectory(parent: number, staged: string, destination: string): void {
  privateFilePath(staged)
  privateFilePath(destination)
  if (staged.includes('/') || destination.includes('/'))
    throw new TypeError('publication requires two leaf names')
  const { ffi, symbols } = calls()
  const source = cString(staged),
    target = cString(destination)
  result(symbols.renameat2!(parent, ffi.ptr(source), parent, ffi.ptr(target), 1))
}

export function privateFilePath(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value) > PRIVATE_FILE_LIMITS.pathBytes ||
    Buffer.from(value).toString('utf8') !== value ||
    value.includes('\\') ||
    FILE_CONTROLS.test(value) ||
    value
      .split('/')
      .some((part) => !part || part === '.' || part === '..' || protectedParts.has(part)) ||
    value.split('/').length > PRIVATE_FILE_LIMITS.depth
  )
    throw new PrivateFileInputError('path')
  return value
}
export function privateAttachmentName(value: string): string {
  if (typeof value !== 'string' || value.length > 64 || !NAME.test(value))
    throw new TypeError('invalid attachment name')
  return value
}

/** Resolve an operator-selected root, rejecting symlinks and protected aliases. */
export function privateOpenFileRoot(path: string): number {
  const absolute = resolve(path)
  const fd = privateOpenAt(-100, absolute, O_PATH | O_DIRECTORY, false)
  try {
    if (!filesystemTypes.has(statfsSync(`/proc/self/fd/${fd}`).type))
      throw new PrivateFileInputError('filesystem')
    requireUnprotected(absolute)
    // A bind-mounted alias retains its source root in mountinfo. Inspect that
    // root as well as the visible spelling before accepting the descriptor.
    const mountId = /^mnt_id:\s+(\d+)$/m.exec(readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8'))?.[1]
    const mount = readFileSync('/proc/self/mountinfo', 'utf8')
      .split('\n')
      .find((line) => line.split(' ')[0] === mountId)
      ?.split(' ')
    if (mount === undefined) throw new TypeError('file mount identity is unavailable')
    const decodeMountPath = (text: string) =>
      text.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))
    const root = decodeMountPath(mount[3]!),
      point = decodeMountPath(mount[4]!)
    const relative = posix.relative(point, absolute)
    if (relative.startsWith('../') || posix.isAbsolute(relative))
      throw new TypeError('file mount identity changed')
    requireUnprotected(posix.join(root, relative))
    return fd
  } catch (error) {
    closeSync(fd)
    throw error
  }
}
function requireUnprotected(path: string): void {
  if (
    path.split('/').some((part) => protectedParts.has(part)) ||
    ['/proc', '/sys', '/dev', '/run'].some((root) => path === root || path.startsWith(`${root}/`))
  ) {
    throw new PrivateFileInputError('protected')
  }
}

export interface PrivateCapturedFile {
  readonly path: string
  readonly bytes: number
  readonly digest: string
  readonly fd: number
}
export interface PrivateCapturedAttachment {
  readonly name: string
  readonly rootFd: number
  readonly files: readonly PrivateCapturedFile[]
}
export interface PrivateFileSelection {
  readonly name: string
  readonly directory: string
  readonly select: readonly string[]
}

export function privateReadRegularFile(parent: number, path: string, maxBytes: number): Buffer {
  const fd = privateOpenAt(parent, privateFilePath(path), constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const before = fstatSync(fd, { bigint: true })
    if (!before.isFile() || before.nlink !== 1n) throw new PrivateFileInputError('linked')
    if (before.size > BigInt(maxBytes)) throw new PrivateFileInputError('bytes', maxBytes)
    const bytes = Buffer.alloc(Number(before.size) + 1)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null)
      if (count === 0) break
      offset += count
    }
    const after = fstatSync(fd, { bigint: true })
    if (
      offset !== Number(before.size) ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      after.nlink !== 1n
    )
      throw new PrivateFileInputError('changed')
    return bytes.subarray(0, offset)
  } finally {
    closeSync(fd)
  }
}

export function privateCaptureAttachments(selections: readonly PrivateFileSelection[]): {
  readonly attachments: readonly PrivateCapturedAttachment[]
  close(): void
} {
  const attachments: PrivateCapturedAttachment[] = []
  const opened: number[] = []
  const deadline = performance.now() + PRIVATE_FILE_LIMITS.captureMs
  const checkTime = () => {
    if (performance.now() >= deadline) throw new PrivateFileInputError('deadline')
  }
  let byteCount = 0,
    fileCount = 0,
    entryCount = 0
  const close = () => {
    for (const fd of opened.splice(0)) closeSync(fd)
  }
  try {
    if (
      selections.length > 8 ||
      new Set(selections.map((item) => item.name)).size !== selections.length
    )
      throw new TypeError('invalid attachment mappings')
    for (const selection of [...selections].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      checkTime()
      const name = privateAttachmentName(selection.name)
      const rootFd = privateOpenFileRoot(selection.directory)
      opened.push(rootFd)
      const files: PrivateCapturedFile[] = []
      const capture = (path: string) => {
        checkTime()
        if (files.some((file) => file.path === path))
          throw new TypeError('duplicate captured file path')
        if (++fileCount > PRIVATE_FILE_LIMITS.files) throw new PrivateFileInputError('files')
        const data = privateReadRegularFile(rootFd, path, PRIVATE_FILE_LIMITS.bytes - byteCount)
        byteCount += data.length
        const fd = privateSealedBytes(data)
        opened.push(fd)
        files.push(Object.freeze({ path, bytes: data.length, digest: sha256(data), fd }))
      }
      const walk = (relative: string) => {
        const fd =
          relative === ''
            ? rootFd
            : privateOpenAt(rootFd, privateFilePath(relative), O_PATH | O_DIRECTORY)
        const directory = opendirSync(`/proc/self/fd/${fd}`, { encoding: 'utf8' })
        try {
          for (;;) {
            checkTime()
            const entry = directory.readSync()
            if (entry === null) break
            if (++entryCount > PRIVATE_FILE_LIMITS.entries)
              throw new PrivateFileInputError('entries')
            const path = privateFilePath(relative === '' ? entry.name : `${relative}/${entry.name}`)
            if (entry.isDirectory()) walk(path)
            else capture(path)
          }
        } finally {
          directory.closeSync()
          if (fd !== rootFd) closeSync(fd)
        }
      }
      if (selection.select.length === 0) walk('')
      else {
        if (new Set(selection.select).size !== selection.select.length)
          throw new TypeError('duplicate file selector')
        for (const path of selection.select) capture(privateFilePath(path))
      }
      attachments.push(
        Object.freeze({
          name,
          rootFd,
          files: Object.freeze(files.sort((a, b) => (a.path < b.path ? -1 : 1))),
        }),
      )
    }
    checkTime()
    return Object.freeze({ attachments: Object.freeze(attachments), close })
  } catch (error) {
    close()
    throw error
  }
}

export function privateSealedBytes(bytes: Uint8Array): number {
  const { ffi, symbols } = calls()
  const name = cString('jig-input')
  const fd = result(symbols.memfd_create!(ffi.ptr(name), 3))
  try {
    let offset = 0
    while (offset < bytes.length)
      offset += writeSync(fd, bytes, offset, bytes.length - offset, offset)
    result(symbols.fcntl!(fd, 1033, CLOSED_SEALS))
    return fd
  } catch (error) {
    closeSync(fd)
    throw error
  }
}
export function privateVerifySealedFile(fd: number, bytes: number, digest: string): void {
  if (
    !Number.isSafeInteger(fd) ||
    fd < 0 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > PRIVATE_FILE_LIMITS.bytes ||
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
export function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
