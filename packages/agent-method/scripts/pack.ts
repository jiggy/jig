// Pack the complete method and its exact ordinary SDK development archive.
// This entrypoint consumes existing builds; the public Just recipe builds first.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--destination') {
  throw new Error('Use --destination <directory>. Build the method and SDK before packing.')
}
const destination = resolve(args[1] as string)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const sdkLocator = 'file:./tooling/flow-sdk.tgz'
const temporary = await mkdtemp(join(tmpdir(), 'agent-method-pack-'))
const stage = join(temporary, 'package')

try {
  await mkdir(stage)
  await mkdir(destination, { recursive: true })
  let sdkArchive: string
  const dependency = manifest.devDependencies?.['@jigging/flow']
  if (dependency === sdkLocator) {
    // Repacking an extracted package preserves its included bytes exactly.
    sdkArchive = join(root, 'tooling', 'flow-sdk.tgz')
    const inventory = JSON.parse(await readFile(join(root, 'tooling', 'flow-sdk.json'), 'utf8'))
    if (inventory.sha256 !== digest(await readFile(sdkArchive))) {
      throw new Error('Included FLOW SDK archive does not match tooling/flow-sdk.json.')
    }
  } else if (dependency === 'workspace:*') {
    // Resolve the ordinary public package entrypoint, then pack the entire SDK
    // using its own published allowlist. Never copy selected private modules.
    const sdkRoot = resolve(dirname(fileURLToPath(import.meta.resolve('@jigging/flow'))), '..')
    const sdkManifest = JSON.parse(await readFile(join(sdkRoot, 'package.json'), 'utf8'))
    if (sdkManifest.name !== '@jigging/flow') throw new Error('Expected the FLOW SDK workspace.')
    const supplied = process.env.FLOW_SDK_PACKAGE_ARCHIVE
    if (supplied !== undefined) {
      sdkArchive = await realpath(resolve(supplied))
      if (!(await lstat(sdkArchive)).isFile())
        throw new Error('FLOW_SDK_PACKAGE_ARCHIVE must be a regular archive file.')
      const suppliedManifest = JSON.parse(
        execFileSync('tar', ['-xOf', sdkArchive, 'package/package.json'], { encoding: 'utf8' }),
      )
      if (
        suppliedManifest.name !== sdkManifest.name ||
        suppliedManifest.version !== sdkManifest.version
      ) {
        throw new Error(
          'The supplied SDK archive must match the selected workspace package name and version.',
        )
      }
    } else {
      execFileSync(
        process.execPath,
        ['pm', 'pack', '--ignore-scripts', '--destination', temporary],
        {
          cwd: sdkRoot,
          stdio: 'inherit',
        },
      )
      sdkArchive = join(temporary, `jigging-flow-${sdkManifest.version}.tgz`)
    }
  } else {
    throw new Error(
      'Pack with the workspace FLOW SDK or the included file:./tooling/flow-sdk.tgz dependency.',
    )
  }

  const sdkBytes = await readFile(sdkArchive)
  const sdkManifest = JSON.parse(
    execFileSync('tar', ['-xOf', sdkArchive, 'package/package.json'], {
      encoding: 'utf8',
    }),
  )
  if (
    sdkManifest.name !== '@jigging/flow' ||
    typeof sdkManifest.version !== 'string' ||
    Object.keys(sdkManifest.dependencies ?? {}).length > 0
  ) {
    throw new Error('The included FLOW SDK must be its complete dependency-free public archive.')
  }
  for (const path of manifest.files) {
    if (path === 'tooling') continue
    const target = join(stage, path)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(root, path), target, { recursive: true })
  }
  await mkdir(join(stage, 'tooling'))
  await writeFile(join(stage, 'tooling', 'flow-sdk.tgz'), sdkBytes)
  await writeFile(
    join(stage, 'tooling', 'flow-sdk.json'),
    `${JSON.stringify(
      {
        name: sdkManifest.name,
        version: sdkManifest.version,
        archive: 'flow-sdk.tgz',
        sha256: digest(sdkBytes),
      },
      null,
      2,
    )}\n`,
  )
  manifest.devDependencies['@jigging/flow'] = sdkLocator
  await writeFile(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  execFileSync(process.execPath, ['pm', 'pack', '--ignore-scripts', '--destination', destination], {
    cwd: stage,
    stdio: 'inherit',
  })
} finally {
  await rm(temporary, { recursive: true, force: true })
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}
