import {
  publishCapturedPackage,
  type PackageArtifactRef,
} from '../internal/package-artifact-store.js'
import {
  createCapturedPackage,
  type CapturedFile,
  type CapturedPackageBacking,
} from '../package/capture.js'
import { packageDigest } from '../package/digest.js'
import { isCapturedAuthorClosure, type CapturedAuthorClosure } from './author-module.js'

export interface RetainedAuthorClosure {
  readonly kind: 'author-closure/1'
  readonly closureDigest: string
  readonly package: PackageArtifactRef
}

/** Retain every byte of one authentic author closure in protected Package/1 storage. */
export async function retainAuthorClosure(
  storeRoot: string,
  closure: CapturedAuthorClosure,
): Promise<RetainedAuthorClosure> {
  if (!isCapturedAuthorClosure(closure)) {
    throw new TypeError('author closure was not produced by the capture boundary')
  }
  const files = Object.freeze(
    closure.modules.map(({ projectPath, sourceBytes }) =>
      Object.freeze({
        path: projectPath,
        size: sourceBytes,
      }),
    ),
  )
  const bytes = new Map(
    closure.modules.map(({ projectPath }) => [projectPath, closure.read(projectPath)]),
  )
  let disposed = false
  const backing: CapturedPackageBacking = {
    async *stream(path: string, maximumBytes?: number): AsyncIterable<Uint8Array> {
      if (disposed) throw new Error('author-closure backing has been disposed')
      const value = bytes.get(path)
      if (value === undefined) throw new Error(`unknown author-closure module ${path}`)
      const end =
        maximumBytes === undefined ? value.byteLength : Math.min(value.byteLength, maximumBytes)
      yield value.slice(0, end)
    },
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      for (const value of bytes.values()) value.fill(0)
      bytes.clear()
    },
  }
  let captured: ReturnType<typeof createCapturedPackage> | undefined
  try {
    const digest = await packageDigest(files, (file: CapturedFile) => backing.stream(file.path))
    captured = createCapturedPackage('captured author closure', files, digest, backing)
    const reference = await publishCapturedPackage(storeRoot, captured)
    return Object.freeze({
      kind: 'author-closure/1' as const,
      closureDigest: closure.closureDigest,
      package: reference,
    })
  } finally {
    if (captured === undefined) await backing.dispose()
    else await captured.dispose()
  }
}
