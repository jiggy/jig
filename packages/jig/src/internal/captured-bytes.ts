import { closeSync, mkdtempSync, readSync, rmdirSync } from 'node:fs'
import { PRIVATE_CAPTURE_LIMITS, type PrivateCapturePurpose, sha256 } from './file-input-policy.js'
import { privateLinuxSealedBytes, privateVerifyLinuxSealedFile } from './linux-file-input.js'
import {
  capturePrivateMacosBytes,
  type PrivateMacosCapturedBytes,
  requirePrivateMacosCapturedBytes,
} from './macos-captured-bytes.js'

/** Live capture authority. Serialized byte identities cannot recreate it. */
export interface PrivateCapturedBytes<P extends PrivateCapturePurpose> {
  readonly purpose: P
  readonly bytes: number
  readonly digest: string
  close(): void
}
interface Capture {
  readonly purpose: PrivateCapturePurpose
  readonly fd: number
  readonly bytes: number
  readonly digest: string
  readonly mac?: PrivateMacosCapturedBytes
  closed: boolean
}
const authentic = new WeakMap<object, Capture>()

export function capturePrivateBytes<P extends PrivateCapturePurpose>(
  input: Uint8Array,
  purpose: P,
): PrivateCapturedBytes<P> {
  if (
    !Object.hasOwn(PRIVATE_CAPTURE_LIMITS, purpose) ||
    !(input instanceof Uint8Array) ||
    input.byteLength > PRIVATE_CAPTURE_LIMITS[purpose]
  )
    throw new TypeError('captured bytes exceed their byte limit')
  let record: Capture
  if (process.platform === 'darwin') {
    // This private allocation is never projected into a payload. Its only name
    // and writer disappear synchronously before the capability can escape.
    const directory = mkdtempSync('/private/tmp/jig-bytes-')
    let mac: PrivateMacosCapturedBytes | undefined
    try {
      mac = capturePrivateMacosBytes(directory, input, purpose)
      const identity = requirePrivateMacosCapturedBytes(mac, purpose)
      rmdirSync(directory)
      record = { ...identity, mac, purpose, closed: false }
    } catch (error) {
      mac?.close()
      try {
        rmdirSync(directory)
      } catch {
        /* Preserve a nonempty failed allocation. */
      }
      throw error
    }
  } else {
    const bytes = Buffer.from(input)
    try {
      record = {
        purpose,
        fd: privateLinuxSealedBytes(bytes),
        bytes: bytes.length,
        digest: sha256(bytes),
        closed: false,
      }
    } finally {
      bytes.fill(0)
    }
  }
  const capability: PrivateCapturedBytes<P> = Object.freeze({
    purpose,
    bytes: record.bytes,
    digest: record.digest,
    close() {
      if (record.closed) return
      record.closed = true
      if (record.mac !== undefined) record.mac.close()
      else closeSync(record.fd)
    },
  })
  authentic.set(capability, record)
  return capability
}

/** Revalidate immediately before projecting through a trusted native handoff. */
export function requirePrivateCapturedBytes<P extends PrivateCapturePurpose>(
  value: PrivateCapturedBytes<P>,
  purpose: P,
): Readonly<{ fd: number; bytes: number; digest: string }> {
  const record = value !== null && typeof value === 'object' ? authentic.get(value) : undefined
  if (record === undefined || record.closed || record.purpose !== purpose)
    throw new TypeError('captured bytes are not active for this purpose')
  if (record.mac !== undefined) return requirePrivateMacosCapturedBytes(record.mac, purpose)
  privateVerifyLinuxSealedFile(
    record.fd,
    record.bytes,
    record.digest,
    PRIVATE_CAPTURE_LIMITS[purpose],
  )
  return Object.freeze({ fd: record.fd, bytes: record.bytes, digest: record.digest })
}

export function readPrivateCapturedBytes<P extends PrivateCapturePurpose>(
  value: PrivateCapturedBytes<P>,
  purpose: P,
): Buffer {
  const { fd, bytes, digest } = requirePrivateCapturedBytes(value, purpose)
  const result = Buffer.alloc(bytes)
  for (let offset = 0; offset < bytes; ) {
    const count = readSync(fd, result, offset, bytes - offset, offset)
    if (count === 0) throw new Error('captured bytes ended early')
    offset += count
  }
  if (sha256(result) !== digest) throw new Error('captured bytes changed')
  return result
}
