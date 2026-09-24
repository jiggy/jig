import { lstat, open, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, normalize } from 'node:path'
import {
  type PrivateAcpAgentProvider,
  type PrivateAcpReadOnlyMount,
  verifyPrivateAcpAgentFileDigests,
} from './acp-agent-provider.js'
import { PrivateAcpSetupError } from './acp-setup-diagnostics.js'
import { privateInstallationFileDigest } from './installation-verification.js'
import { privateMacosCurrentProcessIdentity } from './macos-process-controls.js'
import { privateNativeAgentSupportResolver } from './native-agent-executable.js'

interface MachO {
  readonly executable: boolean
  readonly needed: readonly { readonly path: string; readonly weak: boolean }[]
  readonly search: readonly string[]
  readonly installName?: string
}

/** Static metadata only. No selected executable, dylib, constructor or otool runs.
 * System-cache references are qualified OS support, never invented file mounts.
 * Installed-provider integration must still bind the qualified OS mechanism and
 * compare verifyProvider before using this provisional installation inspection.
 */
export async function inspectPrivateMacosAgentRuntime(
  executable: string,
  projectDirectory: string = process.cwd(),
): Promise<{
  readonly pathPrefix: string
  readonly mounts: readonly PrivateAcpReadOnlyMount[]
  readonly verifyProvider: (provider: PrivateAcpAgentProvider) => void
}> {
  privateMacosCurrentProcessIdentity()
  const outsideProject = await privateNativeAgentSupportResolver(projectDirectory)
  requirePath(executable)
  const main = await realpath(executable)
  const mounts = new Map<string, PrivateAcpReadOnlyMount>()
  const inspected = new Set<string>()
  const loaded = new Map<string, string>()
  const digests = new Map<string, string>()

  async function locate(path: string): Promise<string | undefined> {
    requirePath(path, false)
    if (normalize(path) === path && privateMacosCachedLibrary(path)) return path
    try {
      const source = await outsideProject(path)
      if (source === undefined) throw new Error('native Agent runtime enters the project')
      return source
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
        return undefined
      throw error
    }
  }

  async function visit(path: string, inherited: readonly string[], isMain = false): Promise<void> {
    if (!isMain && privateMacosCachedLibrary(path)) return
    if (inspected.has(path)) return
    if (inspected.size >= 128) throw new Error('native Agent runtime is too large')
    const information = await lstat(path)
    if (
      !information.isFile() ||
      (information.mode & 0o6000) !== 0 ||
      (isMain && (information.mode & 0o111) === 0)
    )
      throw new Error('native Agent runtime file is invalid')
    inspected.add(path)
    if (!isMain)
      mounts.set(path, Object.freeze({ source: path, destination: path, role: 'support' }))
    digests.set(path, await privateInstallationFileDigest(path))
    const metadata = await readPrivateMacosAgentMetadata(path)
    if (metadata.executable !== isMain) throw new Error('native Agent Mach-O file type is invalid')
    if (metadata.installName !== undefined) {
      const previous = loaded.get(metadata.installName)
      if (previous !== undefined && previous !== path)
        throw new Error('native Agent library identity is ambiguous')
      loaded.set(metadata.installName, path)
    }
    const expand = (value: string): string => {
      let expanded: string
      if (value === '@loader_path' || value.startsWith('@loader_path/'))
        expanded = `${dirname(path)}${value.slice(12)}`
      else if (value === '@executable_path' || value.startsWith('@executable_path/'))
        expanded = `${dirname(main)}${value.slice(16)}`
      else {
        requirePath(value)
        expanded = value
      }
      // Preserve traversal until the resolver checks every actual link hop.
      // Lexically collapsing "alias/.." could hide a route through the project.
      requirePath(expanded, false)
      return expanded
    }
    const search = [...metadata.search.map(expand), ...inherited]
    if (search.length > 128) throw new Error('native Agent library search is too large')
    const dependencies: string[] = []
    // dyld selects direct libraries before recursively loading their dependents.
    for (const dependency of metadata.needed) {
      const name = dependency.path
      if (name.startsWith('@rpath/') && loaded.has(name)) continue
      const candidates = name.startsWith('@rpath/')
        ? search.map((directory) => `${directory}/${name.slice(7)}`)
        : [expand(name)]
      let found: string | undefined
      for (const candidate of candidates) {
        found = await locate(candidate)
        if (found !== undefined) break
      }
      if (found === undefined) {
        if (dependency.weak) continue
        throw new Error('native Agent shared library is unavailable')
      }
      if (name.startsWith('@rpath/')) loaded.set(name, found)
      dependencies.push(found)
    }
    for (const dependency of dependencies) await visit(dependency, search)
  }
  await visit(main, [], true)
  return Object.freeze({
    pathPrefix: '',
    mounts: Object.freeze([...mounts.values()]),
    verifyProvider: (provider: PrivateAcpAgentProvider) =>
      verifyPrivateAcpAgentFileDigests(provider, digests),
  })
}

let cacheContains: ((path: string) => boolean) | undefined
/** Consult only the active OS cache, never dlopen an operator-selected library. */
export function privateMacosCachedLibrary(path: string): boolean {
  requirePath(path)
  if (!path.startsWith('/usr/lib/') && !path.startsWith('/System/Library/')) return false
  if (cacheContains === undefined) {
    privateMacosCurrentProcessIdentity()
    const ffi = createRequire(import.meta.url)('bun:ffi') as {
      ptr(bytes: Uint8Array): number
      dlopen(
        path: string,
        declarations: Record<string, { args: string[]; returns: string }>,
      ): {
        symbols: { _dyld_shared_cache_contains_path: (path: number) => boolean }
      }
    }
    const library = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
      _dyld_shared_cache_contains_path: { args: ['ptr'], returns: 'bool' },
    })
    cacheContains = (path) => {
      const bytes = Buffer.from(`${path}\0`)
      return library.symbols._dyld_shared_cache_contains_path(ffi.ptr(bytes))
    }
  }
  return cacheContains(path)
}

/** Bounded Mach-O reader. Can inspect inert fixtures on any development host;
 * this alone establishes neither executable validity nor host qualification. */
export async function readPrivateMacosAgentMetadata(path: string): Promise<MachO> {
  const file = await open(path, 'r')
  try {
    const size = (await file.stat()).size
    async function read(offset: number, length: number): Promise<Buffer> {
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        length > 1024 * 1024 ||
        length > size - offset
      )
        throw new Error('invalid native Agent Mach-O bounds')
      const bytes = Buffer.alloc(length)
      let used = 0
      while (used < length) {
        const result = await file.read(bytes, used, length - used, offset + used)
        if (result.bytesRead === 0) throw new Error('native Agent Mach-O ended early')
        used += result.bytesRead
      }
      return bytes
    }
    const magic = await read(0, Math.min(4, size))
    if (magic.subarray(0, 2).toString() === '#!') throw new PrivateAcpSetupError('wrapper')
    if (magic.length !== 4) throw new Error('native Agent runtime is not Mach-O')
    let start = 0,
      sliceSize = size
    const fatMagic = magic.readUInt32BE()
    if ([0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca].includes(fatMagic)) {
      const little = fatMagic === 0xbebafeca || fatMagic === 0xbfbafeca
      const wide = fatMagic === 0xcafebabf || fatMagic === 0xbfbafeca
      const u32 = (bytes: Buffer, offset: number) =>
        little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset)
      const u64 = (bytes: Buffer, offset: number) =>
        Number(little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset))
      const count = u32(await read(0, 8), 4)
      if (count === 0 || count > 32) throw new Error('invalid native Agent Mach-O slices')
      const entrySize = wide ? 32 : 20
      const table = await read(8, count * entrySize)
      const ranges: { start: number; end: number }[] = []
      let selected = false
      for (let offset = 0; offset < table.length; offset += entrySize) {
        const position = wide ? u64(table, offset + 8) : u32(table, offset + 8)
        const length = wide ? u64(table, offset + 16) : u32(table, offset + 12)
        const alignment = u32(table, offset + (wide ? 24 : 16))
        if (
          !Number.isSafeInteger(position) ||
          !Number.isSafeInteger(length) ||
          position < 8 + table.length ||
          length < 32 ||
          length > size - position ||
          alignment > 30 ||
          position % 2 ** alignment !== 0 ||
          (wide && u32(table, offset + 28) !== 0) ||
          ranges.some((range) => position < range.end && position + length > range.start)
        )
          throw new Error('invalid native Agent Mach-O slice bounds')
        ranges.push({ start: position, end: position + length })
        if (u32(table, offset) !== 0x01000007) continue
        // The qualified client profile uses baseline x86_64, not x86_64h dispatch.
        if (selected || u32(table, offset + 4) !== 3)
          throw new Error('unsupported native Agent Mach-O architecture')
        selected = true
        start = position
        sliceSize = length
      }
      if (!selected) throw new Error('native Agent requires macOS x86-64 Mach-O')
    }
    const header = await read(start, 32)
    if (
      header.readUInt32LE(0) !== 0xfeedfacf ||
      header.readUInt32LE(4) !== 0x01000007 ||
      header.readUInt32LE(8) !== 3
    )
      throw new Error('native Agent requires macOS x86-64 Mach-O')
    const type = header.readUInt32LE(12),
      count = header.readUInt32LE(16),
      commandSize = header.readUInt32LE(20)
    if (
      ![2, 6].includes(type) ||
      count > 4096 ||
      commandSize > sliceSize - 32 ||
      header.readUInt32LE(28) !== 0
    )
      throw new Error('invalid native Agent Mach-O header')
    const commands = await read(start + 32, commandSize)
    const needed: { path: string; weak: boolean }[] = [],
      search: string[] = []
    let interpreter: string | undefined,
      installName: string | undefined,
      platform = false,
      offset = 0
    // These commands cannot add a loader path or another image. Unknown and
    // obsolete loading commands are refused, including embedded DYLD variables.
    const passive = new Set([
      2, 4, 5, 0xb, 0x16, 0x19, 0x1a, 0x1b, 0x1d, 0x1e, 0x22, 0x80000022, 0x26, 0x80000028, 0x29,
      0x2a, 0x2b, 0x2e, 0x31, 0x80000033, 0x80000034,
    ])
    for (let index = 0; index < count; index++) {
      if (offset + 8 > commands.length)
        throw new Error('invalid native Agent Mach-O command bounds')
      const command = commands.readUInt32LE(offset),
        length = commands.readUInt32LE(offset + 4)
      if (length < 8 || length % 8 !== 0 || length > commands.length - offset)
        throw new Error('invalid native Agent Mach-O command bounds')
      const bytes = commands.subarray(offset, offset + length)
      const string = (minimum: number): string => {
        if (length < minimum) throw new Error('invalid native Agent Mach-O command string')
        const position = bytes.readUInt32LE(8),
          end = bytes.indexOf(0, position)
        if (position < minimum || end < position || end - position > 4096)
          throw new Error('invalid native Agent Mach-O command string')
        const value = new TextDecoder('utf-8', { fatal: true }).decode(
          bytes.subarray(position, end),
        )
        if (
          !value ||
          [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
        )
          throw new Error('invalid native Agent Mach-O command string')
        return value
      }
      if ([0xc, 0x80000018, 0x8000001f, 0x20, 0x80000023].includes(command)) {
        if (needed.length >= 128) throw new Error('native Agent runtime is too large')
        needed.push({ path: string(24), weak: command === 0x80000018 })
      } else if (command === 0x8000001c) {
        if (search.length >= 128) throw new Error('native Agent library search is too large')
        search.push(string(12))
      } else if (command === 0xe) {
        if (interpreter !== undefined || type !== 2 || string(12) !== '/usr/lib/dyld')
          throw new Error('unsupported native Agent Mach-O interpreter')
        interpreter = '/usr/lib/dyld'
      } else if (command === 0xd) {
        if (installName !== undefined || type !== 6)
          throw new Error('invalid native Agent library identity')
        installName = string(24)
      } else if (command === 0x32 || command === 0x24) {
        if (
          platform ||
          length < (command === 0x32 ? 24 : 16) ||
          (command === 0x32 &&
            (bytes.readUInt32LE(8) !== 1 || bytes.readUInt32LE(20) * 8 !== length - 24)) ||
          bytes.readUInt32LE(command === 0x32 ? 12 : 8) > 0x000e0401
        )
          throw new Error('unsupported native Agent Mach-O platform')
        platform = true
      } else if (!passive.has(command))
        throw new Error('unsupported native Agent Mach-O load command')
      offset += length
    }
    if (
      offset !== commands.length ||
      !platform ||
      (type === 2 ? interpreter === undefined : installName === undefined)
    )
      throw new Error('incomplete native Agent Mach-O metadata')
    return Object.freeze({
      executable: type === 2,
      needed: Object.freeze(needed),
      search: Object.freeze(search),
      ...(installName === undefined ? {} : { installName }),
    })
  } finally {
    await file.close()
  }
}

function requirePath(path: string, canonical = true): void {
  if (
    !isAbsolute(path) ||
    (canonical && normalize(path) !== path) ||
    path === '/' ||
    Buffer.byteLength(path) > 4096 ||
    [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new Error('native Agent runtime path is invalid')
}
