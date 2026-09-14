// Package existing builds and complete public dependencies for source rebuilds.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--destination')
  throw new Error(
    'Use --destination <directory>. Build the adapter and public dependencies before packing.',
  )
const destination = resolve(args[1]!)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const temporary = await mkdtemp(join(tmpdir(), 'agent-acp-pack-'))
const stage = join(temporary, 'package')
const dependencies = [
  { name: '@jigging/flow', archive: 'flow-sdk.tgz', environment: 'FLOW_SDK_PACKAGE_ARCHIVE' },
  {
    name: '@jigging/agent-method',
    archive: 'agent-method.tgz',
    environment: 'AGENT_METHOD_PACKAGE_ARCHIVE',
  },
] as const
const inventory: Record<
  string,
  { name: string; version: string; archive: string; sha256: string }
> = {}

try {
  await mkdir(stage)
  await mkdir(destination, { recursive: true })
  await mkdir(join(stage, 'tooling'))
  for (const dependency of dependencies) {
    const locator = `file:./tooling/${dependency.archive}`
    const selected = manifest.devDependencies?.[dependency.name]
    let archive: string
    if (selected === locator) {
      archive = join(root, 'tooling', dependency.archive)
      const retained = JSON.parse(
        await readFile(join(root, 'tooling', 'dependencies.json'), 'utf8'),
      )[dependency.name]
      if (
        retained?.name !== dependency.name ||
        retained.archive !== dependency.archive ||
        retained.sha256 !== digest(await readFile(archive))
      )
        throw new Error(`Included ${dependency.name} archive differs from its inventory.`)
    } else if (selected === 'workspace:*') {
      const dependencyRoot = resolve(
        dirname(fileURLToPath(import.meta.resolve(dependency.name))),
        '..',
      )
      const expected = JSON.parse(await readFile(join(dependencyRoot, 'package.json'), 'utf8'))
      if (expected.name !== dependency.name)
        throw new Error(`Expected public ${dependency.name} package.`)
      const supplied = process.env[dependency.environment]
      if (supplied !== undefined) {
        archive = await realpath(resolve(supplied))
        if (!(await lstat(archive)).isFile())
          throw new Error(`${dependency.environment} must identify a regular archive.`)
      } else if (dependency.name === '@jigging/agent-method') {
        // Its documented packaging command preserves its own complete SDK closure.
        execFileSync(process.execPath, ['scripts/pack.ts', '--destination', temporary], {
          cwd: dependencyRoot,
          stdio: 'inherit',
        })
        archive = join(temporary, `jigging-agent-method-${expected.version}.tgz`)
      } else {
        execFileSync(
          process.execPath,
          ['pm', 'pack', '--ignore-scripts', '--destination', temporary],
          { cwd: dependencyRoot, stdio: 'inherit' },
        )
        archive = join(temporary, `jigging-flow-${expected.version}.tgz`)
      }
      const actual = archiveManifest(archive)
      if (actual.name !== expected.name || actual.version !== expected.version)
        throw new Error(
          `${dependency.environment} must match the selected public package identity.`,
        )
    } else throw new Error(`Pack with the workspace or included ${dependency.name} archive.`)
    const bytes = await readFile(archive)
    const actual = archiveManifest(archive)
    if (
      actual.name !== dependency.name ||
      typeof actual.version !== 'string' ||
      Object.keys(actual.dependencies ?? {}).length
    )
      throw new Error(`Expected a complete bundled ${dependency.name} package.`)
    await writeFile(join(stage, 'tooling', dependency.archive), bytes)
    inventory[dependency.name] = {
      name: actual.name,
      version: actual.version,
      archive: dependency.archive,
      sha256: digest(bytes),
    }
    manifest.devDependencies[dependency.name] = locator
  }
  for (const path of manifest.files) {
    if (path === 'tooling') continue
    const target = join(stage, path)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(root, path), target, { recursive: true })
  }
  await writeFile(
    join(stage, 'tooling', 'dependencies.json'),
    `${JSON.stringify(inventory, null, 2)}\n`,
  )
  await writeFile(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  execFileSync(process.execPath, ['pm', 'pack', '--ignore-scripts', '--destination', destination], {
    cwd: stage,
    stdio: 'inherit',
  })
} finally {
  await rm(temporary, { recursive: true, force: true })
}

function archiveManifest(path: string) {
  return JSON.parse(
    execFileSync('tar', ['-xOf', path, 'package/package.json'], { encoding: 'utf8' }),
  )
}
function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
