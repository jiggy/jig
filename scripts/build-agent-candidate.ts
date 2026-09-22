#!/usr/bin/env bun
// Build once from clean archived source; qualify and retain those exact bytes.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const [kind, destination, ...extra] = process.argv.slice(2)
if (!['agent-method', 'agent-acp'].includes(kind ?? '') || !destination || extra.length)
  throw new Error(
    'usage: bun scripts/build-agent-candidate.ts <agent-method|agent-acp> <new-output-directory>',
  )
const name = `@jigging/${kind}`
const repository = resolve(import.meta.dir, '..')
function command(executable: string, args: string[], cwd = repository): string {
  return execFileSync(executable, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 600_000,
  }).trim()
}
const node = process.env.FLOW_NODE
const npm = process.env.FLOW_NPM
for (const [label, executable] of [
  ['FLOW_NODE', node],
  ['FLOW_NPM', npm],
] as const)
  if (!executable || !isAbsolute(executable))
    throw new Error(`set ${label} to its absolute executable`)
if (Bun.version !== '1.3.3' || Bun.revision !== '274e01c737e85f8142070a9745b43a2ba09fce4c')
  throw new Error(
    'Agent candidates require exact Bun 1.3.3 revision 274e01c737e85f8142070a9745b43a2ba09fce4c',
  )
command(node!, ['-e', 'if(process.release.name!=="node"||process.versions.bun)process.exit(70)'])
if (command('git', ['status', '--porcelain', '--untracked-files=no']))
  throw new Error('the tracked working tree must be clean before building a release candidate')
const commit = command('git', ['rev-parse', 'HEAD'])
const output = resolve(destination)
// lstat also refuses broken symlinks; no candidate may overwrite a destination.
async function present(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
if (await present(output)) throw new Error('candidate output already exists')
await mkdir(dirname(output), { recursive: true })
const temporary = await mkdtemp(join(tmpdir(), 'agent-candidate-'))
let staging: string | undefined
try {
  staging = await mkdtemp(join(dirname(output), '.agent-candidate-'))
  const source = join(temporary, 'source')
  const artifacts = join(temporary, 'artifacts')
  const consumer = join(temporary, 'consumer')
  await Promise.all([source, artifacts, consumer].map((path) => mkdir(path)))
  const sourceArchive = join(temporary, 'source.tar')
  command('git', ['archive', '--format=tar', `--output=${sourceArchive}`, commit])
  command('tar', ['-xf', sourceArchive, '-C', source])
  command(
    process.execPath,
    [
      'install',
      '--ignore-scripts',
      '--config=/dev/null',
      '--filter',
      '@jigging/flow',
      '--filter',
      '@jigging/agent-method',
      ...(kind === 'agent-acp' ? ['--filter', '@jigging/agent-acp'] : []),
      '--cache-dir',
      join(temporary, 'cache'),
      '--backend=copyfile',
      '--no-progress',
    ],
    source,
  )
  command(
    'just',
    ['flow::build', 'agent::build', ...(kind === 'agent-acp' ? ['acp::build'] : [])],
    source,
  )
  const relativePackage = `packages/${kind}`
  command(process.execPath, ['test', `${relativePackage}/test`], source)
  command(
    process.execPath,
    ['pm', 'pack', '--ignore-scripts', '--destination', artifacts],
    join(source, relativePackage),
  )
  const archives = (await readdir(artifacts)).filter((path) => path.endsWith('.tgz'))
  if (archives.length !== 1) throw new Error('expected exactly one Agent candidate archive')
  const filename = archives[0]!
  const archive = join(staging, filename)
  const bytes = await readFile(join(artifacts, filename))
  await writeFile(archive, bytes, { flag: 'wx' })
  const manifest = JSON.parse(command('tar', ['-xOzf', archive, 'package/package.json']))
  if (
    manifest.name !== name ||
    manifest.private === true ||
    manifest.publishConfig?.access !== 'public' ||
    !/^\d+\.\d+\.\d+-(alpha|next)(?:\.[0-9A-Za-z-]+)*$/.test(manifest.version)
  )
    throw new Error('candidate must declare the selected public prerelease package')
  const inventory = command('tar', ['-tzf', archive]).split('\n').sort()
  if (
    inventory.some(
      (path) =>
        path.endsWith('.tgz') || path.includes('/tooling/') || path.includes('/node_modules/'),
    )
  )
    throw new Error('Agent candidate contains an embedded dependency archive or installation')
  for (const path of ['FLOW.ts', 'FLOW.contract.json', 'src/flow.ts', 'dist/flow.js'])
    if (!inventory.includes(`package/${path}`)) throw new Error(`candidate omits ${path}`)
  command(npm!, [
    'install',
    '--prefix',
    consumer,
    '--ignore-scripts',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    archive,
  ])
  const module = kind === 'agent-acp' ? `${name}/transport` : name
  command(
    node!,
    [
      '--input-type=module',
      '-e',
      `const api=await import(${JSON.stringify(module)}); if(Object.keys(api).length===0)process.exit(70)`,
    ],
    consumer,
  )
  // A real protocol rejection checks the installed runtime closure. Closing stdin
  // before a Run completes would itself be a transport failure, not a startup test.
  const child = Bun.spawn([process.execPath, join(consumer, 'node_modules', name, 'FLOW.ts')], {
    cwd: consumer,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const deadline = setTimeout(() => child.kill(), 10_000)
  try {
    const stderr = new Response(child.stderr).text()
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 'candidate', method: 'flow/run', params: {} })}\n`,
    )
    const record = JSON.parse(await new Response(child.stdout).text())
    child.stdin.end()
    if (
      record.id !== 'candidate' ||
      record.error?.code !== -32602 ||
      (await child.exited) !== 0 ||
      (await stderr) !== ''
    )
      throw new Error('installed Agent did not return its exact invalid-input rejection')
  } finally {
    clearTimeout(deadline)
    child.kill()
    await child.exited
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex') !== sha256
  )
    throw new Error('candidate bytes changed during qualification')
  await writeFile(`${archive}.sha256`, `${sha256}  ${filename}\n`, { flag: 'wx' })
  await writeFile(`${archive}.files`, `${inventory.join('\n')}\n`, { flag: 'wx' })
  await writeFile(
    join(staging, 'SUCCESS.json'),
    `${JSON.stringify(
      {
        archive: filename,
        package: name,
        version: manifest.version,
        commit,
        sha256,
        bunVersion: Bun.version,
        bunRevision: Bun.revision,
        nodeVersion: command(node!, ['--version']),
        npmVersion: command(npm!, ['--version']),
        gates: ['package-tests', 'npm-install-import', 'installed-flow-invalid-input'],
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  )
  command('mv', ['-T', '--no-clobber', '--', staging, output])
  if (existsSync(staging)) throw new Error('candidate destination appeared during qualification')
  staging = undefined
  process.stdout.write(`${join(output, basename(archive))}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
  if (staging !== undefined) await rm(staging, { recursive: true, force: true })
}
