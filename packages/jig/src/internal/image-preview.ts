import { Worker } from 'node:worker_threads'
import type { DisplayImagePreview } from '@jigging/display-model'
import { PRIVATE_PREVIEW_LIMITS, privateValidImagePreview } from './image-preview-policy.js'
import { privateImagePreviewWorkerPath } from './image-preview-worker-location.js'

/** A single live renderer reservation belongs to this command process. Concurrent
 * callers fall back to text instead of allocating another renderer or queue. */
let rendering = false

export function privateImageSourceCandidate(prefix: Buffer): boolean {
  return (
    (prefix.length >= 8 &&
      prefix.readUInt32BE(0) === 0x89504e47 &&
      prefix.readUInt32BE(4) === 0x0d0a1a0a) ||
    (prefix[0] === 255 && prefix[1] === 216) ||
    /^\s*(?:(?:<\?xml[^>]*>|<!--[\s\S]*?-->)\s*)*<svg[\s>]/i.test(
      prefix.subarray(0, 1024).toString('utf8'),
    )
  )
}

/** Preview failure preserves saved files and the existing textual fallback.
 * Thread termination does not interrupt Wasm on the qualified Bun profiles.
 * Do not expose that candidate until an independently fenced owner is proved. */
export async function privateImagePreview(
  _bytes: Buffer,
  _signal?: AbortSignal,
): Promise<DisplayImagePreview | undefined> {
  return undefined
}

/** Private qualification candidate only. Successful rendering does not qualify
 * its lifetime: native JS/Wasm termination failures remain an admission gate. */
export async function privateCandidateThreadImagePreview(
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<DisplayImagePreview | undefined> {
  if (
    rendering ||
    signal?.aborted ||
    bytes.length > PRIVATE_PREVIEW_LIMITS.sourceBytes ||
    !privateImageSourceCandidate(bytes)
  )
    return undefined
  rendering = true
  let worker: Worker | undefined
  let exited: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stop: (() => void) | undefined
  try {
    const path = await privateImagePreviewWorkerPath()
    if (signal?.aborted) return undefined
    const input = new ArrayBuffer(bytes.length)
    new Uint8Array(input).set(bytes)
    const activeWorker = new Worker(path, { workerData: input, transferList: [input], env: {} })
    worker = activeWorker
    exited = new Promise<void>((resolve) => activeWorker.once('exit', () => resolve()))
    const result = await new Promise<ArrayBuffer | undefined>((resolve) => {
      let done = false
      stop = () => {
        if (!done) {
          done = true
          resolve(undefined)
        }
      }
      activeWorker.once('message', (value: unknown) => {
        if (done) return
        done = true
        resolve(
          value instanceof ArrayBuffer && value.byteLength <= PRIVATE_PREVIEW_LIMITS.pngBytes
            ? value
            : undefined,
        )
      })
      activeWorker.once('error', stop)
      activeWorker.once('exit', stop)
      signal?.addEventListener('abort', stop, { once: true })
      timer = setTimeout(stop, PRIVATE_PREVIEW_LIMITS.renderMs)
      if (signal?.aborted) stop()
    })
    clearTimeout(timer)
    if (stop) signal?.removeEventListener('abort', stop)
    await worker.terminate()
    await exited
    worker = undefined
    exited = undefined
    if (!result || signal?.aborted) return undefined
    const png = Buffer.from(result)
    if (png.length < 33 || png.toString('ascii', 12, 16) !== 'IHDR') return undefined
    const image = {
      mime: 'image/png' as const,
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      base64: png.toString('base64'),
    }
    return privateValidImagePreview(image) ? image : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    if (stop) signal?.removeEventListener('abort', stop)
    // An uncertain join holds this reservation permanently. A deadline is never
    // permission to reuse a potentially live Wasm heap.
    if (worker) {
      await worker.terminate()
      await exited
    }
    rendering = false
  }
}
