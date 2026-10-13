import { lstat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { privateInstallationFileDigest } from './installation-verification.js'

/** Replaced with the exact bundled worker digest by the installed CLI build. */
declare const __JIG_IMAGE_PREVIEW_WORKER_DIGEST__: string

/** Fixed trusted code only. An image, invocation or operator value cannot
 * select a worker. The installed command pins this sibling in its own bytes. */
export async function privateImagePreviewWorkerPath(): Promise<string> {
  const source = import.meta.url.endsWith('.ts')
  const path = fileURLToPath(new URL(
    source ? '../image-preview-worker.ts' : './image-preview-worker.js',
    import.meta.url,
  ))
  const info = await lstat(path)
  if (!info.isFile() || (info.mode & 0o6000) !== 0 ||
      await realpath(path) !== path)
    throw new Error('image preview worker is unavailable')
  if (!source &&
      (typeof __JIG_IMAGE_PREVIEW_WORKER_DIGEST__ !== 'string' ||
       !/^sha256:[a-f0-9]{64}$/.test(__JIG_IMAGE_PREVIEW_WORKER_DIGEST__) ||
       await privateInstallationFileDigest(path) !== __JIG_IMAGE_PREVIEW_WORKER_DIGEST__))
    throw new Error('image preview worker changed')
  return path
}
