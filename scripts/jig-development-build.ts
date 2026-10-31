import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { privateJigDevelopmentCheckout } from '../packages/jig/src/development-checkout.js'

const packages = [
  'jig',
  'agent-method',
  'agent-acp',
  'reporting',
  'display-model',
  'display-web',
  'display-tui',
]
const marker = 'libexec/development-build.json'
const beginning = '.tmp/jig-development-build-inputs.json'
const rebuild = 'From the repository root, run just jig::build, then retry review.'

/** Source inputs for the ordinary Jig build, excluding tests and generated files. */
async function sourceDigest(root: string): Promise<string> {
  const paths = [
    'package.json',
    'justfile',
    'scripts/jig-development-build.ts',
    'LICENSE.md',
    'LICENSES.md',
    'PRICING.md',
  ]
  for (const name of packages) {
    paths.push(
      'packages/' + name + '/package.json',
      'packages/' + name + '/justfile',
      'packages/' + name + '/tsconfig.json',
    )
    await collect(root, 'packages/' + name + '/src', paths)
  }
  for (const directory of [
    'packages/jig/scripts',
    'packages/display-web/scripts',
    'packages/jig/support',
    'packages/jig/patches',
    'LICENSES',
    'docs/jig/spec/contracts',
  ]) {
    await collect(root, directory, paths)
  }
  paths.push('docs/jig/spec/machine/project-authoring-1.schema.json')
  return digestFiles(root, paths)
}

async function outputDigest(release: string): Promise<string> {
  const paths: string[] = []
  for (const directory of ['bin', 'libexec', 'dist']) await collect(release, directory, paths)
  return digestFiles(
    release,
    paths.filter((path) => path !== marker),
  )
}

async function collect(root: string, directory: string, paths: string[]): Promise<void> {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.tmp' || entry.name.endsWith('.md'))
      continue
    const path = directory + '/' + entry.name
    if (entry.isDirectory()) await collect(root, path, paths)
    else if (entry.isFile()) paths.push(path)
    else throw new Error('A build input is not a regular file')
  }
}

async function digestFiles(root: string, paths: string[]): Promise<string> {
  const hashes = new Map<string, string>()
  const ordered = [...new Set(paths)].sort()
  let index = 0
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      while (index < ordered.length) {
        const path = ordered[index++]!
        const file = await open(
          join(root, path),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        )
        try {
          if (!(await file.stat()).isFile()) throw new Error('A build input is not a regular file')
          hashes.set(
            path,
            createHash('sha256')
              .update(await file.readFile())
              .digest('hex'),
          )
        } finally {
          await file.close()
        }
      }
    }),
  )
  return createHash('sha256')
    .update(JSON.stringify(ordered.map((path) => [path, hashes.get(path)])))
    .digest('hex')
}

/** The launcher selects its own contributor source, never application code. */
export async function jigDevelopmentBuild(operation: string, release: string): Promise<void> {
  const root = await privateJigDevelopmentCheckout(release)
  if (root === undefined) {
    if (operation === 'check') throw new Error('Contributor checkout metadata is missing')
    return
  }
  const manifest = JSON.parse(await readFile(join(release, 'package.json'), 'utf8'))
  const current = { version: manifest.version, source: await sourceDigest(root) }
  if (operation === 'begin') {
    await mkdir(join(root, '.tmp'), { recursive: true })
    await writeFile(join(root, beginning), JSON.stringify(current))
    return
  }
  if (operation === 'finish') {
    const started = JSON.parse(await readFile(join(root, beginning), 'utf8'))
    if (JSON.stringify(started) !== JSON.stringify(current))
      throw new Error('Source changed during the build')
    const staged = join(root, '.tmp/development-build-complete.json')
    await writeFile(staged, JSON.stringify({ ...current, output: await outputDigest(release) }))
    await rename(staged, join(release, marker))
    return
  }
  if (operation !== 'check') throw new Error('Unknown build check')
  const recorded = JSON.parse(await readFile(join(release, marker), 'utf8'))
  if (
    recorded.version !== current.version ||
    recorded.source !== current.source ||
    recorded.output !== (await outputDigest(release))
  ) {
    throw new Error('This checkout changed after Jig was built')
  }
}

if (import.meta.main) {
  const [operation, release, ...extra] = process.argv.slice(2)
  try {
    if (!operation || !release || extra.length) throw new Error('Invalid build check')
    await jigDevelopmentBuild(operation, resolve(release))
  } catch {
    process.stderr.write(
      'Error: Jig needs to be rebuilt\n\n' +
        '  This checkout has changed, or its generated build is incomplete.\n\n' +
        '  Next step: ' +
        rebuild +
        '\n\n  Diagnostic code: JIG_BUILD_STALE\n',
    )
    process.exitCode = 2
  }
}
