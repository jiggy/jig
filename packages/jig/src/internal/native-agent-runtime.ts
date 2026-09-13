import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'

import type { PrivateAcpReadOnlyMount } from './acp-agent-provider.js'
import { privateFileDigest } from './identity.js'
import { privateNativeAgentSupportResolver } from './native-agent-executable.js'

interface Elf {
  readonly interpreter?: string
  readonly needed: readonly string[]
  readonly search: readonly string[]
  readonly runpath: boolean
  readonly wrapper?: { readonly executable: string; readonly path: string }
}

/** Read installation metadata as data. Never run ldd, a shell, or the selected client. */
export async function inspectPrivateNativeAgentRuntime(
  executable: string,
  projectDirectory: string = process.cwd(),
): Promise<{
  readonly pathPrefix: string
  readonly mounts: readonly PrivateAcpReadOnlyMount[]
  readonly revalidate: () => Promise<void>
}> {
  const outsideProject = await privateNativeAgentSupportResolver(projectDirectory)
  const mounts = new Map<string, PrivateAcpReadOnlyMount>()
  const inspected = new Set<string>()
  const digests = new Map<string, string>()
  let pathPrefix = ''
  async function visit(
    destination: string,
    inherited: readonly string[] = [],
    loaded: Map<string, string> = new Map(),
    executableFile = false,
  ): Promise<void> {
    requirePath(destination)
    if (mounts.size >= 128) throw new Error('native Agent runtime is too large')
    const source =
      destination === executable ? await realpath(destination) : await outsideProject(destination)
    if (source === undefined) throw new Error('native Agent runtime enters the project')
    const information = await lstat(source)
    if (
      !information.isFile() ||
      (information.mode & 0o6000) !== 0 ||
      (executableFile && (information.mode & 0o111) === 0)
    ) {
      throw new Error('native Agent runtime file is invalid')
    }
    mounts.set(destination, Object.freeze({ source, destination, role: 'support' }))
    if (inspected.has(source)) return
    inspected.add(source)
    const before = await privateFileDigest(source)
    digests.set(source, before)
    const elf = await readElf(source)
    if (elf === undefined) throw new Error('native Agent runtime is not ELF')
    const search = elf.search.map((path) => {
      const expanded = path.replace(/\$\{ORIGIN\}|\$ORIGIN/g, dirname(destination))
      requirePath(expanded)
      if (expanded.includes('$')) throw new Error('unsupported native Agent library search')
      return expanded
    })
    const inheritedSearch = elf.runpath ? inherited : [...search, ...inherited]
    const directories = [...search, ...inherited]
    if (elf.interpreter !== undefined) {
      await visit(elf.interpreter, [], new Map(), true)
      directories.push(dirname(elf.interpreter), dirname(mounts.get(elf.interpreter)!.source))
    }
    // Linux x86-64 ABI defaults. Package RUNPATH/RPATH remains first.
    directories.push(
      '/lib/x86_64-linux-gnu',
      '/usr/lib/x86_64-linux-gnu',
      '/lib64',
      '/usr/lib64',
      '/lib',
      '/usr/lib',
    )
    const dependencies: string[] = []
    // Resolve direct requirements before walking their dependencies. The loader
    // reuses an already selected library name instead of searching for it again.
    for (const name of elf.needed) {
      if (loaded.has(name)) continue
      if (name.includes('/')) {
        requirePath(name)
        loaded.set(name, name)
        dependencies.push(name)
        continue
      }
      let found: string | undefined
      for (const directory of directories) {
        const candidate = join(directory, name)
        try {
          await lstat(candidate)
          found = candidate
          break
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
            throw error
        }
      }
      if (found === undefined) throw new Error('native Agent shared library is unavailable')
      loaded.set(name, found)
      dependencies.push(found)
    }
    for (const dependency of dependencies) await visit(dependency, inheritedSearch, loaded)
    if (elf.wrapper !== undefined) {
      if (destination !== executable) throw new Error('nested native Agent wrapper is unsupported')
      pathPrefix = elf.wrapper.path
      await visit(elf.wrapper.executable, [], new Map(), true)
    }
    if (before !== (await privateFileDigest(source)))
      throw new Error('native Agent runtime changed')
  }
  await visit(executable, [], new Map(), true)
  mounts.delete(executable)
  return Object.freeze({
    pathPrefix,
    mounts: Object.freeze([...mounts.values()]),
    revalidate: async () => {
      for (const [source, digest] of digests) {
        if (digest !== (await privateFileDigest(source)))
          throw new Error('native Agent runtime changed')
      }
    },
  })
}

async function readElf(path: string): Promise<Elf | undefined> {
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
        offset + length > size
      ) {
        throw new Error('invalid native Agent ELF bounds')
      }
      const bytes = Buffer.alloc(length)
      let used = 0
      while (used < length) {
        const result = await file.read(bytes, used, length - used, offset + used)
        if (result.bytesRead === 0) throw new Error('native Agent ELF ended early')
        used += result.bytesRead
      }
      return bytes
    }
    const magic = await read(0, Math.min(4, size))
    if (!magic.equals(Buffer.from([127, 69, 76, 70]))) return undefined
    const header = await read(0, 64)
    if (
      header[4] !== 2 ||
      header[5] !== 1 ||
      header[6] !== 1 ||
      header.readUInt16LE(18) !== 62 ||
      header.readUInt16LE(54) !== 56
    ) {
      throw new Error('native Agent requires Linux x86-64 ELF')
    }
    if (
      ![2, 3].includes(header.readUInt16LE(16)) ||
      header.readUInt32LE(20) !== 1 ||
      header.readUInt16LE(56) > 128
    ) {
      throw new Error('invalid native Agent ELF header')
    }
    const table = await read(Number(header.readBigUInt64LE(32)), header.readUInt16LE(56) * 56)
    const segments = []
    for (let offset = 0; offset < table.length; offset += 56) {
      segments.push({
        type: table.readUInt32LE(offset),
        offset: Number(table.readBigUInt64LE(offset + 8)),
        address: Number(table.readBigUInt64LE(offset + 16)),
        size: Number(table.readBigUInt64LE(offset + 32)),
      })
    }
    const interpreter = segments.find((part) => part.type === 3)
    const dynamic = segments.find((part) => part.type === 2)
    const values = new Map<number, number[]>()
    if (dynamic !== undefined) {
      const bytes = await read(dynamic.offset, dynamic.size)
      if (bytes.length % 16 !== 0 || bytes.length > 64 * 1024)
        throw new Error('invalid native Agent dynamic table')
      let ended = false
      for (let offset = 0; offset < bytes.length; offset += 16) {
        const tag = Number(bytes.readBigUInt64LE(offset))
        if (tag === 0) {
          ended = true
          break
        }
        values.set(tag, [...(values.get(tag) ?? []), Number(bytes.readBigUInt64LE(offset + 8))])
      }
      if (!ended) throw new Error('unterminated native Agent dynamic table')
      for (const tag of [5, 10, 15, 29]) {
        if ((values.get(tag)?.length ?? 0) > 1)
          throw new Error('ambiguous native Agent dynamic table')
      }
    }
    const address = values.get(5)?.[0]
    const stringSize = values.get(10)?.[0]
    let strings: Buffer = Buffer.alloc(0)
    if (address !== undefined && stringSize !== undefined) {
      const segment = segments.find(
        (part) =>
          part.type === 1 &&
          address >= part.address &&
          address + stringSize <= part.address + part.size,
      )
      if (segment === undefined) throw new Error('invalid native Agent string table')
      strings = await read(segment.offset + address - segment.address, stringSize)
    }
    const needed = (values.get(1) ?? []).map((offset) => stringAt(strings, offset))
    const search = (values.get(29) ?? values.get(15) ?? []).flatMap((offset) =>
      stringAt(strings, offset, true) === '' ? [] : stringAt(strings, offset).split(':'),
    )
    // makeBinaryWrapper intentionally embeds its declarative invocation for
    // inspection. Accept only the no-argument, PATH-prefix form needed here;
    // never evaluate this text or infer dependencies from arbitrary strings.
    let wrapper: Elf['wrapper']
    if (size <= 1024 * 1024) {
      const bytes = await read(0, size)
      const marker = bytes.indexOf(Buffer.from("makeCWrapper '"))
      if (marker !== -1) {
        const end = bytes.indexOf(Buffer.from('\n\n'), marker)
        const declaration = bytes.subarray(marker, end).toString('utf8')
        const match =
          /^makeCWrapper '([^'\n]+)' \\\n {4}--inherit-argv0 \\\n {4}--prefix 'PATH' ':' '([^'\n]+)'$/.exec(
            declaration,
          )
        const wrapped = match?.[1]
        const prefix = match?.[2]
        if (wrapped === undefined || prefix === undefined)
          throw new Error('unsupported native Agent binary wrapper')
        requirePath(wrapped)
        for (const directory of prefix.split(':')) requirePath(directory)
        wrapper = { executable: wrapped, path: prefix }
      }
    }
    return {
      ...(interpreter === undefined
        ? {}
        : { interpreter: stringAt(await read(interpreter.offset, interpreter.size), 0) }),
      needed,
      search,
      runpath: values.has(29),
      ...(wrapper === undefined ? {} : { wrapper }),
    }
  } finally {
    await file.close()
  }
}

function stringAt(bytes: Buffer, offset: number, allowEmpty = false): string {
  const end = bytes.indexOf(0, offset)
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset >= bytes.length ||
    end < offset ||
    end - offset > 4096
  )
    throw new Error('invalid native Agent ELF string')
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, end))
  if (!value && !allowEmpty) throw new Error('empty native Agent ELF string')
  return value
}

function requirePath(path: string): void {
  if (!isAbsolute(path) || path.includes('\0') || normalize(path) !== path || path === '/') {
    throw new Error('native Agent runtime path is invalid')
  }
}
