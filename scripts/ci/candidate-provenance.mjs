import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_LAYOUT = Object.freeze({
  'flow-sdk': '@jigging/flow',
  'user-updates': '@jigging/user-updates',
  'agent-method': '@jigging/agent-method',
  'agent-acp': '@jigging/agent-acp',
  jig: '@jigging/jig',
})

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const tarOptions = {
  encoding: 'utf8',
  timeout: 60000,
  maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, LC_ALL: 'C' },
}
export function requireRevision(value) {
  if (!/^[0-9a-f]{40}$/.test(value ?? '')) throw new Error('Expected one full source revision')
  return value
}
export function requireDigest(value) {
  if (!/^[0-9a-f]{64}$/.test(value ?? '')) throw new Error('Expected one SHA256 digest')
  return value
}
export function requireRelative(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.split('/').some((part) => !part || part === '.' || part === '..') ||
    value.startsWith('/')
  )
    throw new Error('Unsafe candidate path')
  return value
}
export async function regularFile(root, path) {
  requireRelative(path)
  const parts = path.split('/')
  for (let index = 1; index <= parts.length; index++) {
    const stat = await lstat(resolve(root, ...parts.slice(0, index)))
    if (stat.isSymbolicLink() || (index === parts.length ? !stat.isFile() : !stat.isDirectory()))
      throw new Error(`Candidate path is not a regular file: ${path}`)
  }
  return resolve(root, path)
}
export async function readMetadata(path) {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw new Error('Invalid or oversized metadata')
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function githubContext({ env = process.env, sourceRevision } = {}) {
  const event = env.GITHUB_EVENT_PATH ? await readMetadata(env.GITHUB_EVENT_PATH) : {}
  const repository = env.GITHUB_REPOSITORY ?? 'local/local'
  const eventName = env.GITHUB_EVENT_NAME ?? 'local'
  let headSha = env.GITHUB_SHA ?? sourceRevision
  let headBranch = (env.GITHUB_REF ?? 'refs/heads/local').replace(/^refs\/heads\//, '')
  let headRepository = repository
  if (eventName === 'pull_request') {
    headSha = event.pull_request?.head?.sha
    headBranch = event.pull_request?.head?.ref
    headRepository = event.pull_request?.head?.repo?.full_name
  }
  const workflowRef = env.GITHUB_WORKFLOW_REF ?? `${repository}/.github/workflows/ci.yml@local`
  const workflowPath = workflowRef.slice(repository.length + 1).split('@')[0]
  return {
    repository,
    workflowPath,
    runId: Number(env.GITHUB_RUN_ID ?? 0),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT ?? 0),
    event: eventName,
    headSha: requireRevision(headSha),
    headBranch,
    headRepository,
  }
}

export function validateProducer(producer) {
  if (
    !producer ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(producer.repository ?? '') ||
    !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(producer.workflowPath ?? '') ||
    !Number.isSafeInteger(producer.runId) ||
    producer.runId < 0 ||
    !Number.isSafeInteger(producer.runAttempt) ||
    producer.runAttempt < 0 ||
    typeof producer.event !== 'string' ||
    typeof producer.headBranch !== 'string' ||
    typeof producer.headRepository !== 'string'
  )
    throw new Error('Invalid producer identity')
  requireRevision(producer.headSha)
  return producer
}

export function validateBuildProfile(profile) {
  if (
    profile?.platform !== 'linux' ||
    profile.architecture !== 'x64' ||
    profile.version !== '1.3.3' ||
    profile.revision !== '274e01c737e85f8142070a9745b43a2ba09fce4c' ||
    profile.justVersion !== 'just 1.43.1' ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(profile.nodeVersion ?? '') ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(profile.npmVersion ?? '')
  )
    throw new Error('Invalid canonical candidate build profile')
  return profile
}

export async function writeCandidateReceipt({
  root,
  sourceRevision,
  producer,
  buildProfile = {},
  resolutionFiles = [],
}) {
  root = resolve(root)
  sourceRevision ??= execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  requireRevision(sourceRevision)
  producer ??= await githubContext({ sourceRevision })
  validateProducer(producer)
  validateBuildProfile(buildProfile)
  const packages = []
  for (const [kind, name] of Object.entries(PACKAGE_LAYOUT)) {
    const files = (await readdir(resolve(root, kind))).filter((file) => file.endsWith('.tgz'))
    if (files.length !== 1) throw new Error(`Expected exactly one ${kind} archive`)
    const archive = `${kind}/${files[0]}`
    const bytes = await readFile(await regularFile(root, archive))
    const manifest = JSON.parse(
      execFileSync('tar', ['-xOzf', resolve(root, archive), 'package/package.json'], {
        ...tarOptions,
        maxBuffer: 1024 * 1024,
      }),
    )
    if (manifest.name !== name || typeof manifest.version !== 'string')
      throw new Error(`Wrong ${kind} package manifest`)
    const inventory = `${archive}.files`
    const inventoryBytes = await readFile(await regularFile(root, inventory))
    packages.push({
      kind,
      name,
      version: manifest.version,
      archive,
      sha256: digest(bytes),
      inventory,
      inventorySha256: digest(inventoryBytes),
    })
  }
  const resolution = []
  for (const path of resolutionFiles)
    resolution.push({
      path: requireRelative(path),
      sha256: digest(await readFile(await regularFile(root, path))),
    })
  if (!resolution.length) throw new Error('Candidate must retain its actual dependency resolution')
  const receipt = { schemaVersion: 1, sourceRevision, producer, buildProfile, resolution, packages }
  await writeFile(resolve(root, 'CANDIDATE.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
  })
  return verifyCandidateBundle(root, { sourceRevision })
}

export async function verifyCandidateBundle(root, expected = {}) {
  root = resolve(root)
  const receiptPath = await regularFile(root, 'CANDIDATE.json')
  const receipt = await readMetadata(receiptPath)
  if (receipt.schemaVersion !== 1) throw new Error('Unsupported candidate receipt')
  requireRevision(receipt.sourceRevision)
  validateProducer(receipt.producer)
  validateBuildProfile(receipt.buildProfile)
  const comparisons = [
    [expected.sourceRevision, receipt.sourceRevision, 'source'],
    [expected.producerRunId, receipt.producer.runId, 'producer run'],
    [expected.producerRunAttempt, receipt.producer.runAttempt, 'producer attempt'],
    [expected.producerRepository, receipt.producer.repository, 'producer repository'],
  ]
  for (const [wanted, actual, label] of comparisons)
    if (wanted !== undefined && wanted !== actual) throw new Error(`Candidate ${label} mismatch`)
  if (
    !Array.isArray(receipt.packages) ||
    receipt.packages.length !== Object.keys(PACKAGE_LAYOUT).length
  )
    throw new Error('Incomplete candidate package set')
  const seen = new Set()
  for (const entry of receipt.packages) {
    if (seen.has(entry.kind) || PACKAGE_LAYOUT[entry.kind] !== entry.name)
      throw new Error('Unknown or duplicate candidate package')
    seen.add(entry.kind)
    requireDigest(entry.sha256)
    requireDigest(entry.inventorySha256)
    requireRelative(entry.archive)
    if (
      entry.archive.split('/')[0] !== entry.kind ||
      !entry.archive.endsWith('.tgz') ||
      entry.inventory !== `${entry.archive}.files`
    )
      throw new Error('Candidate archive path mismatch')
    const bytes = await readFile(await regularFile(root, entry.archive))
    if (digest(bytes) !== entry.sha256) throw new Error('Candidate archive digest mismatch')
    const sidecar = await readFile(await regularFile(root, `${entry.archive}.sha256`), 'utf8')
    if (sidecar !== `${entry.sha256}  ${basename(entry.archive)}\n`)
      throw new Error('Candidate digest sidecar mismatch')
    const inventory = await readFile(await regularFile(root, entry.inventory))
    if (digest(inventory) !== entry.inventorySha256)
      throw new Error('Candidate inventory digest mismatch')
    const actualInventory = `${execFileSync(
      'tar',
      ['-tzf', resolve(root, entry.archive)],
      tarOptions,
    )
      .trimEnd()
      .split('\n')
      .sort()
      .join('\n')}\n`
    if (inventory.toString('utf8') !== actualInventory)
      throw new Error('Candidate inventory does not describe its archive')
    const manifest = JSON.parse(
      execFileSync('tar', ['-xOzf', resolve(root, entry.archive), 'package/package.json'], {
        ...tarOptions,
        maxBuffer: 1024 * 1024,
      }),
    )
    if (manifest.name !== entry.name || manifest.version !== entry.version)
      throw new Error('Candidate package manifest mismatch')
  }
  if (!Array.isArray(receipt.resolution) || !receipt.resolution.length)
    throw new Error('Missing resolved dependency evidence')
  const paths = new Set()
  for (const entry of receipt.resolution) {
    requireDigest(entry.sha256)
    if (paths.has(entry.path)) throw new Error('Duplicate resolution evidence')
    paths.add(entry.path)
    if (digest(await readFile(await regularFile(root, entry.path))) !== entry.sha256)
      throw new Error('Candidate dependency resolution mismatch')
  }
  return { ...receipt, receiptSha256: digest(await readFile(receiptPath)), root }
}

export function candidateBinding(receipt, artifact) {
  if (
    artifact.schemaVersion !== 1 ||
    artifact.repository !== receipt.producer.repository ||
    artifact.runId !== receipt.producer.runId ||
    artifact.runAttempt !== receipt.producer.runAttempt ||
    artifact.sourceRevision !== receipt.sourceRevision ||
    artifact.receiptSha256 !== receipt.receiptSha256 ||
    !Number.isSafeInteger(artifact.artifactId) ||
    artifact.artifactId <= 0 ||
    !/^sha256:[0-9a-f]{64}$/.test(artifact.artifactDigest ?? '')
  )
    throw new Error('Candidate artifact envelope mismatch')
  return {
    sourceRevision: receipt.sourceRevision,
    receiptSha256: receipt.receiptSha256,
    producerRunId: artifact.runId,
    producerRunAttempt: artifact.runAttempt,
    artifactId: artifact.artifactId,
    artifactDigest: artifact.artifactDigest,
  }
}

export async function writeQualificationReceipt({
  root,
  output,
  kind,
  profile = '',
  upstreamReceipt,
  checkedOutRevision,
  stage = 'qualification',
  env = process.env,
}) {
  if (
    !['ci', 'linux', 'macos', 'native'].includes(kind) ||
    (kind === 'macos' && !['x64', 'arm64'].includes(profile)) ||
    (kind === 'native' && !['codex', 'claude', 'pi'].includes(profile))
  )
    throw new Error('Invalid qualification profile')
  if (!['inputs', 'qualification'].includes(stage) || (stage === 'inputs' && kind !== 'native'))
    throw new Error('Invalid evidence stage')
  const receipt = await verifyCandidateBundle(root, {
    sourceRevision: checkedOutRevision || env.SOURCE_REVISION || undefined,
  })
  if (env.SOURCE_REVISION && env.SOURCE_REVISION !== receipt.sourceRevision)
    throw new Error('Qualification tested source mismatch')
  const artifact = await readMetadata(resolve(root, 'ARTIFACT.json'))
  const candidate = candidateBinding(receipt, artifact)
  const consumer = validateProducer(
    await githubContext({ env, sourceRevision: receipt.sourceRevision }),
  )
  let upstream
  if (kind === 'native') {
    if (!upstreamReceipt) throw new Error('Native qualification requires its Linux receipt')
    const linux = await readMetadata(upstreamReceipt)
    if (
      linux.kind !== 'linux' ||
      linux.stage !== 'qualification' ||
      linux.schemaVersion !== 1 ||
      JSON.stringify(linux.candidate) !== JSON.stringify(candidate)
    )
      throw new Error('Native upstream candidate mismatch')
    validateProducer(linux.consumer)
    upstream = { receiptSha256: digest(await readFile(upstreamReceipt)), receipt: linux }
  }
  const qualification = {
    schemaVersion: 1,
    stage,
    kind,
    profile,
    candidate,
    consumer,
    ...(upstream ? { upstream } : {}),
  }
  await writeFile(output, `${JSON.stringify(qualification, null, 2)}\n`, { flag: 'wx' })
  return qualification
}

export function parseOptions(args) {
  const positional = [],
    options = {}
  for (let index = 0; index < args.length; index++) {
    if (!args[index].startsWith('--')) positional.push(args[index])
    else {
      const key = args[index].slice(2)
      if (
        !key ||
        args[index + 1] === undefined ||
        args[index + 1].startsWith('--') ||
        key in options
      )
        throw new Error('Invalid command options')
      options[key] = args[++index]
    }
  }
  return { positional, options }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positional, options } = parseOptions(process.argv.slice(2))
    if (positional[0] === 'verify' && positional.length === 2) {
      const receipt = await verifyCandidateBundle(positional[1], { sourceRevision: options.source })
      console.log(
        JSON.stringify({
          sourceRevision: receipt.sourceRevision,
          receiptSha256: receipt.receiptSha256,
        }),
      )
    } else if (['inputs', 'qualification'].includes(positional[0]) && positional.length === 3) {
      const checkedOutRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim()
      await writeQualificationReceipt({
        root: positional[1],
        output: positional[2],
        kind: options.kind,
        profile: options.profile,
        upstreamReceipt: options['upstream-receipt'],
        checkedOutRevision,
        stage: positional[0],
      })
    } else
      throw new Error(
        'Use verify BUNDLE [--source SHA] or qualification|inputs BUNDLE OUTPUT --kind KIND [--profile PROFILE] [--upstream-receipt FILE]',
      )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
