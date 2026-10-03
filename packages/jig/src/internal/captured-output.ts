import { closeSync, fstatSync, readSync } from 'node:fs'
import {
  capturePrivateBytes,
  type PrivateCapturedBytes,
  readPrivateCapturedBytes,
  requirePrivateCapturedBytes,
} from './captured-bytes.js'
import {
  PRIVATE_DIRECTORY_OPEN_FLAGS,
  PRIVATE_FILE_LIMITS,
  PrivateFileInputError,
  privateFilePath,
  privateInputDirectory,
  privateOpenAt,
  privateReadRegularFile,
  sha256,
} from './file-input.js'
import { PRIVATE_CAPTURE_LIMITS } from './file-input-policy.js'
import {
  type PrivateMacosReceivedDescriptors,
  requirePrivateMacosReceivedDescriptors,
} from './macos-descriptor-handoff.js'

export interface PrivateOutputFile {
  readonly path: string
  readonly offset: number
  readonly bytes: number
  readonly digest: string
}
export interface PrivateCapturedOutput {
  readonly files: readonly PrivateOutputFile[]
  /** Retain empty directories too: native-session collectors validate the whole tree. */
  readonly directories: readonly string[]
  readonly bytes: number
  readonly digest: string
  close(): void
}
const authentic = new WeakMap<object, PrivateCapturedBytes<'output'>>()

/** A content-profile refusal, distinct from a descriptor or I/O failure. */
export class PrivateOutputProfileError extends Error {
  constructor(cause?: unknown) {
    super('output exceeds its finite file profile', { cause })
  }
}

/** Caller must first prove all writers fenced. Copy through that held directory
 * into anonymous immutable bytes, so storage can be released before publication. */
export function capturePrivateOutput(
  directory: number,
  signal?: AbortSignal,
): PrivateCapturedOutput {
  if (!Number.isSafeInteger(directory) || directory < 0 || !fstatSync(directory).isDirectory())
    throw new TypeError('output capture requires an owned directory')
  const end = performance.now() + PRIVATE_FILE_LIMITS.deliveryMs
  let bytes = 0,
    entries = 0
  const contents: { path: string; data: Buffer }[] = [],
    directories: string[] = []
  const check = () => {
    signal?.throwIfAborted()
    if (performance.now() >= end) throw new Error('output capture deadline exceeded')
  }
  const visit = (prefix: string) => {
    check()
    const fd =
      prefix === '' ? directory : privateOpenAt(directory, prefix, PRIVATE_DIRECTORY_OPEN_FLAGS)
    let reader: ReturnType<typeof privateInputDirectory> | undefined
    try {
      reader = privateInputDirectory(fd)
      for (;;) {
        check()
        const entry = reader.readSync()
        if (entry === null) break
        if (++entries > PRIVATE_FILE_LIMITS.entries) throw new PrivateOutputProfileError()
        const path = privateFilePath(prefix === '' ? entry.name : `${prefix}/${entry.name}`)
        if (entry.isDirectory()) {
          directories.push(path)
          visit(path)
        } else {
          if (
            contents.length >= PRIVATE_FILE_LIMITS.files ||
            contents.some((file) => file.path === path)
          )
            throw new PrivateOutputProfileError()
          const data = privateReadRegularFile(
            directory,
            path,
            PRIVATE_CAPTURE_LIMITS.output - bytes,
          )
          bytes += data.length
          contents.push({ path, data })
        }
      }
    } finally {
      try {
        reader?.closeSync()
      } finally {
        if (fd !== directory) closeSync(fd)
      }
    }
  }
  try {
    visit('')
    contents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    directories.sort()
    let offset = 0
    const files = Object.freeze(
      contents.map(({ path, data }) => {
        const file = Object.freeze({ path, offset, bytes: data.length, digest: sha256(data) })
        offset += data.length
        return file
      }),
    )
    check()
    const data = Buffer.concat(
      contents.map((file) => file.data),
      bytes,
    )
    let backing: PrivateCapturedBytes<'output'>
    try {
      backing = capturePrivateBytes(data, 'output')
    } finally {
      data.fill(0)
    }
    try {
      check()
    } catch (error) {
      backing.close()
      throw error
    }
    return mint(backing, files, Object.freeze(directories))
  } catch (error) {
    if (
      error instanceof PrivateFileInputError &&
      ['bytes', 'files', 'entries', 'path', 'symlink', 'linked', 'regular'].includes(error.reason)
    )
      throw new PrivateOutputProfileError(error)
    throw error
  } finally {
    for (const file of contents) file.data.fill(0)
  }
}

function mint(
  backing: PrivateCapturedBytes<'output'>,
  files: readonly PrivateOutputFile[],
  directories: readonly string[],
): PrivateCapturedOutput {
  const output = Object.freeze({
    files,
    directories,
    bytes: backing.bytes,
    digest: backing.digest,
    close: () => backing.close(),
  })
  authentic.set(output, backing)
  return output
}

/** Recreate private immutable bytes only from a live authenticated native transfer.
 * The trusted command protocol separately owns terminal and cleanup admission. */
export function capturePrivateTransferredOutput(
  bundle: PrivateMacosReceivedDescriptors,
  value: unknown,
): PrivateCapturedOutput {
  const descriptors = requirePrivateMacosReceivedDescriptors(bundle)
  const identity = value as PrivateCapturedOutput
  if (
    descriptors.length !== 1 ||
    identity === null ||
    typeof identity !== 'object' ||
    Object.keys(identity).sort().join() !== 'bytes,digest,directories,files' ||
    !Number.isSafeInteger(identity.bytes) ||
    identity.bytes < 0 ||
    identity.bytes > PRIVATE_CAPTURE_LIMITS.output ||
    typeof identity.digest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(identity.digest) ||
    !Array.isArray(identity.files) ||
    identity.files.length > PRIVATE_FILE_LIMITS.files ||
    !Array.isArray(identity.directories) ||
    identity.files.length + identity.directories.length > PRIVATE_FILE_LIMITS.entries
  )
    throw new TypeError('invalid transferred output manifest')
  let offset = 0
  const files = identity.files.map((file) => {
    if (
      file === null ||
      typeof file !== 'object' ||
      Object.keys(file).sort().join() !== 'bytes,digest,offset,path' ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.offset !== offset ||
      typeof file.digest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(file.digest)
    )
      throw new TypeError('invalid transferred output file')
    const path = privateFilePath(file.path)
    offset += file.bytes
    if (offset > identity.bytes)
      throw new TypeError('transferred output offsets exceed its backing')
    return Object.freeze({ path, offset: file.offset, bytes: file.bytes, digest: file.digest })
  })
  const directories = identity.directories.map(privateFilePath)
  const ordered = (names: readonly string[]) =>
    names.every((name, index) => index === 0 || names[index - 1]! < name)
  const directorySet = new Set(directories)
  if (
    offset !== identity.bytes ||
    !ordered(files.map((file) => file.path)) ||
    !ordered(directories) ||
    files.some((file) => directorySet.has(file.path))
  )
    throw new TypeError('transferred output paths conflict')
  for (const path of [...directories, ...files.map((file) => file.path)]) {
    const parts = path.split('/')
    for (let count = 1; count < parts.length; count++)
      if (!directorySet.has(parts.slice(0, count).join('/')))
        throw new TypeError('transferred output parent is absent')
  }
  const fd = descriptors[0]!
  const before = fstatSync(fd, { bigint: true })
  if (!before.isFile() || before.nlink !== 0n || before.size !== BigInt(identity.bytes))
    throw new Error('transferred output is not the declared anonymous file')
  const bytes = Buffer.alloc(identity.bytes)
  try {
    for (let offset = 0; offset < bytes.length; ) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (!count) throw new Error('transferred output ended early')
      offset += count
    }
    const after = fstatSync(fd, { bigint: true })
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      after.nlink !== 0n ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      sha256(bytes) !== identity.digest ||
      files.some(
        (file) => sha256(bytes.subarray(file.offset, file.offset + file.bytes)) !== file.digest,
      )
    )
      throw new Error('transferred output identity changed')
    return mint(
      capturePrivateBytes(bytes, 'output'),
      Object.freeze(files),
      Object.freeze(directories),
    )
  } finally {
    bytes.fill(0)
  }
}

function backing(value: PrivateCapturedOutput): PrivateCapturedBytes<'output'> {
  const result = value !== null && typeof value === 'object' ? authentic.get(value) : undefined
  if (result === undefined) throw new TypeError('output capture is not authentic')
  return result
}

/** Borrowed descriptor, never close it separately or recreate authority from metadata. */
export function requirePrivateCapturedOutput(value: PrivateCapturedOutput) {
  const bytes = requirePrivateCapturedBytes(backing(value), 'output')
  return Object.freeze({ ...bytes, files: value.files, directories: value.directories })
}

/** Fresh owned bytes for one bounded collection; mutations cannot alter the snapshot. */
export function readPrivateCapturedOutput(
  value: PrivateCapturedOutput,
): readonly (PrivateOutputFile & { readonly contents: Buffer })[] {
  const bytes = readPrivateCapturedBytes(backing(value), 'output')
  return Object.freeze(
    value.files.map((file) => {
      const contents = bytes.subarray(file.offset, file.offset + file.bytes)
      if (sha256(contents) !== file.digest) throw new Error('output snapshot identity changed')
      return Object.freeze({ ...file, contents })
    }),
  )
}
