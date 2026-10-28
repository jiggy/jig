import { parentPort, workerData } from 'node:worker_threads'
import { privateGuardImageAllocations } from '../../src/internal/image-preview-allocation.js'
import { PRIVATE_PREVIEW_LIMITS } from '../../src/internal/image-preview-policy.js'

if (!parentPort) throw new Error('private worker fixture')
if (workerData === 'allocation') {
  const budget = privateGuardImageAllocations()
  let individualRefused = false,
    aggregateRefused = false,
    textRefused = false
  try {
    new Uint8Array(PRIVATE_PREVIEW_LIMITS.pngBytes + 1)
  } catch {
    individualRefused = true
  }
  for (let index = 0; index < 16; index++) new Uint8Array(65536)
  try {
    new Uint8Array(1)
  } catch {
    aggregateRefused = true
  }
  const input = new Uint8Array(new ArrayBuffer(65536))
  const decoder = new TextDecoder()
  for (let index = 0; index < 8; index++) decoder.decode(input)
  try {
    decoder.decode(input)
  } catch {
    textRefused = true
  }
  parentPort.postMessage({
    individualRefused,
    aggregateRefused,
    textRefused,
    copies: budget.copies(),
    decodedText: budget.decodedText(),
  })
  parentPort.close()
} else if (workerData === 'wasm') {
  const module = new WebAssembly.Module(
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 1, 1, 80, 7, 17, 2, 4,
      115, 112, 105, 110, 0, 0, 6, 109, 101, 109, 111, 114, 121, 2, 0, 10, 9, 1, 7, 0, 3, 64, 12, 0,
      11, 11,
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
  parentPort.postMessage({
    pid: process.pid,
    ready: true,
    capped,
    memoryBytes: memory.buffer.byteLength,
  })
  ;(instance.exports.spin as () => void)()
} else if (workerData === 'javascript') {
  parentPort.postMessage({ pid: process.pid, ready: true })
  for (;;) {}
} else throw new Error('invalid private fixture mode')
