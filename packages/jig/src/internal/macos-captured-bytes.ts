import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { privateDescriptorByteDigest } from './descriptor-byte-stream.js'
import {
  PRIVATE_CAPTURE_CHUNK_BYTES,
  PRIVATE_CAPTURE_LIMITS,
  type PrivateCapturePurpose,
} from './file-input-policy.js'

const O_CLOEXEC = 0x01000000
const authentic = new WeakMap<object, Capture>()

interface Capture {
  readonly purpose: PrivateCapturePurpose
  readonly fd: number
  readonly bytes: number
  readonly digest: string
  readonly device: bigint
  readonly inode: bigint
  closed: boolean
}

/** A private capability minted by the capture operation, never by decoding data. */
export interface PrivateMacosCapturedBytes {
  readonly purpose: PrivateCapturePurpose
  readonly bytes: number
  readonly digest: string
  close(): void
}

/**
 * Create anonymous read-only bytes without a filesystem-image mount. Closing
 * the only writer and removing the only name happen before minting the handle.
 * Its construction provenance is required: O_RDONLY alone does not prove that
 * another writable descriptor does not exist. This is not a Linux memfd seal.
 * The caller owns the directory outside every payload's filesystem grants;
 * same-UID directory permissions alone do not establish that isolation.
 */
export function capturePrivateMacosBytes(
  ownerDirectory: string,
  input: Uint8Array,
  purpose: PrivateCapturePurpose,
): PrivateMacosCapturedBytes {
  if (
    !(input instanceof Uint8Array) ||
    !Object.hasOwn(PRIVATE_CAPTURE_LIMITS, purpose) ||
    input.byteLength > PRIVATE_CAPTURE_LIMITS[purpose]
  )
    throw new TypeError('captured bytes exceed their byte limit')
  const bytes = Buffer.from(input)
  function* chunks() {
    for (let offset = 0; offset < bytes.length; offset += PRIVATE_CAPTURE_CHUNK_BYTES)
      yield bytes.subarray(offset, offset + PRIVATE_CAPTURE_CHUNK_BYTES)
  }
  try {
    return capturePrivateMacosByteStream(ownerDirectory, chunks(), purpose)
  } finally {
    bytes.fill(0)
  }
}

/** The host borrows each small chunk synchronously; no full-tree copy is retained. */
export function capturePrivateMacosByteStream(
  ownerDirectory: string,
  chunks: Iterable<Uint8Array>,
  purpose: PrivateCapturePurpose,
): PrivateMacosCapturedBytes {
  const uid = process.getuid?.()
  if (process.platform !== 'darwin' || uid === undefined)
    throw new Error('macOS byte capture is unavailable')
  if (!Object.hasOwn(PRIVATE_CAPTURE_LIMITS, purpose))
    throw new TypeError('captured bytes exceed their byte limit')
  const owner = lstatSync(ownerDirectory, { bigint: true })
  if (
    !owner.isDirectory() ||
    owner.uid !== BigInt(uid) ||
    (owner.mode & 0o077n) !== 0n ||
    realpathSync(ownerDirectory) !== ownerDirectory
  )
    throw new Error('byte capture requires a canonical private owner directory')

  const path = join(ownerDirectory, `bytes-${randomBytes(16).toString('hex')}`)
  let writer: number | undefined
  let reader: number | undefined
  let named = false
  try {
    writer = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | O_CLOEXEC,
      0o600,
    )
    named = true
    let bytes = 0
    const hash = createHash('sha256')
    for (const chunk of chunks) {
      if (
        !(chunk instanceof Uint8Array) ||
        chunk.byteLength > PRIVATE_CAPTURE_CHUNK_BYTES ||
        bytes + chunk.byteLength > PRIVATE_CAPTURE_LIMITS[purpose]
      )
        throw new TypeError('captured stream exceeds its byte limit')
      let written = 0
      while (written < chunk.byteLength) {
        const count = writeSync(writer, chunk, written, chunk.byteLength - written, bytes + written)
        if (count <= 0) throw new Error('captured input write made no progress')
        written += count
      }
      hash.update(chunk)
      bytes += chunk.byteLength
    }
    reader = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC)
    const written = fstatSync(writer, { bigint: true })
    const read = fstatSync(reader, { bigint: true })
    if (
      !read.isFile() ||
      read.dev !== written.dev ||
      read.ino !== written.ino ||
      read.nlink !== 1n ||
      read.size !== BigInt(bytes)
    )
      throw new Error('captured input identity changed')
    unlinkSync(path)
    named = false
    const completedWriter = writer
    writer = undefined
    closeSync(completedWriter)
    if (fstatSync(reader).nlink !== 0) throw new Error('captured input still has a name')

    const record: Capture = {
      purpose,
      fd: reader,
      bytes,
      digest: `sha256:${hash.digest('hex')}`,
      device: read.dev,
      inode: read.ino,
      closed: false,
    }
    const capability: PrivateMacosCapturedBytes = Object.freeze({
      purpose,
      bytes: record.bytes,
      digest: record.digest,
      close() {
        if (record.closed) return
        // Mark it closed even if close reports an error; never retry a recycled FD.
        record.closed = true
        closeSync(record.fd)
      },
    })
    authentic.set(capability, record)
    reader = undefined
    return capability
  } finally {
    try {
      if (writer !== undefined) closeSync(writer)
    } finally {
      try {
        if (reader !== undefined) closeSync(reader)
      } finally {
        if (named) unlinkSync(path)
      }
    }
  }
}

/** Revalidate the minted handle before transferring it over a trusted handoff. */
export function requirePrivateMacosCapturedBytes(
  value: unknown,
  purpose: PrivateCapturePurpose,
): Readonly<{
  fd: number
  bytes: number
  digest: string
}> {
  const record = value !== null && typeof value === 'object' ? authentic.get(value) : undefined
  if (record === undefined || record.closed || record.purpose !== purpose)
    throw new TypeError('captured bytes are not active for this purpose')
  const info = fstatSync(record.fd, { bigint: true })
  if (
    !info.isFile() ||
    info.dev !== record.device ||
    info.ino !== record.inode ||
    info.nlink !== 0n ||
    info.size !== BigInt(record.bytes)
  )
    throw new Error('captured input identity changed')
  if (privateDescriptorByteDigest(record.fd, record.bytes) !== record.digest)
    throw new Error('captured input bytes changed')
  return Object.freeze({ fd: record.fd, bytes: record.bytes, digest: record.digest })
}
