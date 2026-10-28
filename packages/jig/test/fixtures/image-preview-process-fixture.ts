import { writeFileSync } from 'node:fs'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { privateImagePreviewChild } from '../../src/internal/image-preview-child.js'
import { PRIVATE_PREVIEW_LIMITS } from '../../src/internal/image-preview-policy.js'

if (isMainThread) {
  await privateImagePreviewChild(import.meta.url)
} else {
  const { mode, ready } = JSON.parse(Buffer.from(workerData).toString())
  if (mode === 'oversize') {
    parentPort!.postMessage(new ArrayBuffer(PRIVATE_PREVIEW_LIMITS.pngBytes + 1))
  } else if (mode === 'crash') {
    throw new Error('injected decoder crash')
  } else {
    // The ready file establishes entry into the actual busy decoder, not launch alone.
    if (mode === 'wasm') {
      const module = new WebAssembly.Module(
        new Uint8Array([
          0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 1, 1, 80, 7, 17, 2,
          4, 115, 112, 105, 110, 0, 0, 6, 109, 101, 109, 111, 114, 121, 2, 0, 10, 9, 1, 7, 0, 3, 64,
          12, 0, 11, 11,
        ]),
      )
      const instance = new WebAssembly.Instance(module)
      const memory = instance.exports.memory as WebAssembly.Memory
      memory.grow(79)
      let capped = false
      try {
        memory.grow(1)
      } catch {
        capped = true
      }
      writeFileSync(
        ready,
        JSON.stringify({ pid: process.pid, capped, bytes: memory.buffer.byteLength }),
      )
      ;(instance.exports.spin as () => void)()
    } else {
      writeFileSync(ready, JSON.stringify({ pid: process.pid }))
      for (;;) {}
    }
  }
}
