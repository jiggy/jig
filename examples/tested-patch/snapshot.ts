import { constants } from 'node:fs'
import { type FileHandle, open, realpath } from 'node:fs/promises'
import { parseInput, type RepairInput, snapshotDigest } from './flows/repair/policy.ts'

// Directory handles anchor each lookup even if a selected parent is renamed.
// O_NOFOLLOW rejects symlinks; nonblocking open lets us reject FIFOs before reading.
async function readSelected(root: FileHandle, path: string, remaining: number): Promise<string> {
  let directory = root
  try {
    const parts = path.split('/')
    for (const part of parts.slice(0, -1)) {
      const next = await open(
        `/proc/self/fd/${directory.fd}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      if (directory !== root) await directory.close()
      directory = next
    }
    const file = await open(
      `/proc/self/fd/${directory.fd}/${parts.at(-1)}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const before = await file.stat({ bigint: true })
      if (!before.isFile()) throw new TypeError('Select regular files only.')
      if (before.size > remaining) throw new TypeError('Selected source exceeds 64 KiB.')
      const buffer = Buffer.alloc(remaining + 1)
      let size = 0
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, null)
        if (!bytesRead) break
        size += bytesRead
      }
      const after = await file.stat({ bigint: true })
      if (size > remaining) throw new TypeError('Selected source exceeds 64 KiB.')
      if (
        before.size !== BigInt(size) ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs
      )
        throw new TypeError('Selected source changed while being read; capture it again.')
      // Preserve a UTF-8 BOM as source bytes, and reject invalid UTF-8 rather than replacing it.
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        buffer.subarray(0, size),
      )
    } finally {
      await file.close()
    }
  } finally {
    if (directory !== root) await directory.close()
  }
}

export async function capture(repo: string, editPath: string, files: string[], issue: string) {
  if (process.platform !== 'linux')
    throw new Error('This example requires the supported Linux host.')
  // Reuse the method's virtual-path and input policy before touching any selected path.
  const empty = [editPath, ...files].map((path) => ({ path, content: '' }))
  parseInput({ issue, editPath, snapshot: { files: empty, sha256: snapshotDigest(empty) } })
  const repository = await realpath(repo)
  const root = await open(
    repository,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  try {
    const selected = []
    let remaining = 65536
    for (const { path } of empty) {
      const content = await readSelected(root, path, remaining)
      remaining -= Buffer.byteLength(content)
      selected.push({ path, content })
    }
    const input: RepairInput = parseInput({
      issue,
      editPath,
      snapshot: { files: selected, sha256: snapshotDigest(selected) },
    })
    // Linux bounds individual argv strings too; escaped JSON can exceed source byte size.
    if (Buffer.byteLength(JSON.stringify(input)) > 120000)
      throw new TypeError('Escaped input exceeds the CLI argument limit; select less source.')
    return { repository, input }
  } finally {
    await root.close()
  }
}
