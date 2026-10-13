import { expect, test } from 'bun:test'
import { Worker } from 'node:worker_threads'
import { PRIVATE_PREVIEW_LIMITS } from '../../src/internal/image-preview-policy.js'
import { fixture } from '../image-preview.fixture.js'

if (process.env.JIG_NATIVE_IMAGE_THREAD_TEST !== '1')
  throw Error('This candidate qualification requires JIG_NATIVE_IMAGE_THREAD_TEST=1')

for (const mode of ['javascript', 'wasm']) {
  test(`native qualification: actual ${mode} termination joins its thread exit`, async () => {
    const worker = new Worker(fixture, { workerData: mode, env: {} })
    const exited = new Promise<number>((resolve) => worker.once('exit', resolve))
    try {
      const ready = await new Promise<{ pid: number; capped?: boolean; memoryBytes?: number }>(
        (resolve, reject) => {
          worker.once('message', resolve)
          worker.once('error', reject)
        },
      )
      expect(ready.pid).toBe(process.pid)
      if (mode === 'wasm') {
        expect(ready.capped).toBeTrue()
        expect(ready.memoryBytes).toBe(PRIVATE_PREVIEW_LIMITS.wasmBytes)
      }
      const termination = worker.terminate()
      expect(termination instanceof Promise).toBeTrue()
      const result = await termination
      expect(await exited).toBe(result)
    } finally {
      await worker.terminate()
      await exited
    }
  }, 5000)
}
