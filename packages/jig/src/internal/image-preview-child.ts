import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { PRIVATE_PREVIEW_LIMITS } from './image-preview-policy.js'

/** The main thread never decodes images. Its deadline and stdin lifetime lease
 * continue while the decoder thread is stuck in JavaScript or Wasm. */
export async function privateImagePreviewChild(workerUrl: string): Promise<void> {
  const expectedBytes = Number(process.argv[2])
  const stop = () => process.kill(process.pid, 'SIGKILL')
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 0 ||
    expectedBytes > PRIVATE_PREVIEW_LIMITS.sourceBytes
  )
    stop()
  const deadline = setTimeout(stop, PRIVATE_PREVIEW_LIMITS.renderMs)
  process.stdin.on('end', stop)
  process.stdin.on('error', stop)
  try {
    const source = await new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = []
      let length = 0
      process.stdin.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > expectedBytes) stop()
        chunks.push(chunk)
        if (length === expectedBytes) resolve(Buffer.concat(chunks, length))
      })
      if (expectedBytes === 0) resolve(Buffer.alloc(0))
    })
    const bytes = new Uint8Array(source).buffer
    const worker = new Worker(fileURLToPath(workerUrl), {
      workerData: bytes,
      transferList: [bytes],
      env: {},
    })
    let result: ArrayBuffer | undefined
    const exitCode = await new Promise<number>((resolve) => {
      worker.once('error', stop)
      worker.on('message', (value: unknown) => {
        if (
          result ||
          !(value instanceof ArrayBuffer) ||
          value.byteLength > PRIVATE_PREVIEW_LIMITS.pngBytes
        )
          stop()
        result = value as ArrayBuffer
      })
      worker.once('exit', resolve)
    })
    if (exitCode === 0 && result) {
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(Buffer.from(result!), (error) => (error ? reject(error) : resolve()))
      })
    }
  } finally {
    clearTimeout(deadline)
    process.stdin.destroy()
  }
}
