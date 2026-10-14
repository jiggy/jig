import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { privateImagePreviewChild } from './internal/image-preview-child.js'
import { PRIVATE_PREVIEW_LIMITS } from './internal/image-preview-policy.js'

if (isMainThread) {
  await privateImagePreviewChild(import.meta.url)
} else {
  if (
    !parentPort ||
    !(workerData instanceof ArrayBuffer) ||
    workerData.byteLength > PRIVATE_PREVIEW_LIMITS.sourceBytes
  )
    throw new Error('invalid private image job')
  try {
    const { privateRenderImage } = await import('./internal/image-preview-renderer.js')
    const png = await privateRenderImage(Buffer.from(workerData))
    if (png) {
      // Own an exact bounded buffer; a view must not expose the surrounding heap.
      const output = new Uint8Array(png).buffer
      parentPort.postMessage(output, [output])
    }
  } finally {
    parentPort.close()
  }
}
