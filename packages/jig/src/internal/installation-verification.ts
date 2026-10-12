import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { type BigIntStats, constants } from 'node:fs'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  observePrivateDescriptorPath,
  openPrivateFile,
  privateChildLocation,
  renamePrivateFile,
  unlinkPrivateFile,
} from './descriptor-files.js'

import { privateFileDigest } from './identity.js'

type Environment = Readonly<Record<string, string | undefined>>
type Mode = 'cached' | 'strict' | 'fast'
interface Entry {
  readonly path: string
  readonly stamp: string
  readonly digest: string
}

const MAX_ENTRIES = 1024
const MAX_BYTES = 1024 * 1024
const NAME = 'entries.json'
const current = new AsyncLocalStorage<InstallationVerification>()

export class PrivateInstallationVerificationConfigurationError extends Error {}

/** Captured operator policy, scoped across acquisition, execution and cleanup. */
export async function withPrivateInstallationVerification<T>(
  environment: Environment,
  action: () => Promise<T>,
  options: { readonly readOnly?: boolean } = {},
): Promise<T> {
  const mode = environment.JIG_VERIFICATION ?? 'cached'
  if (mode !== 'cached' && mode !== 'strict' && mode !== 'fast')
    throw new PrivateInstallationVerificationConfigurationError('invalid verification mode')
  const root = environment.XDG_CACHE_HOME || join(environment.HOME ?? homedir(), '.cache')
  const verification = new InstallationVerification(
    mode,
    isAbsolute(root) ? join(root, 'jig', 'installation-verification') : undefined,
    options.readOnly === true,
  )
  return current.run(verification, async () => {
    try {
      return await action()
    } finally {
      await verification.close()
    }
  })
}

/** Register the actual project before opening installed support, including review PATH. */
export async function excludePrivateVerificationProject(project: string): Promise<void> {
  await current.getStore()?.exclude(project)
}

/** Installed support only. No package, attachment, credential or approval cache. */
export async function privateInstallationFileDigest(path: string): Promise<string> {
  const verification = current.getStore()
  return verification === undefined ? freshDigest(path) : verification.digest(path)
}

class InstallationVerification {
  private readonly entries = new Map<string, Entry>()
  private readonly projects = new Set<string>()
  private initialized: Promise<void> | undefined
  private directory: Awaited<ReturnType<typeof open>> | undefined
  private disabled = false
  private dirty = false

  constructor(
    private readonly mode: Mode,
    private readonly path: string | undefined,
    private readonly readOnly: boolean,
  ) {}

  async exclude(project: string): Promise<void> {
    this.projects.add(resolve(project))
    this.projects.add(await realpath(project))
    if (this.path !== undefined && !this.outsideProjects(this.path)) this.disabled = true
    if (this.disabled) this.entries.clear()
  }

  async digest(path: string): Promise<string> {
    // Private callers without a registered project retain fresh verification.
    if (this.mode === 'strict' || this.disabled || this.projects.size === 0)
      return freshDigest(path)
    this.initialized ??= this.initialize()
    await this.initialized
    if (this.disabled) return freshDigest(path)
    const previous = this.entries.get(path)
    if (this.mode === 'fast' && previous !== undefined) return previous.digest
    const before = await fileStamp(path)
    if (previous?.stamp === before) return previous.digest
    const digest = await freshDigest(path, before)
    this.entries.delete(path)
    this.entries.set(path, { path, stamp: before, digest })
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!)
    this.dirty = true
    return digest
  }

  private outsideProjects(path: string): boolean {
    return [...this.projects].every((project) => {
      const child = relative(project, path)
      return child === '..' || child.startsWith('../') || isAbsolute(child)
    })
  }

  private async initialize(): Promise<void> {
    try {
      if (this.path === undefined) throw new Error('no absolute cache location')
      // Reject symlink routes, including a route through project source that
      // ultimately points outside it. Inspect before creating any directories.
      for (let ancestor = this.path; ; ancestor = dirname(ancestor)) {
        if (!this.outsideProjects(ancestor)) throw new Error('project cache route')
        try {
          const stat = await lstat(ancestor)
          if (!stat.isDirectory()) throw new Error('non-directory cache route')
        } catch (error) {
          if (!absent(error)) throw error
        }
        if (ancestor === dirname(ancestor)) break
      }
      if (!this.readOnly) await mkdir(this.path, { recursive: true, mode: 0o700 })
      this.directory = await open(
        this.path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      const directoryStat = await this.directory.stat()
      if (
        directoryStat.uid !== process.getuid!() ||
        (directoryStat.mode & 0o077) !== 0 ||
        !this.outsideProjects(await observePrivateDescriptorPath(this.directory))
      )
        throw new Error('unsafe verification cache')
      let file: Awaited<ReturnType<typeof open>>
      try {
        file = await openPrivateFile(
          privateChildLocation(this.directory, NAME),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        )
      } catch (error) {
        if (absent(error)) return
        throw error
      }
      try {
        const stat = await file.stat()
        if (
          !stat.isFile() ||
          stat.uid !== process.getuid!() ||
          (stat.mode & 0o077) !== 0 ||
          stat.nlink !== 1 ||
          stat.size > MAX_BYTES
        )
          throw new Error('unsafe verification entries')
        const buffer = Buffer.alloc(MAX_BYTES + 1)
        let size = 0
        while (size < buffer.length) {
          const { bytesRead } = await file.read(buffer, size, buffer.length - size, size)
          if (bytesRead === 0) break
          size += bytesRead
        }
        if (size > MAX_BYTES) throw new Error('oversized verification entries')
        const entries = parseEntries(JSON.parse(buffer.subarray(0, size).toString()))
        for (const entry of entries) this.entries.set(entry.path, entry)
      } finally {
        await file.close()
      }
    } catch {
      // A cache can only save work. Its loss or corruption cannot block a Run
      // or create an empty identity. Fall back to fresh hashes at every boundary.
      this.disabled = true
      this.entries.clear()
    }
  }

  async close(): Promise<void> {
    const directory = this.directory
    if (directory === undefined) return
    const temporary = privateChildLocation(directory, `.${randomBytes(16).toString('hex')}`)
    let temporaryOwned = false
    try {
      if (this.disabled || this.readOnly || !this.dirty) return
      if (!this.outsideProjects(await observePrivateDescriptorPath(directory))) return
      // Bounded and disposable: atomic replacement, no lock or durability fsync.
      const entries = [...this.entries.values()]
      let bytes = JSON.stringify(entries)
      while (Buffer.byteLength(bytes) > MAX_BYTES) {
        entries.shift()
        bytes = JSON.stringify(entries)
      }
      const file = await openPrivateFile(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      temporaryOwned = true
      try {
        await file.writeFile(bytes)
      } finally {
        await file.close()
      }
      await renamePrivateFile(temporary, privateChildLocation(directory, NAME))
      temporaryOwned = false
    } catch {
      // Losing cached work never changes the command's result or cleanup.
    } finally {
      if (temporaryOwned) await unlinkPrivateFile(temporary).catch(() => undefined)
      await directory.close().catch(() => undefined)
    }
  }
}

async function fileStamp(path: string): Promise<string> {
  const stat = await lstat(path, { bigint: true })
  if (!isAbsolute(path) || !stat.isFile())
    throw new Error('installed support must be a regular file')
  return stamp(stat)
}

function stamp(stat: BigIntStats): string {
  return [
    stat.dev,
    stat.ino,
    stat.mode,
    stat.uid,
    stat.gid,
    stat.nlink,
    stat.size,
    stat.mtimeNs,
    stat.ctimeNs,
  ].join(':')
}

async function freshDigest(path: string, observed?: string): Promise<string> {
  const before = observed ?? (await fileStamp(path))
  const digest = await privateFileDigest(path)
  if ((await fileStamp(path)) !== before)
    throw new Error('installed support changed during hashing')
  return digest
}

function parseEntries(value: unknown): Entry[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) throw new Error('invalid cache')
  const paths = new Set<string>()
  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).length !== 3 ||
      typeof entry.path !== 'string' ||
      !isAbsolute(entry.path) ||
      entry.path.length > 4096 ||
      entry.path.includes('\0') ||
      paths.has(entry.path) ||
      typeof entry.stamp !== 'string' ||
      !/^(?:-?\d{1,30}:){8}-?\d{1,30}$/.test(entry.stamp) ||
      typeof entry.digest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(entry.digest)
    )
      throw new Error('invalid cache entry')
    paths.add(entry.path)
  }
  return value
}

function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}
