import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PRIVATE_FILE_LIMITS,
  privateAttachmentName,
  privateFilePath,
} from './internal/file-input-policy.js'

export type PrivateExploreFiles = ReadonlyMap<string, readonly File[]>
export type PrivateExploreUpload = Readonly<{ files: PrivateExploreFiles; identity: string }>

/** Multipart entries supply bytes and leaf names only. Never resolve a client path. */
export function explorerFiles(form: FormData): PrivateExploreFiles {
  const grouped = new Map<string, File[]>()
  let count = 0
  for (const [port, value] of form) {
    if (port === '_intent') continue
    privateAttachmentName(port)
    if (typeof value === 'string' || ++count > PRIVATE_FILE_LIMITS.files)
      throw new Error('Invalid file selection')
    const name = privateFilePath(value.name)
    if (name.includes('/') || Buffer.byteLength(name) > 255) throw new Error('Invalid file name')
    const files = grouped.get(port) ?? []
    if (files.some((file) => file.name === name)) throw new Error('Duplicate file name')
    files.push(value)
    grouped.set(port, files)
  }
  if (!count) throw new Error('Missing files')
  return grouped
}

export async function explorerFileIdentity(files: PrivateExploreFiles): Promise<string> {
  const hash = createHash('sha256')
  for (const [port, entries] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const file of [...entries].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      hash.update(JSON.stringify([port, file.name, bytes.byteLength])).update(bytes)
      bytes.fill(0)
    }
  }
  return hash.digest('hex')
}

/** The ordinary launcher captures these private regular files as read attachments. */
export async function stageExplorerFiles(
  directory: string,
  files: PrivateExploreFiles,
): Promise<string[]> {
  if (!files.size) return []
  const inputs = join(directory, 'attachments')
  await mkdir(inputs, { mode: 0o700 })
  const args: string[] = []
  for (const [port, entries] of files) {
    const root = join(inputs, port)
    await mkdir(root, { mode: 0o700 })
    for (const file of entries) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      try {
        await writeFile(join(root, file.name), bytes, { mode: 0o600, flag: 'wx' })
      } finally {
        bytes.fill(0)
      }
    }
    args.push('--attach', port + '=' + root)
  }
  return args
}
