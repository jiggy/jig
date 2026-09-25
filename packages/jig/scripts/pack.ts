// Assemble a normal npm dependency layout before packing. Bun's isolated
// workspace links are not a complete bundled-dependency distribution.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--destination')
  throw new Error('Use --destination <directory>.')
const destination = resolve(args[1]!)
await mkdir(destination, { recursive: true })
const root = resolve(import.meta.dir, '..')
const author = dirname(dirname(fileURLToPath(import.meta.resolve('@jigging/flow-authoring'))))
const temporary = await mkdtemp(join(tmpdir(), 'jig-pack-'))
const stage = join(temporary, 'package')
await mkdir(stage)
try {
  execFileSync(process.execPath, ['pm', 'pack', '--ignore-scripts', '--destination', temporary], {
    cwd: author,
    stdio: 'inherit',
  })
  const tool = JSON.parse(await readFile(join(author, 'package.json'), 'utf8'))
  const archive = join(
    temporary,
    `${tool.name.replace('@', '').replace('/', '-')}-${tool.version}.tgz`,
  )
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  for (const path of manifest.files) {
    const target = join(stage, path)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(root, path), target, { recursive: true })
  }
  // Standard script-disabled npm preparation supplies the ENTIRE runtime closure.
  // No workspace path, local archive locator or build-only dependency is published.
  await cp(archive, join(stage, 'flow-authoring.tgz'))
  await cp(join(root, 'support/authoring-install.json'), join(stage, 'package.json'))
  await cp(join(root, 'support/authoring-package-lock.json'), join(stage, 'package-lock.json'))
  execFileSync('npm', ['ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: stage,
    stdio: 'inherit',
  })
  // Keep the complete npm-installed tool private. It is not a consumer dependency:
  // installers must not re-resolve its unpublished workspace package from a registry.
  // npm's local install index is preparation metadata, not a runtime dependency.
  await rm(join(stage, 'node_modules/.package-lock.json'), { force: true })
  // npm's executable links are not used by the bundled authoring API, and the
  // registry rejects symlinks inside a published package archive.
  await rm(join(stage, 'node_modules/.bin'), { recursive: true, force: true })
  await rename(join(stage, 'node_modules'), join(stage, 'libexec/authoring/node_modules'))
  await rm(join(stage, 'flow-authoring.tgz'))
  await rm(join(stage, 'package-lock.json'))
  delete manifest.devDependencies
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2))
  await requireRegularTree(stage)
  const output = join(
    destination,
    `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`,
  )
  // npm's packlist excludes nested node_modules. Archive this complete, allowlisted
  // package tree in the ordinary npm tarball format instead of pruning its closure.
  execFileSync(
    'tar',
    [
      '--sort=name',
      '--mtime=@0',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '--format=gnu',
      '-czf',
      output,
      '-C',
      temporary,
      'package',
    ],
    {
      stdio: 'inherit',
    },
  )
  console.log(output)
} finally {
  await rm(temporary, { recursive: true, force: true })
}

async function requireRegularTree(root: string, relative = ''): Promise<void> {
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name)
    if (entry.isDirectory()) await requireRegularTree(root, path)
    else if (!entry.isFile()) throw new Error(`Jig archive contains a non-regular entry: ${path}`)
  }
}
