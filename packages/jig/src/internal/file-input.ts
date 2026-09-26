import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import {
  PRIVATE_FILE_LIMITS,
  PrivateFileInputError,
  privateAttachmentName,
  privateFilePath,
} from './file-input-policy.js'
import { capturePrivateInput, type PrivateCapturedInput } from './input-capture.js'
import {
  privateLinuxOpenAt,
  privateLinuxOpenFileRoot,
  privateLinuxPublishDirectory,
} from './linux-file-input.js'
import { privateMacosDirectory, privateMacosRenameAt } from './macos-descriptor-files.js'
import { privateMacosInputOpenAt, privateMacosOpenFileRoot } from './macos-file-input.js'
import { privateRawDirectory } from './raw-directory.js'

export {
  PRIVATE_FILE_LIMITS,
  PrivateFileInputError,
  privateAttachmentName,
  privateFilePath,
  sha256,
} from './file-input-policy.js'

export const PRIVATE_DIRECTORY_OPEN_FLAGS =
  process.platform === 'darwin' ? constants.O_RDONLY | constants.O_DIRECTORY : 0x200000 | 0x10000
const PRIVATE_CLOEXEC = process.platform === 'darwin' ? 0x01000000 : 0x80000

export function privateOpenAt(
  directory: number,
  path: string,
  flags: number,
  beneath = true,
): number {
  return process.platform === 'darwin'
    ? privateMacosInputOpenAt(directory, path, flags, beneath)
    : privateLinuxOpenAt(directory, path, flags, beneath)
}
export function privateOpenFileRoot(path: string): number {
  return process.platform === 'darwin'
    ? privateMacosOpenFileRoot(path)
    : privateLinuxOpenFileRoot(path)
}
export function privatePublishDirectory(parent: number, staged: string, destination: string): void {
  if (process.platform !== 'darwin') {
    privateLinuxPublishDirectory(parent, staged, destination)
    return
  }
  privateFilePath(staged)
  privateFilePath(destination)
  if (staged.includes('/') || destination.includes('/'))
    throw new TypeError('publication requires two leaf names')
  privateMacosRenameAt(parent, staged, parent, destination, true)
}
export function privateInputDirectory(fd: number) {
  const directory =
    process.platform === 'darwin'
      ? privateMacosDirectory(fd)
      : privateRawDirectory(`/proc/self/fd/${fd}`)
  return {
    readSync() {
      const entry = directory.readSync()
      if (entry === null) return null
      const bytes = Buffer.from(entry.name)
      let name: string
      try {
        name = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new PrivateFileInputError('path')
      }
      return { name, isDirectory: () => entry.isDirectory(), isFile: () => entry.isFile() }
    },
    closeSync() {
      directory.closeSync()
    },
  }
}

export interface PrivateCapturedFile {
  readonly path: string
  readonly input: PrivateCapturedInput
}
export interface PrivateCapturedAttachment {
  readonly name: string
  readonly rootFd: number
  readonly files: readonly PrivateCapturedFile[]
}
export interface PrivateFileSelection {
  readonly name: string
  readonly directory: string
  readonly select: readonly string[]
}

export function privateReadRegularFile(parent: number, path: string, maxBytes: number): Buffer {
  const fd = privateOpenAt(parent, privateFilePath(path), constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const before = fstatSync(fd, { bigint: true })
    if (!before.isFile() || before.nlink !== 1n) throw new PrivateFileInputError('linked')
    if (before.size > BigInt(maxBytes)) throw new PrivateFileInputError('bytes', maxBytes)
    const bytes = Buffer.alloc(Number(before.size) + 1)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null)
      if (count === 0) break
      offset += count
    }
    const after = fstatSync(fd, { bigint: true })
    if (
      offset !== Number(before.size) ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      after.nlink !== 1n
    )
      throw new PrivateFileInputError('changed')
    return bytes.subarray(0, offset)
  } finally {
    closeSync(fd)
  }
}

/**
 * Snapshot one operator-selected data file before project acquisition. Unlike
 * an attachment root, this descriptor never enters package execution, so it
 * does not require mount identity or a local-filesystem allowlist.
 */
export function privateReadOperatorFile(path: string, maxBytes: number): Buffer {
  let fd: number
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | PRIVATE_CLOEXEC | constants.O_NOFOLLOW,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new PrivateFileInputError('input-link')
    }
    throw error
  }
  try {
    const before = fstatSync(fd, { bigint: true })
    if (!before.isFile()) throw new PrivateFileInputError('regular')
    if (before.size > BigInt(maxBytes)) throw new PrivateFileInputError('bytes', maxBytes)
    const bytes = Buffer.alloc(Number(before.size) + 1)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null)
      if (count === 0) break
      offset += count
    }
    const after = fstatSync(fd, { bigint: true })
    if (
      offset !== Number(before.size) ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) {
      throw new PrivateFileInputError('input-changed')
    }
    return bytes.subarray(0, offset)
  } finally {
    closeSync(fd)
  }
}

export function privateCaptureAttachments(
  selections: readonly PrivateFileSelection[],
  parent?: number,
): {
  readonly attachments: readonly PrivateCapturedAttachment[]
  close(): void
} {
  const attachments: PrivateCapturedAttachment[] = []
  const opened: number[] = []
  const inputs: PrivateCapturedInput[] = []
  const deadline = performance.now() + PRIVATE_FILE_LIMITS.captureMs
  const checkTime = () => {
    if (performance.now() >= deadline) throw new PrivateFileInputError('deadline')
  }
  let byteCount = 0,
    fileCount = 0,
    entryCount = 0
  const close = () => {
    const errors: unknown[] = []
    for (const input of inputs.splice(0)) {
      try {
        input.close()
      } catch (error) {
        errors.push(error)
      }
    }
    for (const fd of opened.splice(0)) {
      try {
        closeSync(fd)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, 'input capture closure failed')
  }
  try {
    if (
      selections.length > 8 ||
      new Set(selections.map((item) => item.name)).size !== selections.length
    )
      throw new TypeError('invalid attachment mappings')
    for (const selection of [...selections].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      checkTime()
      const name = privateAttachmentName(selection.name)
      const rootFd =
        parent === undefined
          ? privateOpenFileRoot(selection.directory)
          : privateOpenAt(
              parent,
              privateFilePath(selection.directory),
              PRIVATE_DIRECTORY_OPEN_FLAGS,
            )
      opened.push(rootFd)
      const files: PrivateCapturedFile[] = []
      const capture = (path: string) => {
        checkTime()
        if (files.some((file) => file.path === path))
          throw new TypeError('duplicate captured file path')
        if (++fileCount > PRIVATE_FILE_LIMITS.files) throw new PrivateFileInputError('files')
        const data = privateReadRegularFile(rootFd, path, PRIVATE_FILE_LIMITS.bytes - byteCount)
        byteCount += data.length
        const input = capturePrivateInput(data)
        inputs.push(input)
        files.push(Object.freeze({ path, input }))
      }
      const walk = (relative: string) => {
        const fd =
          relative === ''
            ? rootFd
            : privateOpenAt(rootFd, privateFilePath(relative), PRIVATE_DIRECTORY_OPEN_FLAGS)
        let directory: ReturnType<typeof privateInputDirectory> | undefined
        try {
          directory = privateInputDirectory(fd)
          for (;;) {
            checkTime()
            const entry = directory.readSync()
            if (entry === null) break
            if (++entryCount > PRIVATE_FILE_LIMITS.entries)
              throw new PrivateFileInputError('entries')
            const path = privateFilePath(relative === '' ? entry.name : `${relative}/${entry.name}`)
            if (entry.isDirectory()) walk(path)
            else capture(path)
          }
        } finally {
          try {
            directory?.closeSync()
          } finally {
            if (fd !== rootFd) closeSync(fd)
          }
        }
      }
      if (selection.select.length === 0) walk('')
      else {
        if (new Set(selection.select).size !== selection.select.length)
          throw new TypeError('duplicate file selector')
        for (const path of selection.select) capture(privateFilePath(path))
      }
      attachments.push(
        Object.freeze({
          name,
          rootFd,
          files: Object.freeze(files.sort((a, b) => (a.path < b.path ? -1 : 1))),
        }),
      )
    }
    checkTime()
    return Object.freeze({ attachments: Object.freeze(attachments), close })
  } catch (error) {
    close()
    throw error
  }
}
