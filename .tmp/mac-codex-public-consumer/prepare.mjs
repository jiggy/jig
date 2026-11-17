import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Preparation installs public archives and writes an ordinary project. It never
// reviews, prepares or submits a Run. Run driver.ts separately after review.
assert.equal(process.versions.bun, '1.4.4', 'Use the qualified Bun 1.4.4 for setup')
let root = resolve(process.argv[2] ?? '')
assert.ok(process.argv.length === 3 && isAbsolute(process.argv[2]), 'Usage: bun prepare.mjs ABSOLUTE_FRESH_WORKSPACE')
const here = dirname(fileURLToPath(import.meta.url))
const repository = await realpath(resolve(here, '../..'))
root = join(await realpath(dirname(root)), basename(root))
const delta = relative(repository, root)
assert.ok(delta.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(delta), 'Create the consumer outside the repository')
const archives = {}
for (const [name, variable, packageName] of [
  ['jig', 'JIG_PACKAGE_ARCHIVE', '@jigging/jig'],
  ['flow', 'FLOW_SDK_PACKAGE_ARCHIVE', '@jigging/flow'],
  ['acp', 'AGENT_ACP_PACKAGE_ARCHIVE', '@jigging/agent-acp'],
]) {
  assert.ok(process.env[variable], `${variable} must name the exact canonical archive`)
  const path = await realpath(process.env[variable])
  assert.ok((await lstat(path)).isFile(), `${variable} must be a regular file`)
  const record = spawnSync('tar', ['-xOzf', path, 'package/package.json'], { encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 })
  assert.equal(record.status, 0, 'Cannot inspect the supplied archive')
  const manifest = JSON.parse(record.stdout)
  assert.equal(manifest.name, packageName, 'Wrong canonical package input')
  assert.ok(typeof manifest.version === 'string' && manifest.version.length > 0, 'Canonical archive omitted its version')
  archives[name] = { path, name: packageName, version: manifest.version, sha256: createHash('sha256').update(await readFile(path)).digest('hex') }
}
await mkdir(root, { mode: 0o700 }) // Exclusive fresh destination: never repair/reuse an earlier attempt.
const evidence = join(root, 'evidence')
await mkdir(evidence, { mode: 0o700 })
const environment = { NPM_CONFIG_USERCONFIG: '/dev/null' }
for (const key of ['PATH', 'HOME', 'TMPDIR', 'FLOW_NODE', 'JIG_AUTHORING_NODE_PATH'])
  if (process.env[key] !== undefined) environment[key] = process.env[key]
let commandNumber = 0
const setupDeadline = Date.now() + 480000
async function command(executable, args, cwd = root) {
  const allowance = Math.min(120000, setupDeadline - Date.now())
  assert.ok(allowance > 0, 'The eight-minute setup allowance expired')
  const result = spawnSync(executable, args, { cwd, env: environment, encoding: 'utf8', timeout: allowance, killSignal: 'SIGKILL', maxBuffer: 4194304 })
  await writeFile(join(evidence, `setup-${++commandNumber}.json`), JSON.stringify({ executable, args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }), { flag: 'wx', mode: 0o600 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, 'Setup failed; retain this entire fresh workspace')
}
async function put(path, content) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}
await put('package.json', { name: 'ordinary-codex-startup-driver', private: true, type: 'module', dependencies: { '@jigging/jig': `file:${archives.jig.path}` } })
await command(process.execPath, ['--no-env-file', '--config=/dev/null', 'install', '--ignore-scripts', '--backend=copyfile'])
await put('project/package.json', { private: true, type: 'module', workspaces: ['flows/*', 'libs/*'] })
for (const [name, archive] of [['flow', archives.flow], ['acp', archives.acp]]) {
  const destination = join(root, 'project/libs', name)
  await mkdir(destination, { recursive: true })
  await command('tar', ['-xzf', archive.path, '--strip-components=1', '-C', destination])
}
await put('project/jig.ts', "import {defineJig,discover} from '@jigging/jig'; export default defineJig({flows:discover('flows'),bindings:discover('bindings')});\n")
await put('project/bindings/startup.ts', "import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/startup',slots:{native:{kind:'acp',client:'codex',maxTurns:1}}});\n")
await put('project/flows/startup/package.json', { name: 'ordinary-codex-startup-flow', private: true, type: 'module', dependencies: { '@jigging/flow': 'workspace:*', '@jigging/agent-acp': 'workspace:*' } })
await put('project/flows/startup/FLOW.meta.json', { name: 'startup', uses: { native: { contract: './contracts/finite-acp/contract.json' }, progress: { contract: './contracts/progress/contract.json' } } })
await put('project/flows/startup/FLOW.contract.json', { $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json', input: { type: 'null' } })
await copyFile(join(here, 'FLOW.ts'), join(root, 'project/flows/startup/FLOW.ts'))
await mkdir(join(root, 'project/flows/startup/contracts'))
const cli = join(root, 'node_modules/.bin/jig')
for (const [source, name] of [['jig:finite-acp', 'finite-acp'], ['jig:run-checkpoint', 'progress']])
  await command(cli, ['import-contract', source, `flows/startup/contracts/${name}`], join(root, 'project'))
await command('git', ['init', '--quiet'], join(root, 'project'))
await command(process.execPath, ['--no-env-file', '--config=/dev/null', 'install', '--lockfile-only', '--ignore-scripts', '--no-progress'], join(root, 'project'))
await rm(join(root, 'project/node_modules'), { recursive: true, force: true })
await command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-subj', '/CN=localhost', '-keyout', join(evidence, 'loopback.key'), '-out', join(evidence, 'loopback.crt')])
await copyFile(join(here, 'driver.ts'), join(root, 'driver.ts'))
for (const archive of Object.values(archives))
  assert.equal(createHash('sha256').update(await readFile(archive.path)).digest('hex'), archive.sha256, 'Canonical input changed during setup')
await put('evidence/archives.json', archives)
console.log(JSON.stringify({ prepared: true, workspace: root, next: 'Run driver.ts explicitly with JIG_CODEX_STARTUP_PATH set; preparation has submitted no Run.' }))
