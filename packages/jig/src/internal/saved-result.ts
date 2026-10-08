import { closeSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodeJson1, JSON_1_LIMITS, type JsonValue } from '../json.js'
import {
  PRIVATE_DIRECTORY_OPEN_FLAGS,
  PrivateFileInputError,
  privateFilePath,
  privateOpenAt,
  privateOpenFileRoot,
  privateReadRegularFile,
  sha256,
} from './file-input.js'

const FILE_BYTES = 16 * 1024 * 1024
const PREVIEW_BYTES = 65536
export type PrivateSavedResultFile = Readonly<{
  path: string
  bytes: number
  digest: string
  available: boolean
}>
export class PrivateSavedResultError extends Error {
  constructor(reason: 'data' | 'controls' | 'filesystem' = 'data') {
    super(
      reason === 'controls'
        ? 'Saved packet file controls are unavailable on this installation or host. Restore Jig’s file-control support or inspect the packet with a local file reader. No work was started.'
        : reason === 'filesystem'
          ? 'The selected saved packet is on an unsupported filesystem or crosses a mount boundary. Select a stable packet on a supported local filesystem. No work was started.'
          : 'The selected packet has no safely readable, valid result.json. Select a stable local packet directory with a regular result.json file; symbolic links and special files are not accepted. No work was started.',
    )
  }
}
function object(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function terminal(value: JsonValue): value is Record<string, JsonValue> {
  if (!object(value)) return false
  if (value.status === 'succeeded')
    return typeof value.outcome === 'string' && Object.hasOwn(value, 'output')
  return (
    (value.status === 'failed' || value.status === 'lost') &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  )
}
function manifest(record: Record<string, JsonValue>): Omit<PrivateSavedResultFile, 'available'>[] {
  const delivery = record.delivery
  if (
    !object(delivery) ||
    delivery.status !== 'written' ||
    !Array.isArray(delivery.files) ||
    delivery.files.length > 64
  )
    throw new TypeError('manifest')
  const names = new Set<string>()
  let total = 0
  return delivery.files.map((value) => {
    if (
      !object(value) ||
      typeof value.path !== 'string' ||
      typeof value.digest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(value.digest) ||
      !Number.isSafeInteger(value.bytes) ||
      (value.bytes as number) < 0
    )
      throw new TypeError('manifest')
    const path = privateFilePath(value.path)
    if (names.has(path)) throw new TypeError('manifest')
    names.add(path)
    total += value.bytes as number
    if (total > FILE_BYTES) throw new TypeError('manifest')
    return { path, bytes: value.bytes as number, digest: value.digest }
  })
}
function preview(bytes: Buffer): { text: string; bytes: number; clipped: boolean } | undefined {
  const size = Math.min(PREVIEW_BYTES, bytes.length)
  for (let end = size; end >= Math.max(0, size - (bytes.length > size ? 3 : 0)); end--) {
    try {
      return {
        text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)),
        bytes: bytes.length,
        clipped: bytes.length > end,
      }
    } catch {}
  }
  return undefined
}

/** Local recorded claims, never admission or authenticated publication evidence. */
export interface PrivateSavedResult {
  readonly directory: string
  readonly record: Record<string, JsonValue>
  readonly files: readonly PrivateSavedResultFile[]
  readonly complete: boolean
  readonly finding?: string
  reportPreview(): { text: string; bytes: number; clipped: boolean }
  preview(path: string): { text: string; bytes: number; clipped: boolean } | undefined
  close(): void
}

/** Capture once through held descriptors. Previews never reopen mutable paths. */
export function privateCaptureSavedResult(
  directory: string,
  signal?: AbortSignal,
): PrivateSavedResult {
  const deadline = performance.now() + 10_000
  const check = () => {
    signal?.throwIfAborted()
    if (performance.now() >= deadline) throw new Error('capture deadline')
  }
  let root: number | undefined, filesRoot: number | undefined, report: Buffer | undefined
  const retained = new Map<string, Buffer>()
  const discard = () => {
    report?.fill(0)
    report = undefined
    for (const bytes of retained.values()) bytes.fill(0)
    retained.clear()
  }
  const closeDirectories = () => {
    const owned = [filesRoot, root]
    filesRoot = root = undefined
    const errors: unknown[] = []
    for (const fd of owned) {
      if (fd === undefined) continue
      try {
        closeSync(fd)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, 'saved capture closure failed')
  }
  try {
    check()
    root = privateOpenFileRoot(directory)
    report = privateReadRegularFile(root, 'result.json', JSON_1_LIMITS.bytes + 1)
    check()
    // Publication permits exactly one framing LF beyond the JSON document limit.
    const document = report.at(-1) === 10 ? report.subarray(0, -1) : report
    const record = decodeJson1(document)
    check()
    if (!terminal(record)) throw new PrivateSavedResultError()
    let listed: Omit<PrivateSavedResultFile, 'available'>[] = []
    let finding: string | undefined
    try {
      listed = manifest(record)
    } catch {
      finding =
        'File verification is incomplete: the recorded manifest is invalid or exceeds the 64-file /16 MiB limit. No listed files were captured.'
    }
    if (!finding && listed.length) {
      try {
        check()
        // Limits apply relative to files/, without consuming a valid path component.
        filesRoot = privateOpenAt(root, 'files', PRIVATE_DIRECTORY_OPEN_FLAGS)
        for (const file of listed) {
          check()
          let bytes: Buffer | undefined
          try {
            bytes = privateReadRegularFile(filesRoot, file.path, file.bytes)
            check()
            if (bytes.length !== file.bytes || sha256(bytes) !== file.digest)
              throw new Error('file mismatch')
            retained.set(file.path, bytes)
            bytes = undefined
          } finally {
            bytes?.fill(0)
          }
        }
      } catch {
        signal?.throwIfAborted()
        finding =
          'File verification is incomplete: a listed file is missing, unreadable, changed, or does not match its recorded size and digest. Uncaptured files are unavailable.'
      }
    }
    signal?.throwIfAborted()
    // Finish all descriptor cleanup before handing the copied-byte owner out.
    closeDirectories()
    signal?.throwIfAborted()
    const capturedReport = report
    let closed = false
    return {
      directory: resolve(directory),
      record,
      files: Object.freeze(
        listed.map((file) => Object.freeze({ ...file, available: retained.has(file.path) })),
      ),
      complete: finding === undefined,
      ...(finding === undefined ? {} : { finding }),
      reportPreview() {
        if (closed) throw new Error('saved inspection is closed')
        return preview(capturedReport)!
      },
      preview(path) {
        if (closed) return undefined
        privateFilePath(path)
        const bytes = retained.get(path)
        return bytes === undefined ? undefined : preview(bytes)
      },
      close() {
        if (closed) return
        closed = true
        discard()
      },
    }
  } catch (error) {
    discard()
    try {
      closeDirectories()
    } catch {
      // Cleanup cannot replace the primary capture failure or interruption.
    }
    signal?.throwIfAborted()
    if (error instanceof PrivateSavedResultError) throw error
    if (error instanceof PrivateFileInputError) {
      if (['native', 'kernel'].includes(error.reason)) throw new PrivateSavedResultError('controls')
      if (['filesystem', 'cross-mount', 'mount'].includes(error.reason))
        throw new PrivateSavedResultError('filesystem')
    }
    throw new PrivateSavedResultError()
  }
}
