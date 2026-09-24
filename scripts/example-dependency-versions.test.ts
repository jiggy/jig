import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

type Manifest = {
  name?: string
  version?: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const repository = resolve(import.meta.dir, '..')
const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

test('example Jig dependencies match current public package versions', async () => {
  const tracked = Bun.spawnSync(['git', 'ls-files', '-z', '--', 'examples', 'packages'], {
    cwd: repository,
  })
  expect(tracked.exitCode).toBe(0)
  const paths = new TextDecoder().decode(tracked.stdout).split('\0').filter(Boolean)
  const packagePaths = paths.filter((path) => /^packages\/[^/]+\/package\.json$/.test(path))
  const examplePaths = paths.filter(
    (path) => path.startsWith('examples/') && path.endsWith('/package.json'),
  )
  expect(packagePaths.length).toBeGreaterThan(0)
  expect(examplePaths.length).toBeGreaterThan(0)

  const packages = new Map<string, Manifest>()
  for (const path of packagePaths) {
    const manifest = await loadManifest(path)
    if (manifest.name?.startsWith('@jigging/')) packages.set(manifest.name, manifest)
  }

  for (const path of examplePaths) {
    const manifest = await loadManifest(path)
    for (const section of dependencySections) {
      for (const [name, actual] of Object.entries(manifest[section] ?? {})) {
        if (!name.startsWith('@jigging/')) continue
        const source = packages.get(name)
        if (!source) throw new Error(`${path}: ${name} has no source package manifest`)
        if (source.private) {
          throw new Error(`${path}: ${name} is private and cannot be installed from the registry`)
        }
        if (!source.version) {
          throw new Error(`${path}: ${name} has no source package version`)
        }
        const expected = source.version
        if (actual !== expected) {
          throw new Error(`${path}: ${section}.${name} must be ${expected}, got ${actual}`)
        }
      }
    }
  }
})

async function loadManifest(path: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(repository, path), 'utf8')) as Manifest
}
