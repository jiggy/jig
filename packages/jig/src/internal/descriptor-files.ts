import type { BigIntStats, Dirent } from 'node:fs'
import {
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
  readlink,
  realpath,
  rename,
  rmdir,
  symlink,
  unlink,
} from 'node:fs/promises'
import {
  privateMacosDescriptorPath,
  privateMacosDirectory,
  privateMacosDuplicate,
  privateMacosLinkAt,
  privateMacosMkdirAt,
  privateMacosOpenAt,
  privateMacosReadlinkAt,
  privateMacosRenameAt,
  privateMacosStatAt,
  privateMacosSymlinkAt,
  privateMacosUnlinkAt,
} from './macos-descriptor-files.js'
import { privateRawDirectory } from './raw-directory.js'

const references = new WeakSet<object>()
export interface PrivateChildLocation {
  readonly parent: FileHandle
  readonly name: string
}
export type PrivateFileLocation = string | PrivateChildLocation

/** An invocation-local reference, never a serializable pathname or authority record. */
export function privateChildLocation(parent: FileHandle, name: string): PrivateChildLocation {
  requireLeaf(name)
  const reference = Object.freeze({ parent, name })
  references.add(reference)
  return reference
}

function child(value: PrivateChildLocation): PrivateChildLocation {
  if (!references.has(value)) throw new TypeError('file location was not captured by this host')
  return value
}

export async function openPrivateFile(
  path: PrivateFileLocation,
  flags: number,
  mode = 0o600,
): Promise<FileHandle> {
  if (typeof path === 'string') return open(path, flags, mode)
  const { parent, name } = child(path)
  return openPrivateChild(parent, name, flags, mode)
}

export async function statPrivateFile(path: PrivateFileLocation): Promise<BigIntStats> {
  if (typeof path === 'string') return lstat(path, { bigint: true })
  const { parent, name } = child(path)
  return statPrivateChild(parent, name)
}

function linuxPath(path: PrivateChildLocation): string {
  requireLinux()
  const { parent, name } = child(path)
  return `/proc/self/fd/${parent.fd}/${name}`
}

export async function mkdirPrivateFile(path: PrivateFileLocation, mode = 0o700): Promise<void> {
  if (typeof path === 'string') return mkdir(path, { mode })
  const { parent, name } = child(path)
  if (process.platform === 'darwin') return privateMacosMkdirAt(parent.fd, name, mode)
  return mkdir(linuxPath(path), { mode })
}

export async function unlinkPrivateFile(path: PrivateFileLocation): Promise<void> {
  if (typeof path === 'string') return unlink(path)
  const { parent, name } = child(path)
  if (process.platform === 'darwin') return privateMacosUnlinkAt(parent.fd, name)
  return unlink(linuxPath(path))
}

export async function rmdirPrivateFile(path: PrivateChildLocation): Promise<void> {
  const { parent, name } = child(path)
  if (process.platform === 'darwin') return privateMacosUnlinkAt(parent.fd, name, true)
  return rmdir(linuxPath(path))
}

export async function readlinkPrivateFile(path: PrivateChildLocation): Promise<string> {
  const { parent, name } = child(path)
  if (process.platform === 'darwin')
    return new TextDecoder('utf-8', { fatal: true }).decode(privateMacosReadlinkAt(parent.fd, name))
  return readlink(linuxPath(path))
}

export async function symlinkPrivateFile(
  target: string,
  path: PrivateChildLocation,
): Promise<void> {
  const { parent, name } = child(path)
  if (process.platform === 'darwin') return privateMacosSymlinkAt(parent.fd, name, target)
  return symlink(target, linuxPath(path))
}

export async function duplicatePrivateDirectory(directory: FileHandle): Promise<FileHandle> {
  return duplicatePrivateDirectoryDescriptor(directory.fd)
}

/** Duplicate a borrowed local descriptor; never interpret a remote descriptor number here. */
export async function duplicatePrivateDirectoryDescriptor(fd: number): Promise<FileHandle> {
  if (!Number.isSafeInteger(fd) || fd < 0) throw new TypeError('invalid directory descriptor')
  if (process.platform === 'darwin') return privateMacosDuplicate(fd)
  requireLinux()
  const { constants } = await import('node:fs')
  return open(
    `/proc/self/fd/${fd}`,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK,
  )
}

/** Cache-location observation, not a pathname capability or permission to reopen. */
export async function observePrivateDescriptorPath(directory: FileHandle): Promise<string> {
  if (process.platform === 'darwin') return privateMacosDescriptorPath(directory.fd)
  requireLinux()
  return realpath(`/proc/self/fd/${directory.fd}`)
}

export async function renamePrivateFile(
  from: PrivateChildLocation,
  to: PrivateChildLocation,
): Promise<void> {
  const source = child(from),
    target = child(to)
  if (process.platform === 'darwin')
    return privateMacosRenameAt(source.parent.fd, source.name, target.parent.fd, target.name)
  return rename(linuxPath(from), linuxPath(to))
}

export async function publishPrivateDirectory(
  parent: FileHandle,
  staged: string,
  destination: string,
): Promise<void> {
  requireLeaf(staged)
  requireLeaf(destination)
  if (process.platform === 'darwin')
    return privateMacosRenameAt(parent.fd, staged, parent.fd, destination, true)
  requireLinux()
  const { privatePublishDirectory } = await import('./file-input.js')
  privatePublishDirectory(parent.fd, staged, destination)
}

export async function linkPrivateFile(
  from: PrivateChildLocation,
  to: PrivateChildLocation,
): Promise<void> {
  const source = child(from),
    target = child(to)
  if (process.platform === 'darwin')
    return privateMacosLinkAt(source.parent.fd, source.name, target.parent.fd, target.name)
  return link(linuxPath(from), linuxPath(to))
}

/** Closed host operations; callers retain the parent and validate entry identity. */
export async function openPrivateChild(
  parent: FileHandle,
  name: string,
  flags: number,
  mode = 0o600,
): Promise<FileHandle> {
  requireLeaf(name)
  if (process.platform === 'darwin') return privateMacosOpenAt(parent.fd, name, flags, mode)
  requireLinux()
  return open(`/proc/self/fd/${parent.fd}/${name}`, flags, mode)
}

export async function statPrivateChild(parent: FileHandle, name: string): Promise<BigIntStats> {
  requireLeaf(name)
  if (process.platform === 'darwin') return privateMacosStatAt(parent.fd, name)
  requireLinux()
  return lstat(`/proc/self/fd/${parent.fd}/${name}`, { bigint: true })
}

export interface PrivateRawDirectory {
  read(): Promise<Dirent<Buffer> | null>
  close(): Promise<void>
}

export async function openPrivateDirectory(parent: FileHandle): Promise<PrivateRawDirectory> {
  if (process.platform === 'darwin') return privateMacosDirectory(parent.fd)
  requireLinux()
  return privateRawDirectory(`/proc/self/fd/${parent.fd}`)
}

/** Preserve raw names until the consuming policy explicitly requires UTF-8. */
export async function* privateDirectoryEntries(parent: FileHandle): AsyncIterable<Dirent<string>> {
  const directory = await openPrivateDirectory(parent)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    for (;;) {
      const entry = await directory.read()
      if (entry === null) return
      const name = decoder.decode(entry.name)
      yield {
        name,
        parentPath: '',
        isFile: () => entry.isFile(),
        isDirectory: () => entry.isDirectory(),
        isSymbolicLink: () => entry.isSymbolicLink(),
        isBlockDevice: () => entry.isBlockDevice(),
        isCharacterDevice: () => entry.isCharacterDevice(),
        isFIFO: () => entry.isFIFO(),
        isSocket: () => entry.isSocket(),
      }
    }
  } finally {
    await directory.close()
  }
}

function requireLeaf(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0'))
    throw new TypeError('descriptor operation requires one leaf name')
}

function requireLinux(): void {
  if (process.platform !== 'linux') throw new Error('no qualified descriptor filesystem')
}
