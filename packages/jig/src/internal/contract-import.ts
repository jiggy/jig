import { constants } from 'node:fs'
import { type FileHandle, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { CheckError, invalid, unavailable } from '../diagnostics.js'
import { invocationContractChannelPaths, parseInvocationContract } from '../invocation-contract.js'
import { captureOpenedPackageDirectory, type CapturedPackage } from '../package/capture.js'
import { privateFilePath, privatePublishDirectory } from './linux-file-input.js'

/** Explicit inert authoring: copy one validated offline closure, never package code. */
export async function importContract(
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<{ descriptor: string; files: number; digest: string }> {
  let root: FileHandle | undefined
  let parent: FileHandle | undefined
  let staged: string | undefined
  let captured: CapturedPackage | undefined
  try {
    signal?.throwIfAborted()
    const name = basename(source)
    // The operator chooses the source root; descendants are captured without links.
    root = await open(
      await realpath(dirname(resolve(source))),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    const capture = (paths: readonly string[]) =>
      captureOpenedPackageDirectory(source, root!, {
        includes: (path) => paths.some((p) => p === path || p.startsWith(`${path}/`)),
        maximumFiles: 65,
        maximumBytes: 1_048_576,
      })
    captured = await capture([name])
    const descriptor = await captured.read(name, 262_144)
    const references = invocationContractChannelPaths(descriptor, name)
    const paths = [name, ...references]
    if (new Set(paths).size !== paths.length)
      invalid('CONTRACT_IMPORT_INVALID', 'The descriptor cannot also be a channel agreement.')
    await captured.dispose()
    captured = await capture(paths)
    if (!Buffer.from(descriptor).equals(Buffer.from(await captured.read(name, 262_144))))
      unavailable(
        'CONTRACT_IMPORT_CHANGED',
        'The source descriptor changed during capture; retry with stable files.',
      )
    const documents = new Map<string, Uint8Array>()
    for (const path of references) documents.set(path, await captured.read(path, 262_144))
    const contract = parseInvocationContract(descriptor, name, documents)
    signal?.throwIfAborted()

    const target = resolve(destination)
    const leaf = privateFilePath(basename(target))
    parent = await open(
      await realpath(dirname(target)),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    const parentPath = `/proc/self/fd/${parent.fd}`
    staged = await mkdtemp(`${parentPath}/.jig-contract-`)
    const stage = await open(
      staged,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      for (const path of paths) {
        signal?.throwIfAborted()
        await writeCaptured(stage, path, path === name ? descriptor : documents.get(path)!)
      }
      signal?.throwIfAborted()
      // No replacement, including empty directories and symlinks. Until this point
      // the destination is absent. This is publication, not Run admission.
      privatePublishDirectory(parent.fd, basename(staged), leaf)
      staged = undefined
    } finally {
      await stage.close()
    }
    return { descriptor: `${target}/${name}`, files: paths.length, digest: contract.digest }
  } catch (error) {
    if (signal?.aborted) throw error
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      invalid(
        'CONTRACT_IMPORT_EXISTS',
        'Choose a new destination directory; the existing destination was not replaced.',
      )
    if (error instanceof CheckError) throw error
    return unavailable(
      'CONTRACT_IMPORT_UNAVAILABLE',
      'The contract bundle could not be imported. Check readable regular source files and an existing writable destination parent.',
    )
  } finally {
    try {
      if (staged !== undefined) await rm(staged, { recursive: true, force: true })
    } finally {
      await captured?.dispose()
      await parent?.close()
      await root?.close()
    }
  }
}

async function writeCaptured(root: FileHandle, path: string, bytes: Uint8Array): Promise<void> {
  const parts = path.split('/')
  const handles: FileHandle[] = []
  let parent = root
  try {
    for (const part of parts.slice(0, -1)) {
      const directory = `/proc/self/fd/${parent.fd}/${part}`
      await mkdir(directory, { mode: 0o700 }).catch((error) => {
        if (error.code !== 'EEXIST') throw error
      })
      parent = await open(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      handles.push(parent)
    }
    const file = await open(
      `/proc/self/fd/${parent.fd}/${parts.at(-1)}`,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await file.writeFile(bytes)
    } finally {
      await file.close()
    }
  } finally {
    for (const handle of handles.reverse()) await handle.close()
  }
}
