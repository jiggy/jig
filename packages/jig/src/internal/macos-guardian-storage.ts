import { constants } from 'node:fs'
import { type FileHandle, lstat, open } from 'node:fs/promises'
import { join, posix } from 'node:path'
import {
  privateMacosDirectory,
  privateMacosFilesystem,
  privateMacosMkdirAt,
  privateMacosOpenAt,
  privateMacosStatAt,
  privateMacosUnlinkAt,
} from './macos-descriptor-files.js'
import { requirePrivateMacosOwnerDirectory } from './macos-owner-state.js'
import type { PrivateMacosSandboxFiles } from './macos-sandbox-profile.js'
import {
  allocatePrivateMacosVolume,
  attachPrivateMacosVolume,
  recoverPrivateMacosVolume,
  releasePrivateMacosVolume,
} from './macos-volume.js'

export interface PrivateMacosGuardianStorage {
  readonly mountPath: string
  readonly bytes: number
  readonly collect: 'output' | 'work' | null
}
const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | 0x20000000 | 0x01000000
const controlPath = (owner: string) => join(owner, 'storage')

export function requirePrivateMacosGuardianStorage(
  storage: PrivateMacosGuardianStorage,
  files: PrivateMacosSandboxFiles,
  cwd: string,
): void {
  if (
    storage === null ||
    typeof storage !== 'object' ||
    Object.keys(storage).sort().join() !== 'bytes,collect,mountPath' ||
    typeof storage.mountPath !== 'string' ||
    !storage.mountPath.startsWith('/') ||
    storage.mountPath === '/' ||
    posix.normalize(storage.mountPath) !== storage.mountPath ||
    !Number.isSafeInteger(storage.bytes) ||
    storage.bytes < 16 * 1024 * 1024 ||
    storage.bytes > 512 * 1024 * 1024 ||
    storage.bytes % (1024 * 1024) !== 0 ||
    ![null, 'output', 'work'].includes(storage.collect)
  )
    throw new TypeError('invalid macOS guardian storage')
  const roots = ['work', 'tmp', 'output'].map((name) => join(storage.mountPath, name))
  const inputs = join(storage.mountPath, 'inputs')
  const readOnlyInputCwd =
    files.writableTrees.length === 0 &&
    storage.collect === null &&
    files.readOnlyTrees.includes(inputs) &&
    (cwd === inputs || cwd.startsWith(`${inputs}/`))
  // The mount root stays host-owned so the payload cannot rename the held roots.
  if (
    files.writableTrees.some((path) => !roots.includes(path)) ||
    (!roots.some((root) => cwd === root || cwd.startsWith(`${root}/`)) && !readOnlyInputCwd)
  )
    throw new TypeError('macOS writable projection is outside bounded storage')
}

/** Journal before any guardian exists; the caller already owns the empty mount allocation. */
export async function allocatePrivateMacosGuardianStorage(
  owner: string,
  token: string,
  storage: PrivateMacosGuardianStorage,
): Promise<void> {
  const directory = await open(owner, DIRECTORY)
  try {
    privateMacosMkdirAt(directory.fd, 'storage', 0o700)
  } finally {
    await directory.close()
  }
  await allocatePrivateMacosVolume(controlPath(owner), token, storage.mountPath, storage.bytes)
}

/** Only inside the admitted guardian. The collector's original descriptor remains private. */
export async function preparePrivateMacosGuardianStorage(
  owner: string,
  token: string,
  storage: PrivateMacosGuardianStorage,
  signal: AbortSignal,
): Promise<Readonly<{ directory: FileHandle; collector: FileHandle | undefined }>> {
  const volume = await attachPrivateMacosVolume(controlPath(owner), token, signal)
  try {
    signal.throwIfAborted()
    if (volume.path !== storage.mountPath || volume.capacityBytes > storage.bytes)
      throw new Error('macOS guardian storage allocation changed')
    for (const name of ['work', 'tmp', 'output', 'inputs'])
      privateMacosMkdirAt(volume.directory.fd, name, 0o700)
    const collector =
      storage.collect === null
        ? undefined
        : await privateMacosOpenAt(volume.directory.fd, storage.collect, DIRECTORY)
    return Object.freeze({ directory: volume.directory, collector })
  } catch (error) {
    await volume.directory.close()
    throw error
  }
}

/** Only after the exact no-first-owner job is absent and any prior recovery
 * slot is fenced. No tool or payload can
 * precede that owner's first journal. Retire only its still-empty fixed child;
 * initialized, partial, mounted or changed state retains ordinary recovery. */
export async function removeEmptyPrivateMacosUnstartedStorage(owner: string): Promise<boolean> {
  requirePrivateMacosOwnerDirectory(owner)
  const parent = await open(owner, DIRECTORY)
  try {
    const parentIdentity = await parent.stat({ bigint: true })
    if (
      !parentIdentity.isDirectory() ||
      parentIdentity.uid !== BigInt(process.getuid!()) ||
      (parentIdentity.mode & 0o777n) !== 0o700n
    )
      throw new Error('macOS unstarted storage parent is unsafe')
    const unrecorded = () => {
      for (const name of ['owner.json', 'storage.release.json', 'storage.release.pending']) {
        try {
          privateMacosStatAt(parent.fd, name)
          return false
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      return true
    }
    if (!unrecorded()) return false
    let storage: FileHandle
    try {
      storage = await privateMacosOpenAt(parent.fd, 'storage', DIRECTORY)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
    try {
      const identity = await storage.stat({ bigint: true })
      if (
        !identity.isDirectory() ||
        identity.uid !== parentIdentity.uid ||
        (identity.mode & 0o777n) !== 0o700n ||
        identity.dev !== parentIdentity.dev ||
        privateMacosFilesystem(storage.fd).mountpoint === controlPath(owner)
      )
        throw new Error('macOS unstarted storage allocation is unsafe')
      const entries = privateMacosDirectory(storage.fd)
      try {
        if (entries.readSync() !== null) return false
      } finally {
        entries.closeSync()
      }
      if (!unrecorded()) return false
      const namedParent = await lstat(owner, { bigint: true })
      const namedStorage = privateMacosStatAt(parent.fd, 'storage')
      if (
        !namedParent.isDirectory() ||
        namedParent.dev !== parentIdentity.dev ||
        namedParent.ino !== parentIdentity.ino ||
        namedParent.uid !== parentIdentity.uid ||
        (namedParent.mode & 0o777n) !== 0o700n ||
        !namedStorage.isDirectory() ||
        namedStorage.dev !== identity.dev ||
        namedStorage.ino !== identity.ino ||
        namedStorage.uid !== identity.uid ||
        (namedStorage.mode & 0o777n) !== 0o700n
      )
        throw new Error('macOS unstarted storage identity changed')
      if (!unrecorded()) return false
      // rmdir itself rejects an intervening entry; never enumerate/remove a tree.
      privateMacosUnlinkAt(parent.fd, 'storage', true)
      await parent.sync()
      return true
    } finally {
      await storage.close()
    }
  } finally {
    await parent.close()
  }
}

/** No decoded path or saved device number is cleanup authority. */
export async function recoverPrivateMacosGuardianStorage(
  owner: string,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await lstat(controlPath(owner))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await recoverPrivateMacosVolume(controlPath(owner), token, signal)
}

/** Journal retirement is separate from recovery so uncertain cleanup retains evidence. */
export async function releasePrivateMacosGuardianStorage(
  owner: string,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  // The storage directory may already be gone while its authenticated
  // retirement marker still needs to be removed from the guardian directory.
  await releasePrivateMacosVolume(controlPath(owner), token, signal)
}
