import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync } from 'node:fs'
import {
  capturePrivateOutputByteStream,
  type PrivateCapturedBytes,
  readPrivateCapturedBytes,
  requirePrivateCapturedBytes,
} from './captured-bytes.js'
import {
  privateDescriptorByteChunks,
  privateDescriptorByteDigest,
} from './descriptor-byte-stream.js'
import {
  PRIVATE_DIRECTORY_OPEN_FLAGS,
  PRIVATE_FILE_LIMITS,
  PrivateFileInputError,
  privateFilePath,
  privateInputDirectory,
  privateOpenAt,
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

export interface PrivateOutputManifest {
  readonly files: readonly PrivateOutputFile[]
  readonly directories: readonly string[]
  readonly bytes: number
}

/** Bounded evidence from a held tree after writer fencing; creates no byte copy. */
export function inspectPrivateOutput(
  directory: number,
  signal?: AbortSignal,
): PrivateOutputManifest {
  if (!Number.isSafeInteger(directory) || directory < 0 || !fstatSync(directory).isDirectory())
    throw new TypeError('output capture requires an owned directory')
  const end = performance.now() + PRIVATE_FILE_LIMITS.deliveryMs
  let bytes = 0,
    entries = 0
  const paths: string[] = [],
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
          if (paths.length >= PRIVATE_FILE_LIMITS.files || paths.includes(path))
            throw new PrivateOutputProfileError()
          paths.push(path)
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
    paths.sort()
    directories.sort()
    const files: PrivateOutputFile[] = []
    for (const path of paths) {
      check()
      const fd = privateOpenAt(directory, path, constants.O_RDONLY | constants.O_NONBLOCK)
      try {
        const before = fstatSync(fd, { bigint: true })
        if (!before.isFile() || before.nlink !== 1n) throw new PrivateFileInputError('linked')
        if (before.size < 0n || before.size > BigInt(PRIVATE_CAPTURE_LIMITS.output - bytes))
          throw new PrivateOutputProfileError()
        const size = Number(before.size)
        const hash = createHash('sha256')
        for (const chunk of privateDescriptorByteChunks(fd, size)) {
          check()
          hash.update(chunk)
        }
        const after = fstatSync(fd, { bigint: true })
        if (
          after.size !== before.size ||
          after.mtimeNs !== before.mtimeNs ||
          after.ctimeNs !== before.ctimeNs ||
          after.nlink !== 1n
        )
          throw new PrivateFileInputError('changed')
        files.push(
          Object.freeze({
            path,
            offset: bytes,
            bytes: size,
            digest: `sha256:${hash.digest('hex')}`,
          }),
        )
        bytes += size
      } finally {
        closeSync(fd)
      }
    }
    check()
    return Object.freeze({
      files: Object.freeze(files),
      directories: Object.freeze(directories),
      bytes,
    })
  } catch (error) {
    if (
      error instanceof PrivateFileInputError &&
      ['bytes', 'files', 'entries', 'path', 'symlink', 'linked', 'regular'].includes(error.reason)
    )
      throw new PrivateOutputProfileError(error)
    throw error
  }
}

/** Caller must first prove all writers fenced. The immutable snapshot permits
 * its original native backing to retire before ordinary packet publication. */
export function capturePrivateOutput(
  directory: number,
  signal?: AbortSignal,
): PrivateCapturedOutput {
  const deadline = performance.now() + PRIVATE_FILE_LIMITS.deliveryMs
  const check = () => {
    signal?.throwIfAborted()
    if (performance.now() >= deadline) throw new Error('output capture deadline exceeded')
  }
  const manifest = inspectPrivateOutput(directory, signal)
  function* contents() {
    for (const file of manifest.files) {
      check()
      yield* privateOutputFileChunks(directory, file, check)
    }
  }
  const backing = capturePrivateOutputByteStream(contents())
  return mint(backing, manifest.files, manifest.directories)
}

/** A second pass rechecks every byte while a caller writes to its private stage.
 * The caller keeps the original backing fenced and owns failure cleanup. */
export function* privateOutputFileChunks(
  directory: number,
  file: Pick<PrivateOutputFile, 'path' | 'bytes' | 'digest'>,
  check: () => void,
): Generator<Buffer> {
  const fd = privateOpenAt(directory, file.path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const before = fstatSync(fd, { bigint: true })
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(file.bytes))
      throw new Error('output file identity changed')
    const hash = createHash('sha256')
    for (const chunk of privateDescriptorByteChunks(fd, file.bytes)) {
      check()
      hash.update(chunk)
      yield chunk
    }
    const after = fstatSync(fd, { bigint: true })
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      after.nlink !== 1n ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      `sha256:${hash.digest('hex')}` !== file.digest
    )
      throw new Error('output file changed after validation')
  } finally {
    closeSync(fd)
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
  if (
    privateDescriptorByteDigest(fd, identity.bytes) !== identity.digest ||
    files.some((file) => privateDescriptorByteDigest(fd, file.bytes, file.offset) !== file.digest)
  )
    throw new Error('transferred output identity changed')
  const capture = capturePrivateOutputByteStream(privateDescriptorByteChunks(fd, identity.bytes))
  try {
    const after = fstatSync(fd, { bigint: true })
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      after.nlink !== 0n ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      capture.digest !== identity.digest
    )
      throw new Error('transferred output identity changed')
    return mint(capture, Object.freeze(files), Object.freeze(directories))
  } catch (error) {
    capture.close()
    throw error
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
