import { constants } from 'node:fs'
import { type FileHandle, lstat, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { CheckError, invalid, unavailable } from '../diagnostics.js'
import { invocationContractChannelPaths, parseInvocationContract } from '../invocation-contract.js'
import { type CapturedPackage, captureOpenedPackageDirectory } from '../package/capture.js'
import { npmPackageName } from '../project/package-selector.js'
import { privateFilePath, privatePublishDirectory } from './linux-file-input.js'

async function installedDescriptor(selector: string, destination: string): Promise<string> {
  let name: string
  try {
    name = npmPackageName(selector)
  } catch {
    invalid(
      'CONTRACT_IMPORT_SOURCE',
      'Select an exact npm package name without a version or subpath.',
      selector,
    )
  }
  let directory = dirname(resolve(destination))
  for (;;) {
    const packagePath = resolve(directory, 'node_modules', name)
    try {
      await lstat(packagePath)
      return resolve(packagePath, 'FLOW.contract.json')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return unavailable(
    'CONTRACT_IMPORT_PACKAGE',
    'The selected package is not installed for this consumer. Install its declared dependency, or choose a descriptor file directly.',
    selector,
  )
}

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
  let phase: 'source' | 'destination' = 'source'
  try {
    signal?.throwIfAborted()
    const selected = source.startsWith('npm:')
      ? await installedDescriptor(source, destination)
      : source
    const name = basename(selected)
    // The operator chooses the source root; descendants are captured without links.
    root = await open(
      await realpath(dirname(resolve(selected))),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    const capture = (paths: readonly string[]) =>
      captureOpenedPackageDirectory(selected, root!, {
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
      phase === 'source'
        ? 'The source bundle could not be read. Choose an installed package with FLOW.contract.json or an existing descriptor file with readable regular channel files.'
        : 'The destination could not be written. Choose a new directory beneath an existing writable parent.',
      phase === 'source' ? source : destination,
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
