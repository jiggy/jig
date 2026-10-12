import { constants } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import {
  mkdirPrivateFile,
  openPrivateFile,
  type PrivateChildLocation,
  privateChildLocation,
  privateDirectoryEntries,
  rmdirPrivateFile,
  statPrivateFile,
  unlinkPrivateFile,
} from './descriptor-files.js'

const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW

/** Only the independent delivery owner writes this unexposed, held staging tree. */
export async function writePrivateDeliveryFile(
  root: FileHandle,
  path: string,
  bytes: Uint8Array,
  check: () => void,
): Promise<void> {
  const parts = path.split('/')
  const handles: FileHandle[] = []
  const failures: unknown[] = []
  let parent = root
  try {
    for (const part of parts.slice(0, -1)) {
      check()
      const location = privateChildLocation(parent, part)
      await mkdirPrivateFile(location).catch((error) => {
        if (error.code !== 'EEXIST') throw error
      })
      parent = await openPrivateFile(location, DIRECTORY)
      handles.push(parent)
    }
    check()
    const file = await openPrivateFile(
      privateChildLocation(parent, parts.at(-1)!),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    )
    try {
      await file.writeFile(bytes)
    } finally {
      await file.close()
    }
  } catch (error) {
    failures.push(error)
  } finally {
    for (const handle of handles.reverse()) {
      try {
        await handle.close()
      } catch (error) {
        failures.push(error)
      }
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length) throw new AggregateError(failures, 'delivery writer failed')
}

/** Bounded descriptor-relative cleanup, including after the selected parent moves. */
export async function removePrivateDeliveryStage(
  location: PrivateChildLocation,
  identity: { readonly inode: bigint; readonly device: bigint },
): Promise<void> {
  let entries = 0
  const visit = async (
    current: PrivateChildLocation,
    depth: number,
    expected?: typeof identity,
  ): Promise<void> => {
    if (depth > 18) throw new Error('delivery cleanup depth exceeded')
    const directory = await openPrivateFile(current, DIRECTORY)
    try {
      const opened = await directory.stat({ bigint: true })
      if (
        expected !== undefined &&
        (opened.ino !== expected.inode || opened.dev !== expected.device)
      )
        throw new Error('delivery cleanup identity changed')
      for await (const entry of privateDirectoryEntries(directory)) {
        if (++entries > 1026) throw new Error('delivery cleanup entry bound exceeded')
        const child = privateChildLocation(directory, entry.name)
        if (entry.isDirectory()) await visit(child, depth + 1)
        else await unlinkPrivateFile(child)
      }
      const named = await statPrivateFile(current)
      if (named.ino !== opened.ino || named.dev !== opened.dev || !named.isDirectory())
        throw new Error('delivery cleanup identity changed')
      await rmdirPrivateFile(current)
    } finally {
      await directory.close()
    }
  }
  await visit(location, 0, identity)
}
