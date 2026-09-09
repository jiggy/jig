import { constants } from 'node:fs'
import { type FileHandle, open, opendir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { CheckError } from '../diagnostics.js'
import {
  type CapturedPackage,
  captureOpenedPackageDirectory,
  createCapturedPackage,
} from '../package/capture.js'
import { packageDigest } from '../package/digest.js'
import { assertNoPathCollisions, comparePathBytes, validateLogicalPath } from '../package/paths.js'
import { openPrivateProjectRoot, type PrivateProjectRoot } from '../project/root.js'
import { PRIVATE_BUN_PREPARATION_LIMITS } from './bun-native-preparation-protocol.js'
import { requirePrivateBunResolutionManifest } from './bun-native-lock-policy.js'

const MANIFEST_BYTES = 1024 * 1024
const MAX_MEMBERS = 256
const MAX_ENTRIES = 32_768
const MAX_DEPTH = 32
const Bun = (
  globalThis as unknown as {
    Bun: {
      Glob: new (pattern: string) => { match(path: string): boolean }
      semver: { satisfies(version: string, range: string): boolean }
    }
  }
).Bun

export interface PrivateBunWorkspace {
  readonly captured: CapturedPackage
  readonly target: string
  readonly members: readonly string[]
  readonly selected: readonly string[]
}

interface Member {
  path: string
  bytes: Uint8Array
  manifest: Record<string, unknown>
}

/** Capture declared workspace source, never an installed node_modules link. */
export async function capturePrivateBunWorkspace(input: {
  projectRoot: PrivateProjectRoot
  packagePath: string
  captured: CapturedPackage
  signal: AbortSignal
}): Promise<PrivateBunWorkspace | undefined> {
  if (!input.captured.files.some(({ path }) => path === 'package.json')) return undefined
  const manifestBytes = await input.captured.read('package.json', MANIFEST_BYTES)
  const manifest = parseManifest(manifestBytes)
  const dependencies = runtimeDependencies(manifest)
  if (
    !Object.values(dependencies).some(
      (value) => typeof value === 'string' && value.startsWith('workspace:'),
    )
  )
    return undefined
  const physical = resolve(input.projectRoot.requestedPath, input.packagePath)
  for (let path = dirname(physical), depth = 0; depth < MAX_DEPTH; depth++, path = dirname(path)) {
    input.signal.throwIfAborted()
    const root = await openPrivateProjectRoot(path)
    try {
      const bytes = await readOptional(root.handle, 'package.json')
      if (bytes !== undefined) {
        const rootManifest = parseManifest(bytes)
        if (rootManifest.workspaces !== undefined) {
          const patterns = workspacePatterns(rootManifest.workspaces)
          const target = relative(path, physical)
          if (matches(patterns, target)) {
            try {
              return await capture(
                root,
                bytes,
                patterns,
                target,
                manifestBytes,
                input.captured,
                input.signal,
              )
            } catch (error) {
              if (error instanceof CheckError && !error.code.startsWith('PACKAGE_BUN_')) {
                if (error.code.includes('LIMIT') || error.code.includes('RESOURCE'))
                  fail('PACKAGE_BUN_INPUT_LIMIT', 'workspace source exceeds its capture bounds')
                if (error.code.includes('CHANGED')) changed()
                fail(
                  'PACKAGE_BUN_WORKSPACE_INVALID',
                  'workspace source contains an unsafe or unreadable file',
                )
              }
              throw error
            }
          }
        }
      }
    } finally {
      await root.dispose()
    }
    if (dirname(path) === path) break
  }
  fail(
    'PACKAGE_BUN_WORKSPACE_MISSING',
    'workspace dependencies require membership in a declared ancestor workspace',
  )
}

async function capture(
  root: PrivateProjectRoot,
  rootBytes: Uint8Array,
  patterns: readonly string[],
  target: string,
  targetBytes: Uint8Array,
  source: CapturedPackage,
  signal: AbortSignal,
): Promise<PrivateBunWorkspace> {
  const paths = await discover(root.handle, patterns, signal)
  const members: Member[] = []
  const byName = new Map<string, Member>()
  let metadataBytes = rootBytes.byteLength
  for (const path of paths) {
    signal.throwIfAborted()
    const directory = await openBeneath(root.handle, path)
    try {
      const bytes = await readOptional(directory, 'package.json')
      if (bytes === undefined) continue
      metadataBytes += bytes.byteLength
      if (metadataBytes > PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes)
        fail('PACKAGE_BUN_INPUT_LIMIT', 'workspace metadata exceeds the capture budget')
      const manifest = parseManifest(bytes)
      requireManifest(manifest)
      if (typeof manifest.name !== 'string' || byName.has(manifest.name))
        fail('PACKAGE_BUN_WORKSPACE_INVALID', 'workspace names must be present and unique')
      const member = { path, bytes, manifest }
      members.push(member)
      byName.set(manifest.name, member)
    } finally {
      await directory.close()
    }
  }
  const entry = members.find((member) => member.path === target)
  if (entry === undefined || !Buffer.from(entry.bytes).equals(targetBytes)) changed()
  const selected = new Set<string>()
  const visit = (member: Member): void => {
    if (selected.has(member.path)) return
    selected.add(member.path)
    for (const [name, request] of Object.entries(runtimeDependencies(member.manifest))) {
      const local = byName.get(name)
      const explicit = typeof request === 'string' && request.startsWith('workspace:')
      if (explicit && local === undefined)
        fail('PACKAGE_BUN_WORKSPACE_MISSING', 'a declared workspace dependency is missing')
      if (
        local !== undefined &&
        (explicit ||
          (typeof request === 'string' &&
            typeof local.manifest.version === 'string' &&
            Bun.semver.satisfies(local.manifest.version, request)))
      ) {
        if (explicit && !workspaceVersionMatches(local.manifest.version, String(request)))
          fail(
            'PACKAGE_BUN_WORKSPACE_VERSION',
            'a local workspace version does not satisfy its declaration',
          )
        visit(local)
      }
    }
  }
  visit(entry)
  const owned: CapturedPackage[] = []
  const records = new Map<
    string,
    { size: number; bytes?: Uint8Array; source?: CapturedPackage; path?: string }
  >()
  let total = 0
  const add = (
    path: string,
    size: number,
    value: { bytes?: Uint8Array; source?: CapturedPackage; path?: string },
  ): void => {
    validateLogicalPath(path)
    if (records.has(path)) fail('PACKAGE_BUN_WORKSPACE_INVALID', 'workspace packages overlap')
    total += size
    if (
      total > PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes ||
      records.size >= PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles
    )
      fail('PACKAGE_BUN_INPUT_LIMIT', 'workspace source exceeds the preparation budget')
    records.set(path, { size, ...value })
  }
  try {
    requireManifest(parseManifest(rootBytes), true)
    add('package.json', rootBytes.byteLength, { bytes: rootBytes })
    const lock = await readOptional(root.handle, 'bun.lock', 2 * MANIFEST_BYTES)
    if (lock !== undefined) add('bun.lock', lock.byteLength, { bytes: lock })
    for (const member of members) {
      signal.throwIfAborted()
      if (!selected.has(member.path)) {
        add(`${member.path}/package.json`, member.bytes.byteLength, { bytes: member.bytes })
        continue
      }
      let captured = source
      if (member.path !== target) {
        const directory = await openBeneath(root.handle, member.path)
        try {
          captured = await captureOpenedPackageDirectory(member.path, directory, {
            includes: packageSelection(member.manifest),
            maximumFiles: PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles - records.size,
            maximumBytes: PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes - total,
          })
          owned.push(captured)
        } finally {
          await directory.close()
        }
        if (!Buffer.from(await captured.read('package.json', MANIFEST_BYTES)).equals(member.bytes))
          changed()
        requireBuiltExports(member.manifest, captured)
      }
      if (captured.files.some(({ path }) => path === '.npmrc' || path === 'bun.lock'))
        fail(
          'PACKAGE_BUN_WORKSPACE_INVALID',
          'workspace members use the root lock and no package-local registry configuration',
        )
      for (const file of captured.files)
        add(`${member.path}/${file.path}`, file.size, { source: captured, path: file.path })
    }
    // Verify metadata and membership again after the byte capture. A changed
    // local dependency never qualifies for old admitted-execution reuse.
    if (JSON.stringify(paths) !== JSON.stringify(await discover(root.handle, patterns, signal)))
      changed()
    if (!Buffer.from((await readOptional(root.handle, 'package.json')) ?? []).equals(rootBytes))
      changed()
    const currentLock = await readOptional(root.handle, 'bun.lock', 2 * MANIFEST_BYTES)
    if (
      (lock === undefined) !== (currentLock === undefined) ||
      (lock !== undefined && !Buffer.from(lock).equals(currentLock!))
    )
      changed()
    for (const member of members) {
      const directory = await openBeneath(root.handle, member.path)
      try {
        if (
          !Buffer.from((await readOptional(directory, 'package.json')) ?? []).equals(member.bytes)
        )
          changed()
      } finally {
        await directory.close()
      }
    }
    await root.verify()
    const files = Object.freeze(
      [...records]
        .map(([path, value]) => Object.freeze({ path, size: value.size }))
        .sort((a, b) => comparePathBytes(a.path, b.path)),
    )
    assertNoPathCollisions(files.map(({ path }) => path))
    const backing = {
      async *stream(path: string): AsyncGenerator<Uint8Array> {
        const record = records.get(path)!
        if (record.bytes !== undefined) yield record.bytes
        else yield* record.source!.stream(record.path!)
      },
      async dispose(): Promise<void> {
        await Promise.all(owned.map((value) => value.dispose()))
        records.clear()
      },
    }
    const digest = await packageDigest(files, (file) => backing.stream(file.path))
    return {
      captured: createCapturedPackage('captured Bun workspace', files, digest, backing),
      target,
      members: members.map(({ path }) => path),
      selected: [...selected].sort(comparePathBytes),
    }
  } catch (error) {
    await Promise.all(owned.map((value) => value.dispose()))
    throw error
  }
}

function requireManifest(value: Record<string, unknown>, root = false): void {
  try {
    requirePrivateBunResolutionManifest(value, root ? 'root' : 'member')
  } catch {
    fail('PACKAGE_BUN_WORKSPACE_INVALID', 'unsupported workspace manifest source or override')
  }
}

function runtimeDependencies(manifest: Record<string, unknown>): Record<string, unknown> {
  return Object.assign(
    Object.create(null),
    ...['peerDependencies', 'dependencies', 'optionalDependencies'].map((field) => {
      const value = manifest[field]
      if (value === undefined) return {}
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        fail('PACKAGE_BUN_WORKSPACE_INVALID', 'dependency maps must be objects')
      return value
    }),
  )
}

function workspaceVersionMatches(version: unknown, request: string): boolean {
  const range = request.slice('workspace:'.length)
  return (
    ['*', '^', '~'].includes(range) ||
    (typeof version === 'string' && Bun.semver.satisfies(version, range))
  )
}

function parseManifest(bytes: Uint8Array): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value
  } catch {}
  fail('PACKAGE_BUN_WORKSPACE_INVALID', 'workspace package.json must be a UTF-8 JSON object')
}

function workspacePatterns(value: unknown): readonly string[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value))
    value = (value as Record<string, unknown>).packages
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_MEMBERS ||
    value.some(
      (pattern) =>
        typeof pattern !== 'string' ||
        pattern.length > 1024 ||
        !safePattern(pattern.startsWith('!') ? pattern.slice(1) : pattern),
    )
  )
    fail(
      'PACKAGE_BUN_WORKSPACE_INVALID',
      'workspaces must declare bounded relative package patterns',
    )
  return value as string[]
}

function safePattern(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value
      .split('/')
      .some(
        (part) =>
          part === '.' ||
          part === '..' ||
          part === '' ||
          part === 'node_modules' ||
          part === '.git',
      )
  )
}

function matches(patterns: readonly string[], path: string): boolean {
  return (
    patterns.some((pattern) => !pattern.startsWith('!') && new Bun.Glob(pattern).match(path)) &&
    !patterns.some(
      (pattern) => pattern.startsWith('!') && new Bun.Glob(pattern.slice(1)).match(path),
    )
  )
}

function couldContain(pattern: string, path: string): boolean {
  const parts = pattern.split('/'),
    prefix = path.split('/')
  for (let index = 0; index < prefix.length; index++) {
    if (parts[index] === '**') return true
    if (parts[index] === undefined || !new Bun.Glob(parts[index]!).match(prefix[index]!))
      return false
  }
  return true
}

async function discover(
  root: FileHandle,
  patterns: readonly string[],
  signal: AbortSignal,
): Promise<string[]> {
  const results: string[] = []
  let count = 0
  const visit = async (directory: FileHandle, path: string, depth: number): Promise<void> => {
    signal.throwIfAborted()
    if (depth >= MAX_DEPTH)
      fail('PACKAGE_BUN_INPUT_LIMIT', 'workspace discovery exceeded its depth bound')
    for await (const entry of await opendir(`/proc/self/fd/${directory.fd}`)) {
      if (++count > MAX_ENTRIES)
        fail('PACKAGE_BUN_INPUT_LIMIT', 'workspace discovery exceeded its entry bound')
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const childPath = path === '' ? entry.name : `${path}/${entry.name}`
      if (!patterns.some((pattern) => !pattern.startsWith('!') && couldContain(pattern, childPath)))
        continue
      if (entry.isSymbolicLink())
        fail('PACKAGE_BUN_WORKSPACE_INVALID', 'workspace package paths must not traverse symlinks')
      if (!entry.isDirectory()) continue
      const child = await openBeneath(directory, entry.name)
      try {
        if (matches(patterns, childPath)) {
          if (results.length >= MAX_MEMBERS)
            fail('PACKAGE_BUN_INPUT_LIMIT', 'too many workspace members')
          results.push(childPath)
        }
        await visit(child, childPath, depth + 1)
      } finally {
        await child.close()
      }
    }
  }
  await visit(root, '', 0)
  return results.sort(comparePathBytes)
}

async function openBeneath(root: FileHandle, path: string): Promise<FileHandle> {
  validateLogicalPath(path)
  let current = root
  try {
    for (const part of path.split('/')) {
      const next = await open(
        `/proc/self/fd/${current.fd}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
      if (current !== root) await current.close()
      current = next
    }
    return current
  } catch {
    if (current !== root) await current.close()
    fail('PACKAGE_BUN_WORKSPACE_INVALID', 'workspace directory is missing or unsafe')
  }
}

async function readOptional(
  directory: FileHandle,
  name: string,
  maximum = MANIFEST_BYTES,
): Promise<Uint8Array | undefined> {
  let handle: FileHandle
  try {
    handle = await open(
      `/proc/self/fd/${directory.fd}/${name}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    fail('PACKAGE_BUN_WORKSPACE_INVALID', 'workspace metadata is unreadable or unsafe')
  }
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum))
      fail('PACKAGE_BUN_WORKSPACE_INVALID', 'workspace metadata must be a bounded regular file')
    const buffer = Buffer.alloc(Number(before.size) + 1)
    let size = 0
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, size)
      if (read.bytesRead === 0) break
      size += read.bytesRead
    }
    const after = await handle.stat({ bigint: true })
    if (
      BigInt(size) !== before.size ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      changed()
    return buffer.subarray(0, size)
  } finally {
    await handle.close()
  }
}

function packageSelection(manifest: Record<string, unknown>): (path: string) => boolean {
  const files = manifest.files
  if (
    files !== undefined &&
    (!Array.isArray(files) ||
      files.length > MAX_MEMBERS ||
      files.some(
        (path) =>
          typeof path !== 'string' || !safePattern(path.startsWith('!') ? path.slice(1) : path),
      ))
  )
    fail(
      'PACKAGE_BUN_WORKSPACE_INVALID',
      'package files must be bounded relative paths or patterns',
    )
  const patterns = files as string[] | undefined
  return (path) => {
    if (path.split('/').some((part) => part === 'node_modules' || part === '.git')) return false
    if (path === 'package.json' || /^(README|LICENSE|LICENCE)(\.|$)/i.test(path)) return true
    if (
      patterns?.some(
        (pattern) =>
          pattern.startsWith('!') &&
          (new Bun.Glob(pattern.slice(1)).match(path) ||
            new Bun.Glob(`${pattern.slice(1)}/**`).match(path)),
      )
    )
      return false
    return (
      patterns === undefined ||
      patterns.some(
        (pattern) =>
          !pattern.startsWith('!') &&
          (path === pattern ||
            path.startsWith(`${pattern}/`) ||
            couldContain(pattern, path) ||
            new Bun.Glob(pattern).match(path) ||
            new Bun.Glob(`${pattern}/**`).match(path)),
      )
    )
  }
}

function requireBuiltExports(manifest: Record<string, unknown>, captured: CapturedPackage): void {
  const paths = new Set(captured.files.map(({ path }) => path))
  const check = (value: unknown): void => {
    if (
      typeof value === 'string' &&
      value.startsWith('./') &&
      !value.includes('*') &&
      !paths.has(value.slice(2))
    )
      fail(
        'PACKAGE_BUN_WORKSPACE_BUILD_REQUIRED',
        'a workspace export is missing; build the package before review',
      )
    if (value !== null && typeof value === 'object')
      for (const child of Object.values(value)) check(child)
  }
  check(manifest.exports)
  if (typeof manifest.main === 'string')
    check(manifest.main.startsWith('./') ? manifest.main : `./${manifest.main}`)
}

function changed(): never {
  fail('PACKAGE_BUN_WORKSPACE_CHANGED', 'workspace metadata changed during capture; review again')
}
function fail(code: string, message: string): never {
  throw new CheckError('invalid', code, message, 'package.json')
}
