import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import {
  type FoundationArchives,
  type FoundationQualification,
  foundationCommands,
  foundationResidue,
  lockFoundationWorkspace,
} from './host-foundation/materialize.js'

const example = resolve(import.meta.dir, '../../../../examples/contact-import')
const hash = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

async function put(root: string, path: string, value: string | object) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value), {
    flag: 'wx',
  })
}

/** Unchanged application Flows with normally installed public dependencies. */
export async function runInstalledContactProject(options: {
  directory: string
  archives: FoundationArchives
  reporting: string
  qualification: FoundationQualification
}) {
  const { directory, archives, reporting, qualification } = options
  const command = foundationCommands(join(directory, 'commands'))
  const frozen = await Promise.all([archives.jig, archives.flow, reporting].map(hash))
  const candidates = {
    '@jigging/jig': `file:${archives.jig}`,
    '@jigging/flow': `file:${archives.flow}`,
    '@jigging/reporting': `file:${reporting}`,
  }
  await put(directory, 'package.json', {
    name: 'installed-contact-tooling',
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
  for (const name of [
    'import',
    'read-contacts',
    'map-code',
    'map-agent',
    'map-mixed',
    'convert',
    'export-preview',
  ])
    await cp(join(example, 'flows', name), join(project, 'flows', name), {
      recursive: true,
      filter: (source) => basename(source) !== 'node_modules',
    })
  await cp(join(example, 'fixtures'), join(project, 'fixtures'), { recursive: true })
  await put(project, 'package.json', {
    name: 'installed-contact-project',
    private: true,
    type: 'module',
    workspaces: ['flows/*', 'libs/*'],
  })
  // An ordinary deterministic Flow performs the declared header-mapping task.
  // It supplies no native-client, session, execution or cleanup receipts.
  // First review and Run use the example's original project definition.
  await cp(join(example, 'jig.ts'), join(project, 'jig.ts'))
  await mkdir(join(project, 'bindings'))
  await cp(join(example, 'bindings/code.ts'), join(project, 'bindings/code.ts'))
  await put(
    project,
    'bindings/model.ts',
    `import {defineBinding} from '@jigging/jig'
export default defineBinding({package:'flows/header-task'})
`,
  )
  await put(project, 'flows/header-task/package.json', {
    name: 'contact-header-task',
    private: true,
    type: 'module',
    dependencies: { '@jigging/flow': 'workspace:*' },
  })
  const bundle = join(example, 'flows/map-agent/contracts/agent-run')
  await cp(join(bundle, 'contract.json'), join(project, 'flows/header-task/FLOW.contract.json'))
  await cp(join(bundle, 'contracts'), join(project, 'flows/header-task/contracts'), {
    recursive: true,
  })
  await put(
    project,
    'flows/header-task/FLOW.ts',
    `import assert from 'node:assert/strict'
import {handle} from '@jigging/flow'
await handle(async run => {
  const {instructions,responseSchema} = run.input
  assert.equal(responseSchema.additionalProperties,false)
  assert.deepEqual(responseSchema.required,['name','email','organization'])
  const request = JSON.parse(instructions.slice(instructions.lastIndexOf('\\n\\n')+2))
  assert.deepEqual(Object.keys(request),['headers'])
  const aliases = {
    name:['Customer','Nom complet'],
    email:['Email address','Courriel'],
    organization:['Company','Organisation'],
  }
  const selected = Object.fromEntries(Object.entries(aliases).map(([field,names]) => {
    const candidates = request.headers.flatMap((heading,index) => names.includes(heading) ? [index] : [])
    return [field,candidates.length === 1 ? candidates[0] : null]
  }))
  const complete = Object.values(selected).every(value => value !== null)
    && new Set(Object.values(selected)).size === 3
  const structured = complete ? selected : {name:null,email:null,organization:null}
  return {outcome:'done',output:{text:JSON.stringify(structured),structured}}
})
`,
  )
  for (const [name, archive] of [
    ['flow', archives.flow],
    ['reporting', reporting],
  ] as const) {
    const library = join(project, 'libs', name)
    await mkdir(library, { recursive: true })
    await command(['tar', '-xzf', archive, '--strip-components=1', '-C', library], directory)
  }
  const cli = join(directory, 'node_modules/.bin/jig')
  const before = await foundationResidue(qualification, command, directory)
  const sourceLock = await lockFoundationWorkspace(project, command)
  await command([cli, 'review', '--yes', '--allow-authority-changes'], project)
  assert.equal(await readFile(join(project, 'bun.lock'), 'utf8'), sourceLock)
  let lock = await hash(join(project, 'jig.lock'))
  const packet = join(directory, 'packet')
  // No target, input, attachments or timeout override: exercise authored defaults.
  const invoked = await command([cli, 'run', '--out', packet, '--json'], project)
  assert.deepEqual(await readFile(join(project, 'jig.ts')), await readFile(join(example, 'jig.ts')))
  const result = JSON.parse(invoked.stdout)
  assert.equal(result.status, 'succeeded')
  assert.equal(result.outcome, 'done')
  assert.equal(result.cleanup, undefined, 'The CLI reported cleanup failure')
  assert.equal(result.output.status, 'ready')
  assert.deepEqual(result.output.mapping, { name: 0, email: 1, organization: 2 })
  assert.deepEqual(result.output.accepted, [
    {
      record: 2,
      contact: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        organization: 'Analytical Engines',
      },
    },
    {
      record: 4,
      contact: {
        name: 'Lin, Mei',
        email: 'mei@example.com',
        organization: 'Example, Ltd',
      },
    },
  ])
  assert.equal(result.output.rejected.length, 1)
  assert.equal(result.output.rejected[0].record, 3)
  assert.equal(result.delivery.status, 'written')
  assert.equal(result.delivery.source, 'final')
  // The coordinator forwards the exporter's immutable artifact under its result name.
  const preview = join(packet, 'files/preview/preview.json')
  const previewBytes = await readFile(preview)
  assert.deepEqual(result.delivery.files, [
    {
      path: 'preview/preview.json',
      bytes: previewBytes.length,
      digest: `sha256:${createHash('sha256').update(previewBytes).digest('hex')}`,
    },
  ])
  assert.deepEqual(JSON.parse(previewBytes.toString('utf8')), result.output)
  assert.deepEqual(await readdir(join(packet, 'files')), ['preview'])
  assert.deepEqual(await readdir(join(packet, 'files/preview')), ['preview.json'])
  // Qualify the alternative mappers in a separate operator configuration.
  assert.equal(await hash(join(project, 'jig.lock')), lock)
  await writeFile(
    join(project, 'jig.ts'),
    `import {defineJig,discover} from '@jigging/jig'
export default defineJig({flows:discover('flows'),bindings:discover('bindings'),
defaultProviders:{'https://jig.md/contracts/agent-run':'binding:model'}})
`,
  )
  await command([cli, 'review', '--yes', '--allow-authority-changes'], project)
  lock = await hash(join(project, 'jig.lock'))
  for (const method of ['map-agent', 'map-mixed'])
    for (const [headers, mapping] of [
      [['Organisation', 'Courriel', 'Nom complet'], { name: 2, email: 1, organization: 0 }],
      [['Unclear heading'], null],
    ] as const) {
      const mapped = await command(
        [
          cli,
          'run',
          `flow:flows/${method}`,
          '--input',
          JSON.stringify({ headers }),
          '--timeout',
          '2m',
          '--json',
        ],
        project,
      )
      const actual = JSON.parse(mapped.stdout)
      assert.equal(actual.status, 'succeeded')
      assert.equal(actual.outcome, 'done')
      assert.equal(actual.cleanup, undefined)
      assert.deepEqual(actual.output, { mapping })
    }
  assert.deepEqual(
    await readFile(join(project, 'fixtures/known/contacts.csv')),
    await readFile(join(example, 'fixtures/known/contacts.csv')),
  )
  assert.equal(await hash(join(project, 'jig.lock')), lock)
  assert.deepEqual(
    (await readdir(join(project, '.jig/private-root-owners'))).filter((name) =>
      /^(x-|c-)/.test(name),
    ),
    [],
  )
  assert.deepEqual(await foundationResidue(qualification, command, directory), before)
  assert.deepEqual(await Promise.all([archives.jig, archives.flow, reporting].map(hash)), frozen)
  await put(directory, 'verified.json', {
    application: 'contact-import',
    accepted: 2,
    rejected: 1,
    residue: 'unchanged',
    archiveDigests: frozen,
  })
}
