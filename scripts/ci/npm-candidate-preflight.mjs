import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const registry = '--registry=https://registry.npmjs.org'
const commandOptions = { timeout: 120_000, maxBuffer: 1024 * 1024 }
const packageNames = new Set([
  '@jigging/flow',
  '@jigging/agent-method',
  '@jigging/agent-acp',
  '@jigging/jig',
])
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

// This read-only check catches immutable-version collisions before merge.
// Publication still reconciles the retained archives and channel state again.
export async function preflightCandidate(directory, sourceRevision, npm = 'npm') {
  const success = JSON.parse(await readFile(join(directory, 'SUCCESS.json'), 'utf8'))
  if (
    !sourceRevision ||
    success.commit !== sourceRevision ||
    typeof success.archive !== 'string' ||
    basename(success.archive) !== success.archive ||
    !success.archive.endsWith('.tgz')
  ) {
    throw new Error('candidate record must name one archive from the exact source revision')
  }
  const archive = join(directory, success.archive)
  const candidateDigest = digest(await readFile(archive))
  if (candidateDigest !== success.sha256) throw new Error('candidate archive digest changed')
  const { stdout } = await execute(
    'tar',
    ['-xOzf', archive, 'package/package.json'],
    commandOptions,
  )
  const manifest = JSON.parse(stdout)
  if (
    !packageNames.has(manifest.name) ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-(alpha|next)(?:\.[0-9A-Za-z-]+)*$/.test(
      manifest.version,
    ) ||
    manifest.private === true ||
    manifest.publishConfig?.access !== 'public'
  ) {
    throw new Error('candidate must be a public Jig or FLOW alpha/next package')
  }
  const specifier = `${manifest.name}@${manifest.version}`
  let observed
  try {
    const result = await execute(
      npm,
      ['view', specifier, 'version', '--json', registry],
      commandOptions,
    )
    observed = JSON.parse(result.stdout)
  } catch (error) {
    let code
    try {
      code = JSON.parse(error.stdout).error?.code
    } catch {}
    if (code === 'E404') return `${specifier}: unpublished version; ready for release qualification`
    throw new Error(`could not verify registry version for ${specifier}`, { cause: error })
  }
  if (observed !== manifest.version)
    throw new Error(`invalid registry version response for ${specifier}`)
  const temporary = await mkdtemp(join(tmpdir(), 'jig-npm-preflight-'))
  try {
    await execute(
      npm,
      ['pack', specifier, '--ignore-scripts', '--pack-destination', temporary, registry],
      { ...commandOptions, cwd: temporary },
    )
    const archives = (await readdir(temporary)).filter((name) => name.endsWith('.tgz'))
    if (archives.length !== 1)
      throw new Error(`registry did not return one archive for ${specifier}`)
    if (digest(await readFile(join(temporary, archives[0]))) !== candidateDigest) {
      throw new Error(
        `registry bytes differ from ${specifier}; bump its version and dependent package versions before merging`,
      )
    }
    return `${specifier}: exact archive already published`
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3)
      throw new Error(
        'usage: npm-candidate-preflight.mjs <candidate-directory> (requires SOURCE_REVISION)',
      )
    console.log(await preflightCandidate(resolve(process.argv[2]), process.env.SOURCE_REVISION))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
