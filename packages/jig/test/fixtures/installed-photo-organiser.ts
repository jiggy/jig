import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import {
  type FoundationArchives,
  type FoundationQualification,
  foundationCommands,
  foundationResidue,
} from './host-foundation/materialize.js'

const repository = resolve(import.meta.dir, '../../../..')
const example = join(repository, 'examples/photo-organiser')
const hash = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

async function tree(directory: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) {
      Object.assign(result, await tree(directory, path))
    } else {
      assert.ok((await lstat(join(directory, path))).isFile())
      result[path] = await hash(join(directory, path))
    }
  }
  return result
}

async function put(root: string, path: string, value: string | object) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value), {
    flag: 'wx',
  })
}

/** Copy the unchanged application and configure an ordinary deterministic task. */
export async function materializePhotoProject(
  directory: string,
  archives: FoundationArchives,
  reporting: string,
) {
  const command = foundationCommands(join(directory, 'commands'))
  const candidates = {
    '@jigging/jig': `file:${archives.jig}`,
    '@jigging/flow': `file:${archives.flow}`,
    '@jigging/reporting': `file:${reporting}`,
  }
  await put(directory, 'package.json', {
    name: 'installed-photo-tooling',
    private: true,
    type: 'module',
    dependencies: candidates,
    overrides: candidates,
  })
  await command(['git', 'init', '--quiet'], directory)
  await command(
    [process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
    directory,
    120_000,
  )
  const project = join(directory, 'project')
  await writePhotoProject(project)
  for (const [name, archive] of [
    ['flow', archives.flow],
    ['reporting', reporting],
  ] as const) {
    const library = join(project, 'libs', name)
    await mkdir(library, { recursive: true })
    await command(['tar', '-xzf', archive, '--strip-components=1', '-C', library], directory)
    const packageName = name === 'flow' ? '@jigging/flow' : '@jigging/reporting'
    const installed = await realpath(join(directory, 'node_modules', packageName))
    assert.deepEqual(await tree(library), await tree(installed))
  }
  return { project, command, cli: join(directory, 'node_modules/.bin/jig') }
}

/** Source construction only. This acquires no admission or native authority. */
export async function writePhotoProject(project: string) {
  await cp(join(example, 'flows'), join(project, 'flows'), {
    recursive: true,
    filter: (source) => basename(source) !== 'node_modules',
  })
  await cp(join(example, 'fixtures'), join(project, 'fixtures'), { recursive: true })
  await cp(join(example, 'jig.ts'), join(project, 'jig.ts'))
  await mkdir(join(project, 'grants'))
  for (const binding of ['organise.ts', 'group.ts']) {
    await mkdir(join(project, 'bindings'), { recursive: true })
    await cp(join(example, 'bindings', binding), join(project, 'bindings', binding))
  }
  await put(project, 'package.json', {
    name: 'installed-photo-project',
    private: true,
    type: 'module',
    workspaces: ['flows/*', 'libs/*'],
  })
  await put(
    project,
    'bindings/model.ts',
    `import {defineBinding} from '@jigging/jig'
export default defineBinding({package:'flows/caption-task'})
`,
  )
  await put(project, 'flows/caption-task/package.json', {
    name: 'photo-caption-task',
    private: true,
    type: 'module',
    dependencies: { '@jigging/flow': 'workspace:*' },
  })
  await cp(
    join(example, 'test/caption-task.fixture.ts'),
    join(project, 'flows/caption-task/FLOW.ts'),
  )
  // Preserve every descriptor-relative Agent channel path in its ordinary bundle.
  const agentBundle = join(example, 'flows/group/contracts/agent-run')
  await cp(
    join(agentBundle, 'contract.json'),
    join(project, 'flows/caption-task/FLOW.contract.json'),
  )
  // The copied contract's channel paths are relative to its original descriptor.
  await cp(join(agentBundle, 'contracts'), join(project, 'flows/caption-task/contracts'), {
    recursive: true,
  })
}

export async function runInstalledPhotoProject(options: {
  directory: string
  archives: FoundationArchives
  reporting: string
  qualification: FoundationQualification
}) {
  const { directory, archives, reporting, qualification } = options
  const frozenDigests = await Promise.all([archives.jig, archives.flow, reporting].map(hash))
  const { project, command, cli } = await materializePhotoProject(directory, archives, reporting)
  const sourceBefore = await tree(join(project, 'fixtures/photos'))
  const before = await foundationResidue(qualification, command, directory)
  await command(
    [cli, 'review', '--yes', '--allow-authority-changes', '--allow-resolution-network'],
    project,
  )
  const lock = await hash(join(project, 'jig.lock'))
  const packet = join(directory, 'packet')
  const invoked = await command(
    [
      cli,
      'run',
      'binding:organise',
      '--input',
      '{}',
      '--attach',
      'source=fixtures/photos',
      '--out',
      packet,
      '--timeout',
      '2m',
      '--json',
    ],
    project,
  )
  const result = JSON.parse(invoked.stdout)
  assert.equal(result.status, 'succeeded')
  assert.equal(result.outcome, 'done')
  assert.equal(result.cleanup, undefined, 'The CLI reported cleanup failure')
  assert.equal(result.output.count, 12)
  assert.equal(result.output.manifest, 'copies/manifest.csv')
  assert.equal(result.output.contactSheet, 'overview/contact-sheet.svg')
  assert.equal(result.delivery.status, 'written')
  assert.equal(result.delivery.source, 'final')
  // All deliverables live beneath files/. Forwarded results add their result names.
  const files = join(packet, 'files')
  assert.deepEqual(
    result.delivery.files.map((file: { path: string }) => file.path).sort(),
    [
      ...result.output.photos.map((photo: { destination: string }) => photo.destination),
      'copies/manifest.csv',
      'overview/contact-sheet.svg',
    ].sort(),
  )
  const delivered = await tree(files)
  assert.deepEqual(
    Object.keys(delivered).sort(),
    result.delivery.files.map((file: { path: string }) => file.path).sort(),
  )
  for (const file of result.delivery.files) {
    assert.equal(`sha256:${delivered[file.path]}`, file.digest)
    assert.equal((await readFile(join(files, file.path))).length, file.bytes)
  }
  assert.deepEqual([...result.output.groups].sort(), [
    'Birthday party',
    'Lake picnic',
    'Mountain walk',
  ])
  assert.equal(result.output.photos.length, 12)
  const originals = JSON.parse(await readFile(join(example, 'fixtures/photos/photos.json'), 'utf8'))
  assert.deepEqual(
    result.output.photos.map((photo: { id: string }) => photo.id).sort(),
    originals.map((photo: { id: string }) => photo.id).sort(),
  )
  for (const photo of result.output.photos) {
    const original = originals.find((candidate: { id: string }) => candidate.id === photo.id)
    assert.ok(original)
    for (const field of ['file', 'date', 'caption']) {
      assert.equal(photo[field], original[field])
    }
    assert.ok(photo.destination.startsWith('copies/'))
    assert.deepEqual(
      await readFile(join(files, photo.destination)),
      await readFile(join(example, 'fixtures/photos', photo.file)),
    )
    assert.deepEqual(
      await readFile(join(project, 'fixtures/photos', photo.file)),
      await readFile(join(example, 'fixtures/photos', photo.file)),
    )
  }
  const manifest = await readFile(join(files, 'copies/manifest.csv'), 'utf8')
  assert.equal(manifest.trimEnd().split('\n').length, 13)
  assert.ok(manifest.startsWith('id,original,event,date,copy\n'))
  for (const photo of result.output.photos) {
    assert.ok(manifest.includes(`"${photo.destination.slice('copies/'.length)}"`))
  }
  const sheet = await readFile(join(files, 'overview/contact-sheet.svg'), 'utf8')
  assert.equal(sheet.match(/<image /g)?.length, 24)
  assert.ok(sheet.includes('Original order and names'))
  assert.ok(sheet.includes('Grouped copies'))
  for (const photo of result.output.photos) {
    assert.ok(
      sheet.includes(
        (await readFile(join(example, 'fixtures/photos', photo.file))).toString('base64'),
      ),
    )
  }
  assert.deepEqual(await tree(join(project, 'fixtures/photos')), sourceBefore)
  assert.equal(await hash(join(project, 'jig.lock')), lock)
  assert.deepEqual(
    (await readdir(join(project, '.jig/private-root-owners'))).filter((name) =>
      /^(x-|c-)/.test(name),
    ),
    [],
  )
  assert.deepEqual(await foundationResidue(qualification, command, directory), before)
  assert.deepEqual(
    await Promise.all([archives.jig, archives.flow, reporting].map(hash)),
    frozenDigests,
  )
  await put(directory, 'verified.json', {
    application: 'photo-organiser',
    photos: 12,
    residue: 'unchanged',
    archiveDigests: frozenDigests,
  })
}
