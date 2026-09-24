import { constants } from 'node:fs'
import { type FileHandle, lstat, open } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { privateMacosMkdirAt, privateMacosOpenAt } from './macos-descriptor-files.js'
import type { PrivateMacosSandboxFiles } from './macos-sandbox-profile.js'
import {
  allocatePrivateMacosVolume,
  attachPrivateMacosVolume,
  recoverPrivateMacosVolume,
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
  // The mount root stays host-owned so the payload cannot rename the held roots.
  if (
    files.writableTrees.some((path) => !roots.includes(path)) ||
    !roots.some((root) => cwd === root || cwd.startsWith(`${root}/`))
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
): Promise<FileHandle | undefined> {
  const volume = await attachPrivateMacosVolume(controlPath(owner), token, signal)
  try {
    signal.throwIfAborted()
    if (volume.path !== storage.mountPath || volume.capacityBytes > storage.bytes)
      throw new Error('macOS guardian storage allocation changed')
    for (const name of ['work', 'tmp', 'output'])
      privateMacosMkdirAt(volume.directory.fd, name, 0o700)
    if (storage.collect !== null)
      return await privateMacosOpenAt(volume.directory.fd, storage.collect, DIRECTORY)
    return undefined
  } finally {
    await volume.directory.close()
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
