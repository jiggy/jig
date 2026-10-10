import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promoteDirectory } from '../promote-directory.mjs'
import { PACKAGE_LAYOUT } from './candidate-provenance.mjs'

export const CANDIDATE_PACKAGES = PACKAGE_LAYOUT
export const QUALIFIED_BUN = Object.freeze({
  version: '1.3.3',
  revision: '274e01c737e85f8142070a9745b43a2ba09fce4c',
  platform: 'linux',
  architecture: 'x64',
})
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function execute(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 600_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  }).trim()
}

async function executable(path, label) {
  if (!path || !isAbsolute(path)) throw new Error(`${label} must name an absolute executable`)
  await access(path, constants.X_OK)
  return await realpath(path)
}

// Verify real runtime identities before creating output or changing generated files.
export async function candidateTools({ env = process.env, run = execute } = {}) {
  const bun = await executable(env.JIG_CI_BUN || run('which', ['bun']), 'Bun')
  const node = await executable(env.FLOW_NODE || process.execPath, 'FLOW_NODE')
  const npm = await executable(env.FLOW_NPM || env.JIG_NPM || run('which', ['npm']), 'npm')
  const just = await executable(run('which', ['just']), 'Just')
  const identity = JSON.parse(
    run(bun, [
      '--no-env-file',
      '-e',
      'process.stdout.write(JSON.stringify({version:Bun.version,revision:Bun.revision,platform:process.platform,architecture:process.arch}))',
    ]),
  )
  for (const [key, expected] of Object.entries(QUALIFIED_BUN)) {
    if (identity[key] !== expected)
      throw new Error(
        'Candidates require native Linux x64 Bun 1.3.3 revision 274e01c737e85f8142070a9745b43a2ba09fce4c',
      )
  }
  const nodeVersion = run(node, [
    '-e',
    'if(process.release?.name!=="node"||process.versions.bun||Number(process.versions.node.split(".")[0])<22)process.exit(70);process.stdout.write(process.versions.node)',
  ])
  const npmVersion = run(npm, ['--version'])
  const justVersion = run(just, ['--version'])
  if (
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(nodeVersion) ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(npmVersion) ||
    !/^just \d+\.\d+\.\d+$/.test(justVersion)
  )
    throw new Error('Build tools returned invalid identities')
  if (justVersion !== 'just 1.43.1') throw new Error('Candidates require exact Just 1.43.1')
  return { bun, node, npm, just, identity, nodeVersion, npmVersion, justVersion }
}

export async function inspectArchive(archive, expectedName, run = execute) {
  const manifest = JSON.parse(run('tar', ['-xOzf', archive, 'package/package.json']))
  if (
    manifest.name !== expectedName ||
    manifest.private === true ||
    manifest.publishConfig?.access !== 'public' ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-(alpha|next)(?:\.[0-9A-Za-z-]+)*$/.test(
      manifest.version,
    )
  )
    throw new Error('Candidate must declare the selected public alpha/next package')
  const inventory = run('tar', ['-tzf', archive]).split('\n').sort()
  if (
    inventory.some(
      (path) =>
        path.startsWith('/') ||
        path.split('/').includes('..') ||
        (path !== 'package' && !path.startsWith('package/')) ||
        path.endsWith('.tgz') ||
        (path.includes('/node_modules/') &&
          !(
            expectedName === '@jigging/jig' &&
            path.startsWith('package/libexec/authoring/node_modules/')
          )),
    )
  )
    throw new Error('Candidate contains an unsafe or embedded dependency entry')
  if (expectedName === '@jigging/agent-method' || expectedName === '@jigging/agent-acp') {
    for (const member of ['FLOW.ts', 'FLOW.contract.json', 'src/flow.ts', 'dist/flow.js'])
      if (!inventory.includes(`package/${member}`)) throw new Error(`Candidate omits ${member}`)
  }
  return { manifest, inventory }
}

export async function buildCandidates(
  destination,
  {
    repository = resolve(import.meta.dirname, '../..'),
    env = process.env,
    run = execute,
    writeReceipt,
  } = {},
) {
  if (!destination) throw new Error('A fresh candidate output directory is required')
  const tools = await candidateTools({ env, run })
  if (run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repository }))
    throw new Error('The tracked working tree must be clean before building candidates')
  const revision = run('git', ['rev-parse', 'HEAD'], { cwd: repository })
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Invalid candidate source revision')
  const output = resolve(destination)
  try {
    await lstat(output)
    throw new Error(`Candidate output already exists: ${output}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(dirname(output), { recursive: true })
  const temporary = await mkdtemp(join(tmpdir(), 'jig-ci-candidates-'))
  let staging
  try {
    staging = await mkdtemp(join(dirname(output), '.jig-ci-candidates-'))
    const source = join(temporary, 'source')
    await mkdir(source)
    const archive = join(temporary, 'source.tar')
    run('git', ['archive', '--format=tar', `--output=${archive}`, revision], { cwd: repository })
    run('tar', ['-xf', archive, '-C', source])
    const buildEnv = {
      ...env,
      PATH: `${dirname(tools.bun)}:${dirname(tools.node)}:${dirname(tools.npm)}:${env.PATH || '/usr/bin:/bin'}`,
      FLOW_NODE: tools.node,
      JIG_AUTHORING_NODE_PATH: tools.node,
    }
    const options = { cwd: source, env: buildEnv }
    run(
      tools.bun,
      [
        'install',
        '--ignore-scripts',
        '--config=/dev/null',
        ...Object.values(CANDIDATE_PACKAGES).flatMap((name) => ['--filter', name]),
        '--filter',
        '@jigging/flow-authoring',
        '--cache-dir',
        join(temporary, 'cache'),
        '--backend=copyfile',
        '--no-progress',
        '--no-summary',
      ],
      options,
    )
    run(tools.just, ['--justfile', join(source, 'packages/jig/justfile'), 'build'], options)
    await mkdir(join(staging, 'resolution'))
    await copyFile(join(source, 'bun.lock'), join(staging, 'resolution/bun.lock'))
    const checksums = []
    for (const [kind, name] of Object.entries(CANDIDATE_PACKAGES)) {
      const directory = join(staging, kind)
      await mkdir(directory)
      const packageRoot = join(source, 'packages', kind)
      run(
        tools.bun,
        kind === 'jig'
          ? ['scripts/pack.ts', '--destination', directory]
          : ['pm', 'pack', '--ignore-scripts', '--destination', directory],
        { ...options, cwd: packageRoot },
      )
      const archives = (await readdir(directory)).filter((path) => path.endsWith('.tgz'))
      if (archives.length !== 1) throw new Error(`Expected exactly one ${kind} candidate`)
      const filename = archives[0]
      const candidate = join(directory, filename)
      const { manifest, inventory } = await inspectArchive(candidate, name, run)
      const hash = sha256(await readFile(candidate))
      await writeFile(`${candidate}.sha256`, `${hash}  ${filename}\n`, { flag: 'wx' })
      await writeFile(`${candidate}.files`, `${inventory.join('\n')}\n`, { flag: 'wx' })
      await writeFile(
        join(directory, 'SUCCESS.json'),
        `${JSON.stringify(
          {
            archive: filename,
            package: name,
            version: manifest.version,
            commit: revision,
            sha256: hash,
            gates: [],
            qualification: 'pending',
            bunVersion: tools.identity.version,
            bunRevision: tools.identity.revision,
            nodeVersion: tools.nodeVersion,
            npmVersion: tools.npmVersion,
          },
          null,
          2,
        )}\n`,
        { flag: 'wx' },
      )
      checksums.push(`${hash}  ${kind}/${filename}`)
    }
    await writeFile(join(staging, 'SHA256SUMS'), `${checksums.join('\n')}\n`, { flag: 'wx' })
    const receiptWriter =
      writeReceipt || (await import('./candidate-provenance.mjs')).writeCandidateReceipt
    await receiptWriter({
      root: staging,
      sourceRevision: revision,
      buildProfile: {
        ...tools.identity,
        nodeVersion: tools.nodeVersion,
        npmVersion: tools.npmVersion,
        justVersion: tools.justVersion,
      },
      resolutionFiles: ['resolution/bun.lock'],
    })
    if (run('git', ['rev-parse', 'HEAD'], { cwd: repository }) !== revision)
      throw new Error('Candidate source revision changed during construction')
    await chmod(staging, 0o755)
    await promoteDirectory(staging, output)
    staging = undefined
    return output
  } finally {
    await rm(temporary, { recursive: true, force: true })
    if (staging) await rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3)
      throw new Error('usage: node scripts/ci/build-candidates.mjs <new-output-directory>')
    console.log(await buildCandidates(process.argv[2]))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
