import { type Dirent, lstatSync, opendirSync } from 'node:fs'

/** Retain byte names even when Bun's buffer encoding returns names without Dirent metadata. */
export function privateRawDirectory(path: string) {
  const directory = opendirSync(path, { encoding: 'buffer' } as never)
  return {
    readSync(): Dirent<Buffer> | null {
      const entry = directory.readSync() as Dirent<Buffer> | Uint8Array | null
      if (entry === null) return null
      const raw = entry instanceof Uint8Array ? entry : entry.name
      if (!(raw instanceof Uint8Array)) throw new Error('directory did not retain raw names')
      const name = Buffer.from(raw)
      if (name.length === 0 || name.includes(0) || name.includes(47))
        throw new Error('directory returned an invalid leaf name')
      const metadata =
        entry instanceof Uint8Array
          ? lstatSync(Buffer.concat([Buffer.from(`${path}/`), name]))
          : entry
      return {
        name,
        parentPath: path,
        isFile: () => metadata.isFile(),
        isDirectory: () => metadata.isDirectory(),
        isSymbolicLink: () => metadata.isSymbolicLink(),
        isBlockDevice: () => metadata.isBlockDevice(),
        isCharacterDevice: () => metadata.isCharacterDevice(),
        isFIFO: () => metadata.isFIFO(),
        isSocket: () => metadata.isSocket(),
      }
    },
    closeSync() {
      directory.closeSync()
    },
    async read() {
      return this.readSync()
    },
    async close() {
      this.closeSync()
    },
  }
}
