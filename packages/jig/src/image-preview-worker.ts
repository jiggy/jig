import { parentPort, workerData } from 'node:worker_threads'
import { privateRenderImage } from './internal/image-preview-renderer.js'
import { PRIVATE_PREVIEW_LIMITS } from './internal/image-preview-policy.js'

if (
  !parentPort ||
  !(workerData instanceof ArrayBuffer) ||
  workerData.byteLength > PRIVATE_PREVIEW_LIMITS.sourceBytes
)
  throw new Error('invalid private image job')
try {
  const png = await privateRenderImage(Buffer.from(workerData))
  if (
    png &&
    png.buffer instanceof ArrayBuffer &&
    png.byteOffset === 0 &&
    png.byteLength === png.buffer.byteLength
  )
    parentPort.postMessage(png.buffer, [png.buffer])
  else parentPort.postMessage(undefined)
} catch {
  parentPort.postMessage(undefined)
}
parentPort.close()
