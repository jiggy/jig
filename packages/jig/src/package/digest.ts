import { createHash } from 'node:crypto'

import { invalid } from '../diagnostics.js'
import { PACKAGE_1_HEADER_TEXT, PACKAGE_1_LIMITS } from './capacity.js'
import { assertNoPathCollisions, comparePathBytes } from './paths.js'

const PACKAGE_1_HEADER = Buffer.from(PACKAGE_1_HEADER_TEXT, 'ascii')

export { PACKAGE_1_LIMITS } from './capacity.js'

export interface PackageDigestFile {
  readonly path: string
  readonly size: number
}

export async function packageDigest(
  files: readonly PackageDigestFile[],
  contents: (file: PackageDigestFile) => AsyncIterable<Uint8Array>,
): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of encodePackage1(files, contents)) hash.update(chunk)
  return `sha256:${hash.digest('hex')}`
}

/** The exact canonical byte sequence hashed by Package/0. */
export async function* encodePackage1(
  files: readonly PackageDigestFile[],
  contents: (file: PackageDigestFile) => AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  if (files.length > PACKAGE_1_LIMITS.files)
    invalid('PACKAGE_LIMIT', `package exceeds ${PACKAGE_1_LIMITS.files} files`)
  assertNoPathCollisions(files.map((file) => file.path))
  const ordered = files
    .map((file) => Object.freeze({ path: file.path, size: file.size }))
    .sort((left, right) => comparePathBytes(left.path, right.path))
  let totalBytes = 0
  for (const file of ordered) {
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > PACKAGE_1_LIMITS.fileBytes
    ) {
      invalid('PACKAGE_LIMIT', `invalid content size for ${file.path}`, file.path)
    }
    totalBytes += file.size
    if (totalBytes > PACKAGE_1_LIMITS.totalBytes)
      invalid('PACKAGE_LIMIT', `package exceeds ${PACKAGE_1_LIMITS.totalBytes} bytes`)
  }
  // Do not expose the mutable module-owned Buffer to a consumer.
  yield Uint8Array.from(PACKAGE_1_HEADER)
  yield unsignedBigEndian(BigInt(ordered.length), 8)
  for (const file of ordered) {
    const path = Buffer.from(file.path, 'utf8')
    yield Uint8Array.of(0x01)
    yield unsignedBigEndian(BigInt(path.byteLength), 4)
    yield path
    yield unsignedBigEndian(BigInt(file.size), 8)
    let observed = 0
    for await (const chunk of contents(file)) {
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError(`digest source ${file.path} yielded a non-byte chunk`)
      }
      observed += chunk.byteLength
      if (observed > file.size)
        throw new Error(`digest source ${file.path} exceeds its declared size`)
      yield chunk
    }
    if (observed !== file.size)
      throw new Error(`digest source ${file.path} does not match its declared size`)
  }
}

function unsignedBigEndian(value: bigint, bytes: number): Buffer {
  const maximum = 1n << BigInt(bytes * 8)
  if (value < 0n || value >= maximum) throw new RangeError('integer does not fit digest encoding')
  const result = Buffer.alloc(bytes)
  let remaining = value
  for (let index = bytes - 1; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return result
}
