import { closeSync, constants, fstatSync, openSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PrivateFileInputError,
  privateFilePath,
  privateRequireUnprotected,
} from './file-input-policy.js'
import {
  privateMacosDescriptorPath,
  privateMacosFilesystem,
  privateMacosOpenAncestryDirectory,
  privateMacosOpenFdAt,
} from './macos-descriptor-files.js'
import { privateMacosCurrentProcessIdentity } from './macos-process-controls.js'

function fileError(error: unknown): never {
  const reason = {
    ELOOP: 'symlink',
    ENOENT: 'missing',
    EACCES: 'access',
    EXDEV: 'cross-mount',
    ENOSYS: 'kernel',
  } as const
  const code = (error as NodeJS.ErrnoException).code
  if (code !== undefined && Object.hasOwn(reason, code))
    throw new PrivateFileInputError(reason[code as keyof typeof reason])
  throw error
}

/** Open the selected root once; path observation is only protected-state exclusion. */
export function privateMacosOpenFileRoot(path: string): number {
  privateMacosCurrentProcessIdentity()
  const absolute = resolve(path)
  privateRequireUnprotected(absolute)
  let fd: number | undefined
  try {
    fd = openSync(absolute, constants.O_RDONLY | constants.O_DIRECTORY | 0x20000000 | 0x01000000)
    const filesystem = privateMacosFilesystem(fd)
    if (!['apfs', 'hfs'].includes(filesystem.type) || (filesystem.flags & 0x1000) === 0)
      throw new PrivateFileInputError('filesystem')
    privateRequireUnprotected(privateMacosDescriptorPath(fd))
    return fd
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    return fileError(error)
  }
}

/** Bounded no-link walk anchored to the original descriptor. Each opened
 * component must remain on its filesystem and mount; no pathname is reopened. */
export function privateMacosInputOpenAt(
  directory: number,
  path: string,
  flags: number,
  beneath = true,
): number {
  let current = directory,
    owned = false
  try {
    if (!beneath) {
      if (!['.', '..'].includes(path) || (flags & constants.O_DIRECTORY) === 0)
        throw new PrivateFileInputError('path')
      return privateMacosOpenAncestryDirectory(directory, path === '..')
    }
    const parts = privateFilePath(path).split('/')
    const original = fstatSync(directory, { bigint: true }),
      mount = privateMacosFilesystem(directory)
    for (const [index, part] of parts.entries()) {
      const next = privateMacosOpenFdAt(
        current,
        part,
        index === parts.length - 1
          ? flags
          : constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK,
      )
      const previous = current,
        closePrevious = owned
      current = next
      owned = true
      if (closePrevious) closeSync(previous)
      const entry = fstatSync(next, { bigint: true }),
        filesystem = privateMacosFilesystem(next)
      if (
        entry.dev !== original.dev ||
        filesystem.device !== mount.device ||
        filesystem.mountpoint !== mount.mountpoint
      )
        throw new PrivateFileInputError('cross-mount')
    }
    owned = false
    return current
  } catch (error) {
    return fileError(error)
  } finally {
    if (owned) closeSync(current)
  }
}
