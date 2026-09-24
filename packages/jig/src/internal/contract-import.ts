import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { type FileHandle, open, realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { CheckError, invalid, unavailable } from '../diagnostics.js'
import { invocationContractChannelPaths, parseInvocationContract } from '../invocation-contract.js'
import { type CapturedPackage, captureOpenedPackageDirectory } from '../package/capture.js'
import {
  mkdirPrivateFile,
  openPrivateFile,
  type PrivateChildLocation,
  privateChildLocation,
  privateDirectoryEntries,
  publishPrivateDirectory,
  rmdirPrivateFile,
  unlinkPrivateFile,
} from './descriptor-files.js'
import { privateFilePath } from './linux-file-input.js'

/** Explicit inert authoring: copy one validated offline closure, never package code. */
export async function importContract(
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<{ descriptor: string; files: number; digest: string }> {
  let root: FileHandle | undefined
  let parent: FileHandle | undefined
  let staged: PrivateChildLocation | undefined
  let captured: CapturedPackage | undefined
  let phase: 'source' | 'destination' = 'source'
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

    phase = 'destination'
    const target = resolve(destination)
    const leaf = privateFilePath(basename(target))
    parent = await open(
      await realpath(dirname(target)),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    const allocation = privateChildLocation(
      parent,
      `.jig-contract-${randomBytes(16).toString('hex')}`,
    )
    await mkdirPrivateFile(allocation)
    staged = allocation
    const stage = await openPrivateFile(
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
      await publishPrivateDirectory(parent, staged.name, leaf)
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
      phase === 'source'
        ? 'The source bundle could not be read. Choose an existing descriptor file and readable regular channel files. Workspace dependencies may be installed beneath their member directory.'
        : 'The destination could not be written. Choose a new directory beneath an existing writable parent.',
      phase === 'source' ? source : destination,
    )
  } finally {
    try {
      if (staged !== undefined) await removeStage(staged)
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
      const directory = privateChildLocation(parent, part)
      await mkdirPrivateFile(directory).catch((error) => {
        if (error.code !== 'EEXIST') throw error
      })
      parent = await openPrivateFile(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      handles.push(parent)
    }
    const file = await openPrivateFile(
      privateChildLocation(parent, parts.at(-1)!),
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

/** Remove only the exact unexposed staging tree, never a decoded absolute path. */
async function removeStage(location: PrivateChildLocation): Promise<void> {
  let entries = 0
  const visit = async (current: PrivateChildLocation, depth: number): Promise<void> => {
    if (depth > 512) throw new Error('contract staging cleanup exceeds its depth bound')
    const directory = await openPrivateFile(
      current,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      for await (const entry of privateDirectoryEntries(directory)) {
        if (++entries > 65536) throw new Error('contract staging cleanup exceeds its entry bound')
        const child = privateChildLocation(directory, entry.name)
        if (entry.isDirectory()) await visit(child, depth + 1)
        else await unlinkPrivateFile(child)
      }
    } finally {
      await directory.close()
    }
    await rmdirPrivateFile(current)
  }
  await visit(location, 0)
}
