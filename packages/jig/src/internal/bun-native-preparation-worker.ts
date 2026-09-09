import {
  capturePrivateBunPreparedTree,
  requirePath,
  WorkerFailure,
  type SourceFile,
  type Workspace,
} from './bun-prepared-capture.js'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  requirePrivateBunLockPolicy,
  requirePrivateBunResolutionManifest,
} from './bun-native-lock-policy.js'
import {
  encodePrivateBunMessage,
  PRIVATE_BUN_PREPARATION_LIMITS,
  PRIVATE_BUN_PREPARED_MESSAGE_BYTES,
  PRIVATE_BUN_SOURCE_MESSAGE_BYTES,
  privateBunMessageFits,
} from './bun-native-preparation-protocol.js'

const PACKAGE_ROOT = '/work/package'
const CACHE_ROOT = '/work/cache'

let workspace: Workspace | undefined

let outputQueue = Promise.resolve()
const allowResolutionNetwork =
  process.argv.length === 3 && process.argv[2] === '--allow-resolution-network'

try {
  const iterator = jsonLines(process.stdin, PRIVATE_BUN_SOURCE_MESSAGE_BYTES)[
    Symbol.asyncIterator
  ]()
  const first = await iterator.next()
  if (first.done) throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'preparation source is missing')
  const source = requireSource(first.value)
  workspace = source.workspace
  if (!(await iterator.next()).done) {
    throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'preparation source has trailing data')
  }
  // Bun sees only its intended native inputs, not authored configuration,
  // foreign locks, preload files, or Flow code. Restore source after installation.
  const inputPaths = new Set([
    'package.json',
    'bun.lock',
    ...(workspace?.members.map((path) => `${path}/package.json`) ?? []),
  ])
  const inputs = source.files.filter(({ path }) => inputPaths.has(path))
  await materializeSource(inputs)
  const resolving = !inputs.some(({ path }) => path === 'bun.lock')
  if (resolving) await resolveMissingLock()
  await requireSupportedLock(resolving)
  await install()
  await materializeSource(source.files.filter(({ path }) => !inputPaths.has(path)))
  await verifySource(source.files)
  const prepared = await capturePrivateBunPreparedTree(PACKAGE_ROOT, workspace)
  await sendPrepared(prepared)
  await outputQueue
} catch (error) {
  const failure =
    error instanceof WorkerFailure
      ? error
      : new WorkerFailure(
          'PACKAGE_BUN_PREPARATION_FAILED',
          'locked Bun dependency preparation failed',
        )
  await send({ type: 'failure', code: failure.code, message: failure.message }).catch(
    () => undefined,
  )
  await outputQueue.catch(() => undefined)
  process.exitCode = 1
}

async function materializeSource(files: readonly SourceFile[]): Promise<void> {
  await mkdir(PACKAGE_ROOT, { recursive: true, mode: 0o700 })
  for (const file of files) {
    const bytes = decodeBase64(file.content, file.path)
    const destination = join(PACKAGE_ROOT, ...file.path.split('/'))
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    await writeFile(destination, bytes, { mode: 0o600, flag: 'wx' })
  }
}

async function verifySource(files: readonly SourceFile[]): Promise<void> {
  for (const file of files) {
    const expected = decodeBase64(file.content, file.path)
    const actual = new Uint8Array(await readFile(join(PACKAGE_ROOT, ...file.path.split('/'))))
    if (!Buffer.from(actual).equals(Buffer.from(expected))) {
      throw new WorkerFailure(
        'PACKAGE_BUN_SOURCE_CHANGED',
        'Bun preparation changed authored package bytes',
      )
    }
  }
}

async function requireSupportedLock(resolved: boolean): Promise<void> {
  const lockCopy = '/work/bun-lock.jsonc'
  await copyFile(join(PACKAGE_ROOT, 'bun.lock'), lockCopy)
  let value: unknown
  try {
    const result = await runChild(
      [
        '--no-env-file',
        '--no-install',
        '--config=/dev/null',
        '-e',
        'const value=(await import(process.argv[1])).default;process.stdout.write(JSON.stringify(value));',
        lockCopy,
      ],
      {
        cwd: '/work',
        env: { LD_LIBRARY_PATH: '/jig-runtime/lib' },
      },
      2 * 1024 * 1024,
      64 * 1024,
    )
    if (result.exit !== 0 || result.stderr !== '') throw new Error('lock parser failed')
    value = JSON.parse(result.stdout)
  } catch {
    throw new WorkerFailure(
      'PACKAGE_BUN_LOCK_INVALID',
      'bun.lock is not valid for the pinned Bun runtime',
    )
  }
  try {
    requirePrivateBunLockPolicy(
      value,
      workspace === undefined ? undefined : new Set(workspace.members),
    )
  } catch {
    if (resolved) {
      throw new WorkerFailure(
        'PACKAGE_BUN_RESOLVED_SOURCE_UNSUPPORTED',
        'resolved dependencies are unsupported; resolution requests may already have occurred',
      )
    }
    unsupportedSource()
  }
  if (workspace !== undefined) {
    const locked = (value as { workspaces: Record<string, Record<string, unknown>> }).workspaces
    for (const path of ['', ...workspace.members]) {
      const manifest = JSON.parse(await readFile(join(PACKAGE_ROOT, path, 'package.json'), 'utf8'))
      const entry = locked[path]
      const dependencyFields = [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ]
      if (
        entry === undefined ||
        ['name', 'version'].some((field) => manifest[field] !== entry[field]) ||
        dependencyFields.some(
          (field) => canonical(manifest[field] ?? {}) !== canonical(entry[field] ?? {}),
        )
      )
        throw new WorkerFailure(
          'PACKAGE_BUN_LOCK_STALE',
          'workspace manifests and bun.lock disagree; update the workspace lock explicitly',
        )
    }
  }
}

function canonical(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value))
    return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify(value) ?? ''
}

async function resolveMissingLock(): Promise<void> {
  if (!allowResolutionNetwork)
    throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'resolution permission is missing')
  try {
    requirePrivateBunResolutionManifest(
      JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8')),
      workspace === undefined ? undefined : 'root',
    )
    for (const member of workspace?.members ?? [])
      requirePrivateBunResolutionManifest(
        JSON.parse(await readFile(join(PACKAGE_ROOT, member, 'package.json'), 'utf8')),
        'member',
      )
  } catch {
    throw new WorkerFailure(
      'PACKAGE_BUN_SOURCE_UNSUPPORTED',
      'package.json contains unsupported resolution inputs',
    )
  }
  const result = await runChild(
    [
      '--no-env-file',
      '--config=/dev/null',
      'install',
      '--lockfile-only',
      '--production',
      '--ignore-scripts',
      '--backend=copyfile',
      '--linker=hoisted',
      `--cache-dir=${CACHE_ROOT}`,
      '--registry=https://registry.npmjs.org',
      '--no-progress',
      '--no-summary',
      ...workspaceFilter(),
    ],
    { cwd: PACKAGE_ROOT, env: { LD_LIBRARY_PATH: '/jig-runtime/lib' } },
    64 * 1024,
    64 * 1024,
  )
  if (result.exit !== 0) {
    // Emit only a closed reason, never registry text, URLs, or credentials.
    if (/No version matching|No matching version|No matching tag/i.test(result.stderr)) {
      throw new WorkerFailure(
        'PACKAGE_BUN_RESOLUTION_VERSION_UNAVAILABLE',
        'a dependency version or tag is unavailable; resolution requests may already have occurred',
      )
    }
    throw new WorkerFailure(
      'PACKAGE_BUN_RESOLUTION_FAILED',
      'dependency resolution failed; network requests may already have occurred',
    )
  }
}

function unsupportedSource(): never {
  throw new WorkerFailure(
    'PACKAGE_BUN_SOURCE_UNSUPPORTED',
    'bun.lock contains a dependency source unsupported by this Jig alpha; only the default npm registry is supported',
  )
}

async function install(): Promise<void> {
  const result = await runChild(
    [
      '--no-env-file',
      '--config=/dev/null',
      'install',
      '--frozen-lockfile',
      '--production',
      '--ignore-scripts',
      '--backend=copyfile',
      '--linker=hoisted',
      `--cache-dir=${CACHE_ROOT}`,
      '--registry=https://registry.npmjs.org',
      '--no-progress',
      '--no-summary',
      ...workspaceFilter(),
    ],
    {
      cwd: PACKAGE_ROOT,
      env: {
        LD_LIBRARY_PATH: '/jig-runtime/lib',
      },
    },
    64 * 1024,
    64 * 1024,
  )
  if (result.exit !== 0) {
    const output = `${result.stdout}\n${result.stderr}`
    if (/lockfile|frozen|package\.json/i.test(output)) {
      throw new WorkerFailure(
        'PACKAGE_BUN_LOCK_STALE',
        'package.json and bun.lock disagree; regenerate bun.lock with bun install --lockfile-only',
      )
    }
    throw new WorkerFailure(
      'PACKAGE_BUN_PREPARATION_FAILED',
      'the locked production dependencies could not be prepared by the pinned Bun runtime',
    )
  }
  await rm(join(PACKAGE_ROOT, 'node_modules', '.bin'), { recursive: true, force: true })
}

function requireSource(value: unknown): {
  readonly files: readonly SourceFile[]
  readonly workspace?: Workspace
} {
  const root = ordinaryRecord(value)
  if (
    root?.type !== 'source' ||
    !Array.isArray(root.files) ||
    root.files.length > PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles
  ) {
    throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'preparation source is invalid')
  }
  const files: SourceFile[] = []
  let total = 0
  let prior: string | undefined
  for (const raw of root.files) {
    const file = ordinaryRecord(raw)
    if (file === undefined || typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'preparation source file is invalid')
    }
    requirePath(file.path)
    if (prior !== undefined && Buffer.from(prior).compare(Buffer.from(file.path)) >= 0) {
      throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'preparation source paths are not canonical')
    }
    prior = file.path
    const bytes = decodeBase64(file.content, file.path)
    total += bytes.byteLength
    if (total > PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes) {
      throw new WorkerFailure(
        'PACKAGE_BUN_INPUT_LIMIT',
        'locked Bun package is too large to prepare',
      )
    }
    files.push(Object.freeze({ path: file.path, content: file.content }))
  }
  if (
    !files.some(({ path }) => path === 'package.json') ||
    (!files.some(({ path }) => path === 'bun.lock') && !allowResolutionNetwork)
  ) {
    throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'locked Bun source is incomplete')
  }
  let selectedWorkspace: Workspace | undefined
  if (root.workspace !== undefined) {
    const record = ordinaryRecord(root.workspace)
    if (
      record === undefined ||
      typeof record.target !== 'string' ||
      !Array.isArray(record.members) ||
      !Array.isArray(record.selected) ||
      record.members.length === 0 ||
      record.members.length > 256 ||
      record.selected.length > record.members.length ||
      !record.members.includes(record.target) ||
      !record.selected.includes(record.target)
    )
      throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'workspace preparation metadata is invalid')
    for (const member of record.members) {
      if (typeof member !== 'string')
        throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'workspace path is invalid')
      requirePath(member)
      if (
        member.split('/').includes('node_modules') ||
        !files.some(({ path }) => path === `${member}/package.json`)
      )
        throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'workspace manifest is missing')
    }
    if (
      new Set(record.members).size !== record.members.length ||
      new Set(record.selected).size !== record.selected.length ||
      record.selected.some((path) => !(record.members as unknown[]).includes(path))
    )
      throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'workspace membership is invalid')
    selectedWorkspace = {
      target: record.target,
      members: record.members as string[],
      selected: record.selected as string[],
    }
  }
  return Object.freeze({
    files: Object.freeze(files),
    ...(selectedWorkspace === undefined ? {} : { workspace: selectedWorkspace }),
  })
}

function workspaceFilter(): string[] {
  return workspace === undefined ? [] : ['--filter', `./${workspace.target}`]
}

function decodeBase64(value: string, label: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', `${label} has invalid encoded bytes`)
  }
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function ordinaryRecord(value: unknown): Record<string, unknown> | undefined {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return undefined
  return value as Record<string, unknown>
}

function send(value: Readonly<Record<string, unknown>>): Promise<void> {
  return enqueue(encodePrivateBunMessage(value))
}

function enqueue(bytes: Uint8Array): Promise<void> {
  outputQueue = outputQueue.then(async () => {
    if (!process.stdout.write(bytes))
      await new Promise<void>((resolve) => process.stdout.once('drain', resolve))
  })
  return outputQueue
}

function sendPrepared(files: readonly SourceFile[]): Promise<void> {
  const bytes = encodePrivateBunMessage({ type: 'prepared', files })
  if (!privateBunMessageFits(bytes.byteLength - 1, PRIVATE_BUN_PREPARED_MESSAGE_BYTES)) {
    throw new WorkerFailure('PACKAGE_BUN_OUTPUT_LIMIT', 'prepared dependency tree is too large')
  }
  return enqueue(bytes)
}

async function* jsonLines(
  source: AsyncIterable<Uint8Array | string>,
  maximum: number,
): AsyncGenerator<unknown> {
  let pending: Buffer[] = []
  let pendingBytes = 0
  for await (const chunk of source) {
    const bytes = Buffer.from(chunk)
    let start = 0
    for (;;) {
      const end = bytes.indexOf(0x0a, start)
      if (end === -1) break
      pending.push(bytes.subarray(start, end))
      pendingBytes += end - start
      if (pendingBytes > maximum) throw new Error('protocol line exceeds bound')
      const line = pending.length === 1 ? pending[0]! : Buffer.concat(pending, pendingBytes)
      pending = []
      pendingBytes = 0
      yield JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))
      start = end + 1
    }
    if (start < bytes.byteLength) {
      pending.push(bytes.subarray(start))
      pendingBytes += bytes.byteLength - start
      if (pendingBytes > maximum) throw new Error('protocol line exceeds bound')
    }
  }
  if (pendingBytes !== 0) throw new Error('protocol ended with a partial line')
}

async function collect(stream: NodeJS.ReadableStream | null, maximum: number): Promise<string> {
  if (stream === null) return ''
  let bytes = Buffer.alloc(0)
  for await (const chunk of stream) {
    bytes = Buffer.concat([bytes, Buffer.from(chunk)])
    if (bytes.byteLength > maximum) throw new Error('preparation child diagnostic exceeds bound')
  }
  return bytes.toString('utf8')
}

async function runChild(
  arguments_: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> },
  maximumStdout: number,
  maximumStderr: number,
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exit: number | null }> {
  const child = spawn(process.execPath, [...arguments_], {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exit = childExit(child)
  let settled = false
  try {
    const [stdout, stderr, code] = await Promise.all([
      collect(child.stdout, maximumStdout),
      collect(child.stderr, maximumStderr),
      exit,
    ])
    settled = true
    return Object.freeze({ stdout, stderr, exit: code })
  } finally {
    if (!settled) {
      child.kill('SIGKILL')
      await exit.catch(() => undefined)
    }
  }
}

function childExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
  })
}
