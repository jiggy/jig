import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type { DisplayImagePreview } from '@jigging/display-model'
import { PRIVATE_PREVIEW_LIMITS, privateValidImagePreview } from './image-preview-policy.js'
import { privateImagePreviewWorkerPath } from './image-preview-worker-location.js'
import { privatePresentationNow } from './root-run-timeout-policy.js'

// One live renderer per command. Concurrent requests retain their file fallback.
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

/** Decode only captured bytes, in fixed installed code with no inherited environment.
 * SIGKILL stops the whole process, including Wasm; its actual exit precedes reuse. */
export async function privateImagePreview(
  bytes: Buffer,
  signal?: AbortSignal,
  deadline?: number,
): Promise<DisplayImagePreview | undefined> {
  const raster = bytes[0] === 137 || (bytes[0] === 255 && bytes[1] === 216)
  if (
    rendering ||
    signal?.aborted ||
    (deadline !== undefined && privatePresentationNow() >= deadline) ||
    bytes.length >
      (raster ? PRIVATE_PREVIEW_LIMITS.sourceBytes : PRIVATE_PREVIEW_LIMITS.svgSourceBytes) ||
    !privateImageSourceCandidate(bytes)
  )
    return undefined
  rendering = true
  try {
    const path = await privateImagePreviewWorkerPath()
    if (signal?.aborted) return undefined
    const png = await privateImagePreviewProcess(path, bytes, signal, deadline)
    if (!png || signal?.aborted || png.length < 33 || png.toString('ascii', 12, 16) !== 'IHDR')
      return undefined
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
    rendering = false
  }
}

/** Private process-lifetime seam for native fault fixtures; callers cannot select it. */
export async function privateImagePreviewProcess(
  path: string,
  bytes: Buffer,
  signal?: AbortSignal,
  deadline?: number,
): Promise<Buffer | undefined> {
  const renderDeadline = Math.min(
    privatePresentationNow() + PRIVATE_PREVIEW_LIMITS.renderMs,
    deadline ?? Infinity,
  )
  if (
    !Number.isSafeInteger(renderDeadline) ||
    renderDeadline <= privatePresentationNow() ||
    signal?.aborted
  )
    return undefined
  const child = spawn(process.execPath, ['--no-env-file', path, String(bytes.length)], {
    cwd: dirname(path),
    env: {},
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  // Observe errors before feeding stdin: a decoder can fail before its first read.
  const exited = new Promise<number | null>((resolve) => {
    child.once('error', () => {})
    child.once('close', resolve)
  })
  const stop = () => {
    child.kill('SIGKILL')
  }
  const timer = setTimeout(stop, Math.max(0, renderDeadline - privatePresentationNow()))
  signal?.addEventListener('abort', stop, { once: true })
  child.stdin.on('error', stop)
  // Keep this pipe open as a lifetime lease. Parent death closes it in the kernel.
  child.stdin.write(bytes)
  if (signal?.aborted) stop()
  const chunks: Buffer[] = []
  let length = 0
  try {
    for await (const chunk of child.stdout) {
      length += chunk.length
      if (length > PRIVATE_PREVIEW_LIMITS.pngBytes) return undefined
      chunks.push(chunk)
    }
    if ((await exited) !== 0 || signal?.aborted) return undefined
    return Buffer.concat(chunks, length)
  } finally {
    stop()
    await exited
    child.stdin.destroy()
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
  }
}
