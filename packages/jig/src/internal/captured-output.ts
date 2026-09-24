import { closeSync, fstatSync } from 'node:fs'
import {
  capturePrivateBytes,
  type PrivateCapturedBytes,
  readPrivateCapturedBytes,
  requirePrivateCapturedBytes,
} from './captured-bytes.js'
import {
  PRIVATE_DIRECTORY_OPEN_FLAGS,
  PRIVATE_FILE_LIMITS,
  privateFilePath,
  privateInputDirectory,
  privateOpenAt,
  privateReadRegularFile,
  sha256,
} from './file-input.js'
import { PRIVATE_CAPTURE_LIMITS } from './file-input-policy.js'

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
  constructor() {
    super('output exceeds its finite file profile')
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
    const output: PrivateCapturedOutput = Object.freeze({
      files,
      directories: Object.freeze(directories),
      bytes: backing.bytes,
      digest: backing.digest,
      close: () => backing.close(),
    })
    authentic.set(output, backing)
    return output
  } finally {
    for (const file of contents) file.data.fill(0)
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
