import { createHash } from 'node:crypto'
import { readSync } from 'node:fs'
import { PRIVATE_CAPTURE_CHUNK_BYTES } from './file-input-policy.js'

/** Synchronous borrowing: a yielded view is valid only until the next iteration.
 * The caller owns the live descriptor and separately checks its provenance. */
export function* privateDescriptorByteChunks(
  fd: number,
  bytes: number,
  offset = 0,
): Generator<Buffer> {
  if (
    !Number.isSafeInteger(fd) ||
    fd < 0 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(offset + bytes)
  )
    throw new TypeError('invalid descriptor byte range')
  const buffer = Buffer.alloc(Math.min(bytes, PRIVATE_CAPTURE_CHUNK_BYTES))
  try {
    let consumed = 0
    while (consumed < bytes) {
      const count = readSync(
        fd,
        buffer,
        0,
        Math.min(buffer.length, bytes - consumed),
        offset + consumed,
      )
      if (count === 0) throw new Error('captured bytes ended early')
      consumed += count
      yield buffer.subarray(0, count)
    }
  } finally {
    buffer.fill(0)
  }
}

export function privateDescriptorByteDigest(fd: number, bytes: number, offset = 0): string {
  const hash = createHash('sha256')
  for (const chunk of privateDescriptorByteChunks(fd, bytes, offset)) hash.update(chunk)
  return `sha256:${hash.digest('hex')}`
}
