import { execFileSync } from 'node:child_process'
import { lstat, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

async function identity(path) {
  try {
    return await lstat(path, { bigint: true })
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined
    throw error
  }
}
const sameDirectory = (a, b) => b?.isDirectory() && a.dev === b.dev && a.ino === b.ino

// Publish one complete staging directory on the same filesystem. BSD mv may
// nest it inside a racing destination; only our original inode may be removed.
export async function promoteDirectory(source, destination) {
  if (!['darwin', 'linux'].includes(process.platform))
    throw new Error('directory promotion requires Linux or Mac')
  const staged = await identity(source)
  if (!staged?.isDirectory()) throw new Error('staging must be a real directory')
  if (staged.dev !== (await stat(dirname(destination), { bigint: true })).dev)
    throw new Error('directory promotion requires the same filesystem')
  if (await identity(destination)) throw new Error(`output already exists: ${destination}`)
  execFileSync(
    'mv',
    process.platform === 'darwin'
      ? ['-n', '--', source, destination]
      : ['-T', '--no-clobber', '--', source, destination],
  )
  if (!sameDirectory(staged, await identity(destination))) {
    const nested = join(destination, basename(source))
    if (sameDirectory(staged, await identity(nested))) await rm(nested, { recursive: true })
    throw new Error(`output appeared during directory promotion: ${destination}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4)
      throw new Error('usage: promote-directory.mjs <staging> <new-output>')
    await promoteDirectory(resolve(process.argv[2]), resolve(process.argv[3]))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
