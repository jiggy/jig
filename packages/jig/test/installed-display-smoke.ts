import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { list as listArchive } from 'tar'
import { settleTestCommand } from './fixtures/bounded-command.js'
import {
  checkInstalledDisplay,
  expectedInstalledFiles,
  installedRuntime,
} from './fixtures/installed-display.js'

// A partial installed witness. Live Runs and full release qualification have
// separate owners; no source rebuild, pack fallback or execution receipt here.
const root = resolve(import.meta.dir, '../../..')
const temporary = await mkdtemp(join(tmpdir(), 'jig-installed-display-'))
const candidates = new Map<string, string>()
const names = {
  FLOW_SDK_PACKAGE_ARCHIVE: '@jigging/flow',
  USER_UPDATES_PACKAGE_ARCHIVE: '@jigging/user-updates',
  AGENT_METHOD_PACKAGE_ARCHIVE: '@jigging/agent-method',
  AGENT_ACP_PACKAGE_ARCHIVE: '@jigging/agent-acp',
  DISPLAY_MODEL_PACKAGE_ARCHIVE: '@jigging/display-model',
  DISPLAY_WEB_PACKAGE_ARCHIVE: '@jigging/display-web',
  DISPLAY_TUI_PACKAGE_ARCHIVE: '@jigging/display-tui',
  JIG_PACKAGE_ARCHIVE: '@jigging/jig',
} as const
let completed = false
let before: Map<string, string> | undefined
let packed: Map<string, { bytes: number; sha256: string }> | undefined
let commandNumber = 0

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const hashes = async () =>
  new Map(
    await Promise.all(
      [...candidates].map(async ([name, path]) => [name, digest(await readFile(path))] as const),
    ),
  )

async function run(
  command: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
  timeoutMs = 120_000,
) {
  const node = process.env.JIG_AUTHORING_NODE_PATH
  const child = Bun.spawn(command, {
    cwd,
    env: {
      ...process.env,
      ...(node ? { PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ''}` } : {}),
      ...environment,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const observed = await settleTestCommand(child, {
    evidence: join(temporary, `command-${++commandNumber}`),
    timeoutMs,
    stdoutLimit: 1024 * 1024,
    stderrLimit: 256 * 1024,
  })
  // Output is retained locally. Assertion failures expose only the fixed phase.
  assert.equal(observed.code, 0, 'Installed display command failed; retained local evidence')
  return observed
}

async function archiveInventory(path: string, name: string) {
  const files = new Map<string, { bytes: number; sha256: string }>()
  const pending: Promise<void>[] = []
  let manifest: Record<string, unknown> | undefined
  let totalBytes = 0
  let entries = 0
  await listArchive({
    file: path,
    strict: true,
    onReadEntry(entry) {
      assert(++entries <= 50_000, 'Oversized installed archive inventory')
      const relative = entry.path.replace(/\/$/, '')
      assert(
        relative === 'package' ||
          (relative.startsWith('package/') &&
            !relative.includes('\\') &&
            !relative.includes('\0') &&
            relative.split('/').every((part) => part && part !== '.' && part !== '..')),
        'Unsafe installed archive member',
      )
      assert(entry.type === 'File' || entry.type === 'Directory', 'Nonregular installed archive')
      if (entry.type === 'Directory') return
      assert(relative !== 'package', 'Invalid installed archive root')
      const member = relative.slice('package/'.length)
      assert(!files.has(member), 'Repeated installed archive member')
      assert(Number.isSafeInteger(entry.size) && entry.size >= 0, 'Invalid installed member size')
      totalBytes += entry.size
      assert(totalBytes <= 512 * 1024 * 1024, 'Oversized installed archive body')
      files.set(member, { bytes: entry.size, sha256: '' })
      pending.push(
        new Promise<void>((resolveEntry, reject) => {
          const hash = createHash('sha256')
          const chunks: Buffer[] = []
          let bytes = 0
          entry.on('data', (chunk: Buffer) => {
            bytes += chunk.byteLength
            hash.update(chunk)
            if (member === 'package.json') chunks.push(chunk)
          })
          entry.once('error', reject)
          entry.once('end', () => {
            try {
              assert.equal(bytes, entry.size, 'Incomplete installed archive member')
              files.set(member, { bytes, sha256: hash.digest('hex') })
              if (member === 'package.json') {
                assert(bytes <= 1024 * 1024, 'Oversized installed manifest')
                manifest = JSON.parse(Buffer.concat(chunks).toString())
              }
              resolveEntry()
            } catch (error) {
              reject(error)
            }
          })
        }),
      )
    },
  })
  await Promise.all(pending)
  assert.equal(manifest?.name, name, 'Wrong installed archive package')
  assert(typeof manifest?.version === 'string', 'Missing installed archive version')
  assert(files.size > 0, 'Empty installed archive inventory')
  return files
}

async function installedInventory(directory: string, prefix = '') {
  const files = new Map<string, { bytes: number; sha256: string }>()
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      for (const [name, file] of await installedInventory(path, relative)) files.set(name, file)
    } else {
      assert(entry.isFile(), 'Nonregular installed package member')
      const bytes = await readFile(path)
      files.set(relative, { bytes: bytes.byteLength, sha256: digest(bytes) })
    }
  }
  return files
}

try {
  assert(
    (process.platform === 'linux' && process.arch === 'x64') ||
      (process.platform === 'darwin' && ['x64', 'arm64'].includes(process.arch)),
    'Installed display needs a qualified Linux or Mac profile',
  )
  for (const variable of Object.keys(names)) {
    const path = process.env[variable]
    assert(path && isAbsolute(path) && path.endsWith('.tgz') && !path.includes('\0'), variable)
    assert.equal(await realpath(path), path, 'Candidate archive must be a canonical path')
    const info = await lstat(path)
    assert(info.isFile() && !info.isSymbolicLink() && info.size > 0, 'Candidate must be regular')
    assert(![...candidates.values()].includes(path), 'Repeated candidate archive')
    candidates.set(variable, path)
  }
  before = await hashes()
  for (const [variable, name] of Object.entries(names)) {
    const inventory = await archiveInventory(candidates.get(variable)!, name)
    if (variable === 'JIG_PACKAGE_ARCHIVE') packed = inventory
  }
  assert(packed, 'Missing Jig archive inventory')
  if (process.env.JIG_AUTHORING_NODE_PATH)
    assert(isAbsolute(process.env.JIG_AUTHORING_NODE_PATH), 'Authoring Node must be absolute')
  for (const kind of ['display-model', 'display-web', 'display-tui'])
    await run([process.execPath, join(root, 'packages', kind, 'test/package-smoke.ts')], root)

  const consumer = join(temporary, 'consumer')
  await mkdir(consumer)
  const archive = candidates.get('JIG_PACKAGE_ARCHIVE')!
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { '@jigging/jig': `file:${archive}` },
    }),
  )
  await run(
    [
      process.env.JIG_NPM ?? 'npm',
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--cache',
      join(temporary, 'cache'),
    ],
    consumer,
  )
  const installed = join(consumer, 'node_modules/@jigging/jig')
  const inventory = await installedInventory(installed)
  assert.deepEqual([...inventory].sort(), [...packed].sort(), 'Installed archive bytes differ')
  assert.deepEqual(
    [...inventory.keys()]
      .filter((path) => !path.startsWith('libexec/authoring/node_modules/'))
      .sort(),
    expectedInstalledFiles,
  )
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.bin, { jig: './bin/jig' })
  assert.equal(manifest.scripts, undefined)
  const runtime = join(consumer, 'node_modules/@oven', installedRuntime.package, 'bin/bun')
  assert.equal(digest(await readFile(runtime)), installedRuntime.sha256)
  assert.equal(
    (await run([runtime, '--version'], consumer)).stdout,
    `${installedRuntime.version}\n`,
  )
  assert.equal(
    (await run([runtime, '--revision'], consumer)).stdout,
    `${installedRuntime.revision}\n`,
  )
  await checkInstalledDisplay({
    consumer,
    installed,
    runtime,
    command: join(consumer, 'node_modules/.bin/jig'),
    run,
  })
  // Hiding/restoring Core and public saved inspection cannot mutate Jig bytes.
  assert.deepEqual([...(await installedInventory(installed))].sort(), [...packed].sort())
  assert.deepEqual(await hashes(), before, 'Candidate archives changed during display witness')
  completed = true
} finally {
  try {
    if (before) assert.deepEqual(await hashes(), before, 'Candidate archives changed')
  } finally {
    if (completed) await rm(temporary, { recursive: true, force: true })
    else console.error(`Installed display witness failed; retained evidence at ${temporary}`)
  }
}
console.log('Installed display witness passed with unchanged frozen archives.')
