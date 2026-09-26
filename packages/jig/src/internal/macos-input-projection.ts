import { constants, fstatSync, readSync } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { PRIVATE_FILE_LIMITS, privateFilePath, sha256 } from './file-input-policy.js'
import { privateMacosMkdirAt, privateMacosOpenAt } from './macos-descriptor-files.js'
import {
  type PrivateMacosReceivedDescriptors,
  requirePrivateMacosReceivedDescriptors,
} from './macos-descriptor-handoff.js'

export interface PrivateMacosInputIdentity {
  readonly path: string
  readonly bytes: number
  readonly digest: string
}
const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | 0x20000000 | 0x01000000

/** Inert identities only. The sender must separately retain authentic live captures. */
export function normalizePrivateMacosInputs(value: unknown): readonly PrivateMacosInputIdentity[] {
  if (!Array.isArray(value) || value.length > PRIVATE_FILE_LIMITS.files)
    throw new TypeError('invalid macOS input manifest')
  let bytes = 0
  const names = new Set<string>(),
    directories = new Set<string>()
  const files = value.map((file: unknown) => {
    const entry = file as PrivateMacosInputIdentity
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Object.keys(entry).sort().join() !== 'bytes,digest,path' ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      typeof entry.digest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(entry.digest)
    )
      throw new TypeError('invalid macOS input identity')
    const path = privateFilePath(entry.path)
    bytes += entry.bytes
    if (names.has(path) || bytes > PRIVATE_FILE_LIMITS.bytes)
      throw new TypeError('macOS captured input exceeds its bounds')
    names.add(path)
    const parts = path.split('/')
    for (let count = 1; count < parts.length; count++)
      directories.add(parts.slice(0, count).join('/'))
    return Object.freeze({ path, bytes: entry.bytes, digest: entry.digest })
  })
  if (
    names.size + directories.size > PRIVATE_FILE_LIMITS.entries ||
    [...names].some((name) => directories.has(name))
  )
    throw new TypeError('macOS input paths conflict or exceed their entry bound')
  return Object.freeze(files)
}

/** After authenticated peer transfer, before any native payload exists. The
 * sole writers close and every created input becomes read-only before return. */
export async function projectPrivateMacosInputs(
  volume: FileHandle,
  manifest: readonly PrivateMacosInputIdentity[],
  bundle: PrivateMacosReceivedDescriptors,
  signal: AbortSignal,
): Promise<void> {
  const files = normalizePrivateMacosInputs(manifest)
  const descriptors = requirePrivateMacosReceivedDescriptors(bundle)
  if (files.length !== descriptors.length) throw new Error('macOS input handoff count changed')
  const root = await privateMacosOpenAt(volume.fd, 'inputs', DIRECTORY)
  const directories = new Map<string, FileHandle>([['', root]])
  const failures: unknown[] = []
  try {
    for (const [index, file] of files.entries()) {
      signal.throwIfAborted()
      const fd = descriptors[index]!
      const before = fstatSync(fd, { bigint: true })
      if (!before.isFile() || before.nlink !== 0n || before.size !== BigInt(file.bytes))
        throw new Error('macOS transferred input is not the declared anonymous file')
      const bytes = Buffer.alloc(file.bytes)
      try {
        for (let offset = 0; offset < bytes.length; ) {
          const count = readSync(fd, bytes, offset, bytes.length - offset, offset)
          if (count === 0) throw new Error('macOS transferred input ended early')
          offset += count
        }
        const after = fstatSync(fd, { bigint: true })
        if (
          sha256(bytes) !== file.digest ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          after.nlink !== 0n ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs
        )
          throw new Error('macOS transferred input identity changed')
        const parts = file.path.split('/')
        let parent = root
        for (let count = 1; count < parts.length; count++) {
          const key = parts.slice(0, count).join('/')
          let directory = directories.get(key)
          if (directory === undefined) {
            privateMacosMkdirAt(parent.fd, parts[count - 1]!, 0o700)
            directory = await privateMacosOpenAt(parent.fd, parts[count - 1]!, DIRECTORY)
            directories.set(key, directory)
          }
          parent = directory
        }
        const output = await privateMacosOpenAt(
          parent.fd,
          parts.at(-1)!,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
          0o600,
        )
        try {
          await output.writeFile(bytes)
          await output.chmod(0o444)
        } finally {
          await output.close()
        }
      } finally {
        bytes.fill(0)
      }
    }
    for (const directory of [...directories.values()].reverse()) await directory.chmod(0o555)
    signal.throwIfAborted()
  } catch (error) {
    failures.push(error)
  }
  const results = await Promise.allSettled(
    [...directories.values()].map((directory) => directory.close()),
  )
  for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
  if (failures.length) throw new AggregateError(failures, 'macOS input projection failed')
}
