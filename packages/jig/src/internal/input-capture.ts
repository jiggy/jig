import { closeSync, mkdtempSync, readSync, rmdirSync } from 'node:fs'
import { PRIVATE_FILE_LIMITS, sha256 } from './file-input-policy.js'
import { privateLinuxSealedBytes, privateVerifyLinuxSealedFile } from './linux-file-input.js'
import {
  capturePrivateMacosInput,
  type PrivateMacosCapturedInput,
  requirePrivateMacosCapturedInput,
} from './macos-captured-input.js'

/** Live capture authority. Serialized byte identities cannot recreate it. */
export interface PrivateCapturedInput {
  readonly bytes: number
  readonly digest: string
  close(): void
}
interface Capture {
  readonly fd: number
  readonly bytes: number
  readonly digest: string
  readonly mac?: PrivateMacosCapturedInput
  closed: boolean
}
const authentic = new WeakMap<object, Capture>()

export function capturePrivateInput(input: Uint8Array): PrivateCapturedInput {
  if (!(input instanceof Uint8Array) || input.byteLength > PRIVATE_FILE_LIMITS.bytes)
    throw new TypeError('captured input exceeds its byte limit')
  let record: Capture
  if (process.platform === 'darwin') {
    // This private allocation is never projected into a payload. Its only name
    // and writer disappear synchronously before the capability can escape.
    const directory = mkdtempSync('/private/tmp/jig-input-')
    let mac: PrivateMacosCapturedInput | undefined
    try {
      mac = capturePrivateMacosInput(directory, input)
      const identity = requirePrivateMacosCapturedInput(mac)
      rmdirSync(directory)
      record = { ...identity, mac, closed: false }
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
        fd: privateLinuxSealedBytes(bytes),
        bytes: bytes.length,
        digest: sha256(bytes),
        closed: false,
      }
    } finally {
      bytes.fill(0)
    }
  }
  const capability: PrivateCapturedInput = Object.freeze({
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
export function requirePrivateCapturedInput(
  value: PrivateCapturedInput,
): Readonly<{ fd: number; bytes: number; digest: string }> {
  const record = value !== null && typeof value === 'object' ? authentic.get(value) : undefined
  if (record === undefined || record.closed) throw new TypeError('captured input is not active')
  if (record.mac !== undefined) return requirePrivateMacosCapturedInput(record.mac)
  privateVerifyLinuxSealedFile(record.fd, record.bytes, record.digest)
  return Object.freeze({ fd: record.fd, bytes: record.bytes, digest: record.digest })
}

export function readPrivateCapturedInput(value: PrivateCapturedInput): Buffer {
  const { fd, bytes, digest } = requirePrivateCapturedInput(value)
  const result = Buffer.alloc(bytes)
  for (let offset = 0; offset < bytes; ) {
    const count = readSync(fd, result, offset, bytes - offset, offset)
    if (count === 0) throw new Error('captured input ended early')
    offset += count
  }
  if (sha256(result) !== digest) throw new Error('captured input changed')
  return result
}
